/**
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * programWrapper.ts
 *
 * Wraps Pyright's `Program` in the `IProgram` interface the type server consumes.
 *
 * The wrapper is thin: every method delegates synchronously to the underlying `Program`.
 * It exists to (a) present the `IProgram` contract the conversion layer is written against,
 * (b) reshape Pyright types (`SourceFileInfo`, `ParseFileResults`, `SourceMapper`) into the
 * type-server-facing shapes, and (c) maintain a monotonic `snapshot` content-version counter
 * (on the shared `ITypeCache`) that the server exposes to clients for cache coherence.
 *
 * Cancellation is handled the same way as everywhere else in Pyright: work runs inside
 * `runWithCancellationToken`, and the evaluator polls the token, so long-running synchronous
 * queries can be interrupted mid-request.
 */
import { TypeServerProtocol } from './protocol/typeServerProtocol';
import { CancellationToken, Diagnostic, DocumentDiagnosticReport, FileEvent } from 'vscode-languageserver-protocol';

import {
    AbsoluteModuleDescriptor,
    AnalyzerFileInfo,
    ImportLookupResult,
    LookupImportOptions,
} from '../analyzer/analyzerFileInfo';
import {
    DunderAllInfo,
    getDeclaration,
    getDunderAllInfo,
    getFileInfo,
    getFlowNode,
    getImportInfo,
    getScope,
} from '../analyzer/analyzerNodeInfo';
import { FlowNode } from '../analyzer/codeFlowTypes';
import { Declaration, FunctionDeclaration } from '../analyzer/declaration';
import { ImportedModuleDescriptor } from '../analyzer/importResolver';
import { ImportResult } from '../analyzer/importResult';
import { getScopeIdForNode } from '../analyzer/parseTreeUtils';
import { Program } from '../analyzer/program';
import { getScopeForNode } from '../analyzer/scopeUtils';
import { IPythonMode } from '../analyzer/sourceFile';
import { SourceFileInfo } from '../analyzer/sourceFileInfo';
import { Symbol, SymbolTable } from '../analyzer/symbol';
import { ensureExpectedTypeCandidates, ExpectedTypeResult } from '../analyzer/typeEvaluatorTypes';
import { isClass, isFunctionOrOverloaded, Type } from '../analyzer/types';
import { ConfigOptions, ExecutionEnvironment } from '../common/configOptions';
import { ConsoleInterface } from '../common/console';
import { FileEditAction } from '../common/editAction';
import { ProgramView } from '../common/extensibility';
import { ReadOnlyFileSystem } from '../common/fileSystem';
import { ServiceProvider } from '../common/serviceProvider';
import { Uri } from '../common/uri/uri';
import { UriMap } from '../common/uri/uriMap';
import { isFile } from '../common/uri/uriUtils';
import { isExpressionNode, ModuleNode, ParseNode, ParseNodeType } from '../parser/parseNodes';
import { ParserOutput } from '../parser/parser';

import { createTypeServerEvaluator, ITypeServerEvaluator } from './typeServerEvaluator';
import { getEffectiveTypeOfDeclaration, isDeclaration } from './typeEvalUtils';
import { convertFromPyrightDiagnostic } from './diagnosticUtils';
import { INotebookUriMapper } from './notebookUriMapper';
import { getProtocolDeclKey } from './typeServerConversionTypes';

import { TypeServerServiceKeys } from './typeServerServiceKeys';
import { findFirstExpression } from './typeServerConversionUtils';
import { ProfilingInfo } from './profilingStub';
import { ServerCanceledException } from './cancellation';
import { IProgram, ISourceFileInfo, ISourceMapper, ISymbolLookup, ParseResults } from './programTypes';
import { ITypeCache, TypeCache } from './typeCache';

