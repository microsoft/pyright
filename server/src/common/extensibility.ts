/*
* completions.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.

* Defines language service completion list extensibility.
*/

import { CompletionList } from 'vscode-languageserver';

import { ModuleNode } from '../parser/parseNodes';
import { ConfigOptions } from './configOptions';

export interface LanguageServiceExtension {
    completionListExtension: CompletionListExtension;
}

export interface CompletionListExtension {
    updateCompletionList(
        sourceList: CompletionList,
        ast: ModuleNode,
        content: string,
        position: number,
        options: ConfigOptions
    ): CompletionList;
}
