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

export function equateValues<T>(a: T, b: T) { return a === b; }

export type GetCanonicalFileName = (fileName: string) => string;

/**
 * Compare two strings using a case-insensitive ordinal comparison.
 *
 * Ordinal comparisons are based on the difference between the unicode code points of both
 * strings. Characters with multiple unicode representations are considered unequal. Ordinal
 * comparisons provide predictable ordering, but place "a" after "B".
 *
 * Case-insensitive comparisons compare both strings one code-point at a time using the integer
 * value of each code-point after applying `toUpperCase` to each string. We always map both
 * strings to their upper-case form as some unicode characters do not properly round-trip to
 * lowercase (such as `áºž` (German sharp capital s)).
 */
export function compareStringsCaseInsensitive(a: string, b: string) {
    if (a === b) return Comparison.EqualTo;
    if (a === undefined) return Comparison.LessThan;
    if (b === undefined) return Comparison.GreaterThan;
    a = a.toUpperCase();
    b = b.toUpperCase();
    return a < b ? Comparison.LessThan : a > b ? Comparison.GreaterThan : Comparison.EqualTo;
}

/**
 * Compare two strings using a case-sensitive ordinal comparison.
 *
 * Ordinal comparisons are based on the difference between the unicode code points of both
 * strings. Characters with multiple unicode representations are considered unequal. Ordinal
 * comparisons provide predictable ordering, but place "a" after "B".
 *
 * Case-sensitive comparisons compare both strings one code-point at a time using the integer
 * value of each code-point.
 */
export function compareStringsCaseSensitive(a: string | undefined, b: string | undefined): Comparison {
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
 * Compare two numeric values for their order relative to each other.
 * To compare strings, use any of the `compareStrings` functions.
 */
export function compareValues(a: number | undefined, b: number | undefined): Comparison {
    return compareComparableValues(a, b);
}

export function getStringComparer(ignoreCase?: boolean) {
    return ignoreCase ? compareStringsCaseInsensitive : compareStringsCaseSensitive;
}

/**
 * Compare the equality of two strings using a case-sensitive ordinal comparison.
 *
 * Case-sensitive comparisons compare both strings one code-point at a time using the integer
 * value of each code-point after applying `toUpperCase` to each string. We always map both
 * strings to their upper-case form as some unicode characters do not properly round-trip to
 * lowercase (such as `ẞ` (German sharp capital s)).
 */
export function equateStringsCaseInsensitive(a: string, b: string) {
    return a === b
        || a !== undefined
        && b !== undefined
        && a.toUpperCase() === b.toUpperCase();
}

/**
 * Compare the equality of two strings using a case-sensitive ordinal comparison.
 *
 * Case-sensitive comparisons compare both strings one code-point at a time using the
 * integer value of each code-point.
 */
export function equateStringsCaseSensitive(a: string, b: string) {
    return equateValues(a, b);
}

export function startsWith(str: string, prefix: string): boolean {
    return str.lastIndexOf(prefix, 0) === 0;
}