/**
 * Adapter that lets the in-proc Pyright `Program` (which is mutable and has no
 * native snapshot concept) satisfy the `IProgram` contract the type server's
 * conversion layer is written against.
 *
 *   - `run` runs the callback over the live `Program` via `_program.run(...)`.
 *     Because Pyright's evaluator is synchronous the callback executes atomically,
 *     so it simply receives `this` — there is no copy-on-write snapshot view.
 *   - A monotonic `snapshot` counter (on the shared `ITypeCache`) is bumped by the
 *     mutating methods below. It is a protocol-level content version: the server
 *     hands it to clients via `typeServer/getSnapshot`, rejects stale requests at
 *     the request boundary, and fires `SnapshotChangedNotification` on change.
 *   - Cross-request state (`_declTypeCache`, `_protocolDeclCache`, `_addedStubs`, …)
 *     lives on the wrapper, not on the `Program`, which has nowhere to put it, and
 *     is invalidated when the snapshot increments.
 */
export class ProgramWrapper implements IProgram {
    private _cachedSearchPaths: Uri[] | undefined;
    private _declTypeCache: WeakMap<ParseNode, Type> = new WeakMap();
    private _protocolDeclCache: Map<string, Declaration> = new Map();
    private _disableSnapshotIncrement = false;
    private _addedStubs = new UriMap<boolean>();
    private _inEditMode = false;

    constructor(private readonly _program: Program, private _cache: ITypeCache) {
        // Overwrite a bunch of the program's methods so we can update the snapshot.
        const originalSetFileOpened = this._program.setFileOpened.bind(this._program);
        this._program.setFileOpened = (fileUri: Uri, version: number | null, contents: string, options) => {
            originalSetFileOpened(fileUri, version, contents, options);
            this._incrementSnapshot();
        };
        const originalSetFileClosed = this._program.setFileClosed.bind(this._program);
        this._program.setFileClosed = (fileUri: Uri) => {
            const result = originalSetFileClosed(fileUri);
            this._incrementSnapshot();
            return result;
        };
        const originalUpdateChainedUri = this._program.updateChainedUri.bind(this._program);
        this._program.updateChainedUri = (fileUri: Uri, chainedFileUri: Uri) => {
            originalUpdateChainedUri(fileUri, chainedFileUri);
            this._incrementSnapshot();
        };
        const originalMarkFilesDirty = this._program.markFilesDirty.bind(this._program);
        this._program.markFilesDirty = (fileUris: Uri[], evenIfContentsAreSame: boolean) => {
            originalMarkFilesDirty(fileUris, evenIfContentsAreSame);
            this._incrementSnapshot();
        };
        const originalMarkAllFilesDirty = this._program.markAllFilesDirty.bind(this._program);
        this._program.markAllFilesDirty = (evenIfContentsAreSame: boolean) => {
            originalMarkAllFilesDirty(evenIfContentsAreSame);
            this._incrementSnapshot();
        };
        const originalSetConfigOptions = this._program.setConfigOptions.bind(this._program);
        this._program.setConfigOptions = (configOptions: ConfigOptions) => {
            originalSetConfigOptions(configOptions);
            this._cachedSearchPaths = undefined;
            this._incrementSnapshot();
        };
        const originalSetImportResolver = this._program.setImportResolver.bind(this._program);
        this._program.setImportResolver = (importResolver) => {
            originalSetImportResolver(importResolver);
            this._cachedSearchPaths = undefined;
            this._incrementSnapshot();
        };
    }
    get id(): string {
        return this._program.id;
    }
    get rootPath(): Uri {
        return this._program.rootPath;
    }
    get console(): ConsoleInterface {
        return this._program.console;
    }
    get configOptions(): ConfigOptions {
        return this._program.configOptions;
    }
    get fs() {
        return this._program.fileSystem;
    }
    get fileSystem(): ReadOnlyFileSystem {
        return this._program.fileSystem;
    }
    get serviceProvider(): ServiceProvider {
        return this._program.serviceProvider;
    }
    get uriMapper(): INotebookUriMapper | undefined {
        return this._program.serviceProvider.tryGet(TypeServerServiceKeys.uriMapper);
    }

    get isAlive(): boolean {
        return true;
    }

    get isPyright(): boolean {
        return true;
    }

    get performsAnalysis(): boolean {
        return true;
    }

    get supportsPullDiagnostics(): boolean {
        return true;
    }

