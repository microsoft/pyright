/*
 * sourceFile.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Class that represents a single Python source or stub file.
 */

import {
    CancellationToken,
    CompletionItem,
    DocumentHighlight,
    DocumentSymbol,
    MarkupKind,
} from 'vscode-languageserver';
import { TextDocument, TextDocumentContentChangeEvent } from 'vscode-languageserver-textdocument';
import { isMainThread } from 'worker_threads';

import * as SymbolNameUtils from '../analyzer/symbolNameUtils';
import { OperationCanceledException } from '../common/cancellationUtils';
import {
    ConfigOptions,
    ExecutionEnvironment,
    getBasicDiagnosticRuleSet,
    SignatureDisplayType,
} from '../common/configOptions';
import { ConsoleInterface, StandardConsole } from '../common/console';
import { assert } from '../common/debug';
import { TaskListToken } from '../common/diagnostic';
import { convertLevelToCategory, Diagnostic, DiagnosticCategory } from '../common/diagnostic';
import { DiagnosticRule } from '../common/diagnosticRules';
import { DiagnosticSink, TextRangeDiagnosticSink } from '../common/diagnosticSink';
import { TextEditAction } from '../common/editAction';
import { Extensions } from '../common/extensibility';
import { FileSystem } from '../common/fileSystem';
import { LogTracker } from '../common/logTracker';
import { fromLSPAny } from '../common/lspUtils';
import { getFileName, normalizeSlashes, stripFileExtension } from '../common/pathUtils';
import { convertOffsetsToRange, convertTextRangeToRange } from '../common/positionUtils';
import * as StringUtils from '../common/stringUtils';
import { DocumentRange, getEmptyRange, Position, Range, TextRange } from '../common/textRange';
import { TextRangeCollection } from '../common/textRangeCollection';
import { Duration, timingStats } from '../common/timing';
import { ModuleSymbolMap } from '../languageService/autoImporter';
import { AbbreviationMap, CompletionOptions, CompletionResults } from '../languageService/completionProvider';
import { CompletionItemData, CompletionProvider } from '../languageService/completionProvider';
import { DefinitionFilter, DefinitionProvider } from '../languageService/definitionProvider';
import { DocumentHighlightProvider } from '../languageService/documentHighlightProvider';
import { DocumentSymbolCollectorUseCase } from '../languageService/documentSymbolCollector';
import { DocumentSymbolProvider, IndexOptions, IndexResults } from '../languageService/documentSymbolProvider';
import { HoverProvider, HoverResults } from '../languageService/hoverProvider';
import { performQuickAction } from '../languageService/quickActions';
import { ReferenceCallback, ReferencesProvider, ReferencesResult } from '../languageService/referencesProvider';
import { SignatureHelpProvider, SignatureHelpResults } from '../languageService/signatureHelpProvider';
import { Localizer } from '../localization/localize';
import { ModuleNode } from '../parser/parseNodes';
import { ModuleImport, ParseOptions, Parser, ParseResults } from '../parser/parser';
import { IgnoreComment } from '../parser/tokenizer';
import { Token } from '../parser/tokenizerTypes';
import { AnalyzerFileInfo, ImportLookup } from './analyzerFileInfo';
import * as AnalyzerNodeInfo from './analyzerNodeInfo';
import { Binder } from './binder';
import { Checker } from './checker';
import { CircularDependency } from './circularDependency';
import * as CommentUtils from './commentUtils';
import { ImportResolver } from './importResolver';
import { ImportResult } from './importResult';
import { ParseTreeCleanerWalker } from './parseTreeCleaner';
import { Scope } from './scope';
import { SourceMapper } from './sourceMapper';
import { SymbolTable } from './symbol';
import { TestWalker } from './testWalker';
import { TypeEvaluator } from './typeEvaluatorTypes';

// Limit the number of import cycles tracked per source file.
const _maxImportCyclesPerFile = 4;

// Allow files up to 50MB in length, same as VS Code.
// https://github.com/microsoft/vscode/blob/1e750a7514f365585d8dab1a7a82e0938481ea2f/src/vs/editor/common/model/textModel.ts#L194
const _maxSourceFileSize = 50 * 1024 * 1024;

interface ResolveImportResult {
    imports: ImportResult[];
    builtinsImportResult?: ImportResult | undefined;
    ipythonDisplayImportResult?: ImportResult | undefined;
}

// Indicates whether IPython syntax is supported and if so, what
// type of notebook support is in use.
export enum IPythonMode {
    // Not a notebook. This is the only falsy enum value, so you
    // can test if IPython is supported via "if (ipythonMode)"
    None = 0,
    // Each cell is its own document.
    CellDocs,
}

export class SourceFile {
    // Console interface to use for debugging.
    private _console: ConsoleInterface;

    // File path unique to this file within the workspace. May not represent
    // a real file on disk.
    private readonly _filePath: string;

    // File path on disk. May not be unique.
    private readonly _realFilePath: string;

    // Period-delimited import path for the module.
    private _moduleName: string;

    // True if file is a type-hint (.pyi) file versus a python
    // (.py) file.
    private readonly _isStubFile: boolean;

    // True if the file was imported as a third-party import.
    private readonly _isThirdPartyImport: boolean;

    // True if the file is the "typing.pyi" file, which needs
    // special-case handling.
    private readonly _isTypingStubFile: boolean;

    // True if the file is the "typing_extensions.pyi" file, which needs
    // special-case handling.
    private readonly _isTypingExtensionsStubFile: boolean;

    // True if the file one of the other built-in stub files
    // that require special-case handling: "collections.pyi",
    // "dataclasses.pyi", "abc.pyi", "asyncio/coroutines.pyi".
    private readonly _isBuiltInStubFile: boolean;

    // True if the file is part of a package that contains a
    // "py.typed" file.
    private readonly _isThirdPartyPyTypedPresent: boolean;

    // True if the file appears to have been deleted.
    private _isFileDeleted = false;

    // Number that is incremented every time the diagnostics
    // are updated.
    private _diagnosticVersion = 0;

    // Generation count of the file contents. When the contents
    // change, this is incremented.
    private _fileContentsVersion = 0;

    // Length and hash of the file the last time it was read from disk.
    private _lastFileContentLength: number | undefined = undefined;
    private _lastFileContentHash: number | undefined = undefined;

    // Client's version of the file. Undefined implies that contents
    // need to be read from disk.
    private _clientDocument: TextDocument | undefined;

    // Version of file contents that have been analyzed.
    private _analyzedFileContentsVersion = -1;

    // Do we need to walk the parse tree and clean
    // the binder information hanging from it?
    private _parseTreeNeedsCleaning = false;

    private _parseResults: ParseResults | undefined;
    private _moduleSymbolTable: SymbolTable | undefined;
    private _cachedIndexResults: IndexResults | undefined;

