import { TypeServerProtocol } from './protocol/typeServerProtocol';
import { CancellationToken, Disposable, DocumentDiagnosticReport, FileEvent } from 'vscode-languageserver-protocol';

import {
    AbsoluteModuleDescriptor,
    AnalyzerFileInfo,
    ImportLookupResult,
    LookupImportOptions,
} from '../analyzer/analyzerFileInfo';
import { DunderAllInfo } from '../analyzer/analyzerNodeInfo';
import { FlowNode } from '../analyzer/codeFlowTypes';
import { Declaration, FunctionDeclaration } from '../analyzer/declaration';
import { ImportResult } from '../analyzer/importResult';
import { Scope } from '../analyzer/scope';
import { IPythonMode } from '../analyzer/sourceFile';
import { Symbol, SymbolTable } from '../analyzer/symbol';
import { ExpectedTypeResult } from '../analyzer/typeEvaluatorTypes';
import { ClassType, Type } from '../analyzer/types';
import { ConfigOptions } from '../common/configOptions';
import { ConsoleInterface } from '../common/console';
import { Diagnostic as PyrightDiagnostic } from '../common/diagnostic';
import { FileEditAction } from '../common/editAction';
import { ReferenceUseCase, SourceFileInfo } from '../common/extensibility';
import { ReadOnlyFileSystem } from '../common/fileSystem';
import { ServiceProvider } from '../common/serviceProvider';
import { Range } from '../common/textRange';
import { Uri } from '../common/uri/uri';
import { ModuleNode, ParseNode } from '../parser/parseNodes';
import { ParseFileResults, ParserOutput } from '../parser/parser';

import { IAsyncTypeEvaluator } from './asyncTypeEvaluatorTypes';
import { IParserOutputProvider } from './typeServerConversionTypes';

import { ProfilingInfo } from './profilingStub';

export interface ParseResults extends ParseFileResults {
    moduleName: string;
    uri: Uri;
}

export interface IAsyncSymbolDefinitionProviderFactory {
    createInstance(snapshot: IAsyncProgramSnapshot): IAsyncSymbolDefinitionProvider;
}

export interface IAsyncSymbolDefinitionProvider {
    tryGetDeclarations(node: ParseNode, offset: number, token: CancellationToken): Promise<Declaration[]>;
}

export interface IAsyncSymbolUsageProvider {
    appendSymbolNamesTo(symbolNames: Set<string>): void;
    appendDeclarationsToAsync(to: Declaration[]): Promise<void>;
    appendDeclarationsAtAsync(context: ParseNode, from: readonly Declaration[], to: Declaration[]): Promise<void>;

    // Optional hook for providers that need transitive (fixpoint) discovery. When a usage at
    // `context` is found to match the symbol being collected, the collector calls this so the
    // provider can contribute additional declarations that should join the seed set, allowing
    // later usages that are only reachable through `context` to be matched on a subsequent pass.
    // Providers that do not implement this opt out of the extra passes entirely.
    //
    // CONSTRAINT: seeds contributed here must not introduce new *symbol names*. This async
    // collector only re-runs its match phase over the already-collected candidate nodes and never
    // re-walks the tree, so a seed with a previously-unseen name would be silently missed.
    // Contributing same-named declarations (the protocol-member use case) is safe; growing
    // `appendSymbolNamesTo` mid-fixpoint is not supported.
    appendSeedDeclarationsAtAsync?(context: ParseNode, from: readonly Declaration[], to: Declaration[]): Promise<void>;
}

export interface IAsyncSymbolUsageProviderFactory {
    tryCreateAsyncProvider(
        snapshot: IAsyncProgramSnapshot,
        useCase: ReferenceUseCase,
        declarations: readonly Declaration[],
        token: CancellationToken
    ): Promise<IAsyncSymbolUsageProvider | undefined>;
}

export interface IAsyncSourceFileInfo extends SourceFileInfo {
    getImports(): Promise<IAsyncSourceFileInfo[]>;
    getImportedBy(): Promise<IAsyncSourceFileInfo[]>;
    getBuiltinsImportForBinding(): Promise<IAsyncSourceFileInfo | undefined>;
    getImplicitImportForBinding(): Promise<IAsyncSourceFileInfo | undefined>;
}