    get symbolLookup(): ISymbolLookup {
        const symbolLookup: ISymbolLookup = {
            getFileInfo: (node: ParseNode): AnalyzerFileInfo => {
                // Ensure the file is bound before reading AnalyzerInfo off the node.
                // Without this, nodes from files that haven't been bound yet (e.g.
                // freshly-discovered modules during a code-action request) return
                // undefined fileInfo and crash downstream readers.
                const fileUri = this._cache.getUri(node);
                this._program.getBoundSourceFileInfo(fileUri);
                return getFileInfo(node);
            },
            getImportInfo: (node: ParseNode): ImportResult | undefined => {
                return getImportInfo(node);
            },
            getDeclaration: (node: ParseNode): Declaration | undefined => {
                return getDeclaration(node);
            },
            getFlowNode: (node: ParseNode): FlowNode | undefined => {
                return getFlowNode(node);
            },
            getScope(node) {
                return getScope(node);
            },
            getScopeIdForNode(node: ParseNode): string {
                return getScopeIdForNode(node);
            },
            getDunderAllInfo(node: ModuleNode): DunderAllInfo | undefined {
                return getDunderAllInfo(node);
            },
            getSymbolsForFile: (fileUri: Uri, skipFileNeededCheck = false): SymbolTable | undefined => {
                // The underlying sync `Program` has only one version of any file, and there is
                // no snapshot view to pin to. Callers expect this to return a symbol table even
                // if the file hasn't been analyzed yet, so ensure the file is present and bound.
                this._program.addInterimFile(fileUri);
                this._program.getBoundSourceFileInfo(fileUri, undefined, skipFileNeededCheck);
                return this._program.getModuleSymbolTable(fileUri);
            },
            getSymbolsForNode: (node: ParseNode): SymbolTable | undefined => {
                const scope = getScopeForNode(node);
                return scope?.symbolTable;
            },
            lookupSymbol: (
                scopingNode: ParseNode,
                name: string,
                _skipFileNeededCheck?: boolean
            ): Symbol | undefined => {
                return getSymbolFromScope(scopingNode, name);
            },
            getMatchingFileInfos: (fileId: string): AnalyzerFileInfo[] => {
                const parseTrees = this._program
                    .getSourceFileInfoList()
                    .map((f) => f.sourceFile.getParseResults()?.parserOutput.parseTree)
                    .filter((t): t is ModuleNode => !!t);
                const fileInfos = parseTrees.map((p) => getFileInfo(p)).filter((f) => f.fileId === fileId);
                return fileInfos;
            },
        };
        return symbolLookup;
    }

    runEditMode<T>(callback: (p: IProgram) => T, token: CancellationToken): FileEditAction[] {
        let results: FileEditAction[] = [];
        if (this._inEditMode) {
            throw new ServerCanceledException();
        }
        this._inEditMode = true;
        this._program.enterEditMode();
        try {
            this._program.evaluator?.runWithCancellationToken(token, () => callback(this));
        } finally {
            results = this._program.exitEditMode();
            this._inEditMode = false;
        }
        return results;
    }
    enterEditMode(): void {
        this._program.enterEditMode();
    }
    exitEditMode(): FileEditAction[] {
        return this._program.exitEditMode();
    }
    run<T>(callback: (p: IProgram) => T, token: CancellationToken): T {
        return this._program.run(() => callback(this), token);
    }

    createEvaluator(): ITypeServerEvaluator {
        return createTypeServerEvaluator(this._program, this.symbolLookup);
    }

    getCachedTypeForDeclaration(decl: Declaration): Type | undefined {
        return this._declTypeCache.get(decl.node);
    }

    setCachedTypeForDeclaration(decl: Declaration, type: Type): void {
        this._declTypeCache.set(decl.node, type);
    }

    getCachedProtocolDecl(tspDecl: TypeServerProtocol.Declaration): Declaration | undefined {
        return this._protocolDeclCache.get(getProtocolDeclKey(tspDecl));
    }

