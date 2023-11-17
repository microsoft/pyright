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
const _cachedPerMethod = new Map<string, number>();
const _timePerMethod = new Map<string, number>();

// Times and keeps track of method calls. Used for performance analysis.
function timeUriMethod<T>(functionName: string, func: () => T) {
    const now = performance.now();
    const result = func();
    const elapsed = performance.now() - now;
    _countPerMethod.set(functionName, (_countPerMethod.get(functionName) || 0) + 1);
    _timePerMethod.set(functionName, (_timePerMethod.get(functionName) || 0) + elapsed);
    return result;
}

function addCacheAccess(method: string) {
    _cachedPerMethod.set(method, (_cachedPerMethod.get(method) || 0) + 1);
}

// Create a decorator to memoize (cache) the results of a method.
//
// This is using the Typescript 4 version of decorators as
// that's what Jest and webpack are using.
//
// Typescript 5 decorators look a bit different: https://devblogs.microsoft.com/typescript/announcing-typescript-5-0/#decorators
export function cache(useZeroArgs: boolean) {
    return function (target: any, functionName: string, descriptor: PropertyDescriptor) {
        const originalMethod = descriptor.value;
        const cacheKey = `_cache_${functionName}`; // One cache per function name.
        const multipleArgsFunc = function (this: any, ...args: any) {
            return timeUriMethod(functionName, () => {
                let cachedResult: any;
                let key = '';

                // Small perf optimization, don't use join as it allocates another array, just add
                // to the string.
                for (let i = 0; i < args.length; i++) {
                    key += args[i]?.toString();
                }

                const cache = (this[cacheKey] as Map<string, any>) || new Map<string, any>();
                if (!cache.has(key)) {
                    cachedResult = originalMethod.apply(this, args);
                    cache.set(key, cachedResult);
                } else {
                    cachedResult = cache.get(key);
                    addCacheAccess(functionName);
                }
                if (!this[cacheKey]) {
                    // Dynamically add the cache to the object.
                    this[cacheKey] = cache;
                }
                return cachedResult;
            });
        };
        const zeroArgsFunc = function (this: any, ...args: any) {
            return timeUriMethod(functionName, () => {
                let cachedResult: any;
                if (this[cacheKey] === undefined) {
                    cachedResult = originalMethod.apply(this, args);
                    this[cacheKey] = cachedResult;
                } else {
                    cachedResult = this[cacheKey];
                    addCacheAccess(functionName);
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
            return timeUriMethod(functionName, () => {
                const key = `${functionName}+${args.map((a: any) => a?.toString()).join(',')}`;
                let cachedResult: any;
                if (!staticCache.has(key)) {
                    cachedResult = originalMethod.apply(this, args);
                    staticCache.set(key, cachedResult);
                } else {
                    cachedResult = staticCache.get(key);
                    _cachedPerMethod.set(functionName, (_cachedPerMethod.get(functionName) || 0) + 1);
                }
                return cachedResult;
            });
        };
        return descriptor;
    };
}

export abstract class BaseUri implements Uri {
    // Non dynamic caches for very common operations. This avoids the
    // extra check in the @cache decorator for the cache's existence.
    private _combinePathCache = new Map<string, Uri>();
    private _basename: string | undefined;
    private _extname: string | undefined;
    private _dir: Uri | undefined;
    private _stripAllExtensions: Uri | undefined;
    private _stripExtension: Uri | undefined;

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
    get basename(): string {
        return timeUriMethod('basename', () => {
            if (this._basename === undefined) {
                this._basename = this.getBasenameImpl();
            } else {
                addCacheAccess('basename');
            }
            return this._basename;
        });
    }

    // Returns the extension of the URI, similar to the UNIX extname command.
    get extname(): string {
        return timeUriMethod('extname', () => {
            if (this._extname === undefined) {
                this._extname = this.getExtnameImpl();
            } else {
                addCacheAccess('extname');
            }
            return this._extname;
        });
    }

    // Returns a URI where the path just contains the root folder.
    get root(): Uri {
        return timeUriMethod('root', () => this.getRootImpl());
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

    static cachedPerMethod(method: string): number {
        return _cachedPerMethod.get(method) ?? 0;
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
    getDirectory(): Uri {
        return timeUriMethod('getDirectory', () => {
            if (this._dir === undefined) {
                this._dir = this.getDirectoryImpl();
            } else {
                addCacheAccess('getDirectory');
            }
            return this._dir;
        });
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

    // Combines paths to create a new Uri. Any '..' or '.' path components will be normalized.
    combinePaths(...paths: string[]): Uri {
        return timeUriMethod('combinePaths', () => {
            let key = '';
            for (const path of paths) {
                key += path;
            }
            let combined = this._combinePathCache.get(key);
            if (combined === undefined) {
                combined = this.combinePathsImpl(...paths);
                this._combinePathCache.set(key, combined);
            } else {
                addCacheAccess('combinePaths');
            }
            return combined;
        });
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
        return timeUriMethod('stripExtension', () => {
            if (this._stripExtension === undefined) {
                const base = this.basename;
                const index = base.lastIndexOf('.');
                if (index > 0) {
                    const stripped = base.slice(0, index);
                    this._stripExtension = this.getDirectory().combinePaths(stripped);
                } else {
                    this._stripExtension = this;
                }
            } else {
                addCacheAccess('stripExtension');
            }
            return this._stripExtension;
        });
    }

    @cache(true)
    stripAllExtensions(): Uri {
        return timeUriMethod('stripAllExtensions', () => {
            if (this._stripAllExtensions === undefined) {
                const base = this.basename;
                const stripped = base.split('.')[0];
                if (stripped === base) {
                    this._stripAllExtensions = this;
                } else {
                    this._stripAllExtensions = this.getDirectory().combinePaths(stripped);
                }
            } else {
                addCacheAccess('stripAllExtensions');
            }
            return this._stripAllExtensions;
        });
    }

    @cache(true)
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

    @cache(true)
    protected getComparablePath(): string {
        return this.getComparablePathImpl();
    }

    protected abstract combinePathsImpl(...paths: string[]): Uri;

    protected abstract getComparablePathImpl(): string;

    protected abstract getPathComponentsImpl(): string[];

    protected abstract getBasenameImpl(): string;

    protected abstract getExtnameImpl(): string;
}