export interface IAsyncSymbolLookup {
    getFileInfo(node: ParseNode): Promise<AnalyzerFileInfo>;
    getDeclaration(node: ParseNode): Promise<Declaration | undefined>;
    getScope(node: ParseNode): Promise<Scope | undefined>;
    getDunderAllInfo(node: ParseNode): Promise<DunderAllInfo | undefined>;
    getImportInfo(node: ParseNode): Promise<ImportResult | undefined>;
    getFlowNode(node: ParseNode): Promise<FlowNode | undefined>;
    getSymbolsForFile(
        fileUri: Uri,
        skipFileNeededCheck?: boolean,
        token?: CancellationToken
    ): Promise<SymbolTable | undefined>;
    getSymbolsForNode(node: ParseNode, token?: CancellationToken): Promise<SymbolTable | undefined>;
    lookupSymbol(
        scopingNode: ParseNode,
        name: string,
        skipFileNeededCheck?: boolean,
        token?: CancellationToken
    ): Promise<Symbol | undefined>;
    getScopeIdForNode(node: ParseNode): Promise<string>;
    getMatchingFileInfos(fileId: string): AnalyzerFileInfo[];
}

export interface IAsyncSourceMapper {
    findDeclarations(decl: Declaration): Promise<Declaration[]>;
    findDeclarationsByType(originatedPath: Uri, type: ClassType, useTypeAlias: boolean): Promise<Declaration[]>;
    findFunctionDeclarations(decl: FunctionDeclaration): Promise<FunctionDeclaration[]>;
    findClassDeclarationsByType(uri: Uri, type: ClassType): Promise<Declaration[]>;
    getSourcePathsFromStub(stubUri: Uri, fromFile: Uri | undefined): Promise<Uri[]>;
    getModuleNode(uri: Uri): Promise<ModuleNode | undefined>;
    findModules(stubFile: Uri): Promise<ModuleNode[]>;
    getFileInfo(node: ParseNode): Promise<AnalyzerFileInfo>;
}

export interface IAsyncProgramBase extends IParserOutputProvider {
    readonly id: string;
    readonly rootPath: Uri;
    readonly console: ConsoleInterface;
    readonly configOptions: ConfigOptions;
    readonly fileSystem: ReadOnlyFileSystem;
    readonly serviceProvider: ServiceProvider;
    readonly isAlive: boolean;
    readonly isPyright: boolean;
    readonly performsAnalysis: boolean;
    readonly supportsPullDiagnostics: boolean;
    owns(uri: Uri): boolean;
    getParserOutput(fileUri: Uri): ParserOutput | undefined;
    // Returns the snapshot-resident `ParseResults` (the Pylance subtype of
    // ParseFileResults that carries `moduleName` and `uri`). Snapshot-aware
    // callers (`SnapshotView`) serve from the snapshot's own ASFI cell so
    // reads stay pinned to the snapshot's content version.
    getParseResults(fileUri: Uri): ParseResults | undefined;
    getModuleName(fileUri: Uri): string | undefined;
    /**
     * Non-side-effecting existence probe. Returns true only if the program
     * already has an `IAsyncSourceFileInfo` registered for `fileUri`. Unlike
     * `getSourceFileInfo`, this does NOT lazily materialize a new entry, so
     * it is safe to use when callers (e.g. workspace ownership checks) only
     * want to know whether a file is already tracked.
     */
    hasSourceFile(fileUri: Uri): boolean;
    getSourceFileInfo(fileUri: Uri): IAsyncSourceFileInfo | undefined;
    getTrackedFileList(): readonly IAsyncSourceFileInfo[];
    lookupImport(
        fileUriOrModule: Uri | AbsoluteModuleDescriptor,
        options?: LookupImportOptions
    ): Promise<ImportLookupResult | undefined>;
}

export interface ITypeProvider {
    getComputedType(arg: ParseNode | Declaration, token: CancellationToken): Promise<Type | undefined>;
    getExpectedType(arg: ParseNode | Declaration, token: CancellationToken): Promise<ExpectedTypeResult | undefined>;
    getDeclaredType(arg: ParseNode | Declaration, token: CancellationToken): Promise<Type | undefined>;
}

export interface IAsyncProgramSnapshot extends IAsyncProgramBase, ITypeProvider {
    readonly snapshot: number;
    readonly symbolLookup: IAsyncSymbolLookup;
    readonly host: IAsyncProgramHost;
    createEvaluator(): IAsyncTypeEvaluator;
    resolveImport(
        sourceUri: Uri,
        moduleDescriptor: TypeServerProtocol.ModuleName,
        token: CancellationToken
    ): Promise<Uri | undefined>;
    getPythonSearchPaths(token: CancellationToken): Promise<Uri[] | undefined>;
    getSourceMapper(
        fileUri: Uri,
        mapCompiled: boolean,
        preferStubs: boolean,
        token: CancellationToken
    ): Promise<IAsyncSourceMapper | undefined>;
    getDocumentDiagnostics(
        uri: Uri,
        previousResultId: string | undefined,
        token: CancellationToken
    ): Promise<DocumentDiagnosticReport>;
    getDiagnosticsForRangeWithoutFileIgnore?(fileUri: Uri, range: Range): readonly PyrightDiagnostic[];