    setCachedProtocolDecl(tspDecl: TypeServerProtocol.Declaration, decl: Declaration): void {
        this._protocolDeclCache.set(getProtocolDeclKey(tspDecl), decl);
    }
    getSourceMapper(
        fileUri: Uri,
        mapCompiled: boolean,
        preferStubs: boolean,
        token: CancellationToken
    ): ISourceMapper | undefined {
        const sourceMapper = this._program.getSourceMapper(fileUri, token, mapCompiled, preferStubs);
        const wrapper: ISourceMapper = {
            findDeclarations: (decl: Declaration) => {
                return sourceMapper ? sourceMapper.findDeclarations(decl) : [];
            },
            findDeclarationsByType: (originatedPath, type, useTypeAlias) => {
                return sourceMapper ? sourceMapper.findDeclarationsByType(originatedPath, type, useTypeAlias) : [];
            },
            findClassDeclarationsByType: (uri, type) => {
                return sourceMapper ? sourceMapper.findClassDeclarationsByType(uri, type) : [];
            },
            findFunctionDeclarations: (decl: FunctionDeclaration) => {
                return sourceMapper ? sourceMapper.findFunctionDeclarations(decl) : [];
            },
            getSourcePathsFromStub: (stubUri: Uri, fromFile: Uri | undefined) => {
                return sourceMapper ? sourceMapper.getSourcePathsFromStub(stubUri, fromFile) : [];
            },
            getModuleNode: (uri: Uri) => {
                return sourceMapper ? sourceMapper.getModuleNode(uri) : undefined;
            },
            findModules: (stubFile: Uri) => {
                return sourceMapper ? sourceMapper.findModules(stubFile) : [];
            },
            getFileInfo: (node) => {
                // Ensure the file is bound before reading AnalyzerInfo off the node.
                const fileUri = this._cache.getUri(node);
                this._program.getBoundSourceFileInfo(fileUri);
                return getFileInfo(node);
            },
        };
        return wrapper;
    }
    getUri(node: ParseNode): Uri {
        return this._cache.getUri(node);
    }
    isCaseSensitive(uri: string): boolean {
        return this._cache.isCaseSensitive(uri);
    }

    /**
     * Ensures the file is analyzed and the evaluator's prefetched type cache is warmed up.
     * This avoids expensive re-evaluation when the cache is cold (e.g., first request for a file
     * that imports large libraries).
     */
    ensureFileAnalyzed(fileUri: Uri, token: CancellationToken): void {
        const sourceFile = this._program.getSourceFile(fileUri);
        if (!sourceFile) {
            return;
        }

        // Analyze the file if needed
        this._program.analyzeFile(fileUri, token);

        // Warm up the evaluator's prefetched type cache by calling getType on the first expression.
        // This triggers initializePrefetchedTypes which caches built-in types like object, bool, int, etc.
        // Without this, the first call to getExpectedType/getType would be slow.
        const parserOutput = this._program.getParserOutput(fileUri);
        if (parserOutput?.parseTree) {
            this._program.run((p) => {
                // Find the first expression node in the parse tree
                const firstExpr = findFirstExpression(parserOutput.parseTree);
                if (firstExpr) {
                    // This will trigger initializePrefetchedTypes
                    p.evaluator?.getType(firstExpr);
                }
            }, token);
        }
    }

    getComputedType(arg: ParseNode | Declaration, token: CancellationToken): Type | undefined {
        const result = this._program.run((p) => {
            if (isDeclaration(arg)) {
                return getEffectiveTypeOfDeclaration(p.evaluator, arg);
            }

            if (isExpressionNode(arg)) {
                return p.evaluator?.getType(arg);
            }

            return undefined;
        }, token);

        // Massage the result to ensure compatibility with the protocol.
        return this._massageTypeResult(result);
    }

    getExpectedType(arg: ParseNode | Declaration, token: CancellationToken): ExpectedTypeResult | undefined {
        const result = this._program.run((p) => {
            if (isDeclaration(arg)) {
                const type = p.evaluator?.getTypeForDeclaration(arg)?.type;
                return type
                    ? {
                          type,
                          node: arg.node,
                          candidates: [],
                      }
                    : undefined;
            }

            if (isExpressionNode(arg)) {
                return p.evaluator?.getExpectedType(arg);
            }

            return undefined;
        }, token);

        return this._massageExpectedTypeResult(result);
    }
    getDeclaredType(arg: ParseNode | Declaration, token: CancellationToken): Type | undefined {
        const result = this._program.run((p) => {
            if (isDeclaration(arg)) {
                return p.evaluator?.getTypeForDeclaration(arg)?.type;
            }

            if (isExpressionNode(arg)) {
                return p.evaluator?.getType(arg);
            }

            return undefined;
        }, token);

        // Massage the result to ensure compatibility with the protocol.
        return this._massageTypeResult(result);
    }

