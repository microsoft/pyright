/*
* core.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
*/

export const enum Comparison {
    LessThan = -1,
    EqualTo = 0,
    GreaterThan = 1
}

/**
 * Safer version of `Function` which should not be called.
 * Every function should be assignable to this, but this should not be assignable to every function.
 */
export type AnyFunction = (...args: never[]) => void;

/** Does nothing. */
export function noop(_?: {} | null | undefined): void { }

/** Do nothing and return false */
export function returnFalse(): false { return false; }

/** Do nothing and return true */
export function returnTrue(): true { return true; }

/** Do nothing and return undefined */
export function returnUndefined(): undefined { return undefined; }

/** Returns its argument. */
export function identity<T>(x: T) { return x; }

/** Returns lower case string */
export function toLowerCase(x: string) { return x.toLowerCase(); }

export function equateValues<T>(a: T, b: T) { return a === b; }

export type GetCanonicalFileName = (fileName: string) => string;

export function compareComparableValues(a: string | undefined, b: string | undefined): Comparison;
export function compareComparableValues(a: number | undefined, b: number | undefined): Comparison;
export function compareComparableValues(a: string | number | undefined, b: string | number | undefined) {
    return a === b ? Comparison.EqualTo :
        a === undefined ? Comparison.LessThan :
            b === undefined ? Comparison.GreaterThan :
                a < b ? Comparison.LessThan :
                    Comparison.GreaterThan;
}

/**
 * Compare two numeric values for their order relative to each other.
 * To compare strings, use any of the `compareStrings` functions.
 */
export function compareValues(a: number | undefined, b: number | undefined): Comparison {
    return compareComparableValues(a, b);
}