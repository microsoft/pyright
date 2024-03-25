/*
 * caseSensitivityDetector.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * interface to determine whether the given uri string should be case sensitive or not.
 */

export interface CaseSensitivityDetector {
    isCaseSensitive(uri: string): boolean;
}

export namespace CaseSensitivityDetector {
    export function is(value: any): value is CaseSensitivityDetector {
        return !!value.isCaseSensitive;
    }
}
