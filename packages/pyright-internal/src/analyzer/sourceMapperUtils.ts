/*
 * sourceMapperUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

function _buildImportTreeImpl(
    to: string,
    from: string,
    next: (from: string) => string[],
    previous: string[]
): string[] {
    if (from === to) {
        // At the top, previous should have our way into this recursion.
        return previous.length ? previous : [from];
    } else if (previous.length > 1 && previous.find((s) => s === from)) {
        // Fail the search, we're stuck in a loop.
        return [];
    } else {
        const nextEntries = next(from);
        for (let i = 0; i < nextEntries.length; i++) {
            // Do a search through the next level to get to the 'to' entry.
            const subentries = _buildImportTreeImpl(to, nextEntries[i], next, [...previous, from]);
            if (subentries.length > 0) {
                return subentries;
            }
        }
    }
    // Search failed on this tree, fail so we can exit recursion.
    return [];
}

/**
 * Builds an array of imports from the 'from' to the 'to' entry where 'from' is on the front of the array and
 * the item just before 'to' is on the back of the array
 * @param to
 * @param from
 * @param next
 * @returns
 */
export function buildImportTree(to: string, from: string, next: (from: string) => string[]): string[] {
    const results = _buildImportTreeImpl(to, from, next, []);

    // Result should always have the 'from' node in it.
    return results.length > 0 ? results : [from];
}
