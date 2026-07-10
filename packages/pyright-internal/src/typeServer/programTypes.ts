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
import { Symbol, SymbolTable } from '../analyzer/symbol';
import { ExpectedTypeResult } from '../analyzer/typeEvaluatorTypes';
import { ClassType, Type } from '../analyzer/types';
import { ConfigOptions } from '../common/configOptions';
import { ConsoleInterface } from '../common/console';
import { Diagnostic as PyrightDiagnostic } from '../common/diagnostic';
import { FileEditAction } from '../common/editAction';
import { SourceFileInfo } from '../common/extensibility';
import { ReadOnlyFileSystem } from '../common/fileSystem';
import { ServiceProvider } from '../common/serviceProvider';
import { Range } from '../common/textRange';
import { Uri } from '../common/uri/uri';
import { ModuleNode, ParseNode } from '../parser/parseNodes';
import { ParseFileResults, ParserOutput } from '../parser/parser';

import { IParserOutputProvider } from './typeServerConversionTypes';
import { ITypeServerEvaluator } from './typeServerEvaluator';

import { ProfilingInfo } from './profilingStub';

export interface ParseResults extends ParseFileResults {
    moduleName: string;
    uri: Uri;
}

export interface ISourceFileInfo extends SourceFileInfo {
    getImports(): ISourceFileInfo[];
    getImportedBy(): ISourceFileInfo[];
    getBuiltinsImportForBinding(): ISourceFileInfo | undefined;
    getImplicitImportForBinding(): ISourceFileInfo | undefined;
}

export interface ISymbolLookup {
    getFileInfo(node: ParseNode): AnalyzerFileInfo;
    getDeclaration(node: ParseNode): Declaration | undefined;
    getScope(node: ParseNode): Scope | undefined;
    getDunderAllInfo(node: ParseNode): DunderAllInfo | undefined;
    getImportInfo(node: ParseNode): ImportResult | undefined;
    getFlowNode(node: ParseNode): FlowNode | undefined;
    getSymbolsForFile(fileUri: Uri, skipFileNeededCheck?: boolean, token?: CancellationToken): SymbolTable | undefined;
    getSymbolsForNode(node: ParseNode, token?: CancellationToken): SymbolTable | undefined;
    lookupSymbol(
        scopingNode: ParseNode,
        name: string,
        skipFileNeededCheck?: boolean,
        token?: CancellationToken
    ): Symbol | undefined;
    getScopeIdForNode(node: ParseNode): string;
    getMatchingFileInfos(fileId: string): AnalyzerFileInfo[];
}

export interface ISourceMapper {
    findDeclarations(decl: Declaration): Declaration[];
    findDeclarationsByType(originatedPath: Uri, type: ClassType, useTypeAlias: boolean): Declaration[];
    findFunctionDeclarations(decl: FunctionDeclaration): FunctionDeclaration[];
    findClassDeclarationsByType(uri: Uri, type: ClassType): Declaration[];
    getSourcePathsFromStub(stubUri: Uri, fromFile: Uri | undefined): Uri[];
    getModuleNode(uri: Uri): ModuleNode | undefined;
    findModules(stubFile: Uri): ModuleNode[];
    getFileInfo(node: ParseNode): AnalyzerFileInfo;
}

export interface IProgramBase extends IParserOutputProvider {
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
    // Returns the snapshot-resident `ParseResults` (the subtype of ParseFileResults that
    // carries `moduleName` and `uri`). Snapshot-aware callers (`SnapshotView`) serve from the
    // snapshot's own ASFI cell so reads stay pinned to the snapshot's content version.
    getParseResults(fileUri: Uri): ParseResults | undefined;
    getModuleName(fileUri: Uri): string | undefined;
    /**
     * Non-side-effecting existence probe. Returns true only if the program
     * already has an `ISourceFileInfo` registered for `fileUri`. Unlike
     * `getSourceFileInfo`, this does NOT lazily materialize a new entry, so
     * it is safe to use when callers (e.g. workspace ownership checks) only
     * want to know whether a file is already tracked.
     */
    hasSourceFile(fileUri: Uri): boolean;
    getSourceFileInfo(fileUri: Uri): ISourceFileInfo | undefined;
    getTrackedFileList(): readonly ISourceFileInfo[];
    lookupImport(
        fileUriOrModule: Uri | AbsoluteModuleDescriptor,
        options?: LookupImportOptions
    ): ImportLookupResult | undefined;
}

