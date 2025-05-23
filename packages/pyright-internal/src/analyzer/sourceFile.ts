/*
 * sourceFile.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Class that represents a single Python source or stub file.
 */

import { isMainThread } from 'worker_threads';

import { OperationCanceledException } from '../common/cancellationUtils';
import { appendArray } from '../common/collectionUtils';
import { ConfigOptions, ExecutionEnvironment, getBasicDiagnosticRuleSet } from '../common/configOptions';
import { ConsoleInterface, StandardConsole } from '../common/console';
import { assert } from '../common/debug';
import { Diagnostic, DiagnosticCategory, TaskListToken, convertLevelToCategory } from '../common/diagnostic';
import { DiagnosticRule } from '../common/diagnosticRules';
import { DiagnosticSink, TextRangeDiagnosticSink } from '../common/diagnosticSink';
import { FileSystem } from '../common/fileSystem';
import { LogTracker, getPathForLogging } from '../common/logTracker';
import { stripFileExtension } from '../common/pathUtils';
import { convertOffsetsToRange, convertTextRangeToRange } from '../common/positionUtils';
import { ServiceKeys } from '../common/serviceKeys';
import { ServiceProvider } from '../common/serviceProvider';
import '../common/serviceProviderExtensions';
import * as StringUtils from '../common/stringUtils';
import { Range, TextRange, getEmptyRange } from '../common/textRange';
import { TextRangeCollection } from '../common/textRangeCollection';
import { Duration, timingStats } from '../common/timing';
import { Uri } from '../common/uri/uri';
import { LocMessage } from '../localization/localize';
import { ModuleNode } from '../parser/parseNodes';
import { ModuleImport, ParseFileResults, ParseOptions, Parser, ParserOutput } from '../parser/parser';
import { IgnoreComment, Tokenizer, TokenizerOutput } from '../parser/tokenizer';
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
export const maxSourceFileSize = 50 * 1024 * 1024;

interface ResolveImportResult {
    imports: ImportResult[];
    builtinsImportResult?: ImportResult | undefined;
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

// A monotonically increasing number used to create unique file IDs.
let nextUniqueFileId = 1;

class WriteableData {
    // Number that is incremented every time the diagnostics
    // are updated.
    diagnosticVersion = 0;

    // Generation count of the file contents. When the contents
    // change, this is incremented.
    fileContentsVersion = 0;

    // Length and hash of the file the last time it was read from disk.
    lastFileContentLength: number | undefined = undefined;
    lastFileContentHash: number | undefined = undefined;

    // Client's version of the file. Undefined implies that contents
    // need to be read from disk.
    clientDocumentContents: string | undefined;
    clientDocumentVersion: number | undefined;

    // Version of file contents that have been analyzed.
    analyzedFileContentsVersion = -1;

    // Do we need to walk the parse tree and clean
    // the binder information hanging from it?
    parseTreeNeedsCleaning = false;

    parsedFileContents: string | undefined;
    tokenizerLines: TextRangeCollection<TextRange> | undefined;
    tokenizerOutput: TokenizerOutput | undefined;
    lineCount: number | undefined;

    moduleSymbolTable: SymbolTable | undefined;

    // Reentrancy check for binding.
    isBindingInProgress = false;

    // Diagnostics generated during different phases of analysis.
    parseDiagnostics: Diagnostic[] = [];
    commentDiagnostics: Diagnostic[] = [];
    bindDiagnostics: Diagnostic[] = [];
    checkerDiagnostics: Diagnostic[] = [];
    taskListDiagnostics: Diagnostic[] = [];
    typeIgnoreLines = new Map<number, IgnoreComment>();
    typeIgnoreAll: IgnoreComment | undefined;
    pyrightIgnoreLines = new Map<number, IgnoreComment>();

    // Accumulated and filtered diagnostics that combines all of the
    // above information. This needs to be recomputed any time the
    // above change.
    accumulatedDiagnostics: Diagnostic[] = [];

    // Circular dependencies that have been reported in this file.
    circularDependencies: CircularDependency[] = [];
    noCircularDependencyConfirmed = false;

    // Did we hit the maximum import depth?
    hitMaxImportDepth: number | undefined;

    // Do we need to perform a binding step?
    isBindingNeeded = true;

    // Do we have valid diagnostic results from a checking pass?
    isCheckingNeeded = true;

    // Time (in ms) that the last check() call required for this file.
    checkTime: number | undefined;

    // Information about implicit and explicit imports from this file.
    imports: ImportResult[] | undefined;
    builtinsImport: ImportResult | undefined;
    // True if the file appears to have been deleted.
    isFileDeleted = false;

    parserOutput: ParserOutput | undefined;

    constructor() {
        // Empty
    }

    debugPrint() {
        return `WritableData: 
 diagnosticVersion=${this.diagnosticVersion}, 
 noCircularDependencyConfirmed=${this.noCircularDependencyConfirmed}, 
 isBindingNeeded=${this.isBindingNeeded},
 isBindingInProgress=${this.isBindingInProgress},
 isCheckingNeeded=${this.isCheckingNeeded},
 isFileDeleted=${this.isFileDeleted},
 hitMaxImportDepth=${this.hitMaxImportDepth},
 parseTreeNeedsCleaning=${this.parseTreeNeedsCleaning},
 fileContentsVersion=${this.fileContentsVersion},
 analyzedFileContentsVersion=${this.analyzedFileContentsVersion},
 clientDocumentVersion=${this.clientDocumentVersion},
 lastFileContentLength=${this.lastFileContentLength},
 lastFileContentHash=${this.lastFileContentHash},
 typeIgnoreAll=${this.typeIgnoreAll},
 imports=${this.imports?.length},
 builtinsImport=${this.builtinsImport?.importName},
 circularDependencies=${this.circularDependencies?.length},
 parseDiagnostics=${this.parseDiagnostics?.length},
 commentDiagnostics=${this.commentDiagnostics?.length},
 bindDiagnostics=${this.bindDiagnostics?.length},
 checkerDiagnostics=${this.checkerDiagnostics?.length},
 taskListDiagnostics=${this.taskListDiagnostics?.length},
 accumulatedDiagnostics=${this.accumulatedDiagnostics?.length},
 typeIgnoreLines=${this.typeIgnoreLines?.size},
 pyrightIgnoreLines=${this.pyrightIgnoreLines?.size},
 checkTime=${this.checkTime},
 clientDocumentContents=${this.clientDocumentContents?.length},
 parseResults=${this.parserOutput?.parseTree.length}`;
    }
}

export interface SourceFileEditMode {
    readonly isEditMode: boolean;
}

export class SourceFile {
    // Console interface to use for debugging.
    private _console: ConsoleInterface;

