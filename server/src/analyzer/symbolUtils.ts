/*
* symbolUtils.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Static methods that apply to symbols or symbol names.
*/

export class SymbolUtils {
    // Private symbol names start with a single underscore.
    static isPrivateName(name: string) {
        return name.length > 2 &&
            name.startsWith('_') &&
            !name.startsWith('__');
    }

    // "Dunder" names start and end with two underscores.
    static isDunderName(name: string) {
        return name.length > 4 &&
            name.startsWith('__') &&
            name.endsWith('__');
    }
}
