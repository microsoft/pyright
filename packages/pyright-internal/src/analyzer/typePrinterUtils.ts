/*
 * typePrinterUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Simple utility functions used by the type printer.
 */

const singleTickRegEx = /'/g;
const escapedDoubleQuoteRegEx = /\\"/g;

export function printStringLiteral(value: string, quotation = '"'): string {
    // JSON.stringify will perform proper escaping for " case.
    // So, we only need to do our own escaping for ' case.
    let literalStr = JSON.stringify(value).toString();
    if (quotation !== '"') {
        literalStr = `'${literalStr
            .substring(1, literalStr.length - 1)
            .replace(escapedDoubleQuoteRegEx, '"')
            .replace(singleTickRegEx, "\\'")}'`; // CodeQL [SM02383] Code ql is just wrong here. We don't need to replace backslashes.
    }

    return literalStr;
}

export function printBytesLiteral(value: string) {
    let bytesString = '';

    // There's no good built-in conversion routine in javascript to convert
    // bytes strings. Determine on a character-by-character basis whether
    // it can be rendered into an ASCII character. If not, use an escape.
    for (let i = 0; i < value.length; i++) {
        const char = value.substring(i, i + 1);
        const charCode = char.charCodeAt(0);

        if (charCode >= 20 && charCode <= 126) {
            if (charCode === 34) {
                bytesString += '\\' + char;
            } else {
                bytesString += char;
            }
        } else {
            bytesString += `\\x${((charCode >> 4) & 0xf).toString(16)}${(charCode & 0xf).toString(16)}`;
        }
    }

    return `b"${bytesString}"`;
}
