/*
 * browserConnectionUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Create LSP browser connection from the given reader and writer
 */

import { MessageReader, MessageWriter } from 'vscode-jsonrpc';
import * as LSP from 'vscode-languageserver/browser';

export function createConnection(reader: MessageReader, writer: MessageWriter) {
    return LSP.createConnection(reader, writer);
}
