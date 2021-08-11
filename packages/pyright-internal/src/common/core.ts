/*
 * core.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Various helpers that don't have a dependency on other code files.
 */

export const enum Comparison {
    LessThan = -1,
    EqualTo = 0,
    GreaterThan = 1,
}

/**
 * Safer version of `Function` which should not be called.
 * Every function should be assignable to this, but this should not be assignable to every function.
 */
export type AnyFunction = (...args: never[]) => void;

/** Do nothing and return false */
export function returnFalse(): false {
    return false;
}

/** Do nothing and return true */
export function returnTrue(): true {
    return true;
}

/** Do nothing and return undefined */
export function returnUndefined(): undefined {
    return undefined;
}

/** Returns its argument. */
export function identity<T>(x: T) {
    return x;
}

/** Returns lower case string */
export function toLowerCase(x: string) {
    return x.toLowerCase();
}

export function equateValues<T>(a: T, b: T) {
    return a === b;
}

export type GetCanonicalFileName = (fileName: string) => string;

export function compareComparableValues(a: string | undefined, b: string | undefined): Comparison;
export function compareComparableValues(a: number | undefined, b: number | undefined): Comparison;
export function compareComparableValues(a: string | number | undefined, b: string | number | undefined) {
    return a === b
        ? Comparison.EqualTo
        : a === undefined
        ? Comparison.LessThan
        : b === undefined
        ? Comparison.GreaterThan
        : a < b
        ? Comparison.LessThan
        : Comparison.GreaterThan;
}

/**
 * Compare two numeric values for their order relative to each other.
 * To compare strings, use any of the `compareStrings` functions.
 */
export function compareValues(a: number | undefined, b: number | undefined): Comparison {
    return compareComparableValues(a, b);
}

/**
 * Tests whether a value is an array.
 */
export function isArray(value: any): value is readonly {}[] {
    return Array.isArray ? Array.isArray(value) : value instanceof Array;
}

/**
 * Tests whether a value is string
 */
export function isString(text: unknown): text is string {
    return typeof text === 'string';
}

export function isNumber(x: unknown): x is number {
    return typeof x === 'number';
}

export function isBoolean(x: unknown): x is boolean {
    return typeof x === 'boolean';
}

const hasOwnProperty = Object.prototype.hasOwnProperty;

/**
 * Type of objects whose values are all of the same type.
 * The `in` and `for-in` operators can *not* be safely used,
 * since `Object.prototype` may be modified by outside code.
 */
export interface MapLike<T> {
    [index: string]: T;
}

/**
 * Indicates whether a map-like contains an own property with the specified key.
 *
 * @param map A map-like.
 * @param key A property key.
 */
export function hasProperty(map: MapLike<any>, key: string): boolean {
    return hasOwnProperty.call(map, key);
}

/**
 * Convert the given value to boolean
 * @param trueOrFalse string value 'true' or 'false'
 */
export function toBoolean(trueOrFalse: string): boolean {
    const normalized = trueOrFalse?.trim().toUpperCase();
    if (normalized === 'TRUE') {
        return true;
    }

    return false;
}

export function isDebugMode() {
    const argv = process.execArgv.join();
    return argv.includes('inspect') || argv.includes('debug');
}

interface Thenable<T> {
    then<TResult>(
        onfulfilled?: (value: T) => TResult | Thenable<TResult>,
        onrejected?: (reason: any) => TResult | Thenable<TResult>
    ): Thenable<TResult>;
    then<TResult>(
        onfulfilled?: (value: T) => TResult | Thenable<TResult>,
        onrejected?: (reason: any) => void
    ): Thenable<TResult>;
}

export function isThenable<T>(v: any): v is Thenable<T> {
    return typeof v?.then === 'function';
}

export function isDefined<T>(element: T | undefined): element is T {
    return element !== undefined;
}