    // Reentrancy check for binding.
    private _isBindingInProgress = false;

    // Diagnostics generated during different phases of analysis.
    private _parseDiagnostics: Diagnostic[] = [];
    private _commentDiagnostics: Diagnostic[] = [];
    private _bindDiagnostics: Diagnostic[] = [];
    private _checkerDiagnostics: Diagnostic[] = [];
    private _typeIgnoreLines = new Map<number, IgnoreComment>();
    private _typeIgnoreAll: IgnoreComment | undefined;
    private _pyrightIgnoreLines = new Map<number, IgnoreComment>();

    // Settings that control which diagnostics should be output. The rules
    // are initialized to the basic set. They should be updated after the
    // the file is parsed.
    private _diagnosticRuleSet = getBasicDiagnosticRuleSet();

    // Circular dependencies that have been reported in this file.
    private _circularDependencies: CircularDependency[] = [];
    private _noCircularDependencyConfirmed = false;

    // Did we hit the maximum import depth?
    private _hitMaxImportDepth: number | undefined;

    // Do we need to perform a binding step?
    private _isBindingNeeded = true;

    // Do we have valid diagnostic results from a checking pass?
    private _isCheckingNeeded = true;

    // Time (in ms) that the last check() call required for this file.
    private _checkTime: number | undefined;

    // Do we need to perform an indexing step?
    private _indexingNeeded = true;

    // Indicate whether this file is for ipython or not.
    private _ipythonMode = IPythonMode.None;

    // Information about implicit and explicit imports from this file.
    private _imports: ImportResult[] | undefined;
    private _builtinsImport: ImportResult | undefined;
    private _ipythonDisplayImport: ImportResult | undefined;

    private _logTracker: LogTracker;
    readonly fileSystem: FileSystem;

    constructor(
        fs: FileSystem,
        filePath: string,
        moduleName: string,
        isThirdPartyImport: boolean,
        isThirdPartyPyTypedPresent: boolean,
        console?: ConsoleInterface,
        logTracker?: LogTracker,
        realFilePath?: string,
        ipythonMode = IPythonMode.None
    ) {
        this.fileSystem = fs;
        this._console = console || new StandardConsole();
        this._filePath = filePath;
        this._realFilePath = realFilePath ?? filePath;
        this._moduleName = moduleName;
        this._isStubFile = filePath.endsWith('.pyi');
        this._isThirdPartyImport = isThirdPartyImport;
        this._isThirdPartyPyTypedPresent = isThirdPartyPyTypedPresent;
        const fileName = getFileName(filePath);
        this._isTypingStubFile =
            this._isStubFile &&
            (this._filePath.endsWith(normalizeSlashes('stdlib/typing.pyi')) || fileName === 'typing_extensions.pyi');
        this._isTypingExtensionsStubFile = this._isStubFile && fileName === 'typing_extensions.pyi';

        this._isBuiltInStubFile = false;
        if (this._isStubFile) {
            if (
                this._filePath.endsWith(normalizeSlashes('stdlib/collections/__init__.pyi')) ||
                this._filePath.endsWith(normalizeSlashes('stdlib/asyncio/futures.pyi')) ||
                this._filePath.endsWith(normalizeSlashes('stdlib/asyncio/tasks.pyi')) ||
                this._filePath.endsWith(normalizeSlashes('stdlib/builtins.pyi')) ||
                this._filePath.endsWith(normalizeSlashes('stdlib/_importlib_modulespec.pyi')) ||
                this._filePath.endsWith(normalizeSlashes('stdlib/dataclasses.pyi')) ||
                this._filePath.endsWith(normalizeSlashes('stdlib/abc.pyi')) ||
                this._filePath.endsWith(normalizeSlashes('stdlib/enum.pyi')) ||
                this._filePath.endsWith(normalizeSlashes('stdlib/queue.pyi')) ||
                this._filePath.endsWith(normalizeSlashes('stdlib/types.pyi'))
            ) {
                this._isBuiltInStubFile = true;
            }
        }

        // 'FG' or 'BG' based on current thread.
        this._logTracker = logTracker ?? new LogTracker(console, isMainThread ? 'FG' : 'BG');
        this._ipythonMode = ipythonMode;
    }

    getRealFilePath(): string {
        return this._realFilePath;
    }

    getIPythonMode(): IPythonMode {
        return this._ipythonMode;
    }

    getFilePath(): string {
        return this._filePath;
    }

    getModuleName(): string {
        return this._moduleName;
    }

    setModuleName(name: string) {
        this._moduleName = name;
    }

    getDiagnosticVersion(): number {
        return this._diagnosticVersion;
    }

    isStubFile() {
        return this._isStubFile;
    }

    isThirdPartyPyTypedPresent() {
        return this._isThirdPartyPyTypedPresent;
    }

