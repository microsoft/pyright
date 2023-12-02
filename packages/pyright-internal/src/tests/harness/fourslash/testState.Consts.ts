/*
 * testState.Consts.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Defines consts that will be available to fourslash tests.
 *
 * Make sure to declare consts in fourslash.ts as well to make them available on design time.
 * Ones defined here will be used on runtime.
 */

import * as lsp from 'vscode-languageserver';
import { indexValueDetail } from '../../../languageService/completionProvider';

/* eslint-disable @typescript-eslint/no-unused-vars */
export namespace Consts {
    export import CodeActionKind = lsp.CodeActionKind;

    // it is duped here since original definition in '../../../commands/commands'
    // is marked as const enum and we can't import "const enum" which get removed
    // once compiled
    export enum Commands {
        createTypeStub = 'pyright.createtypestub',
        restartServer = 'pyright.restartserver',
        orderImports = 'pyright.organizeimports',
    }

    export import CompletionItemKind = lsp.CompletionItemKind;
    export import InlayHintKind = lsp.InlayHintKind;

    export const IndexValueDetail = indexValueDetail;
}
