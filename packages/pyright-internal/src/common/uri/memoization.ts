/*
 * memoization.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Decorators used to memoize the result of a function call.
 */
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
