/*
 * uriParser.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * URI utility functions.
 */

import { Position } from 'vscode-languageserver';
import { TextDocumentIdentifier } from 'vscode-languageserver-protocol';
import { URI } from 'vscode-uri';

import { isString } from './core';
import { FileSystem } from './fileSystem';
import { convertUriToPath } from './pathUtils';

export interface IUriParser {
    decodeTextDocumentPosition(
        textDocument: TextDocumentIdentifier,
        position: Position
    ): { filePath: string; position: Position };
    decodeTextDocumentUri(uriString: string): string;
    isUntitled(uri: URI | string | undefined): boolean;
    isLocal(uri: URI | string | undefined): boolean;
}

export class UriParser implements IUriParser {
    constructor(protected readonly fs: FileSystem) {}

    decodeTextDocumentPosition(textDocument: TextDocumentIdentifier, position: Position) {
        const filePath = this.decodeTextDocumentUri(textDocument.uri);
        return { filePath, position };
    }

    decodeTextDocumentUri(uriString: string) {
        return convertUriToPath(this.fs, uriString);
    }

    isUntitled(uri: URI | string | undefined) {
        if (!uri) {
            return false;
        }

        if (isString(uri)) {
            uri = URI.parse(uri);
        }

        return uri.scheme === 'untitled';
    }

    isLocal(uri: URI | string | undefined) {
        if (!uri) {
            return false;
        }

        if (isString(uri)) {
            uri = URI.parse(uri);
        }

        return uri.scheme === 'file';
    }
}