    // Uri unique to this file within the workspace. May not represent
    // a real file on disk.
    private readonly _uri: Uri;

    // A short string that is guaranteed to uniquely
    // identify this file.
    private readonly _fileId: string;

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

    // True if the file is the "_typeshed.pyi" file, which needs special-
    // case handling.
    private readonly _isTypeshedStubFile: boolean;

    // True if the file one of the other built-in stub files
    // that require special-case handling: "collections.pyi",
    // "dataclasses.pyi", "abc.pyi", "asyncio/coroutines.pyi".
    private readonly _isBuiltInStubFile: boolean;

    // True if the file is part of a package that contains a
    // "py.typed" file.
    private readonly _isThirdPartyPyTypedPresent: boolean;

    private readonly _editMode: SourceFileEditMode;

    // Settings that control which diagnostics should be output. The rules
    // are initialized to the basic set. They should be updated after the
    // the file is parsed.
    private _diagnosticRuleSet = getBasicDiagnosticRuleSet();

    // Indicate whether this file is for ipython or not.
    private _ipythonMode = IPythonMode.None;
    private _logTracker: LogTracker;
    private _preEditData: WriteableData | undefined;

    // Data that changes when the source file changes.
    private _writableData: WriteableData;

    readonly fileSystem: FileSystem;

    constructor(
        readonly serviceProvider: ServiceProvider,
        uri: Uri,
        moduleName: string,
        isThirdPartyImport: boolean,
        isThirdPartyPyTypedPresent: boolean,
        editMode: SourceFileEditMode,
        console?: ConsoleInterface,
        logTracker?: LogTracker,
        ipythonMode?: IPythonMode
    ) {
        this.fileSystem = serviceProvider.get(ServiceKeys.fs);
        this._console = console || new StandardConsole();
        this._writableData = new WriteableData();

        this._editMode = editMode;
        this._uri = uri;
        this._fileId = this._makeFileId(uri);
        this._moduleName = moduleName;
        this._isStubFile = uri.hasExtension('.pyi');
        this._isThirdPartyImport = isThirdPartyImport;
        this._isThirdPartyPyTypedPresent = isThirdPartyPyTypedPresent;
        const fileName = uri.fileName;
        this._isTypingStubFile =
            this._isStubFile && (this._uri.pathEndsWith('stdlib/typing.pyi') || fileName === 'typing_extensions.pyi');
        this._isTypingExtensionsStubFile = this._isStubFile && fileName === 'typing_extensions.pyi';
        this._isTypeshedStubFile =
            this._isStubFile &&
            (this._uri.pathEndsWith('stdlib/_typeshed/__init__.pyi') ||
                this._uri.pathEndsWith('stdlib/_typeshed/_type_checker_internals.pyi'));

        this._isBuiltInStubFile = false;
        if (this._isStubFile) {
            if (
                this._uri.pathEndsWith('stdlib/collections/__init__.pyi') ||
                this._uri.pathEndsWith('stdlib/asyncio/futures.pyi') ||
                this._uri.pathEndsWith('stdlib/asyncio/tasks.pyi') ||
                this._uri.pathEndsWith('stdlib/builtins.pyi') ||
                this._uri.pathEndsWith('stdlib/_importlib_modulespec.pyi') ||
                this._uri.pathEndsWith('stdlib/dataclasses.pyi') ||
                this._uri.pathEndsWith('stdlib/abc.pyi') ||
                this._uri.pathEndsWith('stdlib/enum.pyi') ||
                this._uri.pathEndsWith('stdlib/queue.pyi') ||
                this._uri.pathEndsWith('stdlib/types.pyi') ||
                this._uri.pathEndsWith('stdlib/warnings.pyi')
            ) {
                this._isBuiltInStubFile = true;
            }
        }

        // 'FG' or 'BG' based on current thread.
        this._logTracker = logTracker ?? new LogTracker(console, isMainThread ? 'FG' : 'BG');
        this._ipythonMode = ipythonMode ?? IPythonMode.None;
    }

    getIPythonMode(): IPythonMode {
        return this._ipythonMode;
    }

    getUri(): Uri {
        return this._uri;
    }

    getModuleName(): string {
        if (this._moduleName) {
            return this._moduleName;
        }

        // Synthesize a module name using the file path.
        return stripFileExtension(this._uri.fileName);
    }

    setModuleName(name: string) {
        this._moduleName = name;
    }

    getDiagnosticVersion(): number {
        return this._writableData.diagnosticVersion;
    }

    isStubFile() {
        return this._isStubFile;
    }

    isTypingStubFile() {
        return this._isTypingStubFile;
    }

    isThirdPartyPyTypedPresent() {
        return this._isThirdPartyPyTypedPresent;
    }

    // Returns a list of cached diagnostics from the latest analysis job.
    // If the prevVersion is specified, the method returns undefined if
    // the diagnostics haven't changed.
    getDiagnostics(options: ConfigOptions, prevDiagnosticVersion?: number): Diagnostic[] | undefined {
        if (this._writableData.diagnosticVersion === prevDiagnosticVersion) {
            return undefined;
        }

        return this._writableData.accumulatedDiagnostics;
    }