    // Returns a list of cached diagnostics from the latest analysis job.
    // If the prevVersion is specified, the method returns undefined if
    // the diagnostics haven't changed.
    getDiagnostics(options: ConfigOptions, prevDiagnosticVersion?: number): Diagnostic[] | undefined {
        if (this._diagnosticVersion === prevDiagnosticVersion) {
            return undefined;
        }

        let includeWarningsAndErrors = true;

        // If a file was imported as a third-party file, don't report
        // any errors for it. The user can't fix them anyway.
        if (this._isThirdPartyImport) {
            includeWarningsAndErrors = false;
        }

        let diagList = [
            ...this._parseDiagnostics,
            ...this._commentDiagnostics,
            ...this._bindDiagnostics,
            ...this._checkerDiagnostics,
        ];
        const prefilteredDiagList = diagList;
        const typeIgnoreLinesClone = new Map(this._typeIgnoreLines);
        const pyrightIgnoreLinesClone = new Map(this._pyrightIgnoreLines);

        // Filter the diagnostics based on "type: ignore" lines.
        if (this._diagnosticRuleSet.enableTypeIgnoreComments) {
            if (this._typeIgnoreLines.size > 0) {
                diagList = diagList.filter((d) => {
                    if (
                        d.category !== DiagnosticCategory.UnusedCode &&
                        d.category !== DiagnosticCategory.UnreachableCode &&
                        d.category !== DiagnosticCategory.Deprecated
                    ) {
                        for (let line = d.range.start.line; line <= d.range.end.line; line++) {
                            if (this._typeIgnoreLines.has(line)) {
                                typeIgnoreLinesClone.delete(line);
                                return false;
                            }
                        }
                    }

                    return true;
                });
            }
        }

        // Filter the diagnostics based on "pyright: ignore" lines.
        if (this._pyrightIgnoreLines.size > 0) {
            diagList = diagList.filter((d) => {
                if (d.category !== DiagnosticCategory.UnreachableCode && d.category !== DiagnosticCategory.Deprecated) {
                    for (let line = d.range.start.line; line <= d.range.end.line; line++) {
                        const pyrightIgnoreComment = this._pyrightIgnoreLines.get(line);
                        if (pyrightIgnoreComment) {
                            if (!pyrightIgnoreComment.rulesList) {
                                pyrightIgnoreLinesClone.delete(line);
                                return false;
                            }

                            const diagRule = d.getRule();
                            if (!diagRule) {
                                // If there's no diagnostic rule, it won't match
                                // against a rules list.
                                return true;
                            }

                            // Did we find this rule in the list?
                            if (pyrightIgnoreComment.rulesList.find((rule) => rule.text === diagRule)) {
                                // Update the pyrightIgnoreLinesClone to remove this rule.
                                const oldClone = pyrightIgnoreLinesClone.get(line);
                                if (oldClone?.rulesList) {
                                    const filteredRulesList = oldClone.rulesList.filter(
                                        (rule) => rule.text !== diagRule
                                    );
                                    if (filteredRulesList.length === 0) {
                                        pyrightIgnoreLinesClone.delete(line);
                                    } else {
                                        pyrightIgnoreLinesClone.set(line, {
                                            range: oldClone.range,
                                            rulesList: filteredRulesList,
                                        });
                                    }
                                }

                                return false;
                            }

                            return true;
                        }
                    }
                }

                return true;
            });
        }

        const unnecessaryTypeIgnoreDiags: Diagnostic[] = [];

        if (this._diagnosticRuleSet.reportUnnecessaryTypeIgnoreComment !== 'none') {
            const diagCategory = convertLevelToCategory(this._diagnosticRuleSet.reportUnnecessaryTypeIgnoreComment);

            const prefilteredErrorList = prefilteredDiagList.filter(
                (diag) =>
                    diag.category === DiagnosticCategory.Error ||
                    diag.category === DiagnosticCategory.Warning ||
                    diag.category === DiagnosticCategory.Information
            );

            const isUnreachableCodeRange = (range: Range) => {
                return prefilteredDiagList.find(
                    (diag) =>
                        diag.category === DiagnosticCategory.UnreachableCode &&
                        diag.range.start.line <= range.start.line &&
                        diag.range.end.line >= range.end.line
                );
            };

            if (prefilteredErrorList.length === 0 && this._typeIgnoreAll !== undefined) {
                const rangeStart = this._typeIgnoreAll.range.start;
                const rangeEnd = rangeStart + this._typeIgnoreAll.range.length;
                const range = convertOffsetsToRange(rangeStart, rangeEnd, this._parseResults!.tokenizerOutput.lines!);

                if (!isUnreachableCodeRange(range) && this._diagnosticRuleSet.enableTypeIgnoreComments) {
                    unnecessaryTypeIgnoreDiags.push(
                        new Diagnostic(diagCategory, Localizer.Diagnostic.unnecessaryTypeIgnore(), range)
                    );
                }
            }

            typeIgnoreLinesClone.forEach((ignoreComment) => {
                if (this._parseResults?.tokenizerOutput.lines) {
                    const rangeStart = ignoreComment.range.start;
                    const rangeEnd = rangeStart + ignoreComment.range.length;
                    const range = convertOffsetsToRange(
                        rangeStart,
                        rangeEnd,
                        this._parseResults!.tokenizerOutput.lines!
                    );

                    if (!isUnreachableCodeRange(range) && this._diagnosticRuleSet.enableTypeIgnoreComments) {
                        unnecessaryTypeIgnoreDiags.push(
                            new Diagnostic(diagCategory, Localizer.Diagnostic.unnecessaryTypeIgnore(), range)
                        );
                    }
                }
            });

            pyrightIgnoreLinesClone.forEach((ignoreComment) => {
                if (this._parseResults?.tokenizerOutput.lines) {
                    if (!ignoreComment.rulesList) {
                        const rangeStart = ignoreComment.range.start;
                        const rangeEnd = rangeStart + ignoreComment.range.length;
                        const range = convertOffsetsToRange(
                            rangeStart,
                            rangeEnd,
                            this._parseResults!.tokenizerOutput.lines!
                        );

                        if (!isUnreachableCodeRange(range)) {
                            unnecessaryTypeIgnoreDiags.push(
                                new Diagnostic(diagCategory, Localizer.Diagnostic.unnecessaryPyrightIgnore(), range)
                            );
                        }
                    } else {
                        ignoreComment.rulesList.forEach((unusedRule) => {
                            const rangeStart = unusedRule.range.start;
                            const rangeEnd = rangeStart + unusedRule.range.length;
                            const range = convertOffsetsToRange(
                                rangeStart,
                                rangeEnd,
                                this._parseResults!.tokenizerOutput.lines!
                            );

                            if (!isUnreachableCodeRange(range)) {
                                unnecessaryTypeIgnoreDiags.push(
                                    new Diagnostic(
                                        diagCategory,
                                        Localizer.Diagnostic.unnecessaryPyrightIgnoreRule().format({
                                            name: unusedRule.text,
                                        }),
                                        range
                                    )
                                );
                            }
                        });
                    }
                }
            });
        }

        if (this._diagnosticRuleSet.reportImportCycles !== 'none' && this._circularDependencies.length > 0) {
            const category = convertLevelToCategory(this._diagnosticRuleSet.reportImportCycles);

            this._circularDependencies.forEach((cirDep) => {
                const diag = new Diagnostic(
                    category,
                    Localizer.Diagnostic.importCycleDetected() +
                        '\n' +
                        cirDep
                            .getPaths()
                            .map((path) => '  ' + path)
                            .join('\n'),
                    getEmptyRange()
                );
                diag.setRule(DiagnosticRule.reportImportCycles);
                diagList.push(diag);
            });
        }

        if (this._hitMaxImportDepth !== undefined) {
            diagList.push(
                new Diagnostic(
                    DiagnosticCategory.Error,
                    Localizer.Diagnostic.importDepthExceeded().format({ depth: this._hitMaxImportDepth }),
                    getEmptyRange()
                )
            );
        }

        // add diagnostics for comments that match the task list tokens
        this._addTaskListDiagnostics(options.taskListTokens, diagList);

        // If the file is in the ignore list, clear the diagnostic list.
        if (options.ignore.find((ignoreFileSpec) => ignoreFileSpec.regExp.test(this._realFilePath))) {
            diagList = [];
        }

        // If there is a "type: ignore" comment at the top of the file, clear
        // the diagnostic list of all error, warning, and information diagnostics.
        if (this._diagnosticRuleSet.enableTypeIgnoreComments) {
            if (this._typeIgnoreAll !== undefined) {
                diagList = diagList.filter(
                    (diag) =>
                        diag.category !== DiagnosticCategory.Error &&
                        diag.category !== DiagnosticCategory.Warning &&
                        diag.category !== DiagnosticCategory.Information
                );
            }
        }

        // Now add in the "unnecessary type ignore" diagnostics.
        diagList = diagList.concat(unnecessaryTypeIgnoreDiags);

        // If we're not returning any diagnostics, filter out all of
        // the errors and warnings, leaving only the unreachable code
        // and deprecated diagnostics.
        if (!includeWarningsAndErrors) {
            diagList = diagList.filter(
                (diag) =>
                    diag.category === DiagnosticCategory.UnusedCode ||
                    diag.category === DiagnosticCategory.UnreachableCode ||
                    diag.category === DiagnosticCategory.Deprecated
            );
        }

        return diagList;
    }

