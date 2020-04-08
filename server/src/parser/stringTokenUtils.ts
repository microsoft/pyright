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

export interface FormatStringSegment {
    // Offset within the unescaped string where
    // this format string segment begins.
    offset: number;

    // Length of unescaped string corresponding
    // to this segment.
    length: number;

    // Unescaped value of segment (without brackets).
    value: string;

    // Indicates whether this segment should be parsed
    // as an expression.
    isExpression: boolean;
}

export const enum UnescapeErrorType {
    InvalidEscapeSequence,
    EscapeWithinFormatExpression,
    SingleCloseBraceWithinFormatLiteral,
    UnterminatedFormatExpression,
}

export interface UnescapeError {
    // Offset within the unescaped string where
    // this error begins.
    offset: number;

    // Length of section associated with error.
    length: number;

    // Type of error.
    errorType: UnescapeErrorType;
}

export interface UnescapedString {
    value: string;
    unescapeErrors: UnescapeError[];
    nonAsciiInBytes: boolean;
    formatStringSegments: FormatStringSegment[];
}

export function getUnescapedString(stringToken: StringToken): UnescapedString {
    const escapedString = stringToken.escapedValue;
    const isRaw = (stringToken.flags & StringTokenFlags.Raw) !== 0;
    const isBytes = (stringToken.flags & StringTokenFlags.Bytes) !== 0;
    const isFormat = (stringToken.flags & StringTokenFlags.Format) !== 0;
    let formatExpressionNestCount = 0;
    let formatSegment: FormatStringSegment = {
        offset: 0,
        length: 0,
        value: '',
        isExpression: false,
    };
    let strOffset = 0;
    const output: UnescapedString = {
        value: '',
        unescapeErrors: [],
        nonAsciiInBytes: false,
        formatStringSegments: [],
    };

    const addInvalidEscapeOffset = () => {
        // Invalid escapes are not reported for raw strings.
        if (!isRaw) {
            output.unescapeErrors.push({
                offset: strOffset - 1,
                length: 2,
                errorType: UnescapeErrorType.InvalidEscapeSequence,
            });
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
            if (!_isHexCharCode(charCode)) {
                foundIllegalHexDigit = true;
                break;
            }
            hexValue = 16 * hexValue + _getHexDigitValue(charCode);
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

    const appendOutputChar = (charCode: number) => {
        const char = String.fromCharCode(charCode);
        output.value += char;
        formatSegment.value += char;
    };

    while (true) {
        let curChar = getEscapedCharacter();
        if (curChar === Char.EndOfText) {
            if (isFormat) {
                if (formatSegment.isExpression) {
                    // The last format segment was an unterminated expression.
                    output.unescapeErrors.push({
                        offset: formatSegment.offset,
                        length: strOffset - formatSegment.offset,
                        errorType: UnescapeErrorType.UnterminatedFormatExpression,
                    });
                }

                // Push the last segment.
                if (strOffset !== formatSegment.offset) {
                    formatSegment.length = strOffset - formatSegment.offset;
                    output.formatStringSegments.push(formatSegment);
                }
            }
            return output;
        }

        if (curChar === Char.Backslash) {
            if (isFormat && formatSegment.isExpression) {
                // Backslashes aren't allowed within format string expressions.
                output.unescapeErrors.push({
                    offset: strOffset,
                    length: 1,
                    errorType: UnescapeErrorType.EscapeWithinFormatExpression,
                });
            }

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
                                    } else if (!_isAlphaNumericChar(lookaheadChar)) {
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
                            if (_isOctalCharCode(curChar)) {
                                let octalCode = curChar - Char._0;
                                strOffset++;
                                curChar = getEscapedCharacter();
                                if (_isOctalCharCode(curChar)) {
                                    octalCode = octalCode * 8 + curChar - Char._0;
                                    strOffset++;
                                    curChar = getEscapedCharacter();

                                    if (_isOctalCharCode(curChar)) {
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
            formatSegment.value += localValue;
        } else if (curChar === Char.LineFeed || curChar === Char.CarriageReturn) {
            // Skip over the escaped new line (either one or two characters).
            if (curChar === Char.CarriageReturn && getEscapedCharacter(1) === Char.LineFeed) {
                appendOutputChar(curChar);
                strOffset++;
                curChar = getEscapedCharacter();
            }

            appendOutputChar(curChar);
            strOffset++;
        } else if (isFormat && curChar === Char.OpenBrace) {
            if (!formatSegment.isExpression && getEscapedCharacter(1) === Char.OpenBrace) {
                appendOutputChar(curChar);
                strOffset += 2;
            } else {
                // A single open brace within a format literal indicates that
                // an expression is starting.
                formatSegment.length = strOffset - formatSegment.offset;
                if (formatSegment.length > 0) {
                    output.formatStringSegments.push(formatSegment);
                }
                strOffset++;

                // Start a new segment.
                formatSegment = {
                    offset: strOffset,
                    length: 0,
                    value: '',
                    isExpression: true,
                };
                formatExpressionNestCount++;
            }
        } else if (isFormat && curChar === Char.CloseBrace) {
            if (!formatSegment.isExpression && getEscapedCharacter(1) === Char.CloseBrace) {
                appendOutputChar(curChar);
                strOffset += 2;
            } else if (formatExpressionNestCount === 0) {
                output.unescapeErrors.push({
                    offset: strOffset,
                    length: 1,
                    errorType: UnescapeErrorType.SingleCloseBraceWithinFormatLiteral,
                });
                strOffset++;
            } else {
                formatExpressionNestCount--;

                // A close brace within a format expression indicates that
                // the expression is complete.
                formatSegment.length = strOffset - formatSegment.offset;
                output.formatStringSegments.push(formatSegment);
                strOffset++;

                // Start a new segment.
                formatSegment = {
                    offset: strOffset,
                    length: 0,
                    value: '',
                    isExpression: false,
                };
            }
        } else if (formatSegment.isExpression && (curChar === Char.SingleQuote || curChar === Char.DoubleQuote)) {
            // We're within an expression, and we've encountered a string literal.
            // Skip over it.
            const quoteChar = curChar;
            appendOutputChar(curChar);
            const isTriplicate = getEscapedCharacter(1) === quoteChar && getEscapedCharacter(2) === quoteChar;
            if (isTriplicate) {
                strOffset += 2;
                appendOutputChar(curChar);
                appendOutputChar(curChar);
                output.value += String.fromCharCode(curChar);
                output.value += String.fromCharCode(curChar);
            }

            while (true) {
                strOffset++;
                let strChar = getEscapedCharacter();
                if (strChar === Char.EndOfText) {
                    break;
                }

                if (strChar === Char.Backslash) {
                    appendOutputChar(strChar);
                    strOffset++;
                    strChar = getEscapedCharacter();
                    appendOutputChar(strChar);
                    continue;
                }

                if (strChar === Char.LineFeed || strChar === Char.CarriageReturn) {
                    break;
                }

                if (strChar === quoteChar) {
                    if (!isTriplicate) {
                        strOffset++;
                        appendOutputChar(strChar);
                        break;
                    }

                    if (getEscapedCharacter(1) === quoteChar && getEscapedCharacter(2) === quoteChar) {
                        strOffset += 3;
                        appendOutputChar(strChar);
                        appendOutputChar(strChar);
                        appendOutputChar(strChar);
                        break;
                    }
                }

                appendOutputChar(strChar);
            }
        } else {
            // There's nothing to unescape, so output the escaped character directly.
            if (isBytes && curChar >= 128) {
                output.nonAsciiInBytes = true;
            }

            appendOutputChar(curChar);
            strOffset++;
        }
    }
}

function _isAlphaNumericChar(charCode: number): boolean {
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

function _isOctalCharCode(charCode: number): boolean {
    return charCode >= Char._0 && charCode <= Char._7;
}

function _isHexCharCode(charCode: number): boolean {
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

function _getHexDigitValue(charCode: number): number {
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