    getImports(): ImportResult[] {
        return this._writableData.imports || [];
    }

    getBuiltinsImport(): ImportResult | undefined {
        return this._writableData.builtinsImport;
    }

    getModuleSymbolTable(): SymbolTable | undefined {
        return this._writableData.moduleSymbolTable;
    }

    getCheckTime() {
        return this._writableData.checkTime;
    }

    restore(): string | undefined {
        // If we had an edit, return our text.
        if (this._preEditData) {
            const text = this._writableData.clientDocumentContents!;
            this._writableData = this._preEditData;
            this._preEditData = undefined;

            return text;
        }

        return undefined;
    }

    // Indicates whether the contents of the file have changed since
    // the last analysis was performed.
    didContentsChangeOnDisk(): boolean {
        // If this is an open file any content changes will be
        // provided through the editor. We can assume contents
        // didn't change without us knowing about them.
        if (this._writableData.clientDocumentContents) {
            return false;
        }

        // If the file was never read previously, no need to check for a change.
        if (this._writableData.lastFileContentLength === undefined) {
            return false;
        }

        // Read in the latest file contents and see if the hash matches
        // that of the previous contents.
        try {
            // Read the file's contents.
            if (this.fileSystem.existsSync(this._uri)) {
                const fileContents = this.fileSystem.readFileSync(this._uri, 'utf8');

                if (fileContents.length !== this._writableData.lastFileContentLength) {
                    return true;
                }

                if (StringUtils.hashString(fileContents) !== this._writableData.lastFileContentHash) {
                    return true;
                }
            } else {
                // No longer exists, so yes it has changed.
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
        this._fireFileDirtyEvent();

        this._writableData.parserOutput = undefined;
        this._writableData.tokenizerLines = undefined;
        this._writableData.tokenizerOutput = undefined;
        this._writableData.parsedFileContents = undefined;
        this._writableData.moduleSymbolTable = undefined;
        this._writableData.isBindingNeeded = true;
    }

    markDirty(): void {
        this._writableData.fileContentsVersion++;
        this._writableData.noCircularDependencyConfirmed = false;
        this._writableData.isCheckingNeeded = true;
        this._writableData.isBindingNeeded = true;
        this._writableData.moduleSymbolTable = undefined;
        this._writableData.lineCount = undefined;

        this._fireFileDirtyEvent();
    }

    markReanalysisRequired(forceRebinding: boolean): void {
        // Keep the parse info, but reset the analysis to the beginning.
        this._writableData.isCheckingNeeded = true;
        this._writableData.noCircularDependencyConfirmed = false;

        // If the file contains a wildcard import or __all__ symbols,
        // we need to rebind because a dependent import may have changed.
        if (this._writableData.parserOutput) {
            if (
                this._writableData.parserOutput.containsWildcardImport ||
                AnalyzerNodeInfo.getDunderAllInfo(this._writableData.parserOutput.parseTree) !== undefined ||
                forceRebinding
            ) {
                // We don't need to rebuild index data since wildcard
                // won't affect user file indices. User file indices
                // don't contain import alias info.
                this._writableData.parseTreeNeedsCleaning = true;
                this._writableData.isBindingNeeded = true;
                this._writableData.moduleSymbolTable = undefined;
            }
        }
    }

    getFileContentsVersion() {
        return this._writableData.fileContentsVersion;
    }

    getClientVersion() {
        return this._writableData.clientDocumentVersion;
    }

    getRange() {
        return { start: { line: 0, character: 0 }, end: { line: this._writableData.lineCount ?? 0, character: 0 } };
    }

    getOpenFileContents() {
        return this._writableData.clientDocumentContents;
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
            const fileStat = this.fileSystem.statSync(this._uri);
            if (fileStat.size > maxSourceFileSize) {
                this._console.error(
                    `File length of "${this._uri}" is ${fileStat.size} ` +
                        `which exceeds the maximum supported file size of ${maxSourceFileSize}`
                );
                throw new Error('File larger than max');
            }

            return this.fileSystem.readFileSync(this._uri, 'utf8');
        } catch (error) {
            return undefined;
        }
    }

    setClientVersion(version: number | null, contents: string): void {
        // Save pre edit state if in edit mode.
        this._cachePreEditState();

        if (version === null) {
            this._writableData.clientDocumentVersion = undefined;
            this._writableData.clientDocumentContents = undefined;

            // Since the file is no longer open, dump the tokenizer output
            // so it doesn't consume memory.
            this._writableData.tokenizerOutput = undefined;
        } else {
            this._writableData.clientDocumentVersion = version;
            this._writableData.clientDocumentContents = contents;

            const contentsHash = StringUtils.hashString(contents);

            // Have the contents of the file changed?
            if (
                contents.length !== this._writableData.lastFileContentLength ||
                contentsHash !== this._writableData.lastFileContentHash
            ) {
                this.markDirty();
            }

            this._writableData.lastFileContentLength = contents.length;
            this._writableData.lastFileContentHash = contentsHash;
            this._writableData.isFileDeleted = false;
        }
    }

    prepareForClose() {
        this._fireFileDirtyEvent();
    }

    isFileDeleted() {
        return this._writableData.isFileDeleted;
    }

    isParseRequired() {
        return (
            !this._writableData.parserOutput ||
            this._writableData.analyzedFileContentsVersion !== this._writableData.fileContentsVersion
        );
    }

    isBindingRequired() {
        if (this._writableData.isBindingInProgress) {
            return false;
        }

        if (this.isParseRequired()) {
            return true;
        }

        return this._writableData.isBindingNeeded;
    }

    isCheckingRequired() {
        return this._writableData.isCheckingNeeded;
    }

    getParseResults(): ParseFileResults | undefined {
        if (this.isParseRequired()) {
            return undefined;
        }

        assert(this._writableData.parserOutput !== undefined && this._writableData.parsedFileContents !== undefined);

        // If we've cached the tokenizer output, use the cached version.
        // Otherwise re-tokenize the contents on demand.
        const tokenizerOutput =
            this._writableData.tokenizerOutput ?? this._tokenizeContents(this._writableData.parsedFileContents);

        return {
            contentHash:
                this._writableData.lastFileContentHash || StringUtils.hashString(this._writableData.parsedFileContents),
            parserOutput: this._writableData.parserOutput,
            tokenizerOutput,
            text: this._writableData.parsedFileContents,
        };
    }

    getParserOutput(): ParserOutput | undefined {
        if (this.isParseRequired()) {
            return undefined;
        }

        assert(this._writableData.parserOutput !== undefined);

        return this._writableData.parserOutput;
    }

    // Adds a new circular dependency for this file but only if
    // it hasn't already been added.
    addCircularDependency(configOptions: ConfigOptions, circDependency: CircularDependency) {
        let updatedDependencyList = false;

        // Some topologies can result in a massive number of cycles. We'll cut it off.
        if (this._writableData.circularDependencies.length < _maxImportCyclesPerFile) {
            if (!this._writableData.circularDependencies.some((dep) => dep.isEqual(circDependency))) {
                this._writableData.circularDependencies.push(circDependency);
                updatedDependencyList = true;
            }
        }

        if (updatedDependencyList) {
            this._recomputeDiagnostics(configOptions);
        }
    }

    setNoCircularDependencyConfirmed() {
        this._writableData.noCircularDependencyConfirmed = true;
    }

    isNoCircularDependencyConfirmed() {
        return !this.isParseRequired() && this._writableData.noCircularDependencyConfirmed;
    }

    setHitMaxImportDepth(maxImportDepth: number) {
        this._writableData.hitMaxImportDepth = maxImportDepth;
    }

    // Parse the file and update the state. Callers should wait for completion
    // (or at least cancel) prior to calling again. It returns true if a parse
    // was required and false if the parse information was up to date already.
    parse(configOptions: ConfigOptions, importResolver: ImportResolver, content?: string): boolean {
        return this._logTracker.log(`parsing: ${this._getPathForLogging(this._uri)}`, (logState) => {
            // If the file is already parsed, we can skip.
            if (!this.isParseRequired()) {
                logState.suppress();
                return false;
            }

            const diagSink = this.createDiagnosticSink();
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
                        this._writableData.lastFileContentLength = fileContents.length;
                        this._writableData.lastFileContentHash = StringUtils.hashString(fileContents);
                    });
                    logState.add(`fs read ${timingStats.readFileTime.totalTime - startTime}ms`);
                } catch (error) {
                    diagSink.addError(`Source file could not be read`, getEmptyRange());
                    fileContents = '';

                    if (!this.fileSystem.existsSync(this._uri)) {
                        this._writableData.isFileDeleted = true;
                    }
                }
            }

