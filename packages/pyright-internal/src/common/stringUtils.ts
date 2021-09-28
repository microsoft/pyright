/*
 * stringUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Utility methods for manipulating and comparing strings.
 */

import leven from 'leven';

import { compareComparableValues, Comparison } from './core';

// Determines how closely a typed string matches a symbol
// name. An exact match returns 1. A match that differs
// only in case returns a slightly lower number. A match
// that involves a few missing or added characters returns
// an even lower number.
export function computeCompletionSimilarity(typedValue: string, symbolName: string): number {
    if (symbolName.startsWith(typedValue)) {
        return 1;
    }

    const symbolLower = symbolName.toLocaleLowerCase();
    const typedLower = typedValue.toLocaleLowerCase();

    if (symbolLower.startsWith(typedLower)) {
        return 0.75;
    }

    // How far apart are the two strings? Find the smallest edit
    // distance for each of the substrings taken from the start of
    // symbolName.
    let symbolSubstrLength = symbolLower.length;
    let smallestEditDistance = Number.MAX_VALUE;
    while (symbolSubstrLength > 0) {
        const editDistance = leven(symbolLower.substr(0, symbolSubstrLength), typedLower);
        if (editDistance < smallestEditDistance) {
            smallestEditDistance = editDistance;
        }
        symbolSubstrLength--;
    }

    // We'll take into account the length of the typed value. If the user
    // has typed more characters, and they largely match the symbol name,
    // it is considered more similar. If the the edit distance is similar
    // to the number of characters the user has typed, then there's almost
    // no similarity.
    if (smallestEditDistance >= typedValue.length) {
        return 0;
    }

    const similarity = (typedValue.length - smallestEditDistance) / typedValue.length;
    return 0.5 * similarity;
}

// Determines if typed string matches a symbol
// name. Characters must appear in order.
// Return true if all typed characters are in symbol
export function isPatternInSymbol(typedValue: string, symbolName: string): boolean {
    const typedLower = typedValue.toLocaleLowerCase();
    const symbolLower = symbolName.toLocaleLowerCase();
    const typedLength = typedLower.length;
    const symbolLength = symbolLower.length;
    let typedPos = 0;
    let symbolPos = 0;
    while (typedPos < typedLength && symbolPos < symbolLength) {
        if (typedLower[typedPos] === symbolLower[symbolPos]) {
            typedPos += 1;
        }
        symbolPos += 1;
    }
    return typedPos === typedLength;
}

// This is a simple, non-cryptographic hash function for text.
export function hashString(contents: string) {
    let hash = 0;

    for (let i = 0; i < contents.length; i++) {
        hash = ((hash << 5) - hash + contents.charCodeAt(i)) | 0;
    }
    return hash;
}

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
export function compareStringsCaseInsensitive(a: string | undefined, b: string | undefined): Comparison {
    return a === b
        ? Comparison.EqualTo
        : a === undefined
        ? Comparison.LessThan
        : b === undefined
        ? Comparison.GreaterThan
        : compareComparableValues(a.toUpperCase(), b.toUpperCase());
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

export function getStringComparer(ignoreCase?: boolean) {
    return ignoreCase ? compareStringsCaseInsensitive : compareStringsCaseSensitive;
}

/**
 * Compare the equality of two strings using a case-insensitive ordinal comparison.
 *
 * Case-insensitive comparisons compare both strings one code-point at a time using the integer
 * value of each code-point after applying `toUpperCase` to each string. We always map both
 * strings to their upper-case form as some unicode characters do not properly round-trip to
 * lowercase (such as `ẞ` (German sharp capital s)).
 */
export function equateStringsCaseInsensitive(a: string, b: string) {
    return compareStringsCaseInsensitive(a, b) === Comparison.EqualTo;
}

/**
 * Compare the equality of two strings using a case-sensitive ordinal comparison.
 *
 * Case-sensitive comparisons compare both strings one code-point at a time using the
 * integer value of each code-point.
 */
export function equateStringsCaseSensitive(a: string, b: string) {
    return compareStringsCaseSensitive(a, b) === Comparison.EqualTo;
}

export function getCharacterCount(value: string, ch: string) {
    let result = 0;
    for (let i = 0; i < value.length; i++) {
        if (value[i] === ch) {
            result++;
        }
    }
    return result;
}

export function getLastDottedString(text: string) {
    const index = text.lastIndexOf('.');
    return index > 0 ? text.substring(index + 1) : text;
}
