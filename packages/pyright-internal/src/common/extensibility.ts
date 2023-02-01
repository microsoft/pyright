/*
* extensibility.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.

* Language service extensibility.
*/

import { CancellationToken, CodeAction, ExecuteCommandParams } from 'vscode-languageserver';

import { Declaration } from '../analyzer/declaration';
import { ParseTreeVisitor } from '../analyzer/parseTreeWalker';
import { SourceFileInfo } from '../analyzer/program';
import { SourceMapper } from '../analyzer/sourceMapper';
import { TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import { Type } from '../analyzer/types';
import { WorkspaceServiceInstance } from '../languageServerBase';
import { CompletionOptions, CompletionResultsList } from '../languageService/completionProvider';
import { FunctionNode, ParameterNode, ParseNode } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';
import { SignatureDisplayType } from './configOptions';
import { Range } from './textRange';

export interface LanguageServiceExtension {
    readonly completionListExtension?: CompletionListExtension;
    readonly commandExtension?: CommandExtension;
    readonly declarationProviderExtension?: DeclarationProviderExtension;
    readonly nodeCheckerExtension?: NodeCheckerExtension;
    readonly typeProviderExtension?: TypeProviderExtension;
    readonly codeActionExtension?: CodeActionExtension;
    sourceFileChanged?: (sourceFileInfo: SourceFileInfo) => void;
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
    tryGetDeclarations(node: ParseNode, useCase: DeclarationUseCase): Declaration[];
}

export class NodeCheckerExtension extends ParseTreeVisitor<void> {}

export interface TypeProviderExtension {
    tryGetParameterNodeType(node: ParameterNode, evaluator: TypeEvaluator, context?: {}): Type | undefined;
    tryGetFunctionNodeType(node: FunctionNode, evaluator: TypeEvaluator): Type | undefined;
}

export interface CodeActionExtension {
    addCodeActions(
        workspace: WorkspaceServiceInstance,
        filePath: string,
        range: Range,
        parseResults: ParseResults,
        codeActions: CodeAction[],
        token: CancellationToken
    ): void;
}

const extensionList: LanguageServiceExtension[] = [];

export function registerExtensions(extensions: LanguageServiceExtension[]) {
    extensionList.push(...extensions);
}

export function unregisterExtensions() {
    extensionList.splice(0, extensionList.length);
}

export function getExtensions(): LanguageServiceExtension[] {
    return extensionList;
}