            try {
                // Parse the token stream, building the abstract syntax tree.
                const parseFileResults = this._parseFile(
                    configOptions,
                    this._uri,
                    fileContents!,
                    this._ipythonMode !== IPythonMode.None,
                    diagSink
                );

                assert(parseFileResults !== undefined && parseFileResults.tokenizerOutput !== undefined);
                this._writableData.parserOutput = parseFileResults.parserOutput;
                this._writableData.tokenizerLines = parseFileResults.tokenizerOutput.lines;
                this._writableData.parsedFileContents = fileContents;
                this._writableData.typeIgnoreLines = parseFileResults.tokenizerOutput.typeIgnoreLines;
                this._writableData.typeIgnoreAll = parseFileResults.tokenizerOutput.typeIgnoreAll;
                this._writableData.pyrightIgnoreLines = parseFileResults.tokenizerOutput.pyrightIgnoreLines;
                this._writableData.lineCount = parseFileResults.tokenizerOutput.lines.length;

                // Cache the tokenizer output only if this file is open.
                if (this._writableData.clientDocumentContents !== undefined) {
                    this._writableData.tokenizerOutput = parseFileResults.tokenizerOutput;
                }

                // Resolve imports.
                const execEnvironment = configOptions.findExecEnvironment(this._uri);
                timingStats.resolveImportsTime.timeOperation(() => {
                    const importResult = this._resolveImports(
                        importResolver,
                        parseFileResults.parserOutput.importedModules,
                        execEnvironment
                    );

                    this._writableData.imports = importResult.imports;
                    this._writableData.builtinsImport = importResult.builtinsImportResult;

                    this._writableData.parseDiagnostics = diagSink.fetchAndClear();

                    this._writableData.taskListDiagnostics = [];
                    this._addTaskListDiagnostics(
                        configOptions.taskListTokens,
                        parseFileResults.tokenizerOutput,
                        this._writableData.taskListDiagnostics
                    );
                });

                // Is this file in a "strict" path?
                const useStrict =
                    configOptions.strict.find((strictFileSpec) => this._uri.matchesRegex(strictFileSpec.regExp)) !==
                    undefined;

                const commentDiags: CommentUtils.CommentDiagnostic[] = [];
                this._diagnosticRuleSet = CommentUtils.getFileLevelDirectives(
                    parseFileResults.tokenizerOutput.tokens,
                    parseFileResults.tokenizerOutput.lines,
                    execEnvironment.diagnosticRuleSet,
                    useStrict,
                    commentDiags
                );

                this._writableData.commentDiagnostics = [];

                commentDiags.forEach((commentDiag) => {
                    this._writableData.commentDiagnostics.push(
                        new Diagnostic(
                            DiagnosticCategory.Error,
                            commentDiag.message,
                            convertTextRangeToRange(commentDiag.range, parseFileResults.tokenizerOutput.lines)
                        )
                    );
                });
            } catch (e: any) {
                const message: string =
                    (e.stack ? e.stack.toString() : undefined) ||
                    (typeof e.message === 'string' ? e.message : undefined) ||
                    JSON.stringify(e);
                this._console.error(
                    LocMessage.internalParseError().format({
                        file: this.getUri().toUserVisibleString(),
                        message,
                    })
                );

                // Create dummy parse results.
                this._writableData.parsedFileContents = '';

                this._writableData.parserOutput = {
                    parseTree: ModuleNode.create({ start: 0, length: 0 }),
                    importedModules: [],
                    futureImports: new Set<string>(),
                    containsWildcardImport: false,
                    typingSymbolAliases: new Map<string, string>(),
                    hasTypeAnnotations: false,
                };

                this._writableData.tokenizerLines = new TextRangeCollection<TextRange>([]);

                this._writableData.tokenizerOutput = {
                    tokens: new TextRangeCollection<Token>([]),
                    lines: this._writableData.tokenizerLines,
                    typeIgnoreAll: undefined,
                    typeIgnoreLines: new Map<number, IgnoreComment>(),
                    pyrightIgnoreLines: new Map<number, IgnoreComment>(),
                    predominantEndOfLineSequence: '\n',
                    hasPredominantTabSequence: false,
                    predominantTabSequence: '    ',
                    predominantSingleQuoteCharacter: "'",
                };

                this._writableData.imports = undefined;
                this._writableData.builtinsImport = undefined;

                const diagSink = this.createDiagnosticSink();
                diagSink.addError(
                    LocMessage.internalParseError().format({
                        file: this.getUri().toUserVisibleString(),
                        message,
                    }),
                    getEmptyRange()
                );
                this._writableData.parseDiagnostics = diagSink.fetchAndClear();
                this._writableData.taskListDiagnostics = diagSink.fetchAndClear();

                // Do not rethrow the exception, swallow it here. Callers are not
                // prepared to handle an exception.
            }

