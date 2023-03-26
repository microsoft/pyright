/*
 * lspUtils.ts
 * Copyright (c) Microsoft Corporation.
 *
 * Helper functions related to the Language Server Protocol (LSP).
 */

import { LSPAny } from 'vscode-languageserver';

// Converts an internal object to LSPAny to be sent out via LSP
export function toLSPAny(obj: any) {
    return obj as any as LSPAny;
}

// Converts an LSPAny object received via LSP to our internal representation.
export function fromLSPAny<T>(lspAny: LSPAny | undefined) {
    return lspAny as any as T;
}