    // Snapshot-scoped cache of `getTypeForDeclaration` results, used by the
    // TSP→Pyright type-shell factory to avoid re-evaluating the same
    // declaration repeatedly during a single conversion session. Lifetime is
    // bounded by the snapshot; the cache is dropped when the snapshot
    // increments.
    getCachedTypeForDeclaration(decl: Declaration): Type | undefined;
    setCachedTypeForDeclaration(decl: Declaration, type: Type): void;

    // Snapshot-scoped cache of TSP `Declaration` → Pyright `Declaration`
    // resolutions. Used by the type-shell factory to avoid re-running
    // `lookupSymbol` for the same TSP declaration on every conversion call.
    // Lifetime is bounded by the snapshot.
    getCachedProtocolDecl(tspDecl: TypeServerProtocol.Declaration): Declaration | undefined;
    setCachedProtocolDecl(tspDecl: TypeServerProtocol.Declaration, decl: Declaration): void;

    // Snapshot scoped cache for other data.
    setFileCachedData(owningUri: Uri, key: string, data: any): void;
    getFileCachedData(owningUri: Uri, key: string): any;

    /**
     * Handle high memory usage by clearing caches or performing cleanup.
     * Used by long workspace-wide walks (e.g. find-all-references / rename
     * transitive seed discovery) to shed the type cache between files, mirroring
     * the sync `ProgramView.handleMemoryHighUsage`. May be a no-op for
     * implementations that don't manage their own in-process memory.
     */
    handleMemoryHighUsage(): void;
}

export interface IAsyncProgram extends IAsyncProgramBase, Disposable {
    runAsync<T>(callback: (p: IAsyncProgramSnapshot) => Promise<T>, token: CancellationToken): Promise<T>;
    getSnapshot(token: CancellationToken): Promise<number>;
    getDocumentDiagnostics(
        uri: Uri,
        snapshot: number,
        previousResultId: string | undefined,
        token: CancellationToken
    ): Promise<DocumentDiagnosticReport>;
    runEditModeAsync<T>(
        callback: (p: IAsyncProgram) => Promise<T>,
        token: CancellationToken
    ): Promise<FileEditAction[]>;
    enterEditMode(): void;
    exitEditMode(): FileEditAction[];
    addInterimFile(uri: Uri): IAsyncProgramSnapshot;
    startProfiling(): Promise<ProfilingInfo | undefined>;
    stopProfiling(): Promise<ProfilingInfo | undefined>;
    updateFileContents(uri: Uri, newContents: string): void;
    startWorkspaceDiagnostics(partialResultToken: string): Promise<void>;
    stopWorkspaceDiagnostics(): Promise<void>;

    /**
     * Add a file to be tracked by the program for indexing purposes.
     * Creates a source file info entry if it doesn't exist.
     */
    addTrackedFile(uri: Uri, isThirdPartyImport: boolean, isInPyTypedPackage: boolean): void;

    /**
     * Set the list of tracked files for the program.
     * Clears existing tracked state and sets the specified files as tracked.
     */
    setTrackedFiles(uris: Uri[]): void;

    /**
     * Handle high memory usage by clearing caches or performing cleanup.
     * May be a no-op for implementations that don't manage their own memory.
     */
    handleMemoryHighUsage(): void;

    /**
     * Notify the program that watched files have changed.
     * No-op for the sync wrapper; filters and forwards in the async implementation.
     */
    changedWatchedFiles(changes: FileEvent[]): void;
}

export type OpenFileContent = {
    uri: Uri;
    contents: string;
    version: number;
    chainedFileUri: Uri | undefined;
    ipythonMode: IPythonMode;
    isVirtual: boolean;
};

export interface IAsyncServiceFactory<T> {
    createInstance(snapshot: IAsyncProgramSnapshot): T;
}

export class PropertyKey<T> {
    constructor(readonly debugName: string, readonly create: () => T) {}
}

export interface PropertyBag {
    get<T>(key: PropertyKey<T>): T | undefined;
    getOrAdd<T>(key: PropertyKey<T>): T; // calls key.create() if absent
    remove<T>(key: PropertyKey<T>): void;
}

export interface IAsyncProgramHost {
    readonly properties: PropertyBag;
}