    startProfiling(): ProfilingInfo | undefined {
        const localProfiler = this.serviceProvider.tryGet(TypeServerServiceKeys.profilingService);
        return localProfiler?.startProfiling();
    }

    stopProfiling(): ProfilingInfo | undefined {
        const localProfiler = this.serviceProvider.tryGet(TypeServerServiceKeys.profilingService);
        return localProfiler?.stopProfiling();
    }

    startWorkspaceDiagnostics(partialResultToken: string): void {
        // No-op for internal program
    }

    stopWorkspaceDiagnostics(): void {
        // No-op for internal program
    }

    getPythonSearchPaths(token: CancellationToken): Uri[] | undefined {
        const execEnv = this._getExecEnv(this._program.rootPath);
        if (!this._cachedSearchPaths) {
            this._cachedSearchPaths = this._program.importResolver.getImportRoots(execEnv);
        }
        return this._cachedSearchPaths;
    }

    lookupImport(
        fileUriOrModule: Uri | AbsoluteModuleDescriptor,
        options?: LookupImportOptions
    ): ImportLookupResult | undefined {
        return this._program.lookUpImport(fileUriOrModule, options);
    }

    owns(uri: Uri): boolean {
        return this._program.owns(uri);
    }
    getParserOutput(fileUri: Uri): ParserOutput | undefined {
        let results = this._program.getParserOutput(fileUri);
        if (!results) {
            // Try making an interim file instead.
            if (this.fileSystem.existsSync(fileUri)) {
                this._program.addInterimFile(fileUri);
                results = this._program.getParserOutput(fileUri);
            }
        }
        return results;
    }
    getParseResults(fileUri: Uri): ParseResults | undefined {
        let results = this._program.getParseResults(fileUri);
        if (!results) {
            // Try making an interim file instead.
            if (this.fileSystem.existsSync(fileUri)) {
                this._program.addInterimFile(fileUri);
                results = this._program.getParseResults(fileUri);
            }
        }
        if (!results) {
            return undefined;
        }
        // Sync `ProgramView.getParseResults` returns the upstream `ParseFileResults`; the
        // type server's `ParseResults` adds `moduleName` and `uri`. Synthesize them so the
        // wrapper satisfies the shared `IProgram` contract used by snapshot-aware callers.
        return {
            ...results,
            moduleName: this.getModuleName(fileUri) ?? '',
            uri: fileUri,
        };
    }
    addStubCode(code: string, directoryUri?: Uri): { uri: Uri; parseResults: ParseResults } {
        // Generate a unique stub URI
        // If directoryUri is provided, create the stub in that directory so imports resolve correctly
        const stubFileName = `__stub_${Date.now()}_${Math.random().toString(36).substring(7)}.pyi`;
        const stubUri = directoryUri
            ? directoryUri.resolvePaths(stubFileName)
            : Uri.file(`/${stubFileName}`, this.serviceProvider);

        // Disable snapshot increment while adding stub files since they're dynamically generated
        // and don't invalidate existing type analysis
        this._disableSnapshotIncrement = true;
        try {
            // Add as an interim file to the underlying program
            // This allows the program to parse and track the file
            this._program.setFileOpened(stubUri, 0, code, {
                ipythonMode: IPythonMode.None,
                chainedFileUri: undefined,
                isVirtual: true,
            });
            this._program.addInterimFile(stubUri);

            // Get the parse results from the program
            const parseResults = this._program.getParseResults(stubUri);
            if (!parseResults) {
                throw new Error('Failed to parse stub code');
            }
            this._addedStubs.set(stubUri, true);

            return {
                uri: stubUri,
                parseResults: { ...parseResults, moduleName: this.getModuleName(stubUri) ?? '', uri: stubUri },
            };
        } finally {
            this._disableSnapshotIncrement = false;
        }
    }
    getModuleName(fileUri: Uri): string | undefined {
        // Use the import resolver to get the module name, matching the sync Program._getModuleName() behavior.
        // This ensures proper module name resolution for operations like rename module.

        // If this looks like a directory path (no extension or ends with __init__), determine the target file.
        // We don't require the file/directory to exist - the import resolver computes module names from paths.
        let targetUri = fileUri;

        // Check if it's an existing directory
        if (this._program.fileSystem.existsSync(fileUri) && !isFile(this._program.fileSystem, fileUri)) {
            // It's an existing directory - look for __init__.pyi first, then __init__.py
            let initFile = fileUri.initPyiUri;
            if (!this._program.fileSystem.existsSync(initFile)) {
                initFile = fileUri.initPyUri;
                if (!this._program.fileSystem.existsSync(initFile)) {
                    // No __init__ file found, can't determine module name for this package
                    return undefined;
                }
            }
            targetUri = initFile;
        } else if (!this._program.fileSystem.existsSync(fileUri)) {
            // File doesn't exist yet (e.g., new file path for rename/move)
            // The import resolver can still compute the module name from the path
            // For directories being created, assume __init__.py will be created
            const ext = fileUri.lastExtension;
            if (!ext) {
                // No extension suggests it's a directory - use __init__.py path for module name
                targetUri = fileUri.initPyUri;
            }
            // Otherwise, use the file path as-is
        }

        const execEnv = this._program.configOptions.findExecEnvironment(targetUri);
        const moduleNameAndType = this._program.importResolver.getModuleNameForImport(
            targetUri,
            execEnv,
            /* allowIllegalModuleName */ true,
            /* detectPyTyped */ true
        );
        return moduleNameAndType.moduleName || undefined;
    }
    getSourceFileInfo(fileUri: Uri): ISourceFileInfo | undefined {
        const result = this._program.getSourceFileInfo(fileUri);
        if (result) {
            return this._makeSourceFileInfo(result);
        }
        return undefined;
    }
    hasSourceFile(fileUri: Uri): boolean {
        // Sync `Program.getSourceFileInfo` does not lazily materialize, so a
        // simple existence check is safe.
        return !!this._program.getSourceFileInfo(fileUri);
    }
    getTrackedFileList(): readonly ISourceFileInfo[] {
        return this._program.getSourceFileInfoList().map((s) => this._makeSourceFileInfo(s));
    }
    updateFileContents(uri: Uri, newContents: string): void {
        let fileInfo = this._program.getSourceFileInfo(uri);
        if (!fileInfo) {
            fileInfo = this._program.addInterimFile(uri);
        }
        if (fileInfo) {
            const version = fileInfo.clientVersion || 0;
            const chainedFileUri = fileInfo ? fileInfo.chainedSourceFile?.uri : undefined;
            const ipythonMode = fileInfo ? fileInfo.ipythonMode : IPythonMode.None;
            this._program.setFileOpened(uri, version + 1, newContents, { chainedFileUri, ipythonMode });
        }
    }

