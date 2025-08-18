/*
 * memoization.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Decorators used to memoize the result of a function call.
 */

// Cache for static method results with LRU eviction.
const staticCache = new Map<string, any>();

// Max number of static method values that are cached.
const maxStaticCacheEntries = 256;

// Caches the results of a getter property.
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

// Caches the results of method that takes no args.
// This situation can be optimized because the parameters are always the same.
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

// Create a decorator to cache the results of a static method.
export function cacheStaticFunc() {
    return function cacheStaticFunc_Fast(target: any, functionName: string, descriptor: PropertyDescriptor) {
        const originalMethod = descriptor.value;
        descriptor.value = function (...args: any) {
            const key = `${functionName}+${args?.map((a: any) => a?.toString()).join(',')}`;
            if (staticCache.has(key)) {
                // Promote to most-recently used by re-inserting.
                const value = staticCache.get(key);
                staticCache.delete(key);
                staticCache.set(key, value);
                return value;
            }

            // Miss: compute and insert, evict LRU if over capacity.
            const result = originalMethod.apply(this, args);

            if (staticCache.size >= maxStaticCacheEntries) {
                // Remove least-recently used (the first key in insertion order).
                const lruKey = staticCache.keys().next().value as string | undefined;
                if (lruKey !== undefined) {
                    staticCache.delete(lruKey);
                }
            }
            staticCache.set(key, result);
            return result;
        };
        return descriptor;
    };
}
