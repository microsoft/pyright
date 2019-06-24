/*
* symbolUtils.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Static methods that apply to symbols or symbol names.
*/

const _constantRegEx = /^[A-Z0-9_]+$/;
const _underscoreOnlyRegEx = /^[_]+$/;

export class SymbolUtils {
    // Private symbol names start with a double underscore.
    static isPrivateName(name: string) {
        return name.length > 2 &&
            name.startsWith('__') &&
            !name.endsWith('__');
    }

    // Protected symbol names start with a single underscore.
    static isProtectedName(name: string) {
        return name.length > 1 &&
            name.startsWith('_') &&
            !name.startsWith('__');
    }

    // "Dunder" names start and end with two underscores.
    static isDunderName(name: string) {
        return name.length > 4 &&
            name.startsWith('__') &&
            name.endsWith('__');
    }

    // Constants are all-caps with possible numbers and underscores.
    static isConstantName(name: string) {
        return !!name.match(_constantRegEx) && !name.match(_underscoreOnlyRegEx);
    }
}
