/*
* completions.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.

* Language service completion list extensibility.
*/

import { CancellationToken, CompletionList } from 'vscode-languageserver';

import { ModuleNode } from '../parser/parseNodes';
import { ConfigOptions } from './configOptions';

export interface LanguageServiceExtension {
    readonly completionListExtension: CompletionListExtension;
}

export interface CompletionListExtension {
    // Extension updates completion list provided by the application.
    updateCompletionList(
        sourceList: CompletionList,
        ast: ModuleNode,
        content: string,
        position: number,
        options: ConfigOptions,
        token: CancellationToken
    ): Promise<CompletionList>;

    // Prefix to tell extension commands from others.
    // For example, 'myextension'. Command name then
    // should be 'myextension.command'.
    readonly commandPrefix: string;

    // Extension executes command attached to commited
    // completion list item, if any.
    executeCommand(command: string, args: any[] | undefined, token: CancellationToken): Promise<void>;
}