    // Get all task list diagnostics for the current file and add them
    // to the specified diagnostic list
    private _addTaskListDiagnostics(taskListTokens: TaskListToken[] | undefined, diagList: Diagnostic[]) {
        // input validation
        if (!taskListTokens || taskListTokens.length === 0 || !diagList) {
            return;
        }

        // if we have no tokens, we're done
        if (!this._parseResults?.tokenizerOutput?.tokens) {
            return;
        }

        const tokenizerOutput = this._parseResults.tokenizerOutput;
        for (let i = 0; i < tokenizerOutput.tokens.count; i++) {
            const token = tokenizerOutput.tokens.getItemAt(i);

            // if there are no comments, skip this token
            if (!token.comments || token.comments.length === 0) {
                continue;
            }

            for (const comment of token.comments) {
                for (const token of taskListTokens) {
                    // Check if the comment matches the task list token.
                    // The comment must start with zero or more whitespace characters,
                    // followed by the taskListToken (case insensitive),
                    // followed by (0+ whitespace + EOL) OR (1+ NON-alphanumeric characters)
                    const regexStr = '^[\\s]*' + token.text + '([\\s]*$|[\\W]+)';
                    const regex = RegExp(regexStr, 'i'); // case insensitive

                    // if the comment doesn't match, skip it
                    if (!regex.test(comment.value)) {
                        continue;
                    }

                    // Calculate the range for the diagnostic
                    // This allows navigation to the comment via double clicking the item in the task list pane
                    let rangeStart = comment.start;

                    // The comment technically starts right after the comment identifier (#), but we want the caret right
                    // before the task list token (since there might be whitespace before it)
                    const indexOfToken = comment.value.toLowerCase().indexOf(token.text.toLowerCase());
                    rangeStart += indexOfToken;

                    const rangeEnd = TextRange.getEnd(comment);
                    const range = convertOffsetsToRange(rangeStart, rangeEnd, tokenizerOutput.lines!);

                    // Add the diagnostic to the list to send to VS,
                    // and trim whitespace from the comment so it's easier to read in the task list
                    diagList.push(
                        new Diagnostic(DiagnosticCategory.TaskItem, comment.value.trim(), range, token.priority)
                    );
                }
            }
        }
    }

    getImports(): ImportResult[] {
        return this._imports || [];
    }

    getBuiltinsImport(): ImportResult | undefined {
        return this._builtinsImport;
    }

    getIPythonDisplayImport(): ImportResult | undefined {
        return this._ipythonDisplayImport;
    }

    getModuleSymbolTable(): SymbolTable | undefined {
        return this._moduleSymbolTable;
    }

    getCheckTime() {
        return this._checkTime;
    }

    // Indicates whether the contents of the file have changed since
    // the last analysis was performed.
    didContentsChangeOnDisk(): boolean {
        // If this is an open file any content changes will be
        // provided through the editor. We can assume contents
        // didn't change without us knowing about them.
        if (this._clientDocument) {
            return false;
        }

        // If the file was never read previously, no need to check for a change.
        if (this._lastFileContentLength === undefined) {
            return false;
        }

        // Read in the latest file contents and see if the hash matches
        // that of the previous contents.
        try {
            // Read the file's contents.
            const fileContents = this.fileSystem.readFileSync(this._filePath, 'utf8');

            if (fileContents.length !== this._lastFileContentLength) {
                return true;
            }

            if (StringUtils.hashString(fileContents) !== this._lastFileContentHash) {
                return true;
            }
        } catch (error) {
            return true;
        }

        return false;
    }

    // Drop parse and binding info to save memory. It is used
    // in cases where memory is low. When info is needed, the file
    // will be re-parsed and rebound.
    dropParseAndBindInfo(): void {
        this._parseResults = undefined;
        this._moduleSymbolTable = undefined;
        this._isBindingNeeded = true;
    }

    markDirty(indexingNeeded = true): void {
        this._fileContentsVersion++;
        this._noCircularDependencyConfirmed = false;
        this._isCheckingNeeded = true;
        this._isBindingNeeded = true;
        this._indexingNeeded = indexingNeeded;
        this._moduleSymbolTable = undefined;
        this._cachedIndexResults = undefined;
        const filePath = this.getFilePath();
        Extensions.getProgramExtensions(filePath).forEach((e) => (e.fileDirty ? e.fileDirty(filePath) : null));
    }

    markReanalysisRequired(forceRebinding: boolean): void {
        // Keep the parse info, but reset the analysis to the beginning.
        this._isCheckingNeeded = true;
        this._noCircularDependencyConfirmed = false;

        // If the file contains a wildcard import or __all__ symbols,
        // we need to rebind because a dependent import may have changed.
        if (this._parseResults) {
            if (
                this._parseResults.containsWildcardImport ||
                AnalyzerNodeInfo.getDunderAllInfo(this._parseResults.parseTree) !== undefined ||
                forceRebinding
            ) {
                // We don't need to rebuild index data since wildcard
                // won't affect user file indices. User file indices
                // don't contain import alias info.
                this._parseTreeNeedsCleaning = true;
                this._isBindingNeeded = true;
                this._moduleSymbolTable = undefined;
            }
        }
    }

    getClientVersion() {
        return this._clientDocument?.version;
    }

    getOpenFileContents() {
        return this._clientDocument?.getText();
    }

    getFileContent(): string | undefined {
        // Get current buffer content if the file is opened.
        const openFileContent = this.getOpenFileContents();
        if (openFileContent !== undefined) {
            return openFileContent;
        }

        // Otherwise, get content from file system.
        try {
            // Check the file's length before attempting to read its full contents.
            const fileStat = this.fileSystem.statSync(this._filePath);
            if (fileStat.size > _maxSourceFileSize) {
                this._console.error(
                    `File length of "${this._filePath}" is ${fileStat.size} ` +
                        `which exceeds the maximum supported file size of ${_maxSourceFileSize}`
                );
                throw new Error('File larger than max');
            }

            return this.fileSystem.readFileSync(this._filePath, 'utf8');
        } catch (error) {
            return undefined;
        }
    }

