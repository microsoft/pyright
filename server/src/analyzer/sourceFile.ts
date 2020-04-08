/*
 * sourceFile.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Class that represents a single python source file.
 */

import {
    CancellationToken,
    CompletionItem,
    CompletionList,
    DocumentSymbol,
    SymbolInformation,
} from 'vscode-languageserver';

import { OperationCanceledException } from '../common/cancellationUtils';
import { ConfigOptions, ExecutionEnvironment, getDefaultDiagnosticRuleSet } from '../common/configOptions';
import { ConsoleInterface, StandardConsole } from '../common/console';
import { assert } from '../common/debug';
import { Diagnostic, DiagnosticCategory } from '../common/diagnostic';
import { DiagnosticSink, TextRangeDiagnosticSink } from '../common/diagnosticSink';
import { TextEditAction } from '../common/editAction';
import { FileSystem } from '../common/fileSystem';
import { getFileName, normalizeSlashes } from '../common/pathUtils';
import * as StringUtils from '../common/stringUtils';
import { DocumentRange, getEmptyRange, Position, TextRange } from '../common/textRange';
import { TextRangeCollection } from '../common/textRangeCollection';
import { timingStats } from '../common/timing';
import { CompletionItemData, CompletionProvider, ModuleSymbolMap } from '../languageService/completionProvider';
import { DefinitionProvider } from '../languageService/definitionProvider';
import { DocumentSymbolProvider } from '../languageService/documentSymbolProvider';
import { HoverProvider, HoverResults } from '../languageService/hoverProvider';
import { performQuickAction } from '../languageService/quickActions';
import { ReferencesProvider, ReferencesResult } from '../languageService/referencesProvider';
import { SignatureHelpProvider, SignatureHelpResults } from '../languageService/signatureHelpProvider';
import { ModuleNode } from '../parser/parseNodes';
import { ModuleImport, ParseOptions, Parser, ParseResults } from '../parser/parser';
import { Token } from '../parser/tokenizerTypes';
import { AnalyzerFileInfo, ImportLookup } from './analyzerFileInfo';
import * as AnalyzerNodeInfo from './analyzerNodeInfo';
import { Binder, BinderResults } from './binder';
import { Checker } from './checker';
import { CircularDependency } from './circularDependency';
import * as CommentUtils from './commentUtils';
import { ImportResolver } from './importResolver';
import { ImportResult } from './importResult';
import { ParseTreeCleanerWalker } from './parseTreeCleaner';
import { Scope } from './scope';
import { SymbolTable } from './symbol';
import { TestWalker } from './testWalker';
import { TypeEvaluator } from './typeEvaluator';

const _maxImportCyclesPerFile = 4;

export class SourceFile {
    // Console interface to use for debugging.
    private _console: ConsoleInterface;

    // File path on disk.
    private readonly _filePath: string;

    // True if file is a type-hint (.pyi) file versus a python
    // (.py) file.
    private readonly _isStubFile: boolean;

    // True if the file is a typeshed stub file.
    private readonly _isTypeshedStubFile: boolean;

    // True if the file was imported as a third-party import.
    private readonly _isThirdPartyImport: boolean;

    // True if the file is the "typing.pyi" file, which needs
    // special-case handling.
    private readonly _isTypingStubFile: boolean;

    // True if the file one of the other built-in stub files
    // that require special-case handling: "collections.pyi",
    // "dataclasses.pyi", "abc.pyi", "asyncio/coroutines.pyi".
    private readonly _isBuiltInStubFile: boolean;

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

    // Client's version of the file. Null implies that contents
    // need to be read from disk.
    private _clientVersion: number | null = null;

    // In-memory contents if sent from the language client. If
    // clientVersion is null, we'll ignore this and read the
    // contents from disk.
    private _fileContents: string | undefined;

    // Version of file contents that have been analyzed.
    private _analyzedFileContentsVersion = -1;

