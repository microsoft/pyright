/*
 * uri.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * URI class for storing and manipulating URIs.
 */

import { some } from '../collectionUtils';
import { getShortenedFileName, normalizeSlashes } from '../pathUtils';
import { Uri } from './uri';

export abstract class BaseUri implements Uri {
    private static _counter = 0;
    private static _uniqueUris = new Set<string>();
    private static _countPerMethod = new Map<string, number>();
    protected constructor(private readonly _key: string, creationMethod: string) {
        BaseUri._counter++;
        BaseUri._uniqueUris.add(_key);
        const currentCount = BaseUri._countPerMethod.get(creationMethod) || 0;
        BaseUri._countPerMethod.set(creationMethod, currentCount + 1);
    }

    // Unique key for storing in maps.
    get key() {
        return this._key;
    }

    // Returns the scheme of the URI.
    abstract get scheme(): string;

    // Returns the last segment of the URI, similar to the UNIX basename command.
    abstract get basename(): string;

    // Returns the extension of the URI, similar to the UNIX extname command.
    abstract get extname(): string;

    // Returns a URI where the path just contains the root folder.
    abstract get root(): Uri;

    static count(): number {
        return BaseUri._counter;
    }

    static uniqueCount(): number {
        return BaseUri._uniqueUris.size;
    }

    static methods(): string[] {
        return Array.from(BaseUri._countPerMethod.keys());
    }

    static countPerMethod(method: string): number {
        return BaseUri._countPerMethod.get(method) ?? 0;
    }

    isEmpty(): boolean {
        return false;
    }

    abstract toString(): string;

    abstract toUserVisibleString(): string;

    abstract matchesRegex(regex: RegExp): boolean;

    replaceExtension(ext: string): Uri {
        const dir = this.getDirectory();
        const base = this.basename;
        const newBase = base.slice(0, base.length - this.extname.length) + ext;
        return dir.combinePaths(newBase);
    }

    addExtension(ext: string): Uri {
        return this.addPath(ext);
    }

    abstract addPath(extra: string): Uri;

    // Returns a URI where the path is the directory name of the original URI, similar to the UNIX dirname command.
    abstract getDirectory(): Uri;

    getRootPathLength(): number {
        return this.getRootPath().length;
    }

    // Determines whether a path consists only of a path root.
    abstract isRoot(): boolean;

    // Determines whether a Uri is a child of some parent Uri.
    abstract isChild(parent: Uri, ignoreCase?: boolean): boolean;

    abstract isLocal(): boolean;

    isUntitled(): boolean {
        return this.scheme === 'untitled';
    }

    equals(other: Uri | undefined, ignoreCase?: boolean): boolean {
        if (ignoreCase) {
            return this.key.toLowerCase() === other?.key.toLowerCase();
        }
        return this.key === other?.key;
    }

    abstract startsWith(other: Uri | undefined, ignoreCase?: boolean): boolean;

    pathStartsWith(name: string): boolean {
        // ignore path separators.
        name = normalizeSlashes(name);
        return this.getComparablePath().startsWith(name);
    }

    pathEndsWith(name: string): boolean {
        // ignore path separators.
        name = normalizeSlashes(name);
        return this.getComparablePath().endsWith(name);
    }

    pathIncludes(include: string): boolean {
        // ignore path separators.
        include = normalizeSlashes(include);
        return this.getComparablePath().includes(include);
    }

    // How long the path for this Uri is.
    abstract getPathLength(): number;

    abstract combinePaths(...paths: string[]): Uri;

    getRelativePath(child: Uri): string | undefined {
        if (this.scheme !== child.scheme) {
            return undefined;
        }

        // Unlike getRelativePathComponents, this function should not return relative path
        // markers for non children.
        if (child.isChild(this, false)) {
            const relativeToComponents = this.getRelativePathComponents(child);
            if (relativeToComponents.length > 0) {
                return ['.', ...relativeToComponents].join('/');
            }
        }
        return undefined;
    }

    abstract getPathComponents(): string[];

    abstract getPath(): string;

    abstract getFilePath(): string;

    getRelativePathComponents(to: Uri): string[] {
        const fromComponents = this.getPathComponents();
        const toComponents = to.getPathComponents();

        let start: number;
        for (start = 0; start < fromComponents.length && start < toComponents.length; start++) {
            const fromComponent = fromComponents[start];
            const toComponent = toComponents[start];
            if (fromComponent !== toComponent) {
                break;
            }
        }

        if (start === 0) {
            return toComponents;
        }

        const components = toComponents.slice(start);
        const relative: string[] = [];
        for (; start < fromComponents.length; start++) {
            relative.push('..');
        }
        return [...relative, ...components];
    }

    getShortenedFileName(maxDirLength: number = 15): string {
        return getShortenedFileName(this.getPath(), maxDirLength);
    }

    stripExtension(): Uri {
        const base = this.basename;
        const index = base.lastIndexOf('.');
        if (index > 0) {
            const stripped = base.slice(0, index);
            return this.getDirectory().combinePaths(stripped);
        }
        return this;
    }

    stripAllExtensions(): Uri {
        const base = this.basename;
        const stripped = base.split('.')[0];
        if (stripped === base) {
            return this;
        }
        return this.getDirectory().combinePaths(stripped);
    }

    protected abstract getRootPath(): string;

    protected reducePathComponents(components: string[]): string[] {
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

    protected abstract getComparablePath(): string;
}