    addTrackedFile(uri: Uri, isThirdPartyImport: boolean, isInPyTypedPackage: boolean): void {
        this._program.addTrackedFile(uri, isThirdPartyImport, isInPyTypedPackage);
    }

    setTrackedFiles(uris: Uri[]): void {
        this._program.setTrackedFiles(uris);
    }

    handleMemoryHighUsage(): void {
        this._program.handleMemoryHighUsage();
    }

    getSnapshot(token: CancellationToken): number {
        return this._cache.snapshot;
    }
    getDocumentDiagnostics(
        uri: Uri,
        previousResultId: string | undefined,
        token: CancellationToken
    ): DocumentDiagnosticReport {
        const sourceFile = this._program.getSourceFile(uri);
        if (sourceFile) {
            // Analyze the file if it needs to be analyzed
            if (sourceFile.isCheckingRequired() || sourceFile.isBindingRequired()) {
                this._program.analyzeFile(uri, token);
            }
        }
        const parseResults = this._program.getParseResults(uri);
        let diagnostics: Diagnostic[] = [];
        let versionStr: string | undefined = undefined;
        if (sourceFile && parseResults) {
            const range = {
                start: { line: 0, character: 0 },
                end: { line: parseResults.tokenizerOutput.lines.count, character: 0 },
            };
            diagnostics = this._program
                .getDiagnosticsForRange(uri, range)
                .map((d) => convertFromPyrightDiagnostic(d, this._program.fileSystem, true, true) || d);
            versionStr = sourceFile.getDiagnosticVersion().toString();
        }
        return { kind: 'full', resultId: versionStr, items: diagnostics };
    }
    resolveImport(
        source: Uri,
        moduleDescriptor: TypeServerProtocol.ModuleName,
        token: CancellationToken
    ): Uri | undefined {
        const realModuleDescriptor: ImportedModuleDescriptor = {
            ...moduleDescriptor,
            importedSymbols: new Set<string>(),
        };
        const results = this._program.importResolver.resolveImport(
            source,
            this._getExecEnv(source),
            realModuleDescriptor
        );
        const uris = results.resolvedUris.filter((uri) => uri !== undefined && !uri.isEmpty());
        if (uris && results.isImportFound) {
            // Make sure to pick the last one. It's the most specific.
            return uris[uris.length - 1];
        }
        return undefined;
    }
    changedWatchedFiles(changes: FileEvent[]): void {
        // Not necessary for the normal program.
    }
    addInterimFile(uri: Uri): IProgram {
        this._program.addInterimFile(uri);
        return this;
    }
    dispose(): void {
        // Don't dispose of the program. The caller is responsible for that.
    }

