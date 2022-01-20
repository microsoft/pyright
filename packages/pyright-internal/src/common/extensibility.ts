/*
* completions.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.

* Language service completion list extensibility.
*/

import { CancellationToken } from 'vscode-languageserver';

import { CompletionResultsList } from '../languageService/completionProvider';
import { ParseResults } from '../parser/parser';

export interface LanguageServiceExtension {
    readonly completionListExtension: CompletionListExtension;
}

export interface CompletionListExtension {
    // Extension updates completion list provided by the application.
    updateCompletionResults(
        completionResults: CompletionResultsList,
        parseResults: ParseResults,
        position: number,
        token: CancellationToken
    ): Promise<void>;

    // Prefix to tell extension commands from others.
    // For example, 'myextension'. Command name then
    // should be 'myextension.command'.
    readonly commandPrefix: string;

    // Extension executes command attached to committed
    // completion list item, if any.
    executeCommand(command: string, args: any[] | undefined, token: CancellationToken): Promise<void>;
}