    // Do we need to walk the parse tree and clean
    // the binder information hanging from it?
    private _parseTreeNeedsCleaning = false;

    private _parseResults?: ParseResults;
    private _moduleSymbolTable?: SymbolTable;
    private _binderResults?: BinderResults;

    // Reentrancy check for binding.
    private _isBindingInProgress = false;

    // Diagnostics generated during different phases of analysis.
    private _parseDiagnostics: Diagnostic[] = [];
    private _bindDiagnostics: Diagnostic[] = [];
    private _checkerDiagnostics: Diagnostic[] = [];

    // Settings that control which diagnostics should be output.
    private _diagnosticRuleSet = getDefaultDiagnosticRuleSet();

    // Circular dependencies that have been reported in this file.
    private _circularDependencies: CircularDependency[] = [];

    // Did we hit the maximum import depth?
    private _hitMaxImportDepth?: number;

    // Do we need to perform a binding step?
    private _isBindingNeeded = true;

    // Do we need to perform an additional type analysis pass?
    private _isCheckingNeeded = true;

    // Information about implicit and explicit imports from this file.
    private _imports?: ImportResult[];
    private _builtinsImport?: ImportResult;
    private _typingModulePath?: string;
    private _collectionsModulePath?: string;

    readonly fileSystem: FileSystem;

    constructor(
        fs: FileSystem,
        filePath: string,
        isTypeshedStubFile: boolean,
        isThirdPartyImport: boolean,
        console?: ConsoleInterface
    ) {
        this.fileSystem = fs;
        this._console = console || new StandardConsole();
        this._filePath = filePath;
        this._isStubFile = filePath.endsWith('.pyi');
        this._isTypeshedStubFile = isTypeshedStubFile;
        this._isThirdPartyImport = isThirdPartyImport;
        const fileName = getFileName(filePath);
        this._isTypingStubFile =
            this._isStubFile && (fileName === 'typing.pyi' || fileName === 'typing_extensions.pyi');

        this._isBuiltInStubFile = false;
        if (this._isStubFile) {
            if (
                this._filePath.endsWith(normalizeSlashes('/collections/__init__.pyi')) ||
                fileName === 'builtins.pyi' ||
                fileName === '_importlib_modulespec.pyi' ||
                fileName === 'dataclasses.pyi' ||
                fileName === 'abc.pyi' ||
                fileName === 'enum.pyi'
            ) {
                this._isBuiltInStubFile = true;
            }
        }
    }

    getFilePath(): string {
        return this._filePath;
    }

    getDiagnosticVersion(): number {
        return this._diagnosticVersion;
    }

