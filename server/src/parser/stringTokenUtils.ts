/*
* stringTokenUtils.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Methods that handle unescaping of escaped string token
* literal values.
*/

import Char from 'typescript-char';

import { StringToken, StringTokenFlags } from './tokenizerTypes';

export interface UnescapedString {
    value: string;
    invalidEscapeOffsets: number[];
    nonAsciiInBytes: boolean;
}

export class StringTokenUtils {
    static getUnescapedString(stringToken: StringToken): UnescapedString {
        const escapedString = stringToken.escapedValue;
        const isRaw = (stringToken.flags & StringTokenFlags.Raw) !== 0;
        const isBytes = (stringToken.flags & StringTokenFlags.Bytes) !== 0;
        let strOffset = 0;
        let output: UnescapedString = {
            value: '',
            invalidEscapeOffsets: [],
            nonAsciiInBytes: false
        };

        const addInvalidEscapeOffset = () => {
            // Invalid escapes are not reported for raw strings.
            if (!isRaw) {
                output.invalidEscapeOffsets.push(strOffset);
            }
        };

        const getEscapedCharacter = (offset = 0) => {
            if (strOffset + offset >= escapedString.length) {
                return Char.EndOfText;
            }

            return escapedString.charCodeAt(strOffset + offset);
        };

        const scanHexEscape = (digitCount: number) => {
            let foundIllegalHexDigit = false;
            let hexValue = 0;
            let localValue = '';

            for (let i = 0; i < digitCount; i++) {
                const charCode = getEscapedCharacter(1 + i);
                if (!this._isHexCharCode(charCode)) {
                    foundIllegalHexDigit = true;
                    break;
                }
                hexValue = 16 * hexValue + this._getHexDigitValue(charCode);
            }

            if (foundIllegalHexDigit) {
                addInvalidEscapeOffset();
                localValue = '\\' + String.fromCharCode(getEscapedCharacter());
                strOffset++;
            } else {
                localValue = String.fromCharCode(hexValue);
                strOffset += 1 + digitCount;
            }

            return localValue;
        };

        while (true) {
            let curChar = getEscapedCharacter();
            if (curChar === Char.EndOfText) {
                return output;
            }

            if (curChar === Char.Backslash) {
                // Move past the escape (backslash) character.
                strOffset++;
                curChar = getEscapedCharacter();
                let localValue = '';

                if (curChar === Char.CarriageReturn || curChar === Char.LineFeed) {
                    if (curChar === Char.CarriageReturn && getEscapedCharacter(1) === Char.LineFeed) {
                        if (isRaw) {
                            localValue += String.fromCharCode(curChar);
                        }
                        strOffset++;
                        curChar = getEscapedCharacter();
                    }
                    if (isRaw) {
                        localValue = '\\' + localValue + String.fromCharCode(curChar);
                    }
                    strOffset++;
                } else {
                    if (isRaw) {
                        localValue = '\\' + String.fromCharCode(curChar);
                        strOffset++;
                    } else {
                        switch (curChar) {
                            case Char.Backslash:
                            case Char.SingleQuote:
                            case Char.DoubleQuote:
                                localValue = String.fromCharCode(curChar);
                                strOffset++;
                                break;

                            case Char.a:
                                localValue = '\u0007';
                                strOffset++;
                                break;

                            case Char.b:
                                localValue = '\b';
                                strOffset++;
                                break;

                            case Char.f:
                                localValue = '\f';
                                strOffset++;
                                break;

                            case Char.n:
                                localValue = '\n';
                                strOffset++;
                                break;

                            case Char.r:
                                localValue = '\r';
                                strOffset++;
                                break;

                            case Char.t:
                                localValue = '\t';
                                strOffset++;
                                break;

                            case Char.v:
                                localValue = '\v';
                                strOffset++;
                                break;

                            case Char.x:
                                localValue = scanHexEscape(2);
                                break;

                            case Char.N: {
                                let foundIllegalChar = false;
                                let charCount = 1;
                                if (getEscapedCharacter(charCount) !== Char.OpenBrace) {
                                    foundIllegalChar = true;
                                } else {
                                    charCount++;
                                    while (true) {
                                        const lookaheadChar = getEscapedCharacter(charCount);
                                        if (lookaheadChar === Char.CloseBrace) {
                                            break;
                                        } else if (!this._isAlphaNumericChar(lookaheadChar)) {
                                            foundIllegalChar = true;
                                            break;
                                        } else {
                                            charCount++;
                                        }
                                    }
                                }

                                if (foundIllegalChar) {
                                    addInvalidEscapeOffset();
                                    localValue = '\\' + String.fromCharCode(curChar);
                                    strOffset++;
                                } else {
                                    // We don't have the Unicode name database handy, so
                                    // assume that the name is valid and use a '-' as a
                                    // replacement character.
                                    localValue = '-';
                                    strOffset += 1 + charCount;
                                }
                                break;
                            }

                            case Char.u:
                                localValue = scanHexEscape(4);
                                break;

                            case Char.U:
                                localValue = scanHexEscape(8);
                                break;

                            default:
                                if (this._isOctalCharCode(curChar)) {
                                    let octalCode = curChar - Char._0;
                                    strOffset++;
                                    curChar = getEscapedCharacter();
                                    if (this._isOctalCharCode(curChar)) {
                                        octalCode = octalCode * 8 + curChar - Char._0;
                                        strOffset++;
                                        curChar = getEscapedCharacter();

                                        if (this._isOctalCharCode(curChar)) {
                                            octalCode = octalCode * 8 + curChar - Char._0;
                                            strOffset++;
                                        }
                                    }

                                    localValue = String.fromCharCode(octalCode);
                                } else {
                                    localValue = '\\' + String.fromCharCode(curChar);
                                    addInvalidEscapeOffset();
                                    strOffset++;
                                }
                                break;
                        }
                    }
                }

                output.value += localValue;
            } else if (curChar === Char.LineFeed || curChar === Char.CarriageReturn) {
                // Skip over the escaped new line (either one or two characters).
                if (curChar === Char.CarriageReturn && getEscapedCharacter(1) === Char.LineFeed) {
                    output.value += String.fromCharCode(curChar);
                    strOffset++;
                    curChar = getEscapedCharacter();
                }

                output.value += String.fromCharCode(curChar);
                strOffset++;
            } else {
                // There's nothing to unescape, so output the escaped character directly.
                if (isBytes && curChar >= 128) {
                    output.nonAsciiInBytes = true;
                }

                output.value += String.fromCharCode(curChar);

                strOffset++;
            }
        }
    }

    private static _isAlphaNumericChar(charCode: number): boolean {
        if (charCode >= Char._0 && charCode <= Char._9) {
            return true;
        }

        if (charCode >= Char.a && charCode <= Char.z) {
            return true;
        }

        if (charCode >= Char.A && charCode <= Char.A) {
            return true;
        }

        return false;
    }

    private static _isOctalCharCode(charCode: number): boolean {
        return charCode >= Char._0 && charCode <= Char._7;
    }

    private static _isHexCharCode(charCode: number): boolean {
        if (charCode >= Char._0 && charCode <= Char._9) {
            return true;
        }

        if (charCode >= Char.a && charCode <= Char.f) {
            return true;
        }

        if (charCode >= Char.A && charCode <= Char.F) {
            return true;
        }

        return false;
    }

    private static _getHexDigitValue(charCode: number): number {
        if (charCode >= Char._0 && charCode <= Char._9) {
            return charCode - Char._0;
        }

        if (charCode >= Char.a && charCode <= Char.f) {
            return charCode - Char.a + 10;
        }

        if (charCode >= Char.A && charCode <= Char.F) {
            return charCode - Char.A + 10;
        }

        return 0;
    }
}
