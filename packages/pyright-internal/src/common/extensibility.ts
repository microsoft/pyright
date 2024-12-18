/*
* extensibility.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.

* Language service extensibility.
*/

import { CancellationToken } from 'vscode-languageserver';

import { Declaration } from '../analyzer/declaration';
import { ImportResolver } from '../analyzer/importResolver';
import * as prog from '../analyzer/program';
import { IPythonMode } from '../analyzer/sourceFile';
import { SourceMapper } from '../analyzer/sourceMapper';
import { SymbolTable } from '../analyzer/symbol';
import { TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import { Diagnostic } from '../common/diagnostic';
import { ServerSettings } from '../common/languageServerInterface';
import { ParseNode } from '../parser/parseNodes';
import { ParseFileResults, ParserOutput } from '../parser/parser';
import { ConfigOptions } from './configOptions';
import { ConsoleInterface } from './console';
import { ReadOnlyFileSystem } from './fileSystem';
import { ServiceProvider } from './serviceProvider';
import { Range } from './textRange';
import { Uri } from './uri/uri';

export interface SourceFile {
    // See whether we can convert these to regular properties.
    isStubFile(): boolean;
    isTypingStubFile(): boolean;

    isThirdPartyPyTypedPresent(): boolean;

    getIPythonMode(): IPythonMode;
    getUri(): Uri;
    getFileContent(): string | undefined;
    getClientVersion(): number | undefined;
    getOpenFileContents(): string | undefined;
    getModuleSymbolTable(): SymbolTable | undefined;
    getDiagnostics(options: ConfigOptions): Diagnostic[] | undefined;
}

export interface SourceFileInfo {
    // We don't want to expose the real SourceFile since
    // one can mess up program state by calling some methods on it directly.
    // For example, calling sourceFile.parse() directly will mess up
    // dependency graph maintained by the program.
    readonly sourceFile: SourceFile;

    // Information about the source file
    readonly isTypeshedFile: boolean;
    readonly isThirdPartyImport: boolean;
    readonly isThirdPartyPyTypedPresent: boolean;

    readonly chainedSourceFile?: SourceFileInfo | undefined;

    readonly isTracked: boolean;
    readonly isOpenByClient: boolean;

    readonly imports: readonly SourceFileInfo[];
    readonly importedBy: readonly SourceFileInfo[];
    readonly shadows: readonly SourceFileInfo[];
    readonly shadowedBy: readonly SourceFileInfo[];
}

// Readonly wrapper around a Program. Makes sure it doesn't mutate the program.
export interface ProgramView {
    readonly id: string;
    readonly rootPath: Uri;
    readonly console: ConsoleInterface;
    readonly evaluator: TypeEvaluator | undefined;
    readonly configOptions: ConfigOptions;
    readonly importResolver: ImportResolver;
    readonly fileSystem: ReadOnlyFileSystem;
    readonly serviceProvider: ServiceProvider;

    owns(uri: Uri): boolean;
    getSourceFileInfoList(): readonly SourceFileInfo[];
    getParserOutput(fileUri: Uri): ParserOutput | undefined;
    getParseResults(fileUri: Uri): ParseFileResults | undefined;
    getSourceFileInfo(fileUri: Uri): SourceFileInfo | undefined;
    getChainedUri(fileUri: Uri): Uri | undefined;
    getSourceMapper(fileUri: Uri, token: CancellationToken, mapCompiled?: boolean, preferStubs?: boolean): SourceMapper;

    // Consider getDiagnosticsForRange to call `analyzeFile` automatically if the file is not analyzed.
    analyzeFile(fileUri: Uri, token: CancellationToken): boolean;
    getDiagnosticsForRange(fileUri: Uri, range: Range): Diagnostic[];

    // See whether we can get rid of these methods
    handleMemoryHighUsage(): void;
    clone(): prog.Program;
}

// This exposes some APIs to mutate program. Unlike ProgramMutator, this will only mutate this program
// and doesn't forward the request to the BG thread.
// One can use this when edits are temporary such as `runEditMode` or `test`
export interface EditableProgram extends ProgramView {
    addInterimFile(uri: Uri): void;
    setFileOpened(fileUri: Uri, version: number | null, contents: string, options?: prog.OpenFileOptions): void;
    updateChainedUri(fileUri: Uri, chainedUri: Uri | undefined): void;
}

// Mutable wrapper around a program. Allows the FG thread to forward this request to the BG thread
// Any edits made to this program will persist and mutate the program's state permanently.
export interface ProgramMutator {
    addInterimFile(fileUri: Uri): void;
    setFileOpened(
        fileUri: Uri,
        version: number | null,
        contents: string,
        ipythonMode: IPythonMode,
        chainedFilePath?: Uri
    ): void;
    updateOpenFileContents(path: Uri, version: number | null, contents: string, ipythonMode: IPythonMode): void;
}

export enum ReferenceUseCase {
    Rename,
    References,
}

export interface SymbolDefinitionProvider {
    tryGetDeclarations(node: ParseNode, offset: number, token: CancellationToken): Declaration[];
}

export interface SymbolUsageProviderFactory {
    tryCreateProvider(
        useCase: ReferenceUseCase,
        declarations: readonly Declaration[],
        token: CancellationToken
    ): SymbolUsageProvider | undefined;
}

/**
 * All Apis are supposed to be `idempotent` and `deterministic`
 *
 * All Apis should return the same results regardless how often there are called
 * in whatever orders for the same inputs.
 */
export interface SymbolUsageProvider {
    appendSymbolNamesTo(symbolNames: Set<string>): void;
    appendDeclarationsTo(to: Declaration[]): void;
    appendDeclarationsAt(context: ParseNode, from: readonly Declaration[], to: Declaration[]): void;
}

export interface StatusMutationListener {
    onFileDirty?: (fileUri: Uri) => void;
    onClearCache?: () => void;
    onUpdateSettings?: <T extends ServerSettings>(settings: T) => void;
}

export interface DebugInfoInspector {
    getCycleDetail(program: ProgramView, fileInfo: SourceFileInfo): string;
}