    setClientVersion(version: number | null, contents: TextDocumentContentChangeEvent[]): void {
        if (version === null) {
            this._clientDocument = undefined;
        } else {
            if (!this._clientDocument) {
                this._clientDocument = TextDocument.create(this._filePath, 'python', version, '');
            }
            this._clientDocument = TextDocument.update(this._clientDocument, contents, version);

            const fileContents = this._clientDocument.getText();
            const contentsHash = StringUtils.hashString(fileContents);

            // Have the contents of the file changed?
            if (fileContents.length !== this._lastFileContentLength || contentsHash !== this._lastFileContentHash) {
                this.markDirty();
            }

            this._lastFileContentLength = fileContents.length;
            this._lastFileContentHash = contentsHash;
            this._isFileDeleted = false;
        }
    }

    prepareForClose() {
        // Nothing to do currently.
    }

    isFileDeleted() {
        return this._isFileDeleted;
    }

    isParseRequired() {
        return !this._parseResults || this._analyzedFileContentsVersion !== this._fileContentsVersion;
    }

    isBindingRequired() {
        if (this._isBindingInProgress) {
            return false;
        }

        if (this.isParseRequired()) {
            return true;
        }

        return this._isBindingNeeded;
    }

    isIndexingRequired() {
        return this._indexingNeeded;
    }

    isCheckingRequired() {
        return this._isCheckingNeeded;
    }

    getParseResults(): ParseResults | undefined {
        if (!this.isParseRequired()) {
            return this._parseResults;
        }

        return undefined;
    }

    getCachedIndexResults(): IndexResults | undefined {
        return this._cachedIndexResults;
    }

    cacheIndexResults(indexResults: IndexResults) {
        this._cachedIndexResults = indexResults;
    }

    // Adds a new circular dependency for this file but only if
    // it hasn't already been added.
    addCircularDependency(circDependency: CircularDependency) {
        let updatedDependencyList = false;

        // Some topologies can result in a massive number of cycles. We'll cut it off.
        if (this._circularDependencies.length < _maxImportCyclesPerFile) {
            if (!this._circularDependencies.some((dep) => dep.isEqual(circDependency))) {
                this._circularDependencies.push(circDependency);
                updatedDependencyList = true;
            }
        }

        if (updatedDependencyList) {
            this._diagnosticVersion++;
        }
    }

    setNoCircularDependencyConfirmed() {
        this._noCircularDependencyConfirmed = true;
    }

    isNoCircularDependencyConfirmed() {
        return !this.isParseRequired() && this._noCircularDependencyConfirmed;
    }

    setHitMaxImportDepth(maxImportDepth: number) {
        this._hitMaxImportDepth = maxImportDepth;
    }

    // Parse the file and update the state. Callers should wait for completion
    // (or at least cancel) prior to calling again. It returns true if a parse
    // was required and false if the parse information was up to date already.
    parse(configOptions: ConfigOptions, importResolver: ImportResolver, content?: string): boolean {
        return this._logTracker.log(`parsing: ${this._getPathForLogging(this._filePath)}`, (logState) => {
            // If the file is already parsed, we can skip.
            if (!this.isParseRequired()) {
                logState.suppress();
                return false;
            }

            const diagSink = new DiagnosticSink();
            let fileContents = this.getOpenFileContents();
            if (fileContents === undefined) {
                try {
                    const startTime = timingStats.readFileTime.totalTime;
                    timingStats.readFileTime.timeOperation(() => {
                        // Read the file's contents.
                        fileContents = content ?? this.getFileContent();
                        if (fileContents === undefined) {
                            throw new Error("Can't get file content");
                        }

                        // Remember the length and hash for comparison purposes.
                        this._lastFileContentLength = fileContents.length;
                        this._lastFileContentHash = StringUtils.hashString(fileContents);
                    });
                    logState.add(`fs read ${timingStats.readFileTime.totalTime - startTime}ms`);
                } catch (error) {
                    diagSink.addError(`Source file could not be read`, getEmptyRange());
                    fileContents = '';

                    if (!this.fileSystem.existsSync(this._realFilePath)) {
                        this._isFileDeleted = true;
                    }
                }
            }

            try {
                // Parse the token stream, building the abstract syntax tree.
                const parseResults = parseFile(
                    configOptions,
                    this._filePath,
                    fileContents!,
                    this._ipythonMode,
                    diagSink
                );

                assert(parseResults !== undefined && parseResults.tokenizerOutput !== undefined);
                this._parseResults = parseResults;
                this._typeIgnoreLines = this._parseResults.tokenizerOutput.typeIgnoreLines;
                this._typeIgnoreAll = this._parseResults.tokenizerOutput.typeIgnoreAll;
                this._pyrightIgnoreLines = this._parseResults.tokenizerOutput.pyrightIgnoreLines;

                // Resolve imports.
                const execEnvironment = configOptions.findExecEnvironment(this._filePath);
                timingStats.resolveImportsTime.timeOperation(() => {
                    const importResult = this._resolveImports(
                        importResolver,
                        parseResults.importedModules,
                        execEnvironment
                    );

                    this._imports = importResult.imports;
                    this._builtinsImport = importResult.builtinsImportResult;
                    this._ipythonDisplayImport = importResult.ipythonDisplayImportResult;

                    this._parseDiagnostics = diagSink.fetchAndClear();
                });

                // Is this file in a "strict" path?
                const useStrict =
                    configOptions.strict.find((strictFileSpec) => strictFileSpec.regExp.test(this._realFilePath)) !==
                    undefined;

                const commentDiags: CommentUtils.CommentDiagnostic[] = [];
                this._diagnosticRuleSet = CommentUtils.getFileLevelDirectives(
                    this._parseResults.tokenizerOutput.tokens,
                    configOptions.diagnosticRuleSet,
                    useStrict,
                    commentDiags
                );

                this._commentDiagnostics = [];

                commentDiags.forEach((commentDiag) => {
                    this._commentDiagnostics.push(
                        new Diagnostic(
                            DiagnosticCategory.Error,
                            commentDiag.message,
                            convertTextRangeToRange(commentDiag.range, this._parseResults!.tokenizerOutput.lines)
                        )
                    );
                });
            } catch (e: any) {
                const message: string =
                    (e.stack ? e.stack.toString() : undefined) ||
                    (typeof e.message === 'string' ? e.message : undefined) ||
                    JSON.stringify(e);
                this._console.error(
                    Localizer.Diagnostic.internalParseError().format({ file: this.getFilePath(), message })
                );

                // Create dummy parse results.
                this._parseResults = {
                    text: '',
                    parseTree: ModuleNode.create({ start: 0, length: 0 }),
                    importedModules: [],
                    futureImports: new Set<string>(),
                    tokenizerOutput: {
                        tokens: new TextRangeCollection<Token>([]),
                        lines: new TextRangeCollection<TextRange>([]),
                        typeIgnoreAll: undefined,
                        typeIgnoreLines: new Map<number, IgnoreComment>(),
                        pyrightIgnoreLines: new Map<number, IgnoreComment>(),
                        predominantEndOfLineSequence: '\n',
                        predominantTabSequence: '    ',
                        predominantSingleQuoteCharacter: "'",
                    },
                    containsWildcardImport: false,
                    typingSymbolAliases: new Map<string, string>(),
                };
                this._imports = undefined;
                this._builtinsImport = undefined;
                this._ipythonDisplayImport = undefined;

                const diagSink = new DiagnosticSink();
                diagSink.addError(
                    Localizer.Diagnostic.internalParseError().format({ file: this.getFilePath(), message }),
                    getEmptyRange()
                );
                this._parseDiagnostics = diagSink.fetchAndClear();

                // Do not rethrow the exception, swallow it here. Callers are not
                // prepared to handle an exception.
            }

            this._analyzedFileContentsVersion = this._fileContentsVersion;
            this._indexingNeeded = true;
            this._isBindingNeeded = true;
            this._isCheckingNeeded = true;
            this._parseTreeNeedsCleaning = false;
            this._hitMaxImportDepth = undefined;
            this._diagnosticVersion++;

            return true;
        });
    }