    isStubFile() {
        return this._isStubFile;
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

        let diagList: Diagnostic[] = [];
        diagList = diagList.concat(this._parseDiagnostics, this._bindDiagnostics, this._checkerDiagnostics);

        // Filter the diagnostics based on "type: ignore" lines.
        if (options.diagnosticRuleSet.enableTypeIgnoreComments) {
            const typeIgnoreLines = this._parseResults ? this._parseResults.tokenizerOutput.typeIgnoreLines : {};
            if (Object.keys(typeIgnoreLines).length > 0) {
                diagList = diagList.filter((d) => {
                    for (let line = d.range.start.line; line <= d.range.end.line; line++) {
                        if (typeIgnoreLines[line]) {
                            return false;
                        }
                    }

                    return true;
                });
            }
        }

        if (options.diagnosticRuleSet.reportImportCycles !== 'none' && this._circularDependencies.length > 0) {
            const category =
                options.diagnosticRuleSet.reportImportCycles === 'warning'
                    ? DiagnosticCategory.Warning
                    : DiagnosticCategory.Error;

            this._circularDependencies.forEach((cirDep) => {
                diagList.push(
                    new Diagnostic(
                        category,
                        'Cycle detected in import chain\n' +
                            cirDep
                                .getPaths()
                                .map((path) => '  ' + path)
                                .join('\n'),
                        getEmptyRange()
                    )
                );
            });
        }

        if (this._hitMaxImportDepth !== undefined) {
            diagList.push(
                new Diagnostic(
                    DiagnosticCategory.Error,
                    `Import chain depth exceeded ${this._hitMaxImportDepth}`,
                    getEmptyRange()
                )
            );
        }

        if (this._isTypeshedStubFile) {
            if (options.diagnosticRuleSet.reportTypeshedErrors === 'none') {
                includeWarningsAndErrors = false;
            } else if (options.diagnosticRuleSet.reportTypeshedErrors === 'warning') {
                // Convert all the errors to warnings.
                diagList = diagList.map((diag) => {
                    if (diag.category === DiagnosticCategory.Error) {
                        return new Diagnostic(DiagnosticCategory.Warning, diag.message, diag.range);
                    }
                    return diag;
                });
            }
        }

        // If the file is in the ignore list, clear the diagnostic list.
        if (options.ignore.find((ignoreFileSpec) => ignoreFileSpec.regExp.test(this._filePath))) {
            diagList = [];
        }

        // If there is a "type: ignore" comment at the top of the file, clear
        // the diagnostic list.
        if (options.diagnosticRuleSet.enableTypeIgnoreComments) {
            if (this._parseResults && this._parseResults.tokenizerOutput.typeIgnoreAll) {
                diagList = [];
            }
        }

        // If we're not returning any diagnostics, filter out all of
        // the errors and warnings, leaving only the unreachable code
        // diagnostics.
        if (!includeWarningsAndErrors) {
            diagList = diagList.filter((diag) => diag.category === DiagnosticCategory.UnusedCode);
        }

        return diagList;
    }

    getImports(): ImportResult[] {
        return this._imports || [];
    }

    getBuiltinsImport(): ImportResult | undefined {
        return this._builtinsImport;
    }

    getModuleSymbolTable(): SymbolTable | undefined {
        return this._moduleSymbolTable;
    }

    getModuleDocString(): string | undefined {
        return this._binderResults ? this._binderResults.moduleDocString : undefined;
    }

