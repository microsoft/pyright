/*
 * uri.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * URI class for storing and manipulating URIs.
 */

import { performance } from 'perf_hooks';
import { some } from '../collectionUtils';
import { getShortenedFileName, normalizeSlashes } from '../pathUtils';
import { Uri } from './uri';

let _counter = 0;
const _countPerMethod = new Map<string, number>();
const _timePerMethod = new Map<string, number>();

// Times and keeps track of method calls. Used for performance analysis.
function timeMethod<T>(functionName: string, func: () => T) {
    const now = performance.now();
    const result = func();
    const elapsed = performance.now() - now;
    _countPerMethod.set(functionName, (_countPerMethod.get(functionName) || 0) + 1);
    _timePerMethod.set(functionName, (_timePerMethod.get(functionName) || 0) + elapsed);
    return result;
}

// Create a decorator to memoize (cache) the results of a method.
//
// This is using the Typescript 4 version of decorators as
// that's what Jest and webpack are using.
//
// Typescript 5 decorators look a bit different: https://devblogs.microsoft.com/typescript/announcing-typescript-5-0/#decorators
function cache(useZeroArgs: boolean) {
    return function (target: any, functionName: string, descriptor: PropertyDescriptor) {
        const originalMethod = descriptor.value;
        const cacheKey = `_cache_${functionName}`; // One cache per function name.
        const multipleArgsFunc = function (this: any, ...args: any) {
            return timeMethod(functionName, () => {
                const key = args.map((a: any) => a.toString()).join(',');
                let cachedResult: any;
                const cache = (this[cacheKey] as Map<string, any>) || new Map<string, any>();
                if (!cache.has(key)) {
                    cachedResult = originalMethod.apply(this, args);
                    cache.set(key, cachedResult);
                } else {
                    cachedResult = cache.get(key);
                }
                if (!this[cacheKey]) {
                    // Dynamically add the cache to the object.
                    this[cacheKey] = cache;
                }
                return cachedResult;
            });
        };
        const zeroArgsFunc = function (this: any, ...args: any) {
            return timeMethod(functionName, () => {
                let cachedResult: any;
                if (this[cacheKey] === undefined) {
                    cachedResult = originalMethod.apply(this, args);
                    this[cacheKey] = cachedResult;
                } else {
                    cachedResult = this[cacheKey];
                }
                return cachedResult;
            });
        };

        // Use the 'quicker' cache if possible. For those functions that don't take any arguments.
        descriptor.value = useZeroArgs ? zeroArgsFunc : multipleArgsFunc;
        return descriptor;
    };
}

const staticCache = new Map<string, any>();
// Create a decorator to memoize (cache) the results of a static method.
export function staticFuncCache() {
    return function (target: any, functionName: string, descriptor: PropertyDescriptor) {
        const originalMethod = descriptor.value;
        descriptor.value = function (...args: any) {
            return timeMethod(functionName, () => {
                const key = `${functionName}+${args.map((a: any) => a?.toString()).join(',')}`;
                let cachedResult: any;
                if (!staticCache.has(key)) {
                    cachedResult = originalMethod.apply(this, args);
                    staticCache.set(key, cachedResult);
                } else {
                    cachedResult = staticCache.get(key);
                }
                return cachedResult;
            });
        };
        return descriptor;
    };
}

export abstract class BaseUri implements Uri {
    protected constructor(private readonly _key: string) {
        _counter++;
    }

    // Unique key for storing in maps.
    get key() {
        return this._key;
    }

    // Returns the scheme of the URI.
    abstract get scheme(): string;

    // Returns the last segment of the URI, similar to the UNIX basename command.
    get basename() {
        return this.getBasename();
    }

    // Returns the extension of the URI, similar to the UNIX extname command.
    get extname() {
        return this.getExtname();
    }

    // Returns a URI where the path just contains the root folder.
    get root(): Uri {
        return this.getRoot();
    }

    static count(): number {
        return _counter;
    }

    static methods(): string[] {
        return Array.from(_countPerMethod.keys());
    }

    static countPerMethod(method: string): number {
        return _countPerMethod.get(method) ?? 0;
    }

    static timePerMethod(method: string): number {
        return _timePerMethod.get(method) ?? 0;
    }

    isEmpty(): boolean {
        return false;
    }

    abstract toString(): string;

    abstract toUserVisibleString(): string;

    abstract matchesRegex(regex: RegExp): boolean;

    @cache(false)
    replaceExtension(ext: string): Uri {
        const dir = this.getDirectory();
        const base = this.basename;
        const newBase = base.slice(0, base.length - this.extname.length) + ext;
        return dir.combinePaths(newBase);
    }

    @cache(false)
    addExtension(ext: string): Uri {
        return this.addPath(ext);
    }

    abstract addPath(extra: string): Uri;

    // Returns a URI where the path is the directory name of the original URI, similar to the UNIX dirname command.
    @cache(true)
    getDirectory(): Uri {
        return this.getDirectoryImpl();
    }

    @cache(true)
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

    @cache(false)
    combinePaths(...paths: string[]): Uri {
        return this.combinePathsImpl(...paths);
    }

    @cache(false)
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

    @cache(true)
    getPathComponents(): string[] {
        return this.getPathComponentsImpl();
    }

    abstract getPath(): string;

    abstract getFilePath(): string;

    @cache(false)
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

    @cache(true)
    stripExtension(): Uri {
        const base = this.basename;
        const index = base.lastIndexOf('.');
        if (index > 0) {
            const stripped = base.slice(0, index);
            return this.getDirectory().combinePaths(stripped);
        }
        return this;
    }

    @cache(true)
    stripAllExtensions(): Uri {
        const base = this.basename;
        const stripped = base.split('.')[0];
        if (stripped === base) {
            return this;
        }
        return this.getDirectory().combinePaths(stripped);
    }

    @cache(true)
    protected getRoot(): Uri {
        return this.getRootImpl();
    }
    protected abstract getRootImpl(): Uri;
    protected abstract getRootPath(): string;

    protected abstract getDirectoryImpl(): Uri;

    protected abstract combinePathsImpl(...paths: string[]): Uri;

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

    @cache(true)
    protected getComparablePath(): string {
        return this.getComparablePathImpl();
    }

    protected abstract getComparablePathImpl(): string;

    protected abstract getPathComponentsImpl(): string[];

    @cache(true)
    protected getBasename(): string {
        return this.getBasenameImpl();
    }

    protected abstract getBasenameImpl(): string;

    @cache(true)
    protected getExtname(): string {
        return this.getExtnameImpl();
    }

    protected abstract getExtnameImpl(): string;
}
