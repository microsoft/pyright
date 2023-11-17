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
const _argKeys = new Map<string, number>();

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

export function getArgKeys(): string[] {
    // Return them sorted by count.
    return [..._argKeys.entries()]
        .sort((a, b) => b[1] - a[1])
        .map((a) => `${a[0]}: ${a[1]}`)
        .slice(0, 100);
}

// This global flag controls whether or not we generate profiling information for URI functions.
const profiling = false;

function cacheUriMethod_Fast(target: any, functionName: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const cacheKey = `_cache_${functionName}`; // One cache per function name.
    descriptor.value = function (this: any, ...args: any) {
        let key = args[0]?.toString() || '';

        // Small perf optimization, don't use join as it allocates another array, just add
        // to the string.
        for (let i = 1; i < args.length; i++) {
            key += args[i]?.toString() || '';
        }

        const cache = (this[cacheKey] as Map<string, any>) || new Map<string, any>();
        if (!cache.has(key)) {
            const result = originalMethod.apply(this, args);
            cache.set(key, result);
            this[cacheKey] = cache;
            return result;
        } else {
            return cache.get(key)!;
        }
    };
    return descriptor;
}

function cacheUriMethod_Profile(target: any, functionName: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    const cacheKey = `_cache_${functionName}`; // One cache per function name.
    descriptor.value = function (this: any, ...args: any) {
        return timeUriMethod(functionName, () => {
            let key = args[0]?.toString() || '';

            // Small perf optimization, don't use join as it allocates another array, just add
            // to the string.
            for (let i = 1; i < args.length; i++) {
                key += args[i]?.toString() || '';
            }

            const cache = (this[cacheKey] as Map<string, any>) || new Map<string, any>();
            if (!cache.has(key)) {
                const result = originalMethod.apply(this, args);
                cache.set(key, result);
                addCacheMiss(functionName);
                this[cacheKey] = cache;
                //_argKeys.set(key, (_argKeys.get(key) || 0) + 1);
                return result;
            } else {
                //_argKeys.set(key, (_argKeys.get(key) || 0) + 1);
                return cache.get(key)!;
            }
        });
    };
    return descriptor;
}

// Create a decorator to memoize (cache) the results of a method.
//
// This is using the Typescript 4 version of decorators as
// that's what Jest and webpack are using.
//
// Typescript 5 decorators look a bit different: https://devblogs.microsoft.com/typescript/announcing-typescript-5-0/#decorators
export function cacheUriMethod() {
    return profiling ? cacheUriMethod_Profile : cacheUriMethod_Fast;
}

function cacheUriMethodWithNoArgs_Fast(target: any, functionName: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    descriptor.value = function (this: any, ...args: any) {
        // Call the function once to get the result.
        const result = originalMethod.apply(this, args);

        // Then we replace the original function with one that just returns the result.
        this[functionName] = () => {
            // Note that this poses a risk. The result is passed by reference, so if the caller
            // modifies the result, it will modify the cached result.
            return result;
        };
        return result;
    };
    return descriptor;
}

function cacheUriMethodWithNoArgs_Profile(target: any, functionName: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    descriptor.value = function (this: any, ...args: any) {
        return timeUriMethod(functionName, () => {
            // Call the function once to get the result.
            const result = originalMethod.apply(this, args);
            addCacheMiss(functionName);

            // Then we replace the original function with one that just returns the result.
            this[functionName] = () => {
                // Note that this poses a risk. The result is passed by reference, so if the caller
                // modifies the result, it will modify the cached result.
                return timeUriMethod(functionName, () => result);
            };
            return result;
        });
    };
    return descriptor;
}

export function cacheUriMethodWithNoArgs() {
    return profiling ? cacheUriMethodWithNoArgs_Profile : cacheUriMethodWithNoArgs_Fast;
}

function cacheUriProperty_Fast(target: any, functionName: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.get;
    descriptor.get = function (this: any, ...args: any) {
        // Call the function once to get the result.
        const result = originalMethod!.apply(this, args);

        // Then we replace the original function with one that just returns the result.
        Object.defineProperty(this, functionName, {
            get() {
                return result;
            },
        });
        return result;
    };
    return descriptor;
}

function cacheUriProperty_Profile(target: any, functionName: string, descriptor: PropertyDescriptor) {
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
}

export function cacheUriProperty() {
    return profiling ? cacheUriProperty_Profile : cacheUriProperty_Fast;
}

const staticCache = new Map<string, any>();
function cacheStaticFunc_Fast(target: any, functionName: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value;
    descriptor.value = function (...args: any) {
        const key = `${functionName}+${args.map((a: any) => a?.toString()).join(',')}`;
        let cachedResult: any;
        if (!staticCache.has(key)) {
            cachedResult = originalMethod.apply(this, args);
            staticCache.set(key, cachedResult);
        } else {
            cachedResult = staticCache.get(key);
        }
        return cachedResult;
    };
    return descriptor;
}

function cacheStaticFunc_Profile(target: any, functionName: string, descriptor: PropertyDescriptor) {
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
}

// Create a decorator to memoize (cache) the results of a static method.
export function cacheStaticFunc() {
    return profiling ? cacheStaticFunc_Profile : cacheStaticFunc_Fast;
}
