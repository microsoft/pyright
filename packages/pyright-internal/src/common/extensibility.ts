/*
* extensibility.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.

* Language service extensibility.
*/

import { CancellationToken, CodeAction, ExecuteCommandParams } from 'vscode-languageserver';

import { getFileInfo } from '../analyzer/analyzerNodeInfo';
import { Declaration } from '../analyzer/declaration';
import { ImportResolver } from '../analyzer/importResolver';
import { SourceFileInfo } from '../analyzer/program';
import { SourceMapper } from '../analyzer/sourceMapper';
import { TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import { Type } from '../analyzer/types';
import { LanguageServerBase } from '../languageServerBase';
import { CompletionOptions, CompletionResultsList } from '../languageService/completionProvider';
import { FunctionNode, ParameterNode, ParseNode } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';
import { ConfigOptions, SignatureDisplayType } from './configOptions';
import { ConsoleInterface } from './console';
import { Range } from './textRange';

export interface LanguageServiceExtension {
    readonly commandExtension?: CommandExtension;
}

export interface ProgramExtension {
    readonly completionListExtension?: CompletionListExtension;
    readonly declarationProviderExtension?: DeclarationProviderExtension;
    readonly typeProviderExtension?: TypeProviderExtension;
    readonly codeActionExtension?: CodeActionExtension;
    fileDirty?: (filePath: string) => void;
    clearCache?: () => void;
}

// Readonly wrapper around a Program. Makes sure it doesn't mutate the program.
export interface ProgramView {
    readonly id: number;
    readonly rootPath: string;
    readonly console: ConsoleInterface;
    readonly evaluator: TypeEvaluator | undefined;
    readonly configOptions: ConfigOptions;
    readonly importResolver: ImportResolver;

    owns(file: string): boolean;
    getParseResults(filePath: string): ParseResults | undefined;
    getBoundSourceFileInfo(file: string, content?: string, force?: boolean): SourceFileInfo | undefined;

    createSourceMapper(
        filePath: string,
        token: CancellationToken,
        mapCompiled?: boolean,
        preferStubs?: boolean
    ): SourceMapper;
}

// Mutable wrapper around a program. Allows the FG thread to forward this request to the BG thread
export interface ProgramMutator {
    addInterimFile(file: string): void;
}

export interface ExtensionFactory {
    createProgramExtension: (view: ProgramView, mutator: ProgramMutator) => ProgramExtension;
    createLanguageServiceExtension: (languageserver: LanguageServerBase) => LanguageServiceExtension;
}

export interface CommandExtension {
    // Prefix to tell extension commands from others.
    // For example, 'myextension'. Command name then
    // should be 'myextension.command'.
    readonly commandPrefix: string;

    // Extension executes command
    executeCommand(params: ExecuteCommandParams, token: CancellationToken): Promise<void>;
}
export interface CompletionListExtension {
    // Extension updates completion list provided by the application.
    updateCompletionResults(
        evaluator: TypeEvaluator,
        sourceMapper: SourceMapper,
        options: CompletionOptions,
        completionResults: CompletionResultsList,
        parseResults: ParseResults,
        position: number,
        functionSignatureDisplay: SignatureDisplayType,
        token: CancellationToken
    ): Promise<void>;
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
        useCase: DeclarationUseCase,
        token: CancellationToken
    ): Declaration[];
}

export interface TypeProviderExtension {
    tryGetParameterNodeType(
        node: ParameterNode,
        evaluator: TypeEvaluator,
        token: CancellationToken,
        context?: {}
    ): Type | undefined;
    tryGetFunctionNodeType(node: FunctionNode, evaluator: TypeEvaluator, token: CancellationToken): Type | undefined;
}

export interface CodeActionExtension {
    addCodeActions(
        evaluator: TypeEvaluator,
        filePath: string,
        range: Range,
        parseResults: ParseResults,
        codeActions: CodeAction[],
        token: CancellationToken
    ): void;
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

    export function destroyProgramExtensions(viewId: number) {
        programExtensions = programExtensions.filter((s) => s.view.id !== viewId);
    }

    export function createLanguageServiceExtensions(languageServer: LanguageServerBase) {
        languageServiceExtensions.push(
            ...(factories
                .map((s) => {
                    let result = s.createLanguageServiceExtension
                        ? s.createLanguageServiceExtension(languageServer)
                        : undefined;
                    if (result) {
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
        return programExtensions.filter((s) => s.view === bestProgram) as ProgramExtension[];
    }

    export function getLanguageServiceExtensions() {
        return languageServiceExtensions as LanguageServiceExtension[];
    }

    export function unregister() {
        programExtensions.splice(0, programExtensions.length);
        languageServiceExtensions.splice(0, languageServiceExtensions.length);
        factories.splice(0, factories.length);
    }
}
