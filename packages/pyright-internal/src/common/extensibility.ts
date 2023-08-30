/*
* extensibility.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.

* Language service extensibility.
*/

import { CancellationToken } from 'vscode-languageserver';

import { getFileInfo } from '../analyzer/analyzerNodeInfo';
import { Declaration } from '../analyzer/declaration';
import { ImportResolver } from '../analyzer/importResolver';
import * as prog from '../analyzer/program';
import * as src from '../analyzer/sourceFileInfo';
import { SourceMapper } from '../analyzer/sourceMapper';
import { TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import { LanguageServerBase, LanguageServerInterface } from '../languageServerBase';
import { ParseNode } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';
import { ConfigOptions } from './configOptions';
import { ConsoleInterface } from './console';
import { ReadOnlyFileSystem } from './fileSystem';
import { Range } from './textRange';
import { SymbolTable } from '../analyzer/symbol';
import { Diagnostic } from '../common/diagnostic';
import { IPythonMode } from '../analyzer/sourceFile';

export interface LanguageServiceExtension {
    // empty
}

export interface ProgramExtension {
    readonly declarationProviderExtension?: DeclarationProviderExtension;

    fileDirty?: (filePath: string) => void;
    clearCache?: () => void;
}

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

// Readonly wrapper around a Program. Makes sure it doesn't mutate the program.
export interface ProgramView {
    readonly id: string;
    readonly rootPath: string;
    readonly console: ConsoleInterface;
    readonly evaluator: TypeEvaluator | undefined;
    readonly configOptions: ConfigOptions;
    readonly importResolver: ImportResolver;
    readonly fileSystem: ReadOnlyFileSystem;

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
    getBoundSourceFileInfo(file: string, content?: string, force?: boolean): src.SourceFileInfo | undefined;
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

export interface ExtensionFactory {
    createProgramExtension?: (view: ProgramView, mutator: ProgramMutator) => ProgramExtension;
    createLanguageServiceExtension?: (languageserver: LanguageServerInterface) => LanguageServiceExtension;
}

export enum DeclarationUseCase {
    Definition,
    Rename,
    References,
}

export interface DeclarationProviderExtension {
    tryGetDeclarations(
        evaluator: TypeEvaluator,
        node: ParseNode,
        offset: number,
        useCase: DeclarationUseCase,
        token: CancellationToken
    ): Declaration[];
}

interface OwnedProgramExtension extends ProgramExtension {
    readonly view: ProgramView;
}

interface OwnedLanguageServiceExtension extends LanguageServiceExtension {
    readonly owner: LanguageServerBase;
}

export namespace Extensions {
    const factories: ExtensionFactory[] = [];
    let programExtensions: OwnedProgramExtension[] = [];
    let languageServiceExtensions: OwnedLanguageServiceExtension[] = [];

    export function register(entries: ExtensionFactory[]) {
        factories.push(...entries);
    }
    export function createProgramExtensions(view: ProgramView, mutator: ProgramMutator) {
        programExtensions.push(
            ...(factories
                .map((s) => {
                    let result = s.createProgramExtension ? s.createProgramExtension(view, mutator) : undefined;
                    if (result) {
                        // Add the extra parameter that we use for finding later.
                        result = Object.defineProperty(result, 'view', { value: view });
                    }
                    return result;
                })
                .filter((s) => !!s) as OwnedProgramExtension[])
        );
    }

    export function destroyProgramExtensions(viewId: string) {
        programExtensions = programExtensions.filter((s) => s.view.id !== viewId);
    }

    export function createLanguageServiceExtensions(languageServer: LanguageServerInterface) {
        languageServiceExtensions.push(
            ...(factories
                .map((s) => {
                    let result = s.createLanguageServiceExtension
                        ? s.createLanguageServiceExtension(languageServer)
                        : undefined;
                    if (result && !(result as any).owner) {
                        // Add the extra parameter that we use for finding later.
                        result = Object.defineProperty(result, 'owner', { value: languageServer });
                    }
                    return result;
                })
                .filter((s) => !!s) as OwnedLanguageServiceExtension[])
        );
    }

    export function destroyLanguageServiceExtensions(languageServer: LanguageServerBase) {
        languageServiceExtensions = languageServiceExtensions.filter((s) => s.owner !== languageServer);
    }

    function getBestProgram(filePath: string): ProgramView {
        // Find the best program to use for this file.
        const programs = [...new Set<ProgramView>(programExtensions.map((s) => s.view))];
        let bestProgram: ProgramView | undefined;
        programs.forEach((program) => {
            // If the file is tracked by this program, use it.
            if (program.owns(filePath)) {
                if (!bestProgram || filePath.startsWith(program.rootPath)) {
                    bestProgram = program;
                }
            }
        });

        // If we didn't find a program that tracks the file, use the first one that claims ownership.
        if (bestProgram === undefined) {
            if (programs.length === 1) {
                bestProgram = programs[0];
            } else {
                bestProgram = programs.find((p) => p.getBoundSourceFileInfo(filePath)) || programs[0];
            }
        }
        return bestProgram;
    }

    export function getProgramExtensions(nodeOrFilePath: ParseNode | string) {
        const filePath =
            typeof nodeOrFilePath === 'string' ? nodeOrFilePath.toString() : getFileInfo(nodeOrFilePath).filePath;
        const bestProgram = getBestProgram(filePath);

        return getProgramExtensionsForView(bestProgram);
    }

    export function getLanguageServiceExtensions() {
        return languageServiceExtensions as LanguageServiceExtension[];
    }

    export function getProgramExtensionsForView(view: ProgramView) {
        return programExtensions.filter((s) => s.view === view) as ProgramExtension[];
    }

    export function unregister() {
        programExtensions.splice(0, programExtensions.length);
        languageServiceExtensions.splice(0, languageServiceExtensions.length);
        factories.splice(0, factories.length);
    }
}
