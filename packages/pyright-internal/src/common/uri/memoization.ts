/*
 * uri.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * URI class for storing and manipulating URIs.
 */

import { performance } from 'perf_hooks';

let _counter = 0;
const _countPerMethod = new Map<string, number>();
const _cacheMissPerMethod = new Map<string, number>();
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

function addCacheMiss(method: string) {
    _cacheMissPerMethod.set(method, (_cacheMissPerMethod.get(method) || 0) + 1);
}

export function incrementCounter() {
    _counter++;
}

export function getCounter() {
    return _counter;
}

export function getCountPerMethod(method: string) {
    return _countPerMethod.get(method) ?? 0;
}

export function getTimePerMethod(method: string) {
    return _timePerMethod.get(method) ?? 0;
}

export function getCachedMissesPerMethod(method: string) {
    return _cacheMissPerMethod.get(method) ?? 0;
}

export function getMethods(): string[] {
    return [..._countPerMethod.keys()];
}

// Create a decorator to memoize (cache) the results of a method.
//
// This is using the Typescript 4 version of decorators as
// that's what Jest and webpack are using.
//
// Typescript 5 decorators look a bit different: https://devblogs.microsoft.com/typescript/announcing-typescript-5-0/#decorators
export function cacheUriMethod() {
    return function (target: any, functionName: string, descriptor: PropertyDescriptor) {
        const originalMethod = descriptor.value;
        const cacheKey = `_cache_${functionName}`; // One cache per function name.
        descriptor.value = function (this: any, ...args: any) {
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
                    addCacheMiss(functionName);
                } else {
                    cachedResult = cache.get(key);
                }

                // Always add the cache to the object. This is faster than checking.
                this[cacheKey] = cache;
                return cachedResult;
            });
        };
        return descriptor;
    };
}
export function cacheUriMethodWithNoArgs() {
    return function (target: any, functionName: string, descriptor: PropertyDescriptor) {
        const originalMethod = descriptor.value;
        descriptor.value = function (this: any, ...args: any) {
            return timeUriMethod(functionName, () => {
                // Call the function once to get the result.
                const result = originalMethod.apply(this, args);
                addCacheMiss(functionName);

                // Then we replace the original function with one that just returns the result.
                this[functionName] = () => {
                    return timeUriMethod(functionName, () => result);
                };
                return result;
            });
        };
        return descriptor;
    };
}

export function cacheUriProperty() {
    return function (target: any, functionName: string, descriptor: PropertyDescriptor) {
        const originalMethod = descriptor.get;
        descriptor.get = function (this: any, ...args: any) {
            return timeUriMethod(functionName, () => {
                // Call the function once to get the result.
                const result = originalMethod!.apply(this, args);
                addCacheMiss(functionName);

                // Then we replace the original function with one that just returns the result.
                Object.defineProperty(this, functionName, {
                    get() {
                        return timeUriMethod(functionName, () => result);
                    },
                });
                return result;
            });
        };
        return descriptor;
    };
}

const staticCache = new Map<string, any>();
// Create a decorator to memoize (cache) the results of a static method.
export function cacheStaticFunc() {
    return function (target: any, functionName: string, descriptor: PropertyDescriptor) {
        const originalMethod = descriptor.value;
        descriptor.value = function (...args: any) {
            return timeUriMethod(functionName, () => {
                const key = `${functionName}+${args.map((a: any) => a?.toString()).join(',')}`;
                let cachedResult: any;
                if (!staticCache.has(key)) {
                    cachedResult = originalMethod.apply(this, args);
                    staticCache.set(key, cachedResult);
                    addCacheMiss(functionName);
                } else {
                    cachedResult = staticCache.get(key);
                }
                return cachedResult;
            });
        };
        return descriptor;
    };
}