    // Indicates whether the contents of the file have changed since
    // the last analysis was performed.
    didContentsChangeOnDisk(): boolean {
        // If this is an open file any content changes will be
        // provided through the editor. We can assume contents
        // didn't change without us knowing about them.
        if (this._clientVersion !== null) {
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

    markDirty(): void {
        this._fileContentsVersion++;
        this._isCheckingNeeded = true;
        this._moduleSymbolTable = undefined;
        this._binderResults = undefined;
    }

    markReanalysisRequired(): void {
        // Keep the parse info, but reset the analysis to the beginning.
        this._isCheckingNeeded = true;

        // If the file contains a wildcard import, we need to rebind
        // also because the dependent import may have changed.
        if (this._parseResults && this._parseResults.containsWildcardImport) {
            this._parseTreeNeedsCleaning = true;
            this._isBindingNeeded = true;
            this._moduleSymbolTable = undefined;
            this._binderResults = undefined;
        }
    }

    setClientVersion(version: number | null, contents: string): void {
        this._clientVersion = version;

        if (version === null) {
            this._fileContents = undefined;
        } else {
            if (this._fileContents !== undefined) {
                if (this._fileContents !== contents) {
                    this.markDirty();
                }
            }

            this._fileContents = contents;
        }
    }

    prepareForClose() {
        // Nothing to do currently.
    }

    isFileDeleted() {
        return this._isFileDeleted;
    }

    isParseRequired() {
        return this._analyzedFileContentsVersion !== this._fileContentsVersion;
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

    isCheckingRequired() {
        if (this.isBindingRequired()) {
            return true;
        }

        return this._isCheckingNeeded;
    }

    getParseResults(): ParseResults | undefined {
        if (!this.isParseRequired()) {
            return this._parseResults;
        }

        return undefined;
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

    setHitMaxImportDepth(maxImportDepth: number) {
        this._hitMaxImportDepth = maxImportDepth;
    }

    // Parse the file and update the state. Callers should wait for completion
    // (or at least cancel) prior to calling again. It returns true if a parse
    // was required and false if the parse information was up to date already.
    parse(configOptions: ConfigOptions, importResolver: ImportResolver): boolean {
        // If the file is already parsed, we can skip.
        if (!this.isParseRequired()) {
            return false;
        }

        const diagSink = new DiagnosticSink();
        let fileContents = this._fileContents;
        if (this._clientVersion === null) {
            try {
                timingStats.readFileTime.timeOperation(() => {
                    // Read the file's contents.
                    fileContents = this.fileSystem.readFileSync(this._filePath, 'utf8');

                    // Remember the length and hash for comparison purposes.
                    this._lastFileContentLength = fileContents.length;
                    this._lastFileContentHash = StringUtils.hashString(fileContents);
                });
            } catch (error) {
                diagSink.addError(`Source file could not be read`, getEmptyRange());
                fileContents = '';

                if (!this.fileSystem.existsSync(this._filePath)) {
                    this._isFileDeleted = true;
                }
            }
        }

        // Use the configuration options to determine the environment in which
        // this source file will be executed.
        const execEnvironment = configOptions.findExecEnvironment(this._filePath);

        const parseOptions = new ParseOptions();
        if (this._filePath.endsWith('pyi')) {
            parseOptions.isStubFile = true;
        }
        parseOptions.pythonVersion = execEnvironment.pythonVersion;

        try {
            // Parse the token stream, building the abstract syntax tree.
            const parser = new Parser();
            const parseResults = parser.parseSourceFile(fileContents!, parseOptions, diagSink);
            assert(parseResults !== undefined && parseResults.tokenizerOutput !== undefined);
            this._parseResults = parseResults;

            // Resolve imports.
            timingStats.resolveImportsTime.timeOperation(() => {
                [
                    this._imports,
                    this._builtinsImport,
                    this._typingModulePath,
                    this._collectionsModulePath,
                ] = this._resolveImports(importResolver, parseResults.importedModules, execEnvironment);
                this._parseDiagnostics = diagSink.fetchAndClear();
            });

            // Is this file in a "strict" path?
            const useStrict =
                configOptions.strict.find((strictFileSpec) => strictFileSpec.regExp.test(this._filePath)) !== undefined;

            this._diagnosticRuleSet = CommentUtils.getFileLevelDirectives(
                this._parseResults.tokenizerOutput.tokens,
                configOptions.diagnosticRuleSet,
                useStrict
            );
        } catch (e) {
            const message: string =
                (e.stack ? e.stack.toString() : undefined) ||
                (typeof e.message === 'string' ? e.message : undefined) ||
                JSON.stringify(e);
            this._console.log(`An internal error occurred while parsing ${this.getFilePath()}: ` + message);

            // Create dummy parse results.
            this._parseResults = {
                text: '',
                parseTree: ModuleNode.create({ start: 0, length: 0 }),
                importedModules: [],
                futureImports: new Map<string, boolean>(),
                tokenizerOutput: {
                    tokens: new TextRangeCollection<Token>([]),
                    lines: new TextRangeCollection<TextRange>([]),
                    typeIgnoreAll: false,
                    typeIgnoreLines: {},
                    predominantEndOfLineSequence: '\n',
                    predominantTabSequence: '    ',
                    predominantSingleQuoteCharacter: "'",
                },
                containsWildcardImport: false,
            };
            this._imports = undefined;
            this._builtinsImport = undefined;

            const diagSink = new DiagnosticSink();
            diagSink.addError(`An internal error occurred while parsing file`, getEmptyRange());
            this._parseDiagnostics = diagSink.fetchAndClear();

            // Do not rethrow the exception, swallow it here. Callers are not
            // prepared to handle an exception.
        }

        this._analyzedFileContentsVersion = this._fileContentsVersion;
        this._isBindingNeeded = true;
        this._isCheckingNeeded = true;
        this._parseTreeNeedsCleaning = false;
        this._hitMaxImportDepth = undefined;
        this._diagnosticVersion++;

        return true;
    }

    getDefinitionsForPosition(
        position: Position,
        evaluator: TypeEvaluator,
        token: CancellationToken
    ): DocumentRange[] | undefined {
        // If we have no completed analysis job, there's nothing to do.
        if (!this._parseResults) {
            return undefined;
        }

        return DefinitionProvider.getDefinitionsForPosition(this._parseResults, position, evaluator, token);
    }

    getReferencesForPosition(
        position: Position,
        includeDeclaration: boolean,
        evaluator: TypeEvaluator,
        token: CancellationToken
    ): ReferencesResult | undefined {
        // If we have no completed analysis job, there's nothing to do.
        if (!this._parseResults) {
            return undefined;
        }

        return ReferencesProvider.getReferencesForPosition(
            this._parseResults,
            this._filePath,
            position,
            includeDeclaration,
            evaluator,
            token
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

    addHierarchicalSymbolsForDocument(
        symbolList: DocumentSymbol[],
        evaluator: TypeEvaluator,
        token: CancellationToken
    ) {
        // If we have no completed analysis job, there's nothing to do.
        if (!this._parseResults) {
            return;
        }

        DocumentSymbolProvider.addHierarchicalSymbolsForDocument(symbolList, this._parseResults, evaluator, token);
    }

    addSymbolsForDocument(
        symbolList: SymbolInformation[],
        evaluator: TypeEvaluator,
        query: string,
        token: CancellationToken
    ) {
        // If we have no completed analysis job, there's nothing to do.
        if (!this._parseResults) {
            return;
        }

        DocumentSymbolProvider.addSymbolsForDocument(
            symbolList,
            query,
            this._filePath,
            this._parseResults,
            evaluator,
            token
        );
    }

    getHoverForPosition(
        position: Position,
        evaluator: TypeEvaluator,
        token: CancellationToken
    ): HoverResults | undefined {
        // If this file hasn't been bound, no hover info is available.
        if (this._isBindingNeeded || !this._parseResults) {
            return undefined;
        }

        return HoverProvider.getHoverForPosition(this._parseResults, position, evaluator, token);
    }

    getSignatureHelpForPosition(
        position: Position,
        importLookup: ImportLookup,
        evaluator: TypeEvaluator,
        token: CancellationToken
    ): SignatureHelpResults | undefined {
        // If we have no completed analysis job, there's nothing to do.
        if (!this._parseResults) {
            return undefined;
        }

        return SignatureHelpProvider.getSignatureHelpForPosition(this._parseResults, position, evaluator, token);
    }

    getCompletionsForPosition(
        position: Position,
        workspacePath: string,
        configOptions: ConfigOptions,
        importResolver: ImportResolver,
        importLookup: ImportLookup,
        evaluator: TypeEvaluator,
        moduleSymbolsCallback: () => ModuleSymbolMap,
        token: CancellationToken
    ): CompletionList | undefined {
        // If we have no completed analysis job, there's nothing to do.
        if (!this._parseResults) {
            return undefined;
        }

        // This command should be called only for open files, in which
        // case we should have the file contents already loaded.
        if (this._fileContents === undefined) {
            return undefined;
        }

        const completionProvider = new CompletionProvider(
            workspacePath,
            this._parseResults,
            this._fileContents,
            importResolver,
            position,
            this._filePath,
            configOptions,
            importLookup,
            evaluator,
            moduleSymbolsCallback,
            token
        );

        return completionProvider.getCompletionsForPosition();
    }

    resolveCompletionItem(
        configOptions: ConfigOptions,
        importResolver: ImportResolver,
        importLookup: ImportLookup,
        evaluator: TypeEvaluator,
        moduleSymbolsCallback: () => ModuleSymbolMap,
        completionItem: CompletionItem,
        token: CancellationToken
    ) {
        if (!this._parseResults || this._fileContents === undefined) {
            return;
        }

        const completionData = completionItem.data as CompletionItemData;
        const completionProvider = new CompletionProvider(
            completionData.workspacePath,
            this._parseResults,
            this._fileContents,
            importResolver,
            completionData.position,
            this._filePath,
            configOptions,
            importLookup,
            evaluator,
            moduleSymbolsCallback,
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
        if (this._fileContents === undefined) {
            return undefined;
        }

        return performQuickAction(command, args, this._parseResults, token);
    }

    bind(configOptions: ConfigOptions, importLookup: ImportLookup, builtinsScope: Scope | undefined) {
        assert(!this.isParseRequired());
        assert(this.isBindingRequired());
        assert(!this._isBindingInProgress);
        assert(this._parseResults !== undefined);

        try {
            // Perform name binding.
            timingStats.bindTime.timeOperation(() => {
                this._cleanParseTreeIfRequired();

                const fileInfo = this._buildFileInfo(
                    configOptions,
                    this._parseResults!.text,
                    importLookup,
                    builtinsScope
                );
                AnalyzerNodeInfo.setFileInfo(this._parseResults!.parseTree, fileInfo);

                const binder = new Binder(fileInfo);
                this._isBindingInProgress = true;
                this._binderResults = binder.bindModule(this._parseResults!.parseTree);

                // If we're in "test mode" (used for unit testing), run an additional
                // "test walker" over the parse tree to validate its internal consistency.
                if (configOptions.internalTestMode) {
                    const testWalker = new TestWalker();
                    testWalker.walk(this._parseResults!.parseTree);
                }

                this._bindDiagnostics = fileInfo.diagnosticSink.fetchAndClear();
                const moduleScope = AnalyzerNodeInfo.getScope(this._parseResults!.parseTree);
                assert(moduleScope !== undefined);
                this._moduleSymbolTable = moduleScope!.symbolTable;
            });
        } catch (e) {
            const message: string =
                (e.stack ? e.stack.toString() : undefined) ||
                (typeof e.message === 'string' ? e.message : undefined) ||
                JSON.stringify(e);
            this._console.log(
                `An internal error occurred while performing name binding for ${this.getFilePath()}: ` + message
            );

            const diagSink = new DiagnosticSink();
            diagSink.addError(`An internal error occurred while performing name binding`, getEmptyRange());
            this._bindDiagnostics = diagSink.fetchAndClear();

            // Do not rethrow the exception, swallow it here. Callers are not
            // prepared to handle an exception.
        } finally {
            this._isBindingInProgress = false;
        }

        // Prepare for the next stage of the analysis.
        this._diagnosticVersion++;
        this._isCheckingNeeded = true;
        this._isBindingNeeded = false;
    }

    check(evaluator: TypeEvaluator) {
        assert(!this.isParseRequired());
        assert(!this.isBindingRequired());
        assert(!this._isBindingInProgress);
        assert(this.isCheckingRequired());
        assert(this._parseResults !== undefined);

        try {
            timingStats.typeCheckerTime.timeOperation(() => {
                const checker = new Checker(this._parseResults!.parseTree, evaluator);
                checker.check();
                this._isCheckingNeeded = false;

                const fileInfo = AnalyzerNodeInfo.getFileInfo(this._parseResults!.parseTree)!;
                this._checkerDiagnostics = fileInfo.diagnosticSink.fetchAndClear();
            });
        } catch (e) {
            const isCancellation = OperationCanceledException.is(e);
            if (!isCancellation) {
                const message: string =
                    (e.stack ? e.stack.toString() : undefined) ||
                    (typeof e.message === 'string' ? e.message : undefined) ||
                    JSON.stringify(e);
                this._console.log(
                    `An internal error occurred while while performing type checking for ${this.getFilePath()}: ` +
                        message
                );
                const diagSink = new DiagnosticSink();
                diagSink.addError(`An internal error occurred while performing type checking`, getEmptyRange());

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
    }

    private _buildFileInfo(
        configOptions: ConfigOptions,
        fileContents: string,
        importLookup: ImportLookup,
        builtinsScope?: Scope
    ) {
        assert(this._parseResults !== undefined);
        const analysisDiagnostics = new TextRangeDiagnosticSink(this._parseResults!.tokenizerOutput.lines);

        const fileInfo: AnalyzerFileInfo = {
            importLookup,
            futureImports: this._parseResults!.futureImports,
            builtinsScope,
            typingModulePath: this._typingModulePath,
            collectionsModulePath: this._collectionsModulePath,
            diagnosticSink: analysisDiagnostics,
            executionEnvironment: configOptions.findExecEnvironment(this._filePath),
            diagnosticRuleSet: this._diagnosticRuleSet,
            fileContents,
            lines: this._parseResults!.tokenizerOutput.lines,
            filePath: this._filePath,
            isStubFile: this._isStubFile,
            isTypingStubFile: this._isTypingStubFile,
            isBuiltInStubFile: this._isBuiltInStubFile,
            accessedSymbolMap: new Map<number, true>(),
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
    ): [ImportResult[], ImportResult?, string?, string?] {
        const imports: ImportResult[] = [];

        // Always include an implicit import of the builtins module.
        let builtinsImportResult: ImportResult | undefined = importResolver.resolveImport(this._filePath, execEnv, {
            leadingDots: 0,
            nameParts: ['builtins'],
            importedSymbols: undefined,
        });

        // Avoid importing builtins from the builtins.pyi file itself.
        if (
            builtinsImportResult.resolvedPaths.length === 0 ||
            builtinsImportResult.resolvedPaths[0] !== this.getFilePath()
        ) {
            imports.push(builtinsImportResult);
        } else {
            builtinsImportResult = undefined;
        }

        // Always include an implicit import of the typing module.
        const typingImportResult: ImportResult | undefined = importResolver.resolveImport(this._filePath, execEnv, {
            leadingDots: 0,
            nameParts: ['typing'],
            importedSymbols: undefined,
        });

        // Avoid importing typing from the typing.pyi file itself.
        let typingModulePath: string | undefined;
        if (
            typingImportResult.resolvedPaths.length === 0 ||
            typingImportResult.resolvedPaths[0] !== this.getFilePath()
        ) {
            imports.push(typingImportResult);
            typingModulePath = typingImportResult.resolvedPaths[0];
        }

        let collectionsModulePath: string | undefined;

        for (const moduleImport of moduleImports) {
            const importResult = importResolver.resolveImport(this._filePath, execEnv, {
                leadingDots: moduleImport.leadingDots,
                nameParts: moduleImport.nameParts,
                importedSymbols: moduleImport.importedSymbols,
            });

            // If the file imports the stdlib 'collections' module, stash
            // away its file path. The type analyzer may need this to
            // access types defined in the collections module.
            if (importResult.isImportFound && importResult.isTypeshedFile) {
                if (moduleImport.nameParts.length >= 1 && moduleImport.nameParts[0] === 'collections') {
                    collectionsModulePath = importResult.resolvedPaths[importResult.resolvedPaths.length - 1];
                }
            }

            imports.push(importResult);

            // Associate the import results with the module import
            // name node in the parse tree so we can access it later
            // (for hover and definition support).
            AnalyzerNodeInfo.setImportInfo(moduleImport.nameNode, importResult);
        }

        return [imports, builtinsImportResult, typingModulePath, collectionsModulePath];
    }
}
