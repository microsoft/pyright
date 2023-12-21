/*
 * sourceMapperUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

import { CancellationToken } from 'vscode-jsonrpc';
import { Uri } from '../common/uri/uri';

const MAX_TREE_SEARCH_COUNT = 1000;

class NumberReference {
    value = 0;
}

// Builds an array of imports from the 'from' to the 'to' entry where 'from'
// is on the front of the array and the item just before 'to' is on the
// back of the array.
export function buildImportTree(to: Uri, from: Uri, next: (from: Uri) => Uri[], token: CancellationToken): Uri[] {
    const totalCountRef = new NumberReference();
    const results = _buildImportTreeImpl(to, from, next, [], totalCountRef, token);

    // Result should always have the 'from' node in it.
    return results.length > 0 ? results : [from];
}

function _buildImportTreeImpl(
    to: Uri,
    from: Uri,
    next: (from: Uri) => Uri[],
    previous: Uri[],
    totalSearched: NumberReference,
    token: CancellationToken
): Uri[] {
    // Exit early if cancellation is requested or we've exceeded max count
    if (totalSearched.value > MAX_TREE_SEARCH_COUNT || token.isCancellationRequested) {
        return [];
    }
    totalSearched.value += 1;

    if (from.equals(to)) {
        // At the top, previous should have our way into this recursion.
        return previous.length ? previous : [from];
    }

    if (previous.length > 1 && previous.find((s) => s.equals(from))) {
        // Fail the search, we're stuck in a loop.
        return [];
    }

    const nextEntries = next(from);
    for (let i = 0; i < nextEntries.length && !token.isCancellationRequested; i++) {
        // Do a search through the next level to get to the 'to' entry.
        const subentries = _buildImportTreeImpl(to, nextEntries[i], next, [...previous, from], totalSearched, token);

        if (subentries.length > 0) {
            return subentries;
        }
    }

    // Search failed on this tree. Fail so we can exit recursion.
    return [];
}