export interface ITypeProvider {
    getComputedType(arg: ParseNode | Declaration, token: CancellationToken): Type | undefined;
    getExpectedType(arg: ParseNode | Declaration, token: CancellationToken): ExpectedTypeResult | undefined;
    getDeclaredType(arg: ParseNode | Declaration, token: CancellationToken): Type | undefined;
}

export interface IProgram extends IProgramBase, ITypeProvider, Disposable {
    readonly symbolLookup: ISymbolLookup;
    createEvaluator(): ITypeServerEvaluator;

    // Monotonic content-version counter. Bumped whenever the underlying program
    // mutates (files opened/closed/dirtied, config changes). The type server hands
    // this to clients via `typeServer/getSnapshot`; clients echo it back on
    // subsequent requests so the server request handlers can reject stale work and
    // notify clients (SnapshotChangedNotification) when it changes.
    getSnapshot(token: CancellationToken): number;

    // Runs the callback against the live program. Because Pyright's evaluator is
    // synchronous, the callback executes atomically: the program cannot be mutated
    // mid-run, so the callback simply receives `this`.
    run<T>(callback: (p: IProgram) => T, token: CancellationToken): T;
    runEditMode<T>(callback: (p: IProgram) => T, token: CancellationToken): FileEditAction[];
    enterEditMode(): void;
    exitEditMode(): FileEditAction[];
    addInterimFile(uri: Uri): IProgram;

    resolveImport(
        sourceUri: Uri,
        moduleDescriptor: TypeServerProtocol.ModuleName,
        token: CancellationToken
    ): Uri | undefined;
    getPythonSearchPaths(token: CancellationToken): Uri[] | undefined;
    getSourceMapper(
        fileUri: Uri,
        mapCompiled: boolean,
        preferStubs: boolean,
        token: CancellationToken
    ): ISourceMapper | undefined;
    getDocumentDiagnostics(
        uri: Uri,
        previousResultId: string | undefined,
        token: CancellationToken
    ): DocumentDiagnosticReport;
    getDiagnosticsForRangeWithoutFileIgnore?(fileUri: Uri, range: Range): readonly PyrightDiagnostic[];

    // Cache of `getTypeForDeclaration` results, used by the TSP→Pyright type-shell
    // factory to avoid re-evaluating the same declaration repeatedly during a
    // conversion session. Dropped whenever the snapshot increments.
    getCachedTypeForDeclaration(decl: Declaration): Type | undefined;
    setCachedTypeForDeclaration(decl: Declaration, type: Type): void;

    // Cache of TSP `Declaration` → Pyright `Declaration` resolutions. Used by the
    // type-shell factory to avoid re-running `lookupSymbol` for the same TSP
    // declaration on every conversion call. Dropped whenever the snapshot increments.
    getCachedProtocolDecl(tspDecl: TypeServerProtocol.Declaration): Declaration | undefined;
    setCachedProtocolDecl(tspDecl: TypeServerProtocol.Declaration, decl: Declaration): void;

    startProfiling(): ProfilingInfo | undefined;
    stopProfiling(): ProfilingInfo | undefined;
    updateFileContents(uri: Uri, newContents: string): void;
    startWorkspaceDiagnostics(partialResultToken: string): void;
    stopWorkspaceDiagnostics(): void;

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
     * Used by long workspace-wide walks (e.g. find-all-references / rename
     * transitive seed discovery) to shed the type cache between files, mirroring
     * the sync `ProgramView.handleMemoryHighUsage`. May be a no-op for
     * implementations that don't manage their own in-process memory.
     */
    handleMemoryHighUsage(): void;

    /**
     * Notify the program that watched files have changed.
     */
    changedWatchedFiles(changes: FileEvent[]): void;
}
