/*
 * uri.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * URI class for storing and manipulating URIs.
 */

import { some } from '../collectionUtils';
import { getShortenedFileName, normalizeSlashes } from '../pathUtils';
import { cacheUriMethod, cacheUriMethodWithNoArgs, cacheUriProperty, incrementCounter } from './memoization';
import { Uri } from './uri';

export abstract class BaseUri implements Uri {
    protected constructor(private readonly _key: string) {
        incrementCounter();
    }

    // Unique key for storing in maps.
    get key() {
        return this._key;
    }

    // Returns the scheme of the URI.
    abstract get scheme(): string;

    // Returns the last segment of the URI, similar to the UNIX basename command.
    @cacheUriProperty()
    get basename(): string {
        return this.getBasenameImpl();
    }

    // Returns the extension of the URI, similar to the UNIX extname command.
    @cacheUriProperty()
    get extname(): string {
        return this.getExtnameImpl();
    }

    // Returns a URI where the path just contains the root folder.
    @cacheUriProperty()
    get root(): Uri {
        return this.getRootImpl();
    }

    // Returns a URI where the path contains the path with .py appended.
    @cacheUriProperty()
    get packageUri(): Uri {
        // This is assuming that the current path is a directory already.
        return this.addPath('.py');
    }

    // Returns a URI where the path contains the path with .pyi appended.
    @cacheUriProperty()
    get packageStubUri(): Uri {
        // This is assuming that the current path is a directory already.
        return this.addPath('.pyi');
    }

    // Returns a URI where the path has __init__.py appended.
    @cacheUriProperty()
    get initFileUri(): Uri {
        // This is assuming that the current path is a directory already.
        return this.combinePaths('__init__.py');
    }

    // Returns a URI where the path has __init__.pyi appended.
    @cacheUriProperty()
    get initStubUri(): Uri {
        // This is assuming that the current path is a directory already.
        return this.combinePaths('__init__.pyi');
    }

    // Returns a URI where the path has py.typed appended.
    @cacheUriProperty()
    get pytypedUri(): Uri {
        // This is assuming that the current path is a directory already.
        return this.combinePaths('py.typed');
    }

    isEmpty(): boolean {
        return false;
    }

    abstract toString(): string;

    abstract toUserVisibleString(): string;

    abstract matchesRegex(regex: RegExp): boolean;

    @cacheUriMethod()
    replaceExtension(ext: string): Uri {
        const dir = this.getDirectory();
        const base = this.basename;
        const newBase = base.slice(0, base.length - this.extname.length) + ext;
        return dir.combinePaths(newBase);
    }

    @cacheUriMethod()
    addExtension(ext: string): Uri {
        return this.addPath(ext);
    }

    abstract addPath(extra: string): Uri;

    // Returns a URI where the path is the directory name of the original URI, similar to the UNIX dirname command.
    @cacheUriMethodWithNoArgs()
    getDirectory(): Uri {
        return this.getDirectoryImpl();
    }

    @cacheUriMethodWithNoArgs()
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

    // Combines paths to create a new Uri. Any '..' or '.' path components will be normalized.
    @cacheUriMethod()
    combinePaths(...paths: string[]): Uri {
        return this.combinePathsImpl(...paths);
    }

    @cacheUriMethod()
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

    @cacheUriMethodWithNoArgs()
    getPathComponents(): readonly string[] {
        // Make sure to freeze the result so that it can't be modified.
        return Object.freeze(this.getPathComponentsImpl());
    }

    abstract getPath(): string;

    abstract getFilePath(): string;

    @cacheUriMethod()
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

    @cacheUriMethodWithNoArgs()
    stripExtension(): Uri {
        const base = this.basename;
        const index = base.lastIndexOf('.');
        if (index > 0) {
            const stripped = base.slice(0, index);
            return this.getDirectory().combinePaths(stripped);
        } else {
            return this;
        }
    }

    @cacheUriMethodWithNoArgs()
    stripAllExtensions(): Uri {
        const base = this.basename;
        const stripped = base.split('.')[0];
        if (stripped === base) {
            return this;
        } else {
            return this.getDirectory().combinePaths(stripped);
        }
    }

    @cacheUriMethodWithNoArgs()
    protected getRoot(): Uri {
        return this.getRootImpl();
    }
    protected abstract getRootImpl(): Uri;
    protected abstract getRootPath(): string;

    protected abstract getDirectoryImpl(): Uri;

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

    @cacheUriMethodWithNoArgs()
    protected getComparablePath(): string {
        return this.getComparablePathImpl();
    }

    protected abstract combinePathsImpl(...paths: string[]): Uri;

    protected abstract getComparablePathImpl(): string;

    protected abstract getPathComponentsImpl(): string[];

    protected abstract getBasenameImpl(): string;

    protected abstract getExtnameImpl(): string;
}
