import { Comparison, equateValues } from "./core";

export type EqualityComparer<T> = (a: T, b: T) => boolean;

export function contains<T>(array: readonly T[] | undefined, value: T, equalityComparer: EqualityComparer<T> = equateValues): boolean {
    if (array) {
        for (const v of array) {
            if (equalityComparer(v, value)) {
                return true;
            }
        }
    }
    return false;
}

/** Array that is only intended to be pushed to, never read. */
export interface Push<T> {
    push(...values: T[]): void;
}

/**
 * Appends a value to an array, returning the array.
 *
 * @param to The array to which `value` is to be appended. If `to` is `undefined`, a new array
 * is created if `value` was appended.
 * @param value The value to append to the array. If `value` is `undefined`, nothing is
 * appended.
 */
export function append<TArray extends any[] | undefined, TValue extends NonNullable<TArray>[number] | undefined>(to: TArray, value: TValue): [undefined, undefined] extends [TArray, TValue] ? TArray : NonNullable<TArray>[number][];
export function append<T>(to: T[], value: T | undefined): T[];
export function append<T>(to: T[] | undefined, value: T): T[];
export function append<T>(to: T[] | undefined, value: T | undefined): T[] | undefined;
export function append<T>(to: Push<T>, value: T | undefined): void;
export function append<T>(to: T[], value: T | undefined): T[] | undefined {
    if (value === undefined) return to;
    if (to === undefined) return [value];
    to.push(value);
    return to;
}

/** Works like Array.prototype.find, returning `undefined` if no element satisfying the predicate is found. */
export function find<T, U extends T>(array: readonly T[], predicate: (element: T, index: number) => element is U): U | undefined;
export function find<T>(array: readonly T[], predicate: (element: T, index: number) => boolean): T | undefined;
export function find<T>(array: readonly T[], predicate: (element: T, index: number) => boolean): T | undefined {
    for (let i = 0; i < array.length; i++) {
        const value = array[i];
        if (predicate(value, i)) {
            return value;
        }
    }
    return undefined;
}

export type Comparer<T> = (a: T, b: T) => Comparison;

/**
 * Type of objects whose values are all of the same type.
 * The `in` and `for-in` operators can *not* be safely used,
 * since `Object.prototype` may be modified by outside code.
 */
export interface MapLike<T> {
    [index: string]: T;
}

export interface SortedReadonlyArray<T> extends ReadonlyArray<T> {
    " __sortedArrayBrand": any;
}

export interface SortedArray<T> extends Array<T> {
    " __sortedArrayBrand": any;
}

function selectIndex(_: unknown, i: number) {
    return i;
}

export function indicesOf(array: readonly unknown[]): number[] {
    return array.map(selectIndex);
}

/**
 * Stable sort of an array. Elements equal to each other maintain their relative position in the array.
 */
export function stableSort<T>(array: readonly T[], comparer: Comparer<T>): SortedReadonlyArray<T> {
    const indices = indicesOf(array);
    stableSortIndices(array, indices, comparer);
    return indices.map(i => array[i]) as SortedArray<T> as SortedReadonlyArray<T>;
}

function stableSortIndices<T>(array: readonly T[], indices: number[], comparer: Comparer<T>) {
    // sort indices by value then position
    indices.sort((x, y) => comparer(array[x], array[y]) || compareValues(x, y));
}

/**
 * Compare two numeric values for their order relative to each other.
 * To compare strings, use any of the `compareStrings` functions.
 */
export function compareValues(a: number | undefined, b: number | undefined): Comparison {
    return compareComparableValues(a, b);
}

function compareComparableValues(a: string | undefined, b: string | undefined): Comparison;
function compareComparableValues(a: number | undefined, b: number | undefined): Comparison;
function compareComparableValues(a: string | number | undefined, b: string | number | undefined) {
    return a === b ? Comparison.EqualTo :
        a === undefined ? Comparison.LessThan :
            b === undefined ? Comparison.GreaterThan :
                a < b ? Comparison.LessThan :
                    Comparison.GreaterThan;
}

/**
 * Iterates through 'array' by index and performs the callback on each element of array until the callback
 * returns a truthy value, then returns that value.
 * If no such value is found, the callback is applied to each element of array and undefined is returned.
 */
export function forEach<T, U>(array: readonly T[] | undefined, callback: (element: T, index: number) => U | undefined): U | undefined {
    if (array) {
        for (let i = 0; i < array.length; i++) {
            const result = callback(array[i], i);
            if (result) {
                return result;
            }
        }
    }
    return undefined;
}

export function some<T>(array: readonly T[] | undefined): array is readonly T[];
export function some<T>(array: readonly T[] | undefined, predicate: (value: T) => boolean): boolean;
export function some<T>(array: readonly T[] | undefined, predicate?: (value: T) => boolean): boolean {
    if (array) {
        if (predicate) {
            for (const v of array) {
                if (predicate(v)) {
                    return true;
                }
            }
        }
        else {
            return array.length > 0;
        }
    }
    return false;
}

/**
 * Performs a binary search, finding the index at which `value` occurs in `array`.
 * If no such index is found, returns the 2's-complement of first index at which
 * `array[index]` exceeds `value`.
 * @param array A sorted array whose first element must be no larger than number
 * @param value The value to be searched for in the array.
 * @param keySelector A callback used to select the search key from `value` and each element of
 * `array`.
 * @param keyComparer A callback used to compare two keys in a sorted array.
 * @param offset An offset into `array` at which to start the search.
 */
export function binarySearch<T, U>(array: readonly T[], value: T, keySelector: (v: T) => U, keyComparer: Comparer<U>, offset?: number): number {
    return binarySearchKey(array, keySelector(value), keySelector, keyComparer, offset);
}

/**
 * Performs a binary search, finding the index at which an object with `key` occurs in `array`.
 * If no such index is found, returns the 2's-complement of first index at which
 * `array[index]` exceeds `key`.
 * @param array A sorted array whose first element must be no larger than number
 * @param key The key to be searched for in the array.
 * @param keySelector A callback used to select the search key from each element of `array`.
 * @param keyComparer A callback used to compare two keys in a sorted array.
 * @param offset An offset into `array` at which to start the search.
 */
export function binarySearchKey<T, U>(array: readonly T[], key: U, keySelector: (v: T) => U, keyComparer: Comparer<U>, offset?: number): number {
    if (!some(array)) {
        return -1;
    }

    let low = offset || 0;
    let high = array.length - 1;
    while (low <= high) {
        const middle = low + ((high - low) >> 1);
        const midKey = keySelector(array[middle]);
        switch (keyComparer(midKey, key)) {
            case Comparison.LessThan:
                low = middle + 1;
                break;
            case Comparison.EqualTo:
                return middle;
            case Comparison.GreaterThan:
                high = middle - 1;
                break;
        }
    }

    return ~low;
}

/** Remove an item by index from an array, moving everything to its right one space left. */
export function orderedRemoveItemAt<T>(array: T[], index: number): void {
    // This seems to be faster than either `array.splice(i, 1)` or `array.copyWithin(i, i+ 1)`.
    for (let i = index; i < array.length - 1; i++) {
        array[i] = array[i + 1];
    }
    array.pop();
}