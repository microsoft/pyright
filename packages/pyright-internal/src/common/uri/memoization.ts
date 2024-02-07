/*
 * memoization.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Decorators used to memoize the result of a function call.
 */

// Cache for static method results.
const staticCache = new Map<string, any>();

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
