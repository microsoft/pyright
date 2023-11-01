/*
 * uri.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * URI class for storing and manipulating URIs.
 */

import { URI, Utils } from 'vscode-uri';
import { some } from './collectionUtils';

export class Uri {
    private _uri: URI;
    private _key: string;

    private constructor(uri: URI) {
        this._uri = uri;
        this._key = uri.toString(); // TODO: Can we make this handle when the case is different? Ignore case on drive letters but keep for everything else?
    }

    get key() {
        return this._key;
    }

    static parse(value: string): Uri {
        return new Uri(URI.parse(value));
    }

    static isUri(thing: any): thing is Uri {
        return typeof thing._uri?.isUri === 'function' && thing._uri.isUri();
    }

    toString(): string {
        return this._uri.toString();
    }

    test(regex: RegExp): boolean {
        // Just test the path portion of the URI.
        return regex.test(this._getPath());
    }

    dirname(): Uri {
        return new Uri(Utils.dirname(this._uri.with({ query: '', fragment: '' })));
    }

    root(): Uri {
        return new Uri(Utils.dirname(this._uri.with({ path: this._getRootPath(), query: '', fragment: '' })));
    }

    rootLength(): number {
        return this._getRootPath().length;
    }

    startsWith(other: Uri): boolean {
        return this._uri.toString().startsWith(other._uri.toString());
    }

    combinePaths(...paths: string[]): Uri {
        return new Uri(Utils.joinPath(this._uri.with({ fragment: '', query: '' }), ...paths));
    }

    relative(relativeTo: Uri): Uri | undefined {
        if (this._uri.scheme !== relativeTo._uri.scheme) {
            return undefined;
        }
        const pathComponents = this.getPathComponents();
        const relativeToComponents = relativeTo.getPathComponents();

        let relativePath = '.';
        for (let i = relativeToComponents.length; i < pathComponents.length; i++) {
            relativePath += `/${pathComponents[i]}`;
        }

        return new Uri(this._uri.with({ path: relativePath, fragment: '', query: '' }));
    }

    getPathComponents(): string[] {
        return this._reducePathComponents(this._getPath().split('/'));
    }

    private _getPath(): string {
        if (this._uri.scheme === 'file') {
            return this._uri.fsPath;
        }
        return this._uri.path;
    }

    private _getRootPath(): string {
        return this._uri.path.split('/')[0];
    }

    private _reducePathComponents(components: string[]): string[] {
        if (!some(components)) {
            return [];
        }

        // Reduce the path components by eliminating
        // any '.' or '..'.
        const reduced = [components[0]];
        for (let i = 1; i < components.length; i++) {
            const component = components[i];
            if (!component || component === '.') {
                continue;
            }

            if (component === '..') {
                if (reduced.length > 1) {
                    if (reduced[reduced.length - 1] !== '..') {
                        reduced.pop();
                        continue;
                    }
                } else if (reduced[0]) {
                    continue;
                }
            }
            reduced.push(component);
        }

        return reduced;
    }
}