    private _massageTypeResult(result: Type | undefined): Type | undefined {
        // For function types, make sure we inferred the return type if not
        // already.
        if (result && isFunctionOrOverloaded(result)) {
            this._program.evaluator?.inferReturnTypeIfNecessary(result);
        }

        // Temporary problem. If this is a class, the protocol compatibility
        // map stores Pyright types in it. Remove it.
        if (result && isClass(result) && result.shared.protocolCompatibility) {
            result = { ...result, shared: { ...result.shared, protocolCompatibility: undefined } };
        }

        // Remove all cached values. They need to be recomputed on the client side.
        if (result && result.cached) {
            result = { ...result, cached: undefined };
        }

        return result;
    }

    private _massageExpectedTypeResult(result: ExpectedTypeResult | undefined): ExpectedTypeResult | undefined {
        if (!result) {
            return undefined;
        }

        const type = this._massageTypeResult(result.type);
        if (!type) {
            return undefined;
        }

        const candidates = result.candidates
            .map((candidate) => this._massageTypeResult(candidate))
            .filter((candidate): candidate is Type => !!candidate);

        return {
            type,
            node: result.node,
            candidates: ensureExpectedTypeCandidates(type, candidates),
        };
    }

    private _makeSourceFileInfo(s: SourceFileInfo): ISourceFileInfo {
        // Create an anonymous class that wraps a SourceFileInfo and provides the ISourceFileInfo interface
        return new (class implements ISourceFileInfo {
            constructor(private _parentWrapper: ProgramWrapper, private _s: SourceFileInfo) {}

            // Implement all properties from SourceFileInfo as getters
            get uri() {
                return this._s.uri;
            }
            get contents() {
                return this._s.contents;
            }
            get ipythonMode() {
                return this._s.ipythonMode;
            }
            get isTypeshedFile() {
                return this._s.isTypeshedFile;
            }
            get isThirdPartyImport() {
                return this._s.isThirdPartyImport;
            }
            get isThirdPartyPyTypedPresent() {
                return this._s.isThirdPartyPyTypedPresent;
            }
            get isTypingStubFile() {
                return this._s.isTypingStubFile;
            }
            get hasTypeAnnotations() {
                return this._s.hasTypeAnnotations;
            }
            get diagnosticsVersion() {
                return this._s.diagnosticsVersion;
            }
            get semanticVersion() {
                return this._s.semanticVersion;
            }
            get clientVersion() {
                return this._s.clientVersion;
            }
            get chainedSourceFile() {
                return this._s.chainedSourceFile;
            }
            get isTracked() {
                return this._s.isTracked;
            }
            get isOpenByClient() {
                return this._s.isOpenByClient;
            }
            get isVirtual() {
                return this._s.isVirtual;
            }
            get imports() {
                return this._s.imports;
            }
            get areImportsComputed() {
                return true;
            }
            get importedBy() {
                return this._s.importedBy;
            }
            get shadows() {
                return this._s.shadows;
            }
            get shadowedBy() {
                return this._s.shadowedBy;
            }

            getImports(): ISourceFileInfo[] {
                return s.imports.map(this._makeSourceFileInfo);
            }

            getImportedBy(): ISourceFileInfo[] {
                return s.importedBy.map(this._makeSourceFileInfo);
            }

            getImplicitImport(): ISourceFileInfo | undefined {
                if (s.builtinsImport === s) {
                    return undefined;
                }
                if (s.chainedSourceFile && !s.chainedSourceFile.sourceFile.isFileDeleted()) {
                    return this._makeSourceFileInfo(s.chainedSourceFile);
                }

                return s.builtinsImport ? this._makeSourceFileInfo(s.builtinsImport) : undefined;
            }

            getBuiltinsImport(): ISourceFileInfo | undefined {
                return s.builtinsImport ? this._makeSourceFileInfo(s.builtinsImport) : undefined;
            }

            // Binding-specialized methods: in the wrapper path, imports are always
            // synchronously available so these delegate to the full-import versions.
            getBuiltinsImportForBinding(): ISourceFileInfo | undefined {
                return this.getBuiltinsImport();
            }

            getImplicitImportForBinding(): ISourceFileInfo | undefined {
                return this.getImplicitImport();
            }

            private _makeSourceFileInfo = (sf: SourceFileInfo): ISourceFileInfo => {
                return this._parentWrapper._makeSourceFileInfo(sf);
            };
        })(this, s);
    }