    index(options: IndexOptions, token: CancellationToken): IndexResults | undefined {
        return this._logTracker.log(`indexing: ${this._getPathForLogging(this._filePath)}`, (ls) => {
            // If we have no completed analysis job, there's nothing to do.
            if (!this._parseResults || !this.isIndexingRequired()) {
                ls.suppress();
                return undefined;
            }

            this._indexingNeeded = false;
            const symbols = DocumentSymbolProvider.indexSymbols(
                AnalyzerNodeInfo.getFileInfo(this._parseResults.parseTree)!,
                this._parseResults,
                options,
                token
            );

            ls.add(`found ${symbols.length}`);

            const name = stripFileExtension(getFileName(this._filePath));
            const privateOrProtected = SymbolNameUtils.isPrivateOrProtectedName(name);
            return { privateOrProtected, symbols };
        });
    }

    getDefinitionsForPosition(
        sourceMapper: SourceMapper,
        position: Position,
        filter: DefinitionFilter,
        evaluator: TypeEvaluator,
        token: CancellationToken
    ): DocumentRange[] | undefined {
        // If we have no completed analysis job, there's nothing to do.
        if (!this._parseResults) {
            return undefined;
        }

        return DefinitionProvider.getDefinitionsForPosition(
            sourceMapper,
            this._parseResults,
            position,
            filter,
            evaluator,
            token
        );
    }

    getTypeDefinitionsForPosition(
        sourceMapper: SourceMapper,
        position: Position,
        evaluator: TypeEvaluator,
        filePath: string,
        token: CancellationToken
    ): DocumentRange[] | undefined {
        // If we have no completed analysis job, there's nothing to do.
        if (!this._parseResults) {
            return undefined;
        }

        return DefinitionProvider.getTypeDefinitionsForPosition(
            sourceMapper,
            this._parseResults,
            position,
            evaluator,
            filePath,
            token
        );
    }

    getDeclarationForPosition(
        sourceMapper: SourceMapper,
        position: Position,
        evaluator: TypeEvaluator,
        reporter: ReferenceCallback | undefined,
        useCase: DocumentSymbolCollectorUseCase,
        token: CancellationToken,
        implicitlyImportedBy?: SourceFile[]
    ): ReferencesResult | undefined {
        // If we have no completed analysis job, there's nothing to do.
        if (!this._parseResults) {
            return undefined;
        }

        return ReferencesProvider.getDeclarationForPosition(
            sourceMapper,
            this._parseResults,
            this._filePath,
            position,
            evaluator,
            reporter,
            useCase,
            token,
            implicitlyImportedBy
        );
    }

    addReferences(
        referencesResult: ReferencesResult,
        includeDeclaration: boolean,
        evaluator: TypeEvaluator,
        token: CancellationToken
    ): void {
        // If we have no completed analysis job, there's nothing to do.
        if (!this._parseResults) {
            return;
        }

        ReferencesProvider.addReferences(
            this._parseResults,
            this._filePath,
            referencesResult,
            includeDeclaration,
            evaluator,
            token
        );
    }

    addHierarchicalSymbolsForDocument(symbolList: DocumentSymbol[], token: CancellationToken) {
        // If we have no completed analysis job, there's nothing to do.
        if (!this._parseResults && !this._cachedIndexResults) {
            return;
        }

        DocumentSymbolProvider.addHierarchicalSymbolsForDocument(
            this._parseResults ? AnalyzerNodeInfo.getFileInfo(this._parseResults.parseTree) : undefined,
            this.getCachedIndexResults(),
            this._parseResults,
            symbolList,
            token
        );
    }

    getSymbolsForDocument(query: string, token: CancellationToken) {
        // If we have no completed analysis job, there's nothing to do.
        if (!this._parseResults && !this._cachedIndexResults) {
            return [];
        }

        return DocumentSymbolProvider.getSymbolsForDocument(
            this._parseResults ? AnalyzerNodeInfo.getFileInfo(this._parseResults.parseTree) : undefined,
            this.getCachedIndexResults(),
            this._parseResults,
            this._filePath,
            query,
            token
        );
    }

    getHoverForPosition(
        sourceMapper: SourceMapper,
        position: Position,
        format: MarkupKind,
        evaluator: TypeEvaluator,
        functionSignatureDisplay: SignatureDisplayType,
        token: CancellationToken
    ): HoverResults | undefined {
        // If this file hasn't been bound, no hover info is available.
        if (this._isBindingNeeded || !this._parseResults) {
            return undefined;
        }

        return HoverProvider.getHoverForPosition(
            sourceMapper,
            this._parseResults,
            position,
            format,
            evaluator,
            functionSignatureDisplay,
            token
        );
    }

    getDocumentHighlight(
        sourceMapper: SourceMapper,
        position: Position,
        evaluator: TypeEvaluator,
        token: CancellationToken
    ): DocumentHighlight[] | undefined {
        // If this file hasn't been bound, no hover info is available.
        if (this._isBindingNeeded || !this._parseResults) {
            return undefined;
        }

        return DocumentHighlightProvider.getDocumentHighlight(this._parseResults, position, evaluator, token);
    }

    getSignatureHelpForPosition(
        position: Position,
        sourceMapper: SourceMapper,
        evaluator: TypeEvaluator,
        format: MarkupKind,
        token: CancellationToken
    ): SignatureHelpResults | undefined {
        // If we have no completed analysis job, there's nothing to do.
        if (!this._parseResults) {
            return undefined;
        }

        return SignatureHelpProvider.getSignatureHelpForPosition(
            this._parseResults,
            position,
            sourceMapper,
            evaluator,
            format,
            token
        );
    }

