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
import { SourceMapper } from '../analyzer/sourceMapper';
import { TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import { ServerSettings } from '../languageServerBase';
import { ParseNode } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';
import { ConfigOptions } from './configOptions';
import { ConsoleInterface } from './console';
import { ReadOnlyFileSystem } from './fileSystem';
import { Range } from './textRange';
import { SymbolTable } from '../analyzer/symbol';
import { Diagnostic } from '../common/diagnostic';
import { IPythonMode } from '../analyzer/sourceFile';
import { GroupServiceKey, ServiceKey } from './serviceProvider';

export interface SourceFile {
    // See whether we can convert these to regular properties.
    isStubFile(): boolean;
    isThirdPartyPyTypedPresent(): boolean;

    getIPythonMode(): IPythonMode;
    getFilePath(): string;
    getFileContent(): string | undefined;
    getRealFilePath(): string | undefined;
    getClientVersion(): number | undefined;
    getOpenFileContents(): string | undefined;
    getModuleSymbolTable(): SymbolTable | undefined;
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

export interface ServiceProvider {
    tryGet<T>(key: ServiceKey<T>): T | undefined;
    tryGet<T>(key: GroupServiceKey<T>): readonly T[] | undefined;

    get<T>(key: ServiceKey<T>): T;
    get<T>(key: GroupServiceKey<T>): readonly T[];
}

// Readonly wrapper around a Program. Makes sure it doesn't mutate the program.
export interface ProgramView {
    readonly id: string;
    readonly rootPath: string;
    readonly console: ConsoleInterface;
    readonly evaluator: TypeEvaluator | undefined;
    readonly configOptions: ConfigOptions;
    readonly importResolver: ImportResolver;
    readonly fileSystem: ReadOnlyFileSystem;
    readonly serviceProvider: ServiceProvider;

    owns(file: string): boolean;
    getSourceFileInfoList(): readonly SourceFileInfo[];
    getParseResults(filePath: string): ParseResults | undefined;
    getSourceFileInfo(filePath: string): SourceFileInfo | undefined;
    getChainedFilePath(filePath: string): string | undefined;
    getSourceMapper(
        filePath: string,
        token: CancellationToken,
        mapCompiled?: boolean,
        preferStubs?: boolean
    ): SourceMapper;

    // Consider getDiagnosticsForRange to call `analyzeFile` automatically if the file is not analyzed.
    analyzeFile(filePath: string, token: CancellationToken): boolean;
    getDiagnosticsForRange(filePath: string, range: Range): Diagnostic[];

    // See whether we can get rid of these methods
    handleMemoryHighUsage(): void;
    clone(): prog.Program;
}

// This exposes some APIs to mutate program. Unlike ProgramMutator, this will only mutate this program
// and doesn't forward the request to the BG thread.
// One can use this when edits are temporary such as `runEditMode` or `test`
export interface EditableProgram extends ProgramView {
    addInterimFile(file: string): void;
    setFileOpened(filePath: string, version: number | null, contents: string, options?: prog.OpenFileOptions): void;
    updateChainedFilePath(filePath: string, chainedFilePath: string | undefined): void;
}

// Mutable wrapper around a program. Allows the FG thread to forward this request to the BG thread
// Any edits made to this program will persist and mutate the program's state permanently.
export interface ProgramMutator {
    addInterimFile(file: string): void;
    setFileOpened(
        filePath: string,
        version: number | null,
        contents: string,
        ipythonMode: IPythonMode,
        chainedFilePath?: string,
        realFilePath?: string
    ): void;
    updateOpenFileContents(
        path: string,
        version: number | null,
        contents: string,
        ipythonMode: IPythonMode,
        realFilePath?: string
    ): void;
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
    fileDirty?: (filePath: string) => void;
    clearCache?: () => void;
    updateSettings?: <T extends ServerSettings>(settings: T) => void;
}
