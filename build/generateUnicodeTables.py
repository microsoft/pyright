# generateUnicodeTables.py
# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.
#
# Generates the content of unicode.ts based on the official Unicode
# character database.

import sys
import urllib.request
from io import TextIOWrapper


class Character:
    def __init__(self, code: int, category: str, *, end: int | None = None):
        self.code = code
        self.category = category

        self.hasSurrogate = code > 0xFFFF
        if self.hasSurrogate:
            unicodeChar = chr(code)
            utf16 = unicodeChar.encode("utf-16")
            rawHex = utf16.hex()
            hex = rawHex[4:]

            self.highSurrogate = int(hex[2:4] + hex[0:2], base=16)
            self.lowSurrogate = int(hex[6:8] + hex[4:6], base=16)


class CharacterRange:
    def __init__(self, start: Character, end: Character):
        self.start = start
        self.end = end


def downloadUnicodeData(unicodeVersion: str) -> str:
    url = f"https://www.unicode.org/Public/{unicodeVersion}.0/ucd/UnicodeData.txt"
    (path, _) = urllib.request.urlretrieve(url)
    return path


def parseFile(filePath: str) -> list[Character]:
    with open(filePath, "r") as reader:
        lines = reader.readlines()
        chars: list[Character] = []
        for i in range(len(lines)):
            line = lines[i]
            splitOnSemicolon = line.split(";")
            charCode = int(splitOnSemicolon[0], base=16)
            category = splitOnSemicolon[2]

            if splitOnSemicolon[1].endswith(", First>"):
                # Legacy range syntax
                # D800;<Non Private Use High Surrogate, First>;Cs;0;L;;;;;N;;;;;
                # DB7F;<Non Private Use High Surrogate, Last>;Cs;0;L;;;;;N;;;;;
                nextLine = lines[i + 1]
                nextSplitOnSemicolon = nextLine.split(";")
                nextCharCode = int(nextSplitOnSemicolon[0], base=16)
                for ord in range(charCode, nextCharCode + 1):
                    chars.append(Character(ord, category))
            elif splitOnSemicolon[1].endswith(", Last>"):
                continue
            else:
                chars.append(Character(charCode, category))

        return chars


# Given a collection of characters, returns a list of ranges of contiguous
# characters. Contiguous means that the character codes are sequential with
# no gaps and the characters all have the same category. For character codes
# greater than 0xFFFF, contiguous means that the high surrogate is the same
# and the low surrogate values are sequential with no gaps. So, two charcter
# codes might be sequential numerically but have different high surrogates,
# and therefore would not be members of the same range.
def getSurrogateRanges(chars: list[Character]) -> list[CharacterRange]:
    surrogateRanges: list[CharacterRange] = []

    consecutiveRangeStartChar: Character | None = None
    previousChar: Character | None = None
    for char in chars:
        if not consecutiveRangeStartChar:
            consecutiveRangeStartChar = char

        if previousChar:
            if not previousChar.hasSurrogate and not char.hasSurrogate:
                if (
                    char.code == previousChar.code + 1
                    and char.category == previousChar.category
                ):
                    pass
            elif not previousChar.hasSurrogate and char.hasSurrogate:
                consecutiveRangeStartChar = char
            else:
                if (
                    char.highSurrogate == previousChar.highSurrogate
                    and char.lowSurrogate == previousChar.lowSurrogate + 1
                    and char.category == previousChar.category
                ):
                    pass
                else:
                    surrogateRanges.append(
                        CharacterRange(consecutiveRangeStartChar, previousChar)
                    )
                    consecutiveRangeStartChar = char

        previousChar = char

    return surrogateRanges


# Write out a table of all character codes within the specified category. These are
# the full hex character codes (Unicode code points) not surrogate values. Sequential
# ranges of character codes are written as arrays of two numbers (start and end) to
# save space.
def writeRangeTable(writer: TextIOWrapper, category: str, chars: list[Character]):
    chars = [ch for ch in chars if ch.category == category]

    writer.write(f"export const unicode{category}: UnicodeRangeTable = [\n")

    consecutiveRangeStartChar: Character | None = None
    for i in range(len(chars)):
        char = chars[i]

        if not consecutiveRangeStartChar:
            consecutiveRangeStartChar = char

        if i + 1 >= len(chars) or chars[i + 1].code != char.code + 1:
            if consecutiveRangeStartChar.code == char.code:
                writer.write(f"    0x{consecutiveRangeStartChar.code:04X},\n")
            else:
                writer.write(f"    [0x{consecutiveRangeStartChar.code:04X}, 0x{char.code:04X}],\n")

            consecutiveRangeStartChar = None

    writer.write("];\n\n")


# Write out a table of all characters within the specified category using their UTF-16
# values. Characters are grouped by high surrogate value. Sequential ranges of low
# surrogate values are written as arrays of two numbers (start and end) to save space.
def writeSurrogateRangeTable(
    writer: TextIOWrapper, category: str, surrogateRanges: list[CharacterRange]
):
    surrogateRanges = [r for r in surrogateRanges if r.start.category == category]

    if len(surrogateRanges) == 0:
        return

    writer.write(
        f"export const unicode{category}Surrogate: UnicodeSurrogateRangeTable = {{\n"
    )

    previousCharRange: CharacterRange | None = None
    for charRange in surrogateRanges:
        if (
            previousCharRange
            and charRange.start.highSurrogate != previousCharRange.start.highSurrogate
        ):
            writer.write("    ],\n")
            previousCharRange = None

        if not previousCharRange:
            writer.write(f"    0x{charRange.start.highSurrogate:04X}: [\n")
            previousCharRange = charRange

        if charRange.start.lowSurrogate == charRange.end.lowSurrogate:
            writer.write(f"        0x{charRange.start.lowSurrogate:04X}, // 0x{charRange.start.code:04X}\n")
        else:
            writer.write(
                f"        [0x{charRange.start.lowSurrogate:04X}, 0x{charRange.end.lowSurrogate:04X}], // 0x{charRange.start.code:04X}..0x{charRange.end.code:04X}\n"
            )

    writer.write("    ],\n")
    writer.write("};\n\n")


unicodeVersion = "15.1" if len(sys.argv) <= 1 else sys.argv[1]
path = downloadUnicodeData(unicodeVersion)
chars = parseFile(path)
surrogateRanges = getSurrogateRanges(chars)

with open("packages/pyright-internal/src/parser/unicode.ts", "w") as writer:
    writer.write(
        f"""/*
 * unicode.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Tables that encode Unicode character codes for various Unicode-
 * defined categories used in the Python spec.
 *
 * Generated by build/generateUnicodeTables.py from the UnicodeData.txt
 * metadata file for Unicode {unicodeVersion}.
 */

export type UnicodeRange = [number, number] | number;
export type UnicodeRangeTable = UnicodeRange[];
export type UnicodeSurrogateRangeTable = {{ [surrogate: number]: UnicodeRange[] }};

"""
    )

    for category in ["Lu", "Ll", "Lt", "Lo", "Lm", "Nl", "Mn", "Mc", "Nd", "Pc"]:
        writeRangeTable(writer, category, chars)
        writeSurrogateRangeTable(writer, category, surrogateRanges)