    getCompletionsForPosition(
        position: Position,
        workspacePath: string,
        configOptions: ConfigOptions,
        importResolver: ImportResolver,
        importLookup: ImportLookup,
        evaluator: TypeEvaluator,
        options: CompletionOptions,
        sourceMapper: SourceMapper,
        nameMap: AbbreviationMap | undefined,
        libraryMap: Map<string, IndexResults> | undefined,
        moduleSymbolsCallback: () => ModuleSymbolMap,
        token: CancellationToken
    ): CompletionResults | undefined {
        // If we have no completed analysis job, there's nothing to do.
        if (!this._parseResults) {
            return undefined;
        }

        // This command should be called only for open files, in which
        // case we should have the file contents already loaded.
        const fileContents = this.getOpenFileContents();
        if (fileContents === undefined) {
            return undefined;
        }

        const completionProvider = new CompletionProvider(
            workspacePath,
            this._parseResults,
            fileContents,
            importResolver,
            position,
            this._filePath,
            configOptions,
            importLookup,
            evaluator,
            options,
            sourceMapper,
            {
                nameMap,
                libraryMap,
                getModuleSymbolsMap: moduleSymbolsCallback,
            },
            token
        );

        return completionProvider.getCompletionsForPosition();
    }

    resolveCompletionItem(
        configOptions: ConfigOptions,
        importResolver: ImportResolver,
        importLookup: ImportLookup,
        evaluator: TypeEvaluator,
        options: CompletionOptions,
        sourceMapper: SourceMapper,
        nameMap: AbbreviationMap | undefined,
        libraryMap: Map<string, IndexResults> | undefined,
        moduleSymbolsCallback: () => ModuleSymbolMap,
        completionItem: CompletionItem,
        token: CancellationToken
    ) {
        const fileContents = this.getOpenFileContents();
        if (!this._parseResults || fileContents === undefined) {
            return;
        }

        const completionData = fromLSPAny<CompletionItemData>(completionItem.data);
        const completionProvider = new CompletionProvider(
            completionData.workspacePath,
            this._parseResults,
            fileContents,
            importResolver,
            completionData.position,
            this._filePath,
            configOptions,
            importLookup,
            evaluator,
            options,
            sourceMapper,
            {
                nameMap,
                libraryMap,
                getModuleSymbolsMap: moduleSymbolsCallback,
            },
            token
        );

        completionProvider.resolveCompletionItem(completionItem);
    }

    performQuickAction(command: string, args: any[], token: CancellationToken): TextEditAction[] | undefined {
        // If we have no completed analysis job, there's nothing to do.
        if (!this._parseResults) {
            return undefined;
        }

        // This command should be called only for open files, in which
        // case we should have the file contents already loaded.
        if (this.getClientVersion() === undefined) {
            return undefined;
        }

        return performQuickAction(command, args, this._parseResults, token);
    }

    bind(
        configOptions: ConfigOptions,
        importLookup: ImportLookup,
        builtinsScope: Scope | undefined,
        futureImports: Set<string>
    ) {
        assert(!this.isParseRequired(), 'Bind called before parsing');
        assert(this.isBindingRequired(), 'Bind called unnecessarily');
        assert(!this._isBindingInProgress, 'Bind called while binding in progress');
        assert(this._parseResults !== undefined, 'Parse results not available');

        return this._logTracker.log(`binding: ${this._getPathForLogging(this._filePath)}`, () => {
            try {
                // Perform name binding.
                timingStats.bindTime.timeOperation(() => {
                    this._cleanParseTreeIfRequired();

                    const fileInfo = this._buildFileInfo(
                        configOptions,
                        this._parseResults!.text,
                        importLookup,
                        builtinsScope,
                        futureImports
                    );
                    AnalyzerNodeInfo.setFileInfo(this._parseResults!.parseTree, fileInfo);

                    const binder = new Binder(fileInfo, configOptions.indexGenerationMode);
                    this._isBindingInProgress = true;
                    binder.bindModule(this._parseResults!.parseTree);

                    // If we're in "test mode" (used for unit testing), run an additional
                    // "test walker" over the parse tree to validate its internal consistency.
                    if (configOptions.internalTestMode) {
                        const testWalker = new TestWalker();
                        testWalker.walk(this._parseResults!.parseTree);
                    }

                    this._bindDiagnostics = fileInfo.diagnosticSink.fetchAndClear();
                    const moduleScope = AnalyzerNodeInfo.getScope(this._parseResults!.parseTree);
                    assert(moduleScope !== undefined, 'Module scope not returned by binder');
                    this._moduleSymbolTable = moduleScope!.symbolTable;
                });
            } catch (e: any) {
                const message: string =
                    (e.stack ? e.stack.toString() : undefined) ||
                    (typeof e.message === 'string' ? e.message : undefined) ||
                    JSON.stringify(e);
                this._console.error(
                    Localizer.Diagnostic.internalBindError().format({ file: this.getFilePath(), message })
                );

                const diagSink = new DiagnosticSink();
                diagSink.addError(
                    Localizer.Diagnostic.internalBindError().format({ file: this.getFilePath(), message }),
                    getEmptyRange()
                );
                this._bindDiagnostics = diagSink.fetchAndClear();

                // Do not rethrow the exception, swallow it here. Callers are not
                // prepared to handle an exception.
            } finally {
                this._isBindingInProgress = false;
            }

            // Prepare for the next stage of the analysis.
            this._diagnosticVersion++;
            this._isCheckingNeeded = true;
            this._indexingNeeded = true;
            this._isBindingNeeded = false;
        });
    }

    check(
        importResolver: ImportResolver,
        evaluator: TypeEvaluator,
        sourceMapper: SourceMapper,
        dependentFiles?: ParseResults[]
    ) {
        assert(!this.isParseRequired(), 'Check called before parsing');
        assert(!this.isBindingRequired(), 'Check called before binding');
        assert(!this._isBindingInProgress, 'Check called while binding in progress');
        assert(this.isCheckingRequired(), 'Check called unnecessarily');
        assert(this._parseResults !== undefined, 'Parse results not available');

        return this._logTracker.log(`checking: ${this._getPathForLogging(this._filePath)}`, () => {
            try {
                timingStats.typeCheckerTime.timeOperation(() => {
                    const checkDuration = new Duration();
                    const checker = new Checker(
                        importResolver,
                        evaluator,
                        this._parseResults!,
                        sourceMapper,
                        dependentFiles
                    );
                    checker.check();
                    this._isCheckingNeeded = false;

                    const fileInfo = AnalyzerNodeInfo.getFileInfo(this._parseResults!.parseTree)!;
                    this._checkerDiagnostics = fileInfo.diagnosticSink.fetchAndClear();
                    this._checkTime = checkDuration.getDurationInMilliseconds();
                });
            } catch (e: any) {
                const isCancellation = OperationCanceledException.is(e);
                if (!isCancellation) {
                    const message: string =
                        (e.stack ? e.stack.toString() : undefined) ||
                        (typeof e.message === 'string' ? e.message : undefined) ||
                        JSON.stringify(e);
                    this._console.error(
                        Localizer.Diagnostic.internalTypeCheckingError().format({ file: this.getFilePath(), message })
                    );
                    const diagSink = new DiagnosticSink();
                    diagSink.addError(
                        Localizer.Diagnostic.internalTypeCheckingError().format({ file: this.getFilePath(), message }),
                        getEmptyRange()
                    );

                    this._checkerDiagnostics = diagSink.fetchAndClear();

                    // Mark the file as complete so we don't get into an infinite loop.
                    this._isCheckingNeeded = false;
                }

                throw e;
            } finally {
                // Clear any circular dependencies associated with this file.
                // These will be detected by the program module and associated
                // with the source file right before it is finalized.
                this._circularDependencies = [];
                this._diagnosticVersion++;
            }
        });
    }

