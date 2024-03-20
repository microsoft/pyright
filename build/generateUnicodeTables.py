import urllib.request
from io import TextIOWrapper


def downloadUnicodeData(unicodeVersion: str) -> str:
    url = f'https://www.unicode.org/Public/{unicodeVersion}.0/ucd/UnicodeData.txt'
    (path, _) = urllib.request.urlretrieve(url)
    return path


def loadFile(filePath: str) -> list[str]:
    with open(filePath, "r") as reader:
        return [x.strip() for x in reader.readlines()]


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

    def __str__(self):
        return f"{self.code} ({self.category})"


DUMMY_CHARACTER = Character(-999, "ZZ")


class CharacterRange:
    def __init__(self, start: Character, end: Character):
        self.start = start
        self.end = end

    def __str__(self):
        return f"{self.start} -> {self.end}"


def parse(line: str) -> Character:
    splitOnSemicolon = line.split(";")
    return Character(int(splitOnSemicolon[0], base=16), splitOnSemicolon[2])


path = downloadUnicodeData("15.1")
lines = loadFile(path)
chars = [parse(line) for line in lines]


def sort(range: Character) -> int:
    return range.code


chars.sort(key=sort)


def getSurrogateRanges(chars: list[Character]) -> list[CharacterRange]:
    surrogateRanges: list[CharacterRange] = []

    consecutiveRangeStartChar: Character | None = None
    previousChar = DUMMY_CHARACTER
    for char in chars:
        if not consecutiveRangeStartChar:
            consecutiveRangeStartChar = char

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
                writer.write(f"    {consecutiveRangeStartChar.code},\n")
            else:
                writer.write(f"    [{consecutiveRangeStartChar.code}, {char.code}],\n")
            
            consecutiveRangeStartChar = None

    writer.write("];\n\n")


def writeSurrogateRangeTable(writer: TextIOWrapper, category: str, surrogateRanges: list[CharacterRange]):
    surrogateRanges = [r for r in surrogateRanges if r.start.category == category]

    if len(surrogateRanges) == 0:
        return

    writer.write(f"export const unicode{category}Surrogate: UnicodeSurrogateRangeTable = {{\n")

    consecutiveRangeStartChar: Character | None = None
    previousCharRange: CharacterRange | None = None
    for charRange in surrogateRanges:
        if (
            previousCharRange
            and charRange.start.highSurrogate != previousCharRange.start.highSurrogate
        ):
            writer.write("    ],\n")
            previousCharRange = None

        if not previousCharRange:
            writer.write(f"    {charRange.start.highSurrogate}: [\n")
            previousCharRange = charRange

        if charRange.start.lowSurrogate == charRange.end.lowSurrogate:
            writer.write(f"        {charRange.start.lowSurrogate},\n")
        else:
            writer.write(
                f"        [{charRange.start.lowSurrogate}, {charRange.end.lowSurrogate}],\n"
            )

    writer.write("    ],\n")
    writer.write("};\n\n")


surrogateRanges = getSurrogateRanges(chars)

with open("packages/pyright-internal/src/parser/unicode.ts", "w") as writer:
    writer.write("""/*
 * unicode.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Tables that encode Unicode character codes for various Unicode-
 * defined categories used in the Python spec. These tables were built
 * from the npm package unicode, which contains the same information
 * in a much more verbose form.
 */

export type UnicodeRange = [number, number] | number;
export type UnicodeRangeTable = UnicodeRange[];
export type UnicodeSurrogateRangeTable = { [surrogate: number]: UnicodeRange[] };

""")

    for category in ["Lu", "Ll", "Lt", "Lo", "Lm", "Nl", "Mn", "Mc", "Nd", "Pc"]:
        writeRangeTable(writer, category, chars)
        writeSurrogateRangeTable(writer, category, surrogateRanges)
