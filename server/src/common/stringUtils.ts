/*
* stringUtils.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Utility methods for manipulating and comparing strings.
*/

import leven from 'leven';

export class StringUtils {
    // Determines how closely a typed string matches a symbol
    // name. An exact match returns 1. A match that differs
    // only in case returns a slightly lower number. A match
    // that involves a few missing or added characters returns
    // an even lower number.
    static computeCompletionSimilarity(typedValue: string, symbolName: string): number {
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
        // no simiarlity.
        if (smallestEditDistance >= typedValue.length) {
            return 0;
        }

        const similarity = (typedValue.length - smallestEditDistance) / typedValue.length;
        return 0.5 * similarity;
    }

    // This is a simple, non-cryptographic hash function for text.
    static hashString(contents: string) {
        let hash = 0;

        for (let i = 0; i < contents.length; i++) {
            hash = (hash << 5) - hash + contents.charCodeAt(i++) | 0;
        }
        return hash;
    }
}