    test_enableIPythonMode(enable: boolean) {
        this._ipythonMode = enable ? IPythonMode.CellDocs : IPythonMode.None;
    }

    private _buildFileInfo(
        configOptions: ConfigOptions,
        fileContents: string,
        importLookup: ImportLookup,
        builtinsScope: Scope | undefined,
        futureImports: Set<string>
    ) {
        assert(this._parseResults !== undefined, 'Parse results not available');
        const analysisDiagnostics = new TextRangeDiagnosticSink(this._parseResults!.tokenizerOutput.lines);

        const fileInfo: AnalyzerFileInfo = {
            importLookup,
            futureImports,
            builtinsScope,
            diagnosticSink: analysisDiagnostics,
            executionEnvironment: configOptions.findExecEnvironment(this._filePath),
            diagnosticRuleSet: this._diagnosticRuleSet,
            fileContents,
            lines: this._parseResults!.tokenizerOutput.lines,
            typingSymbolAliases: this._parseResults!.typingSymbolAliases,
            definedConstants: configOptions.defineConstant,
            filePath: this._filePath,
            moduleName: this._moduleName,
            isStubFile: this._isStubFile,
            isTypingStubFile: this._isTypingStubFile,
            isTypingExtensionsStubFile: this._isTypingExtensionsStubFile,
            isBuiltInStubFile: this._isBuiltInStubFile,
            isInPyTypedPackage: this._isThirdPartyPyTypedPresent,
            ipythonMode: this._ipythonMode,
            accessedSymbolSet: new Set<number>(),
        };
        return fileInfo;
    }

    private _cleanParseTreeIfRequired() {
        if (this._parseResults) {
            if (this._parseTreeNeedsCleaning) {
                const cleanerWalker = new ParseTreeCleanerWalker(this._parseResults.parseTree);
                cleanerWalker.clean();
                this._parseTreeNeedsCleaning = false;
            }
        }
    }

    private _resolveImports(
        importResolver: ImportResolver,
        moduleImports: ModuleImport[],
        execEnv: ExecutionEnvironment
    ): ResolveImportResult {
        const imports: ImportResult[] = [];

        const resolveAndAddIfNotSelf = (nameParts: string[], skipMissingImport = false) => {
            const importResult = importResolver.resolveImport(this._filePath, execEnv, {
                leadingDots: 0,
                nameParts,
                importedSymbols: undefined,
            });

            if (skipMissingImport && !importResult.isImportFound) {
                return undefined;
            }

            // Avoid importing module from the module file itself.
            if (importResult.resolvedPaths.length === 0 || importResult.resolvedPaths[0] !== this._filePath) {
                imports.push(importResult);
                return importResult;
            }

            return undefined;
        };

        // Always include an implicit import of the builtins module.
        let builtinsImportResult: ImportResult | undefined;

        // If this is a project source file (not a stub), try to resolve
        // the __builtins__ stub first.
        if (!this._isThirdPartyImport && !this._isStubFile) {
            builtinsImportResult = resolveAndAddIfNotSelf(['__builtins__'], /* skipMissingImport */ true);
        }

        if (!builtinsImportResult) {
            builtinsImportResult = resolveAndAddIfNotSelf(['builtins']);
        }

        const ipythonDisplayImportResult = this._ipythonMode
            ? resolveAndAddIfNotSelf(['IPython', 'display'])
            : undefined;

        for (const moduleImport of moduleImports) {
            const importResult = importResolver.resolveImport(this._filePath, execEnv, {
                leadingDots: moduleImport.leadingDots,
                nameParts: moduleImport.nameParts,
                importedSymbols: moduleImport.importedSymbols,
            });

            imports.push(importResult);

            // Associate the import results with the module import
            // name node in the parse tree so we can access it later
            // (for hover and definition support).
            if (moduleImport.nameParts.length === moduleImport.nameNode.nameParts.length) {
                AnalyzerNodeInfo.setImportInfo(moduleImport.nameNode, importResult);
            } else {
                // For implicit imports of higher-level modules within a multi-part
                // module name, the moduleImport.nameParts will refer to the subset
                // of the multi-part name rather than the full multi-part name. In this
                // case, store the import info on the name part node.
                assert(moduleImport.nameParts.length > 0);
                assert(moduleImport.nameParts.length - 1 < moduleImport.nameNode.nameParts.length);
                AnalyzerNodeInfo.setImportInfo(
                    moduleImport.nameNode.nameParts[moduleImport.nameParts.length - 1],
                    importResult
                );
            }
        }

        return {
            imports,
            builtinsImportResult,
            ipythonDisplayImportResult,
        };
    }

    private _getPathForLogging(filepath: string) {
        if (this.fileSystem.isMappedFilePath(filepath)) {
            return this.fileSystem.getOriginalFilePath(filepath);
        }

        return filepath;
    }
}

export function parseFile(
    configOptions: ConfigOptions,
    filePath: string,
    fileContents: string,
    ipythonMode: IPythonMode,
    diagSink: DiagnosticSink
) {
    // Use the configuration options to determine the environment in which
    // this source file will be executed.
    const execEnvironment = configOptions.findExecEnvironment(filePath);

    const parseOptions = new ParseOptions();
    parseOptions.ipythonMode = ipythonMode;
    if (filePath.endsWith('pyi')) {
        parseOptions.isStubFile = true;
    }
    parseOptions.pythonVersion = execEnvironment.pythonVersion;
    parseOptions.skipFunctionAndClassBody = configOptions.indexGenerationMode ?? false;

    // Parse the token stream, building the abstract syntax tree.
    const parser = new Parser();
    return parser.parseSourceFile(fileContents, parseOptions, diagSink);
}
