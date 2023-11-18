/*
 * memoization.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Decorators used to memoize the result of a function call.
 */

// Create a decorator to memoize (cache) the results of a method.
//
// This is using the Typescript 4 version of decorators as
// that's what Jest and webpack are using.
//
// Typescript 5 decorators look a bit different: https://devblogs.microsoft.com/typescript/announcing-typescript-5-0/#decorators
export function cacheMethodWithArgs() {
    return function (target: any, functionName: string, descriptor: PropertyDescriptor) {
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
    };
}

export function cacheMethodWithNoArgs() {
    return function (target: any, functionName: string, descriptor: PropertyDescriptor) {
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
    };
}

export function cacheProperty() {
    return function (target: any, functionName: string, descriptor: PropertyDescriptor) {
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
    };
}

const staticCache = new Map<string, any>();

// Create a decorator to memoize (cache) the results of a static method.
export function cacheStaticFunc() {
    return function cacheStaticFunc_Fast(target: any, functionName: string, descriptor: PropertyDescriptor) {
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
    };
}
