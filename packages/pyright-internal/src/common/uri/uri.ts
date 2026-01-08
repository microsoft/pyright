/*
 * uri.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * URI namespace for storing and manipulating URIs.
 */

import { URI, Utils } from 'vscode-uri';
import { CaseSensitivityDetector } from '../caseSensitivityDetector';
import { isArray } from '../core';
import { combinePaths, isRootedDiskPath, normalizeSlashes } from '../pathUtils';
import { ServiceKeys } from '../serviceKeys';
import { ServiceKey } from '../serviceProvider';
import { JsonObjType } from './baseUri';
import { ConstantUri } from './constantUri';
import { EmptyUri } from './emptyUri';
import { FileUri, FileUriSchema } from './fileUri';
import { WebUri } from './webUri';

export const enum UriKinds {
    file,
    web,
    empty,
}

export type SerializedType = [UriKinds, ...any[]];

// Re-export Uri interface from uriInterface.ts to maintain backward compatibility
// Use interface merging instead of direct export to avoid conflict with Uri namespace
import type { Uri as UriInterface } from './uriInterface';
export interface Uri extends UriInterface {}

const _dosPathRegex = /^\/[a-zA-Z]:\//;
const _win32NormalizationRegex = /\//g;

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
    if (filePath.match(_dosPathRegex)) {
        filePath = filePath.slice(1);
    }

    // vscode.URI normalizes the path to use the correct path separators.
    // We need to do the same.
    if (process?.platform === 'win32') {
        filePath = filePath.replace(_win32NormalizationRegex, '\\');
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

const windowsUriRegEx = /^[a-zA-Z]:\\?/;
const uriRegEx = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/?\/?/;

export namespace Uri {
    export interface IServiceProvider {
        get<T>(key: ServiceKey<T>): T;
    }

    export function maybeUri(value: string) {
        return uriRegEx.test(value) && !windowsUriRegEx.test(value);
    }

    export function create(value: string, serviceProvider: IServiceProvider, checkRelative?: boolean): Uri;
    export function create(
        value: string,
        caseSensitivityDetector: CaseSensitivityDetector,
        checkRelative?: boolean
    ): Uri;
    export function create(value: string, arg: IServiceProvider | CaseSensitivityDetector, checkRelative = false): Uri {
        arg = CaseSensitivityDetector.is(arg) ? arg : arg.get(ServiceKeys.caseSensitivityDetector);

        if (maybeUri(value)) {
            return parse(value, arg);
        }

        return file(value, arg, checkRelative);
    }

    export function file(path: string, serviceProvider: IServiceProvider, checkRelative?: boolean): Uri;
    export function file(path: string, caseSensitivityDetector: CaseSensitivityDetector, checkRelative?: boolean): Uri;
    export function file(path: string, arg: IServiceProvider | CaseSensitivityDetector, checkRelative = false): Uri {
        arg = CaseSensitivityDetector.is(arg) ? arg : arg.get(ServiceKeys.caseSensitivityDetector);

        // Fix path if we're checking for relative paths and this is not a rooted path.
        path = checkRelative && !isRootedDiskPath(path) ? combinePaths(process.cwd(), path) : path;

        // If this already starts with 'file:', then we can
        // parse it normally. It's actually a uri string. Otherwise parse it as a file path.
        const normalized = path.startsWith('file:')
            ? normalizeUri(path)
            : normalizeUri(URI.file(normalizeSlashes(path)));

        // Turn the path into a file URI.
        return FileUri.createFileUri(
            getFilePath(normalized.uri),
            normalized.uri.query,
            normalized.uri.fragment,
            normalized.str,
            arg.isCaseSensitive(normalized.str)
        );
    }

    export function parse(uriStr: string | undefined, serviceProvider: IServiceProvider): Uri;
    export function parse(uriStr: string | undefined, caseSensitivityDetector: CaseSensitivityDetector): Uri;
    export function parse(uriStr: string | undefined, arg: IServiceProvider | CaseSensitivityDetector): Uri {
        if (!uriStr) {
            return Uri.empty();
        }

        arg = CaseSensitivityDetector.is(arg) ? arg : arg.get(ServiceKeys.caseSensitivityDetector);

        // Normalize the value here. This gets rid of '..' and '.' in the path. It also removes any
        // '/' on the end of the path.
        const normalized = normalizeUri(uriStr);
        if (normalized.uri.scheme === FileUriSchema) {
            return FileUri.createFileUri(
                getFilePath(normalized.uri),
                normalized.uri.query,
                normalized.uri.fragment,
                normalized.str,
                arg.isCaseSensitive(normalized.str)
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

    export function constant(markerName: string): Uri {
        return new ConstantUri(markerName);
    }

    export function empty(): Uri {
        return EmptyUri.instance;
    }

    // Excel's copy of tests\harness\vfs\pathValidation.ts knows about this constant.
    // If the value is changed, the Excel team should be told.
    export const DefaultWorkspaceRootComponent = '<default workspace root>';
    export const DefaultWorkspaceRootPath = `/${DefaultWorkspaceRootComponent}`;

    export function defaultWorkspace(serviceProvider: IServiceProvider): Uri;
    export function defaultWorkspace(caseSensitivityDetector: CaseSensitivityDetector): Uri;
    export function defaultWorkspace(arg: IServiceProvider | CaseSensitivityDetector): Uri {
        arg = CaseSensitivityDetector.is(arg) ? arg : arg.get(ServiceKeys.caseSensitivityDetector);
        return Uri.file(DefaultWorkspaceRootPath, arg);
    }

    export function fromJsonObj(jsonObj: JsonObjType) {
        if (isArray<SerializedType>(jsonObj)) {
            // Currently only file uri supports SerializedType.
            switch (jsonObj[0]) {
                case UriKinds.file:
                    return FileUri.fromJsonObj(jsonObj);
            }
        }

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

    export function is(thing: any): thing is Uri {
        return !!thing && typeof thing._key === 'string';
    }

    export function isEmpty(uri: Uri | undefined): boolean {
        return !uri || uri.isEmpty();
    }

    export function equals(a: Uri | undefined, b: Uri | undefined): boolean {
        if (a === b) {
            return true;
        }

        return a?.equals(b) ?? false;
    }

    export function isDefaultWorkspace(uri: Uri) {
        return uri.fileName.includes(DefaultWorkspaceRootComponent);
    }
}
