/*
 * uriParser.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * URI utility functions.
 */

import { Position } from 'vscode-languageserver';
import { TextDocumentIdentifier } from 'vscode-languageserver-protocol';

import { FileSystem } from './fileSystem';
import { convertUriToPath } from './pathUtils';

export class UriParser {
    constructor(private _fs: FileSystem) {}

    public decodeTextDocumentPosition(textDocument: TextDocumentIdentifier, position: Position) {
        const filePath = convertUriToPath(this._fs, textDocument.uri);
        return { filePath, position };
    }

    public decodeTextDocumentUri(uriString: string) {
        return convertUriToPath(this._fs, uriString);
    }
}
