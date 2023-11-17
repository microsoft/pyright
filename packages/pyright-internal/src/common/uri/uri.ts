/*
 * uri.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * URI namespace for storing and manipulating URIs.
 */

import { URI, Utils } from 'vscode-uri';
import { BaseUri } from './baseUri';
import { EmptyUri } from './emptyUri';
import { FileUri } from './fileUri';
import { WebUri } from './webUri';

export interface Uri {
    // Unique key for storing in maps.
    readonly key: string;

    // Returns the scheme of the URI.
    readonly scheme: string;

    // Returns the last segment of the URI, similar to the UNIX basename command.
    readonly basename: string;

    // Returns the extension of the URI, similar to the UNIX extname command.
    readonly extname: string;

    // Returns a URI where the path just contains the root folder.
    readonly root: Uri;

    isEmpty(): boolean;

    toString(): string;

    toUserVisibleString(): string;

    matchesRegex(regex: RegExp): boolean;

    replaceExtension(ext: string): Uri;

    addExtension(ext: string): Uri;

    addPath(extra: string): Uri;

    // Returns a URI where the path is the directory name of the original URI, similar to the UNIX dirname command.
    getDirectory(): Uri;

    getRootPathLength(): number;

    // Determines whether a path consists only of a path root.
    isRoot(): boolean;

    // Determines whether a Uri is a child of some parent Uri.
    isChild(parent: Uri, ignoreCase?: boolean): boolean;

    isLocal(): boolean;

    isUntitled(): boolean;

    equals(other: Uri | undefined, ignoreCase?: boolean): boolean;

    startsWith(other: Uri | undefined, ignoreCase?: boolean): boolean;

    pathStartsWith(name: string): boolean;

    pathEndsWith(name: string): boolean;

    pathIncludes(include: string): boolean;

    // How long the path for this Uri is.
    getPathLength(): number;

    combinePaths(...paths: string[]): Uri;

    getRelativePath(child: Uri): string | undefined;

    getPathComponents(): string[];

    getPath(): string;

    getFilePath(): string;

    getRelativePathComponents(to: Uri): string[];
    getShortenedFileName(maxDirLength?: number): string;

    stripExtension(): Uri;

    stripAllExtensions(): Uri;
}

// Returns just the fsPath path portion of a vscode URI.
function getFilePath(uri: URI): string {
    let filePath: string | undefined;

    // Compute the file path ourselves. The vscode.URI class doesn't
    // treat UNC shares with a single slash as UNC paths.
    // https://github.com/microsoft/vscode-uri/blob/53e4ca6263f2e4ddc35f5360c62bc1b1d30f27dd/src/uri.ts#L567
    if (uri.authority && uri.path[0] === '/' && uri.path.length === 1) {
        filePath = `//${uri.authority}${uri.path}`;
    } else {
        // Otherwise use the vscode.URI version
        filePath = uri.fsPath;
    }

    // If this is a DOS-style path with a drive letter, remove
    // the leading slash.
    if (filePath.match(/^\/[a-zA-Z]:\//)) {
        filePath = filePath.slice(1);
    }

    // vscode.URI noralizes the path to use the correct path separators.
    // We need to do the same.
    if (process.platform === 'win32') {
        filePath = filePath.replace(/\//g, '\\');
    }

    return filePath;
}

// Function called to normalize input URIs. This gets rid of '..' and '.' in the path.
// It also removes any '/' on the end of the path.
// This is slow but should only be called when the URI is first created.
function normalizeUri(uri: string | URI): { uri: URI; str: string } {
    // Make sure the drive letter is lower case. This
    // is consistent with what VS code does for URIs.
    let originalString = URI.isUri(uri) ? uri.toString() : uri;
    const parsed = URI.isUri(uri) ? uri : URI.parse(uri);
    if (parsed.scheme === 'file') {
        // The Vscode.URI parser makes sure the drive is lower cased.
        originalString = parsed.toString();
    }

    // Original URI may not have resolved all the `..` in the path, so remove them.
    // Note: this also has the effect of removing any trailing slashes.
    const finalURI = Utils.resolvePath(parsed);
    const finalString = finalURI.path.length !== parsed.path.length ? finalURI.toString() : originalString;
    return { uri: finalURI, str: finalString };
}

export namespace Uri {
    export function file(path: string): Uri {
        // If this already starts with 'file:', then we can
        // parse it normally. It's actually a uri string. Otherwise parse it as a file path.
        const normalized = path.startsWith('file:') ? normalizeUri(path) : normalizeUri(URI.file(path));

        // Turn the path into a file URI.
        return FileUri.create(
            getFilePath(normalized.uri),
            normalized.uri.query,
            normalized.uri.fragment,
            normalized.str
        );
    }

    export function empty(): Uri {
        return EmptyUri.instance;
    }

    export function parse(value: string | undefined): Uri {
        if (!value) {
            return Uri.empty();
        }

        // Normalize the value here. This gets rid of '..' and '.' in the path. It also removes any
        // '/' on the end of the path.
        const normalized = normalizeUri(value);
        if (normalized.uri.scheme === 'file') {
            return FileUri.create(
                getFilePath(normalized.uri),
                normalized.uri.query,
                normalized.uri.fragment,
                normalized.str
            );
        }
        return WebUri.create(
            normalized.uri.scheme,
            normalized.uri.authority,
            normalized.uri.path,
            normalized.uri.query,
            normalized.uri.fragment,
            normalized.str
        );
    }

    export function fromKey(key: string): Uri {
        // Right now the key is the same as the original string. Just parse it.
        return Uri.parse(key);
    }

    export function isUri(thing: any): thing is Uri {
        return !!thing && typeof thing._key === 'string';
    }

    export function count(): number {
        return BaseUri.count();
    }

    export function methods(): string[] {
        return BaseUri.methods();
    }

    export function countPerMethod(method: string): number {
        return BaseUri.countPerMethod(method);
    }

    export function timePerMethod(method: string): number {
        return BaseUri.timePerMethod(method);
    }
}