    private _incrementSnapshot(): void {
        if (this._disableSnapshotIncrement) {
            return;
        }
        this._cache.incrementSnapshot();
        this._cachedSearchPaths = undefined;
        // Drop the declaration→Type cache; entries are tied to parse-tree
        // nodes that may be replaced by re-parsed source files.
        this._declTypeCache = new WeakMap();
        // Drop the protocol-declaration cache; the resolved Pyright Declaration
        // it points to may reference parse nodes that no longer exist.
        this._protocolDeclCache = new Map();

        // Remove all added stubs from our tracking map
        this._disableSnapshotIncrement = true;
        try {
            this._addedStubs.forEach((_, uri) => {
                this._program.setFileClosed(uri);
            });
            this._addedStubs.clear();
        } finally {
            this._disableSnapshotIncrement = false;
        }
    }

    private _getExecEnv(uri: Uri): ExecutionEnvironment {
        const env = this._program.configOptions
            .getExecutionEnvironments()
            .find((env) => env.root && (env.root.equals(uri) || uri.isChild(env.root)));
        return env ?? this._program.configOptions.getDefaultExecEnvironment();
    }
}

const programWrappers = new WeakMap<ProgramView, IProgram>();
export function makeProgram(program: ProgramView, cache?: ITypeCache): IProgram {
    // Cache the wrapper for the program. This lets us avoid creating multiple wrappers for the
    // same program and use the same wrapper as the key into other maps.
    let wrapper: IProgram | undefined = programWrappers.get(program);
    if (!wrapper) {
        wrapper = new ProgramWrapper(
            program as Program,
            cache ?? new TypeCache(program.serviceProvider, (uri) => program.getParserOutput(uri))
        );
        programWrappers.set(program, wrapper);
    }
    return wrapper;
}

function getSymbolFromScope(node: ParseNode, name: string) {
    // use name node for parameter to get the correct scope
    const nodeForScope = node.nodeType === ParseNodeType.Parameter ? node.d.name ?? node : node;
    const scope = getScopeForNode(nodeForScope);
    if (!scope) {
        return undefined;
    }

    return scope.lookUpSymbol(name);
}
