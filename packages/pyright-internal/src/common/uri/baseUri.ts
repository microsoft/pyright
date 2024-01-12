/*
 * baseUri.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Base URI class for storing and manipulating URIs.
 */

import { some } from '../collectionUtils';
import { getShortenedFileName, normalizeSlashes } from '../pathUtils';
import { Uri } from './uri';

export abstract class BaseUri implements Uri {
    protected constructor(private readonly _key: string) {}

    // Unique key for storing in maps.
    get key() {
        return this._key;
    }

    // Returns the scheme of the URI.
    abstract get scheme(): string;

    // Returns whether the underlying file system is case sensitive or not.
    abstract get isCaseSensitive(): boolean;

    // Returns the last segment of the URI, similar to the UNIX basename command.
    abstract get fileName(): string;

    // Returns just the fileName without any extensions
    get fileNameWithoutExtensions(): string {
        const fileName = this.fileName;
        const index = fileName.lastIndexOf('.');
        if (index > 0) {
            return fileName.slice(0, index);
        } else {
            return fileName;
        }
    }

    // Returns the extension of the URI, similar to the UNIX extname command.
    abstract get lastExtension(): string;

    // Returns a URI where the path just contains the root folder.
    abstract get root(): Uri;

    // Returns a URI where the path contains the path with .py appended.
    get packageUri(): Uri {
        // This is assuming that the current path is a file already.
        return this.addExtension('.py');
    }

    // Returns a URI where the path contains the path with .pyi appended.
    get packageStubUri(): Uri {
        // This is assuming that the current path is a file already.
        return this.addExtension('.pyi');
    }

    // Returns a URI where the path has __init__.py appended.
    get initPyUri(): Uri {
        // This is assuming that the current path is a directory already.
        return this.combinePaths('__init__.py');
    }

    // Returns a URI where the path has __init__.pyi appended.
    get initPyiUri(): Uri {
        // This is assuming that the current path is a directory already.
        return this.combinePaths('__init__.pyi');
    }

    // Returns a URI where the path has py.typed appended.
    get pytypedUri(): Uri {
        // This is assuming that the current path is a directory already.
        return this.combinePaths('py.typed');
    }

    abstract get fragment(): string;

    isEmpty(): boolean {
        return false;
    }

    abstract toString(): string;

    abstract toUserVisibleString(): string;

    abstract matchesRegex(regex: RegExp): boolean;

    replaceExtension(ext: string): Uri {
        const dir = this.getDirectory();
        const base = this.fileName;
        const newBase = base.slice(0, base.length - this.lastExtension.length) + ext;
        return dir.combinePaths(newBase);
    }

    addExtension(ext: string): Uri {
        return this.addPath(ext);
    }

    hasExtension(ext: string): boolean {
        return this.isCaseSensitive
            ? this.lastExtension === ext
            : this.lastExtension.toLowerCase() === ext.toLowerCase();
    }

    containsExtension(ext: string): boolean {
        const fileName = this.fileName;
        // Use a regex so we keep the . on the front of the extension.
        const extensions = fileName.split(/(?=\.)/g);
        return extensions.some((e) => (this.isCaseSensitive ? e === ext : e.toLowerCase() === ext.toLowerCase()));
    }

    abstract withFragment(fragment: string): Uri;

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

    equals(other: Uri | undefined): boolean {
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

    // Combines paths to create a new Uri. Any '..' or '.' path components will be normalized.
    abstract combinePaths(...paths: string[]): Uri;

    getRelativePath(child: Uri): string | undefined {
        if (this.scheme !== child.scheme) {
            return undefined;
        }

        // Unlike getRelativePathComponents, this function should not return relative path
        // markers for non children.
        if (child.isChild(this)) {
            const relativeToComponents = this.getRelativePathComponents(child);
            if (relativeToComponents.length > 0) {
                return ['.', ...relativeToComponents].join('/');
            }
        }
        return undefined;
    }

    getPathComponents(): readonly string[] {
        // Make sure to freeze the result so that it can't be modified.
        return Object.freeze(this.getPathComponentsImpl());
    }

    abstract getPath(): string;

    abstract getFilePath(): string;

    getRelativePathComponents(to: Uri): readonly string[] {
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
        const base = this.fileName;
        const index = base.lastIndexOf('.');
        if (index > 0) {
            const stripped = base.slice(0, index);
            return this.getDirectory().combinePaths(stripped);
        } else {
            return this;
        }
    }

    stripAllExtensions(): Uri {
        const base = this.fileName;
        const stripped = base.split('.')[0];
        if (stripped === base) {
            return this;
        } else {
            return this.getDirectory().combinePaths(stripped);
        }
    }

    protected abstract getRootPath(): string;

    protected normalizeSlashes(path: string): string {
        return path.replace(/\\/g, '/');
    }

    protected reducePathComponents(components: string[]): string[] {
        if (!some(components)) {
            return [];
        }

        // Reduce the path components by eliminating
        // any '.' or '..'. We start at 1 because the first component is
        // always the root.
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
    protected abstract getPathComponentsImpl(): string[];
}