            this._writableData.analyzedFileContentsVersion = this._writableData.fileContentsVersion;
            this._writableData.isBindingNeeded = true;
            this._writableData.isCheckingNeeded = true;
            this._writableData.parseTreeNeedsCleaning = false;
            this._writableData.hitMaxImportDepth = undefined;

            this._recomputeDiagnostics(configOptions);

            return true;
        });
    }

    bind(
        configOptions: ConfigOptions,
        importLookup: ImportLookup,
        builtinsScope: Scope | undefined,
        futureImports: Set<string>
    ) {
        assert(!this.isParseRequired(), 'Bind called before parsing');
        assert(this.isBindingRequired(), 'Bind called unnecessarily');
        assert(!this._writableData.isBindingInProgress, 'Bind called while binding in progress');
        assert(this._writableData.parserOutput !== undefined, 'Parse results not available');

        return this._logTracker.log(`binding: ${this._getPathForLogging(this._uri)}`, () => {
            try {
                // Perform name binding.
                timingStats.bindTime.timeOperation(() => {
                    this._cleanParseTreeIfRequired();

                    const fileInfo = this._buildFileInfo(
                        configOptions,
                        this._writableData.parsedFileContents!,
                        importLookup,
                        builtinsScope,
                        futureImports
                    );
                    AnalyzerNodeInfo.setFileInfo(this._writableData.parserOutput!.parseTree, fileInfo);

                    const binder = new Binder(fileInfo, configOptions.indexGenerationMode);
                    this._writableData.isBindingInProgress = true;
                    binder.bindModule(this._writableData.parserOutput!.parseTree);

                    // If we're in "test mode" (used for unit testing), run an additional
                    // "test walker" over the parse tree to validate its internal consistency.
                    if (configOptions.internalTestMode) {
                        const testWalker = new TestWalker();
                        testWalker.walk(this._writableData.parserOutput!.parseTree);
                    }

                    this._writableData.bindDiagnostics = fileInfo.diagnosticSink.fetchAndClear();
                    const moduleScope = AnalyzerNodeInfo.getScope(this._writableData.parserOutput!.parseTree);
                    assert(moduleScope !== undefined, 'Module scope not returned by binder');
                    this._writableData.moduleSymbolTable = moduleScope!.symbolTable;
                });
            } catch (e: any) {
                const message: string =
                    (e.stack ? e.stack.toString() : undefined) ||
                    (typeof e.message === 'string' ? e.message : undefined) ||
                    JSON.stringify(e);
                this._console.error(
                    LocMessage.internalBindError().format({
                        file: this.getUri().toUserVisibleString(),
                        message,
                    })
                );

                const diagSink = this.createDiagnosticSink();
                diagSink.addError(
                    LocMessage.internalBindError().format({
                        file: this.getUri().toUserVisibleString(),
                        message,
                    }),
                    getEmptyRange()
                );
                this._writableData.bindDiagnostics = diagSink.fetchAndClear();

                // Do not rethrow the exception, swallow it here. Callers are not
                // prepared to handle an exception.
            } finally {
                this._writableData.isBindingInProgress = false;
            }

            // Prepare for the next stage of the analysis.
            this._writableData.isCheckingNeeded = true;
            this._writableData.isBindingNeeded = false;

            this._recomputeDiagnostics(configOptions);
        });
    }

    check(
        configOptions: ConfigOptions,
        importLookup: ImportLookup,
        importResolver: ImportResolver,
        evaluator: TypeEvaluator,
        sourceMapper: SourceMapper,
        dependentFiles?: ParserOutput[]
    ) {
        assert(!this.isParseRequired(), `Check called before parsing: state=${this._writableData.debugPrint()}`);
        assert(!this.isBindingRequired(), `Check called before binding: state=${this._writableData.debugPrint()}`);
        assert(!this._writableData.isBindingInProgress, 'Check called while binding in progress');
        assert(this.isCheckingRequired(), 'Check called unnecessarily');
        assert(this._writableData.parserOutput !== undefined, 'Parse results not available');

        return this._logTracker.log(`checking: ${this._getPathForLogging(this._uri)}`, () => {
            try {
                timingStats.typeCheckerTime.timeOperation(() => {
                    const checkDuration = new Duration();
                    const checker = new Checker(
                        importResolver,
                        evaluator,
                        this._writableData.parserOutput!,
                        sourceMapper,
                        dependentFiles
                    );
                    checker.check();
                    this._writableData.isCheckingNeeded = false;

                    const fileInfo = AnalyzerNodeInfo.getFileInfo(this._writableData.parserOutput!.parseTree)!;
                    this._writableData.checkerDiagnostics = fileInfo.diagnosticSink.fetchAndClear();
                    this._writableData.checkTime = checkDuration.getDurationInMilliseconds();
                });
            } catch (e: any) {
                const isCancellation = OperationCanceledException.is(e);
                if (!isCancellation) {
                    const message: string =
                        (e.stack ? e.stack.toString() : undefined) ||
                        (typeof e.message === 'string' ? e.message : undefined) ||
                        JSON.stringify(e);
                    this._console.error(
                        LocMessage.internalTypeCheckingError().format({
                            file: this.getUri().toUserVisibleString(),
                            message,
                        })
                    );
                    const diagSink = this.createDiagnosticSink();
                    diagSink.addError(
                        LocMessage.internalTypeCheckingError().format({
                            file: this.getUri().toUserVisibleString(),
                            message,
                        }),
                        getEmptyRange()
                    );

                    this._writableData.checkerDiagnostics = diagSink.fetchAndClear();

                    // Mark the file as complete so we don't get into an infinite loop.
                    this._writableData.isCheckingNeeded = false;
                }

                throw e;
            } finally {
                // Clear any circular dependencies associated with this file.
                // These will be detected by the program module and associated
                // with the source file right before it is finalized.
                this._writableData.circularDependencies = [];

                this._recomputeDiagnostics(configOptions);
            }
        });
    }

    test_enableIPythonMode(enable: boolean) {
        this._ipythonMode = enable ? IPythonMode.CellDocs : IPythonMode.None;
    }

    protected createDiagnosticSink(): DiagnosticSink {
        return new DiagnosticSink();
    }

    protected createTextRangeDiagnosticSink(lines: TextRangeCollection<TextRange>): TextRangeDiagnosticSink {
        return new TextRangeDiagnosticSink(lines);
    }

    // Creates a short string that can be used to uniquely identify
    // this file from all other files. It is used in the type evaluator
    // to distinguish between types that are defined in different files
    // or scopes.
    private _makeFileId(uri: Uri) {
        const maxNameLength = 8;

        // Use a small portion of the file name to help with debugging.
        let fileName = uri.fileNameWithoutExtensions;
        if (fileName.length > maxNameLength) {
            fileName = fileName.substring(fileName.length - maxNameLength);
        }

        // Append a number to guarantee uniqueness.
        const uniqueNumber = nextUniqueFileId++;

        // Use a "/" to separate the two components, since this
        // character will never appear in a file name.
        return `${fileName}/${uniqueNumber.toString()}`;
    }

    // Computes an updated set of accumulated diagnostics for the file
    // based on the partial diagnostics from various analysis stages.
    private _recomputeDiagnostics(configOptions: ConfigOptions) {
        this._writableData.diagnosticVersion++;

        let includeWarningsAndErrors = true;

        // If a file was imported as a third-party file, don't report
        // any errors for it. The user can't fix them anyway.
        if (this._isThirdPartyImport) {
            includeWarningsAndErrors = false;
        }

        let diagList: Diagnostic[] = [];
        appendArray(diagList, this._writableData.parseDiagnostics);
        appendArray(diagList, this._writableData.commentDiagnostics);
        appendArray(diagList, this._writableData.bindDiagnostics);
        appendArray(diagList, this._writableData.checkerDiagnostics);
        appendArray(diagList, this._writableData.taskListDiagnostics);

        const prefilteredDiagList = diagList;
        const typeIgnoreLinesClone = new Map(this._writableData.typeIgnoreLines);
        const pyrightIgnoreLinesClone = new Map(this._writableData.pyrightIgnoreLines);

        // Filter the diagnostics based on "type: ignore" lines.
        if (this._diagnosticRuleSet.enableTypeIgnoreComments) {
            if (this._writableData.typeIgnoreLines.size > 0) {
                diagList = diagList.filter((d) => {
                    if (
                        d.category !== DiagnosticCategory.UnusedCode &&
                        d.category !== DiagnosticCategory.UnreachableCode &&
                        d.category !== DiagnosticCategory.Deprecated
                    ) {
                        for (let line = d.range.start.line; line <= d.range.end.line; line++) {
                            if (this._writableData.typeIgnoreLines.has(line)) {
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
        if (this._writableData.pyrightIgnoreLines.size > 0) {
            diagList = diagList.filter((d) => {
                if (
                    d.category !== DiagnosticCategory.UnusedCode &&
                    d.category !== DiagnosticCategory.UnreachableCode &&
                    d.category !== DiagnosticCategory.Deprecated
                ) {
                    for (let line = d.range.start.line; line <= d.range.end.line; line++) {
                        const pyrightIgnoreComment = this._writableData.pyrightIgnoreLines.get(line);
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

        // Skip this step if type checking is needed. Otherwise we'll likely produce
        // incorrect (false positive) reportUnnecessaryTypeIgnoreComment diagnostics
        // until checking is performed on this file.
        if (
            this._diagnosticRuleSet.reportUnnecessaryTypeIgnoreComment !== 'none' &&
            !this._writableData.isCheckingNeeded
        ) {
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

            if (prefilteredErrorList.length === 0 && this._writableData.typeIgnoreAll !== undefined) {
                const rangeStart = this._writableData.typeIgnoreAll.range.start;
                const rangeEnd = rangeStart + this._writableData.typeIgnoreAll.range.length;
                const range = convertOffsetsToRange(rangeStart, rangeEnd, this._writableData.tokenizerLines!);

                if (!isUnreachableCodeRange(range) && this._diagnosticRuleSet.enableTypeIgnoreComments) {
                    const diag = new Diagnostic(diagCategory, LocMessage.unnecessaryTypeIgnore(), range);
                    diag.setRule(DiagnosticRule.reportUnnecessaryTypeIgnoreComment);
                    unnecessaryTypeIgnoreDiags.push(diag);
                }
            }

            typeIgnoreLinesClone.forEach((ignoreComment) => {
                if (this._writableData.tokenizerLines!) {
                    const rangeStart = ignoreComment.range.start;
                    const rangeEnd = rangeStart + ignoreComment.range.length;
                    const range = convertOffsetsToRange(rangeStart, rangeEnd, this._writableData.tokenizerLines!);

                    if (!isUnreachableCodeRange(range) && this._diagnosticRuleSet.enableTypeIgnoreComments) {
                        const diag = new Diagnostic(diagCategory, LocMessage.unnecessaryTypeIgnore(), range);
                        diag.setRule(DiagnosticRule.reportUnnecessaryTypeIgnoreComment);
                        unnecessaryTypeIgnoreDiags.push(diag);
                    }
                }
            });

            pyrightIgnoreLinesClone.forEach((ignoreComment) => {
                if (this._writableData.tokenizerLines!) {
                    if (!ignoreComment.rulesList) {
                        const rangeStart = ignoreComment.range.start;
                        const rangeEnd = rangeStart + ignoreComment.range.length;
                        const range = convertOffsetsToRange(rangeStart, rangeEnd, this._writableData.tokenizerLines!);

                        if (!isUnreachableCodeRange(range)) {
                            const diag = new Diagnostic(diagCategory, LocMessage.unnecessaryTypeIgnore(), range);
                            diag.setRule(DiagnosticRule.reportUnnecessaryTypeIgnoreComment);
                            unnecessaryTypeIgnoreDiags.push(diag);
                        }
                    } else {
                        ignoreComment.rulesList.forEach((unusedRule) => {
                            const rangeStart = unusedRule.range.start;
                            const rangeEnd = rangeStart + unusedRule.range.length;
                            const range = convertOffsetsToRange(
                                rangeStart,
                                rangeEnd,
                                this._writableData.tokenizerLines!
                            );

                            if (!isUnreachableCodeRange(range)) {
                                const diag = new Diagnostic(
                                    diagCategory,
                                    LocMessage.unnecessaryPyrightIgnoreRule().format({
                                        name: unusedRule.text,
                                    }),
                                    range
                                );
                                diag.setRule(DiagnosticRule.reportUnnecessaryTypeIgnoreComment);
                                unnecessaryTypeIgnoreDiags.push(diag);
                            }
                        });
                    }
                }
            });
        }

        if (
            this._diagnosticRuleSet.reportImportCycles !== 'none' &&
            this._writableData.circularDependencies.length > 0
        ) {
            const category = convertLevelToCategory(this._diagnosticRuleSet.reportImportCycles);

            this._writableData.circularDependencies.forEach((cirDep) => {
                const diag = new Diagnostic(
                    category,
                    LocMessage.importCycleDetected() +
                        '\n' +
                        cirDep
                            .getPaths()
                            .map((path) => '  ' + path.toUserVisibleString())
                            .join('\n'),
                    getEmptyRange()
                );
                diag.setRule(DiagnosticRule.reportImportCycles);
                diagList.push(diag);
            });
        }

        if (this._writableData.hitMaxImportDepth !== undefined) {
            diagList.push(
                new Diagnostic(
                    DiagnosticCategory.Error,
                    LocMessage.importDepthExceeded().format({ depth: this._writableData.hitMaxImportDepth }),
                    getEmptyRange()
                )
            );
        }

        // If there is a "type: ignore" comment at the top of the file, clear
        // the diagnostic list of all error, warning, and information diagnostics.
        if (this._diagnosticRuleSet.enableTypeIgnoreComments) {
            if (this._writableData.typeIgnoreAll !== undefined) {
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

        // If the file is in the ignore list, clear the diagnostic list.
        if (configOptions.ignore.find((ignoreFileSpec) => this._uri.matchesRegex(ignoreFileSpec.regExp))) {
            diagList = [];
        }

        this._writableData.accumulatedDiagnostics = diagList;
    }

    private _cachePreEditState() {
        // If this is our first write, then make a copy of the writable data.
        if (!this._editMode.isEditMode || this._preEditData) {
            return;
        }

        // Copy over the writable data.
        this._preEditData = this._writableData;

        // Recreate all the writable data from scratch.
        this._writableData = new WriteableData();
    }

    // Get all task list diagnostics for the current file and add them
    // to the specified diagnostic list.
    private _addTaskListDiagnostics(
        taskListTokens: TaskListToken[] | undefined,
        tokenizerOutput: TokenizerOutput,
        diagList: Diagnostic[]
    ) {
        if (!taskListTokens || taskListTokens.length === 0 || !diagList) {
            return;
        }

        for (let i = 0; i < tokenizerOutput.tokens.count; i++) {
            const token = tokenizerOutput.tokens.getItemAt(i);

            // If there are no comments, skip this token.
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

                    // If the comment doesn't match, skip it.
                    if (!regex.test(comment.value)) {
                        continue;
                    }

                    // Calculate the range for the diagnostic. This allows navigation
                    // to the comment via double clicking the item in the task list pane.
                    let rangeStart = comment.start;

                    // The comment technically starts right after the comment identifier(#),
                    // but we want the caret right before the task list token (since there
                    // might be whitespace before it).
                    const indexOfToken = comment.value.toLowerCase().indexOf(token.text.toLowerCase());
                    rangeStart += indexOfToken;

                    const rangeEnd = TextRange.getEnd(comment);
                    const range = convertOffsetsToRange(rangeStart, rangeEnd, tokenizerOutput.lines!);

                    // Add the diagnostic to the list and trim whitespace from the comment so
                    // it's easier to read in the task list.
                    diagList.push(
                        new Diagnostic(DiagnosticCategory.TaskItem, comment.value.trim(), range, token.priority)
                    );
                }
            }
        }
    }

    private _buildFileInfo(
        configOptions: ConfigOptions,
        fileContents: string,
        importLookup: ImportLookup,
        builtinsScope: Scope | undefined,
        futureImports: Set<string>
    ) {
        assert(this._writableData.parserOutput !== undefined, 'Parse results not available');
        const analysisDiagnostics = this.createTextRangeDiagnosticSink(this._writableData.tokenizerLines!);

        const fileInfo: AnalyzerFileInfo = {
            importLookup,
            futureImports,
            builtinsScope,
            diagnosticSink: analysisDiagnostics,
            executionEnvironment: configOptions.findExecEnvironment(this._uri),
            diagnosticRuleSet: this._diagnosticRuleSet,
            lines: this._writableData.tokenizerLines!,
            typingSymbolAliases: this._writableData.parserOutput!.typingSymbolAliases,
            definedConstants: configOptions.defineConstant,
            fileId: this._fileId,
            fileUri: this._uri,
            moduleName: this.getModuleName(),
            isStubFile: this._isStubFile,
            isTypingStubFile: this._isTypingStubFile,
            isTypingExtensionsStubFile: this._isTypingExtensionsStubFile,
            isTypeshedStubFile: this._isTypeshedStubFile,
            isBuiltInStubFile: this._isBuiltInStubFile,
            isInPyTypedPackage: this._isThirdPartyPyTypedPresent,
            ipythonMode: this._ipythonMode,
            accessedSymbolSet: new Set<number>(),
        };
        return fileInfo;
    }

    private _cleanParseTreeIfRequired() {
        if (this._writableData.parserOutput) {
            if (this._writableData.parseTreeNeedsCleaning) {
                const cleanerWalker = new ParseTreeCleanerWalker(this._writableData.parserOutput.parseTree);
                cleanerWalker.clean();
                this._writableData.parseTreeNeedsCleaning = false;
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
            const importResult = importResolver.resolveImport(this._uri, execEnv, {
                leadingDots: 0,
                nameParts,
                importedSymbols: undefined,
            });

            if (skipMissingImport && !importResult.isImportFound) {
                return undefined;
            }

            // Avoid importing module from the module file itself.
            if (importResult.resolvedUris.length === 0 || importResult.resolvedUris[0] !== this._uri) {
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

        resolveAndAddIfNotSelf(['_typeshed', '_type_checker_internals'], /* skipMissingImport */ true);

        for (const moduleImport of moduleImports) {
            const importResult = importResolver.resolveImport(this._uri, execEnv, {
                leadingDots: moduleImport.leadingDots,
                nameParts: moduleImport.nameParts,
                importedSymbols: moduleImport.importedSymbols,
            });

            imports.push(importResult);

            // Associate the import results with the module import
            // name node in the parse tree so we can access it later
            // (for hover and definition support).
            if (moduleImport.nameParts.length === moduleImport.nameNode.d.nameParts.length) {
                AnalyzerNodeInfo.setImportInfo(moduleImport.nameNode, importResult);
            } else {
                // For implicit imports of higher-level modules within a multi-part
                // module name, the moduleImport.nameParts will refer to the subset
                // of the multi-part name rather than the full multi-part name. In this
                // case, store the import info on the name part node.
                assert(moduleImport.nameParts.length > 0);
                assert(moduleImport.nameParts.length - 1 < moduleImport.nameNode.d.nameParts.length);
                AnalyzerNodeInfo.setImportInfo(
                    moduleImport.nameNode.d.nameParts[moduleImport.nameParts.length - 1],
                    importResult
                );
            }
        }

        return {
            imports,
            builtinsImportResult,
        };
    }

    private _getPathForLogging(fileUri: Uri) {
        return getPathForLogging(this.fileSystem, fileUri);
    }

    private _parseFile(
        configOptions: ConfigOptions,
        fileUri: Uri,
        fileContents: string,
        useNotebookMode: boolean,
        diagSink: DiagnosticSink
    ): ParseFileResults {
        // Use the configuration options to determine the environment zin which
        // this source file will be executed.
        const execEnvironment = configOptions.findExecEnvironment(fileUri);

        const parseOptions = new ParseOptions();
        parseOptions.useNotebookMode = useNotebookMode;
        if (fileUri.pathEndsWith('pyi')) {
            parseOptions.isStubFile = true;
        }
        parseOptions.pythonVersion = execEnvironment.pythonVersion;
        parseOptions.skipFunctionAndClassBody = configOptions.indexGenerationMode ?? false;

        // Parse the token stream, building the abstract syntax tree.
        const parser = new Parser();
        return parser.parseSourceFile(fileContents, parseOptions, diagSink);
    }

    private _tokenizeContents(fileContents: string): TokenizerOutput {
        const tokenizer = new Tokenizer();
        const output = tokenizer.tokenize(fileContents);

        // If the file is currently open, cache the tokenizer results.
        if (this._writableData.clientDocumentContents !== undefined) {
            this._writableData.tokenizerOutput = output;

            // Replace the existing tokenizerLines with the newly-returned
            // version. They should have the same contents, but we want to use
            // the same object so the older object can be deallocated.
            this._writableData.tokenizerLines = output.lines;
        }

        return output;
    }

    private _fireFileDirtyEvent() {
        this.serviceProvider.tryGet(ServiceKeys.stateMutationListeners)?.forEach((l) => {
            try {
                l.onFileDirty?.(this._uri);
            } catch (ex: any) {
                const console = this.serviceProvider.tryGet(ServiceKeys.console);
                if (console) {
                    console.error(`State mutation listener exception: ${ex.message}`);
                }
            }
        });
    }
}
