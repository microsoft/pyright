/*
 * uri.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * URI namespace for storing and manipulating URIs.
 */

import { URI, Utils } from 'vscode-uri';
import { combinePaths, isRootedDiskPath } from '../pathUtils';
import { EmptyUri } from './emptyUri';
import { FileUri } from './fileUri';
import { WebUri } from './webUri';
import { JsonObjType } from './baseUri';

export interface Uri {
    // Unique key for storing in maps.
    readonly key: string;

    // Returns the scheme of the URI.
    readonly scheme: string;

    // Returns the last segment of the URI, similar to the UNIX basename command.
    readonly fileName: string;

    // Returns the extension of the URI, similar to the UNIX extname command. This includes '.' on the extension.
    readonly lastExtension: string;

    // Returns a URI where the path just contains the root folder.
    readonly root: Uri;

    // Returns a URI where the path contains the directory name with .py appended.
    readonly packageUri: Uri;

    // Returns a URI where the path contains the directory name with .pyi appended.
    readonly packageStubUri: Uri;

    // Returns a URI where the path has __init__.py appended.
    readonly initPyUri: Uri;

    // Returns a URI where the path has __init__.pyi appended.
    readonly initPyiUri: Uri;

    // Returns a URI where the path has py.typed appended.
    readonly pytypedUri: Uri;

    // Returns the filename without any extensions
    readonly fileNameWithoutExtensions: string;

    // Indicates if the underlying file system for this URI is case sensitive or not.
    readonly isCaseSensitive: boolean;

    // Returns the fragment part of a URI.
    readonly fragment: string;

    isEmpty(): boolean;
    toString(): string;
    toUserVisibleString(): string;
    // Determines whether a path consists only of a path root.
    isRoot(): boolean;
    // Determines whether a Uri is a child of some parent Uri. Meaning the parent Uri is a prefix of this Uri.
    isChild(parent: Uri): boolean;
    isLocal(): boolean;
    isUntitled(): boolean;
    equals(other: Uri | undefined): boolean;
    // Returns true if the `other` is the parent of `this`. Meaning `other` is a prefix of `this`.
    startsWith(other: Uri | undefined): boolean;
    pathStartsWith(name: string): boolean;
    pathEndsWith(name: string): boolean;
    pathIncludes(include: string): boolean;
    matchesRegex(regex: RegExp): boolean;
    addPath(extra: string): Uri;
    // Returns a URI where the path is the directory name of the original URI, similar to the UNIX dirname command.
    getDirectory(): Uri;
    getRootPathLength(): number;
    // How long the path for this Uri is.
    getPathLength(): number;
    // Combines paths with the URI and resolves any relative paths. This should be used for combining paths with user input.
    // Input can be of the form `.` or `./` or `../` or `../foo` or `foo/bar` or `/foo/bar` or `c:\foo\bar` or `file:///foo/bar`
    // Meaning relative or rooted paths are allowed.
    resolvePaths(...paths: string[]): Uri;
    // Combines paths with the URI and resolves any relative paths. When the paths contain separators or '..', this will
    // use resolvePaths to combine the paths. Otherwise it calls the quicker version.
    combinePaths(...paths: string[]): Uri;
    // Combines paths with the URI and DOES NOT resolve any '..' or '.' in the path.
    // This should only be used when the input is known to be relative and contains no separators (as separators are not normalized)
    combinePathsUnsafe(...paths: string[]): Uri;
    getRelativePath(child: Uri): string | undefined;
    getPathComponents(): readonly string[];
    getPath(): string;
    getFilePath(): string;
    getRelativePathComponents(to: Uri): readonly string[];
    getShortenedFileName(maxDirLength?: number): string;
    stripExtension(): Uri;
    stripAllExtensions(): Uri;
    replaceExtension(ext: string): Uri;
    addExtension(ext: string): Uri;
    hasExtension(ext: string): boolean;
    containsExtension(ext: string): boolean;
    withFragment(fragment: string): Uri;
    toJsonObj(): any;
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

    // vscode.URI normalizes the path to use the correct path separators.
    // We need to do the same.
    if (process?.platform === 'win32') {
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
    const parsed = URI.isUri(uri) ? uri : URI.parse(uri);

    // Original URI may not have resolved all the `..` in the path, so remove them.
    // Note: this also has the effect of removing any trailing slashes.
    const finalURI = parsed.path.length > 0 ? Utils.resolvePath(parsed) : parsed;
    const finalString = finalURI.toString();
    return { uri: finalURI, str: finalString };
}

export namespace Uri {
    export function file(path: string, isCaseSensitive = true, checkRelative = false): Uri {
        // Fix path if we're checking for relative paths and this is not a rooted path.
        path = checkRelative && !isRootedDiskPath(path) ? combinePaths(process.cwd(), path) : path;

        // If this already starts with 'file:', then we can
        // parse it normally. It's actually a uri string. Otherwise parse it as a file path.
        const normalized = path.startsWith('file:') ? normalizeUri(path) : normalizeUri(URI.file(path));

        // Turn the path into a file URI.
        return FileUri.createFileUri(
            getFilePath(normalized.uri),
            normalized.uri.query,
            normalized.uri.fragment,
            normalized.str,
            isCaseSensitive
        );
    }

    export function empty(): Uri {
        return EmptyUri.instance;
    }

    export function fromJsonObj(jsonObj: JsonObjType) {
        if (FileUri.isFileUri(jsonObj)) {
            return FileUri.fromJsonObj(jsonObj);
        }
        if (WebUri.isWebUri(jsonObj)) {
            return WebUri.fromJsonObj(jsonObj);
        }
        if (EmptyUri.isEmptyUri(jsonObj)) {
            return EmptyUri.instance;
        }
        return jsonObj;
    }

    export function parse(value: string | undefined, isCaseSensitive: boolean): Uri {
        if (!value) {
            return Uri.empty();
        }

        // Normalize the value here. This gets rid of '..' and '.' in the path. It also removes any
        // '/' on the end of the path.
        const normalized = normalizeUri(value);
        if (normalized.uri.scheme === 'file') {
            return FileUri.createFileUri(
                getFilePath(normalized.uri),
                normalized.uri.query,
                normalized.uri.fragment,
                normalized.str,
                isCaseSensitive
            );
        }

        // Web URIs are always case sensitive.
        return WebUri.createWebUri(
            normalized.uri.scheme,
            normalized.uri.authority,
            normalized.uri.path,
            normalized.uri.query,
            normalized.uri.fragment,
            normalized.str
        );
    }

    export function isUri(thing: any): thing is Uri {
        return !!thing && typeof thing._key === 'string';
    }
}
