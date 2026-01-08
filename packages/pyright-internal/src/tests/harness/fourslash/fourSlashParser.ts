/*
 * fourSlashParser.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Parse fourslash markup code and return parsed content with marker/range data
 */

import { contains } from '../../../common/collectionUtils';
import { toBoolean } from '../../../common/core';
import {
    combinePaths,
    getRelativePath,
    isRootedDiskPath,
    normalizePath,
    normalizeSlashes,
} from '../../../common/pathUtils';
import { UriEx } from '../../../common/uri/uriUtils';
import { distlibFolder, libFolder } from '../vfs/factory';
import {
    CompilerSettingRawData,
    CompilerSettings,
    FourSlashData,
    FourSlashFile,
    GlobalMetadataOptionNames,
    Marker,
    MetadataOptionNames,
    RawContentMapping,
    RawContentMappingSegment,
    RawToken,
    RawTokenKind,
    RawTokenRange,
    Range,
    fileMetadataNames,
} from './fourSlashTypes';
import { findItemContainingOffset, findTokenIndexAtOrAfter } from './fourSlashRawUtils';

/**
 * Parse given fourslash markup code and return content with markup/range data
 *
 * @param basePath this will be combined with given `fileName` to form filepath to this content
 * @param contents content with fourslash markups.
 * @param fileName this will be a default filename for the first no named content in `contents`.
 *                 if content is marked with `@filename`, that will override this given `filename`
 */
export function parseTestData(basePath: string, contents: string, fileName: string): FourSlashData {
    const normalizedBasePath = normalizeSlashes(basePath);

    // Historically, many fourslash strings ended with a trailing newline (often from a closing backtick on its own
    // line). Some parsing logic assumes line feeds exist for line-to-offset mapping. Normalize to ensure the
    // input always ends with an LF, so callers don't need to add a trailing empty line.
    const rawText = contents.endsWith('\n') ? contents : `${contents}\n`;
    const rawTokens: RawToken[] = [];

    // List of all the subfiles we've parsed out
    const files: FourSlashFile[] = [];
    // Global options
    const globalOptions: CompilerSettings = {};
    const globalOptionsRawData: CompilerSettings<CompilerSettingRawData> = {};
    // Marker positions

    // Split up the input file by line
    // Note: IE JS engine incorrectly handles consecutive delimiters here when using RegExp split, so
    // we have to string-based splitting instead and try to figure out the delimiting chars
    const lines = rawText.split('\n');
    let i = 0;

    const markerPositions = new Map<string, Marker>();
    const markers: Marker[] = [];
    const ranges: Range[] = [];

    // Stuff related to the subfile we're parsing
    let currentFileContent: string | undefined;
    let currentFileName = normalizeSlashes(fileName);
    let currentFileOptions: CompilerSettings = {};
    let currentFileOptionsRawData: CompilerSettings<CompilerSettingRawData> = {};
    let currentFileTokenRanges: RawTokenRange[] = [];
    let currentFileContentToRawSegments: ContentToRawSegment[] = [];
    let lastFourSlashLineLfOffset: number | undefined;

    let normalizedProjectRoot = normalizedBasePath;

    function nextFile() {
        if (currentFileContent === undefined) {
            return;
        }

        if (toBoolean(currentFileOptions[MetadataOptionNames.library])) {
            currentFileName = normalizePath(
                combinePaths(libFolder.getFilePath(), getRelativePath(currentFileName, normalizedBasePath))
            );
        }

        if (toBoolean(currentFileOptions[MetadataOptionNames.distLibrary])) {
            currentFileName = normalizePath(
                combinePaths(distlibFolder.getFilePath(), getRelativePath(currentFileName, normalizedBasePath))
            );
        }

        const ignoreCase = toBoolean(globalOptions[GlobalMetadataOptionNames.ignoreCase]);
        const file = parseFileContent(
            currentFileContent,
            currentFileContentToRawSegments,
            rawTokens,
            currentFileName,
            ignoreCase,
            markerPositions,
            markers,
            ranges
        );
        file.fileOptions = currentFileOptions;

        const mappingRawData = file.rawData;
        file.rawData = {
            tokenRanges: currentFileTokenRanges,
            fileOptionsRawData: currentFileOptionsRawData,
            rawToContent: mappingRawData?.rawToContent,
            contentToRaw: mappingRawData?.contentToRaw,
        };

        // Store result file
        files.push(file);

        currentFileContent = undefined;
        currentFileOptions = {};
        currentFileOptionsRawData = {};
        currentFileTokenRanges = [];
        currentFileContentToRawSegments = [];
        lastFourSlashLineLfOffset = undefined;
        currentFileName = fileName;
    }

    let rawOffset = 0;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const lineWithPotentialCr = lines[lineIndex];
        i++;

        const lineStartRawOffset = rawOffset;
        const hasLf = lineIndex < lines.length - 1;

        const lineTokenStart = rawTokens.length;
        const tokenizeResult = tokenizeRawLine(rawText, rawTokens, lineStartRawOffset, lineWithPotentialCr, hasLf);
        const lineTokenEnd = rawTokens.length;

        // Maintain legacy parsing behavior: treat CRLF as LF-delimited lines with a trailing '\r' in the line text.
        let line = lineWithPotentialCr;
        if (line.length > 0 && line.charAt(line.length - 1) === '\r') {
            line = line.substr(0, line.length - 1);
        }

        if (line.substr(0, 4) === '////') {
            const text = line.substr(4);
            currentFileTokenRanges.push({ startToken: lineTokenStart, endToken: lineTokenEnd });

            if (currentFileContent === undefined) {
                currentFileContent = text;
                currentFileContentToRawSegments = [
                    {
                        contentStart: 0,
                        contentEnd: text.length,
                        rawStart: lineStartRawOffset + 4,
                    },
                ];
            } else {
                const newlineContentOffset = currentFileContent.length;
                currentFileContent = currentFileContent + '\n' + text;

                if (lastFourSlashLineLfOffset === undefined) {
                    throw new Error(`Missing line feed mapping for four-slash line ending at line ${i - 1}`);
                }

                currentFileContentToRawSegments.push({
                    contentStart: newlineContentOffset,
                    contentEnd: newlineContentOffset + 1,
                    rawStart: lastFourSlashLineLfOffset,
                });

                const textContentStart = newlineContentOffset + 1;
                currentFileContentToRawSegments.push({
                    contentStart: textContentStart,
                    contentEnd: textContentStart + text.length,
                    rawStart: lineStartRawOffset + 4,
                });
            }

            // Record the raw offset of the '\n' for this line (used if another four-slash line follows).
            lastFourSlashLineLfOffset = hasLf ? lineStartRawOffset + lineWithPotentialCr.length : undefined;
        } else if (line.substr(0, 3) === '///' && currentFileContent !== undefined) {
            throw new Error(`Three-slash line in the middle of four-slash region at line ${i}`);
        } else if (line.substr(0, 2) === '//') {
            // Comment line, check for global/file @options and record them
            const directive = tryParseOptionDirective(line.substr(2));
            if (directive) {
                const key = directive.key.toLowerCase();
                const value = directive.value;
                const directiveRawData = tokenizeResult.directiveRawData;

                if (!contains(fileMetadataNames, key)) {
                    // Check if the match is already existed in the global options
                    if (globalOptions[key] !== undefined) {
                        throw new Error(`Global option '${key}' already exists`);
                    }
                    globalOptions[key] = value;

                    if (directiveRawData) {
                        globalOptionsRawData[key] = directiveRawData;
                    }

                    if (key === GlobalMetadataOptionNames.projectRoot) {
                        normalizedProjectRoot = combinePaths(normalizedBasePath, value);
                    }
                } else {
                    switch (key) {
                        case MetadataOptionNames.fileName: {
                            // Found an @FileName directive, if this is not the first then create a new subfile
                            nextFile();
                            const normalizedPath = normalizeSlashes(value);
                            currentFileName = isRootedDiskPath(normalizedPath)
                                ? normalizedPath
                                : combinePaths(normalizedProjectRoot, normalizedPath);
                            currentFileOptions[key] = value;
                            if (directiveRawData) {
                                currentFileOptionsRawData[key] = directiveRawData;
                            }
                            break;
                        }
                        default:
                            // Add other fileMetadata flag
                            currentFileOptions[key] = value;
                            if (directiveRawData) {
                                currentFileOptionsRawData[key] = directiveRawData;
                            }
                    }
                }
            }
        } else if (line !== '' || i === lines.length) {
            // Previously blank lines between fourslash content caused it to be considered as 2 files,
            // Remove this behavior since it just causes errors now
            //
            // Code line, terminate current subfile if there is one
            nextFile();
        }

        rawOffset += lineWithPotentialCr.length + (hasLf ? 1 : 0);
    }

    return {
        markerPositions,
        markers,
        globalOptions,
        globalOptionsRawData,
        files,
        ranges,
        rawText,
        rawTokens,
    };
}

interface ContentToRawSegment {
    contentStart: number;
    contentEnd: number;
    rawStart: number;
}

interface ParsedOptionDirective {
    key: string;
    value: string;
}

function tryParseOptionDirective(textAfterTwoSlash: string): ParsedOptionDirective | undefined {
    // Matches the legacy behavior of: /^\s*@(\w+):\s*(.*)\s*/
    let i = 0;
    while (i < textAfterTwoSlash.length && /\s/.test(textAfterTwoSlash[i])) {
        i++;
    }

    if (i >= textAfterTwoSlash.length || textAfterTwoSlash[i] !== '@') {
        return undefined;
    }

    i++;
    const nameStart = i;
    while (i < textAfterTwoSlash.length && /\w/.test(textAfterTwoSlash[i])) {
        i++;
    }

    if (i === nameStart) {
        return undefined;
    }

    const key = textAfterTwoSlash.substring(nameStart, i);
    while (i < textAfterTwoSlash.length && /\s/.test(textAfterTwoSlash[i])) {
        i++;
    }

    if (i >= textAfterTwoSlash.length || textAfterTwoSlash[i] !== ':') {
        return undefined;
    }

    i++;
    while (i < textAfterTwoSlash.length && /\s/.test(textAfterTwoSlash[i])) {
        i++;
    }

    const valueStart = i;
    let valueEnd = textAfterTwoSlash.length;
    while (valueEnd > valueStart && /\s/.test(textAfterTwoSlash[valueEnd - 1])) {
        valueEnd--;
    }

    const value = textAfterTwoSlash.substring(valueStart, valueEnd);
    return { key, value };
}

interface TokenizeRawLineResult {
    directiveRawData?: CompilerSettingRawData | undefined;
}

function tokenizeRawLine(
    rawText: string,
    rawTokens: RawToken[],
    lineStartRawOffset: number,
    lineTextIncludingOptionalCR: string,
    hasLf: boolean
): TokenizeRawLineResult {
    const lineTokenStart = rawTokens.length;

    const hasCr = lineTextIncludingOptionalCR.length > 0 && lineTextIncludingOptionalCR.endsWith('\r');
    const lineBody = hasCr
        ? lineTextIncludingOptionalCR.substring(0, lineTextIncludingOptionalCR.length - 1)
        : lineTextIncludingOptionalCR;

    const lineBodyStart = lineStartRawOffset;
    const lineBodyEnd = lineStartRawOffset + lineBody.length;
    let directiveRawData: CompilerSettingRawData | undefined;

    const push = (kind: RawTokenKind, start: number, end: number) => {
        if (start < end) {
            rawTokens.push({ kind, start, end });
        }
    };

    const tokenizePlain = (start: number, end: number) => {
        let pos = start;
        while (pos < end) {
            const ch = rawText[pos];
            if (ch === ' ' || ch === '\t') {
                const wsStart = pos;
                pos++;
                while (pos < end && (rawText[pos] === ' ' || rawText[pos] === '\t')) {
                    pos++;
                }
                push(RawTokenKind.Whitespace, wsStart, pos);
            } else {
                const textStart = pos;
                pos++;
                while (pos < end && rawText[pos] !== ' ' && rawText[pos] !== '\t') {
                    pos++;
                }
                push(RawTokenKind.Text, textStart, pos);
            }
        }
    };

    if (lineBody.startsWith('////')) {
        push(RawTokenKind.FourSlashPrefix, lineBodyStart, lineBodyStart + 4);
        tokenizeFourSlashRemainder(rawText, rawTokens, lineBodyStart + 4, lineBodyEnd);
    } else if (lineBody.startsWith('//')) {
        const prefixStartToken = rawTokens.length;
        push(RawTokenKind.TwoSlashPrefix, lineBodyStart, lineBodyStart + 2);

        const afterPrefixStart = lineBodyStart + 2;
        const afterPrefixText = rawText.substring(afterPrefixStart, lineBodyEnd);
        const directive = tryParseOptionDirective(afterPrefixText);
        if (!directive) {
            tokenizePlain(afterPrefixStart, lineBodyEnd);
        } else {
            const isWhitespaceNotNewline = (ch: string) => /\s/.test(ch) && ch !== '\r' && ch !== '\n';

            const consumeWhitespaceTokens = (pos: number, stopChar?: string): number => {
                while (
                    pos < lineBodyEnd &&
                    isWhitespaceNotNewline(rawText[pos]) &&
                    (stopChar === undefined || rawText[pos] !== stopChar)
                ) {
                    const wsStart = pos;
                    pos++;
                    while (
                        pos < lineBodyEnd &&
                        isWhitespaceNotNewline(rawText[pos]) &&
                        (stopChar === undefined || rawText[pos] !== stopChar)
                    ) {
                        pos++;
                    }
                    push(RawTokenKind.Whitespace, wsStart, pos);
                }

                return pos;
            };

            // Tokenize with directive structure. This keeps token spans aligned to the stored value.
            let pos = afterPrefixStart;

            // Leading whitespace.
            pos = consumeWhitespaceTokens(pos);

            const atStartToken = rawTokens.length;
            push(RawTokenKind.DirectiveAt, pos, pos + 1);
            pos++;

            const nameStart = pos;
            while (pos < lineBodyEnd && /\w/.test(rawText[pos])) {
                pos++;
            }
            const nameTokenIndex = rawTokens.length;
            push(RawTokenKind.DirectiveName, nameStart, pos);

            // Whitespace before ':'
            pos = consumeWhitespaceTokens(pos, ':');

            const colonTokenIndex = rawTokens.length;
            push(RawTokenKind.DirectiveColon, pos, pos + 1);
            pos++;

            // Whitespace after ':'
            pos = consumeWhitespaceTokens(pos);

            const valueStart = pos;
            let valueEnd = lineBodyEnd;
            while (valueEnd > valueStart && /\s/.test(rawText[valueEnd - 1])) {
                valueEnd--;
            }

            const valueTokenStart = rawTokens.length;
            push(RawTokenKind.DirectiveValue, valueStart, valueEnd);
            const valueTokenEnd = rawTokens.length;

            // Trailing whitespace.
            tokenizePlain(valueEnd, lineBodyEnd);

            directiveRawData = {
                directiveLine: { startToken: lineTokenStart, endToken: -1 },
                prefix: { startToken: prefixStartToken, endToken: prefixStartToken + 1 },
                name: { startToken: atStartToken, endToken: nameTokenIndex + 1 },
                colon: { startToken: colonTokenIndex, endToken: colonTokenIndex + 1 },
                value: { startToken: valueTokenStart, endToken: valueTokenEnd },
            };
        }
    } else {
        tokenizePlain(lineBodyStart, lineBodyEnd);
    }

    // CR and LF are tokenized separately.
    if (hasCr) {
        push(RawTokenKind.NewLineCR, lineBodyEnd, lineBodyEnd + 1);
    }
    if (hasLf) {
        const lfStart = lineStartRawOffset + lineTextIncludingOptionalCR.length;
        push(RawTokenKind.NewLineLF, lfStart, lfStart + 1);
    }

    const lineTokenEnd = rawTokens.length;
    if (directiveRawData) {
        directiveRawData.directiveLine.endToken = lineTokenEnd;
    }

    return { directiveRawData };
}

function tokenizeFourSlashRemainder(rawText: string, rawTokens: RawToken[], start: number, end: number): void {
    const push = (kind: RawTokenKind, s: number, e: number) => {
        if (s < e) {
            rawTokens.push({ kind, start: s, end: e });
        }
    };

    const validMarkerChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz$1234567890_';

    let pos = start;
    while (pos < end) {
        const ch = rawText[pos];
        if (ch === ' ' || ch === '\t') {
            const wsStart = pos;
            pos++;
            while (pos < end && (rawText[pos] === ' ' || rawText[pos] === '\t')) {
                pos++;
            }
            push(RawTokenKind.Whitespace, wsStart, pos);
            continue;
        }

        // Range delimiters.
        if (pos + 1 < end && rawText[pos] === '[' && rawText[pos + 1] === '|') {
            push(RawTokenKind.RangeStart, pos, pos + 2);
            pos += 2;
            continue;
        }
        if (pos + 1 < end && rawText[pos] === '|' && rawText[pos + 1] === ']') {
            push(RawTokenKind.RangeEnd, pos, pos + 2);
            pos += 2;
            continue;
        }

        // Object markers.
        if (pos + 1 < end && rawText[pos] === '{' && rawText[pos + 1] === '|') {
            const closeIndex = rawText.indexOf('|}', pos + 2);
            if (closeIndex >= 0 && closeIndex + 2 <= end) {
                push(RawTokenKind.ObjectMarkerStart, pos, pos + 2);
                if (pos + 2 < closeIndex) {
                    push(RawTokenKind.ObjectMarkerText, pos + 2, closeIndex);
                }
                push(RawTokenKind.ObjectMarkerEnd, closeIndex, closeIndex + 2);
                pos = closeIndex + 2;
                continue;
            }
        }

        // Slash-star markers.
        if (pos + 1 < end && rawText[pos] === '/' && rawText[pos + 1] === '*') {
            const closeIndex = rawText.indexOf('*/', pos + 2);
            if (closeIndex >= 0 && closeIndex + 2 <= end) {
                let isValidMarker = true;
                for (let j = pos + 2; j < closeIndex; j++) {
                    if (validMarkerChars.indexOf(rawText[j]) < 0) {
                        isValidMarker = false;
                        break;
                    }
                }

                if (isValidMarker) {
                    push(RawTokenKind.MarkerStart, pos, pos + 2);
                    if (pos + 2 < closeIndex) {
                        push(RawTokenKind.MarkerName, pos + 2, closeIndex);
                    }
                    push(RawTokenKind.MarkerEnd, closeIndex, closeIndex + 2);
                    pos = closeIndex + 2;
                    continue;
                }
            }
        }

        // Plain text chunk until whitespace or a known delimiter.
        const textStart = pos;
        pos++;
        while (pos < end) {
            const c = rawText[pos];
            if (c === ' ' || c === '\t') {
                break;
            }
            if (pos + 1 < end) {
                const c2 = rawText[pos + 1];
                if (
                    (c === '[' && c2 === '|') ||
                    (c === '|' && c2 === ']') ||
                    (c === '{' && c2 === '|') ||
                    (c === '|' && c2 === '}') ||
                    (c === '/' && c2 === '*') ||
                    (c === '*' && c2 === '/')
                ) {
                    break;
                }
            }
            pos++;
        }
        push(RawTokenKind.Text, textStart, pos);
    }
}

interface LocationInformation {
    position: number;
    sourcePosition: number;
    sourceLine: number;
    sourceColumn: number;
}

interface RangeLocationInformation extends LocationInformation {
    marker?: Marker | undefined;
    rawOpen?: RawSpan | undefined;
}

const enum State {
    none,
    inSlashStarMarker,
    inObjectMarker,
}

function reportError(fileName: string, line: number, col: number, message: string) {
    const errorMessage = `${fileName}(${line},${col}): ${message}`;
    throw new Error(errorMessage);
}

function recordObjectMarker(
    fileName: string,
    ignoreCase: boolean,
    location: LocationInformation,
    text: string,
    markerMap: Map<string, Marker>,
    markers: Marker[],
    rawData?: Marker['rawData']
): Marker | undefined {
    let markerValue: unknown;
    try {
        // Attempt to parse the marker value as JSON
        markerValue = JSON.parse('{ ' + text + ' }') as unknown;
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        reportError(fileName, location.sourceLine, location.sourceColumn, `Unable to parse marker text ${message}`);
    }

    if (markerValue === undefined || markerValue === null || typeof markerValue !== 'object') {
        reportError(fileName, location.sourceLine, location.sourceColumn, 'Object markers can not be empty');
        return undefined;
    }

    const markerData = markerValue as {};

    const marker: Marker = {
        fileName,
        fileUri: UriEx.file(fileName, !ignoreCase),
        position: location.position,
        data: markerData,
        rawData,
    };

    // Object markers can be anonymous
    const markerNameValue = (markerValue as Record<string, unknown>).name;
    if (markerNameValue) {
        // Preserve legacy behavior: this may not be a string at runtime.
        markerMap.set(markerNameValue as unknown as string, marker);
    }

    markers.push(marker);

    return marker;
}

function recordMarker(
    fileName: string,
    ignoreCase: boolean,
    location: LocationInformation,
    name: string,
    markerMap: Map<string, Marker>,
    markers: Marker[],
    rawData?: Marker['rawData']
): Marker | undefined {
    const marker: Marker = {
        fileName,
        fileUri: UriEx.file(fileName, !ignoreCase),
        position: location.position,
        rawData,
    };

    // Verify markers for uniqueness
    if (markerMap.has(name)) {
        const message = "Marker '" + name + "' is duplicated in the source file contents.";
        reportError(marker.fileName, location.sourceLine, location.sourceColumn, message);
        return undefined;
    } else {
        markerMap.set(name, marker);
        markers.push(marker);
        return marker;
    }
}

function parseFileContent(
    content: string,
    contentToRawSegments: ContentToRawSegment[],
    rawTokens: RawToken[],
    fileName: string,
    ignoreCase: boolean,
    markerMap: Map<string, Marker>,
    markers: Marker[],
    ranges: Range[]
): FourSlashFile {
    ({ content, segments: contentToRawSegments } = chompLeadingSpaceWithMapping(content, contentToRawSegments));

    // Any slash-star comment with a character not in this string is not a marker.
    const validMarkerChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz$1234567890_';

    /// The file content (minus metacharacters) so far
    let output = '';

    // Mapping segments for the final FourSlashFile.content -> rawText offsets.
    const contentToRawOutputSegments: RawContentMappingSegment[] = [];

    /// The current marker (or maybe multi-line comment?) we're parsing, possibly
    let openMarker: LocationInformation | undefined;

    /// A stack of the open range markers that are still unclosed
    const openRanges: RangeLocationInformation[] = [];

    /// A list of ranges we've collected so far */
    let localRanges: Range[] = [];

    /// The latest position of the start of an unflushed plain text area
    let lastNormalCharPosition = 0;

    /// The total number of metacharacters removed from the file (so far)
    let difference = 0;

    /// The fourslash file state object we are generating
    let state: State = State.none;

    /// Current position data
    let line = 1;
    let column = 1;

    const flush = (lastSafeCharIndex: number | undefined) => {
        const safeIndex = lastSafeCharIndex ?? content.length;
        if (safeIndex <= lastNormalCharPosition) {
            return;
        }

        const outputStart = output.length;
        output = output + content.substring(lastNormalCharPosition, safeIndex);
        appendOutputMappingSegments(
            contentToRawSegments,
            lastNormalCharPosition,
            safeIndex,
            outputStart,
            contentToRawOutputSegments
        );
    };

    if (content.length > 0) {
        let previousChar = content.charAt(0);
        for (let i = 1; i < content.length; i++) {
            const currentChar = content.charAt(i);
            switch (state) {
                case State.none:
                    if (previousChar === '[' && currentChar === '|') {
                        // found a range start
                        const rawOpen = getRawSpanFromContentSpan(contentToRawSegments, i - 1, i + 1);
                        openRanges.push({
                            position: i - 1 - difference,
                            sourcePosition: i - 1,
                            sourceLine: line,
                            sourceColumn: column,
                            rawOpen,
                        });
                        // copy all text up to marker position
                        flush(i - 1);
                        lastNormalCharPosition = i + 1;
                        difference += 2;
                    } else if (previousChar === '|' && currentChar === ']') {
                        // found a range end
                        const rangeStart = openRanges.pop();
                        if (!rangeStart) {
                            reportError(fileName, line, column, 'Found range end with no matching start.');
                        }

                        const rawClose = getRawSpanFromContentSpan(contentToRawSegments, i - 1, i + 1);
                        const rawSelectedStart = rangeStart!.rawOpen?.rawEnd ?? rawClose.rawStart;
                        const rawSelectedEnd = rawClose.rawStart;
                        const rawFullStart = rangeStart!.rawOpen?.rawStart ?? rawClose.rawStart;
                        const rawFullEnd = rawClose.rawEnd;

                        const range: Range = {
                            fileName,
                            fileUri: UriEx.file(fileName, !ignoreCase),
                            pos: rangeStart!.position,
                            end: i - 1 - difference,
                            marker: rangeStart!.marker,
                            rawData: {
                                full: getTokenRangeCoveringRawSpan(rawTokens, rawFullStart, rawFullEnd),
                                open: getTokenRangeCoveringRawSpan(
                                    rawTokens,
                                    rangeStart!.rawOpen?.rawStart ?? rawClose.rawStart,
                                    rangeStart!.rawOpen?.rawEnd ?? rawClose.rawStart
                                ),
                                selected: getTokenRangeCoveringRawSpan(rawTokens, rawSelectedStart, rawSelectedEnd),
                                close: getTokenRangeCoveringRawSpan(rawTokens, rawClose.rawStart, rawClose.rawEnd),
                            },
                        };
                        localRanges.push(range);

                        // copy all text up to range marker position
                        flush(i - 1);
                        lastNormalCharPosition = i + 1;
                        difference += 2;
                    } else if (previousChar === '/' && currentChar === '*') {
                        // found a possible marker start
                        state = State.inSlashStarMarker;
                        openMarker = {
                            position: i - 1 - difference,
                            sourcePosition: i - 1,
                            sourceLine: line,
                            sourceColumn: column,
                        };
                    } else if (previousChar === '{' && currentChar === '|') {
                        // found an object marker start
                        state = State.inObjectMarker;
                        openMarker = {
                            position: i - 1 - difference,
                            sourcePosition: i - 1,
                            sourceLine: line,
                            sourceColumn: column,
                        };
                        flush(i - 1);
                    }
                    break;

                case State.inObjectMarker:
                    // Object markers are only ever terminated by |} and have no content restrictions
                    if (previousChar === '|' && currentChar === '}') {
                        const rawFull = getRawSpanFromContentSpan(
                            contentToRawSegments,
                            openMarker!.sourcePosition,
                            i + 1
                        );
                        const rawStart = getRawSpanFromContentSpan(
                            contentToRawSegments,
                            openMarker!.sourcePosition,
                            openMarker!.sourcePosition + 2
                        );
                        const rawEnd = getRawSpanFromContentSpan(contentToRawSegments, i - 1, i + 1);
                        const rawTextSpan = getRawSpanFromContentSpan(
                            contentToRawSegments,
                            openMarker!.sourcePosition + 2,
                            i - 1
                        );

                        // Record the marker
                        const objectMarkerNameText = content.substring(openMarker!.sourcePosition + 2, i - 1).trim();
                        const marker = recordObjectMarker(
                            fileName,
                            ignoreCase,
                            openMarker!,
                            objectMarkerNameText,
                            markerMap,
                            markers,
                            {
                                kind: 'object',
                                full: getTokenRangeCoveringRawSpan(rawTokens, rawFull.rawStart, rawFull.rawEnd),
                                start: getTokenRangeCoveringRawSpan(rawTokens, rawStart.rawStart, rawStart.rawEnd),
                                text: getTokenRangeCoveringRawSpan(rawTokens, rawTextSpan.rawStart, rawTextSpan.rawEnd),
                                end: getTokenRangeCoveringRawSpan(rawTokens, rawEnd.rawStart, rawEnd.rawEnd),
                            }
                        );

                        if (openRanges.length > 0) {
                            openRanges[openRanges.length - 1].marker = marker;
                        }

                        // Set the current start to point to the end of the current marker to ignore its text
                        lastNormalCharPosition = i + 1;
                        difference += i + 1 - openMarker!.sourcePosition;

                        // Reset the state
                        openMarker = undefined;
                        state = State.none;
                    }
                    break;

                case State.inSlashStarMarker:
                    if (previousChar === '*' && currentChar === '/') {
                        const rawFull = getRawSpanFromContentSpan(
                            contentToRawSegments,
                            openMarker!.sourcePosition,
                            i + 1
                        );
                        const rawStart = getRawSpanFromContentSpan(
                            contentToRawSegments,
                            openMarker!.sourcePosition,
                            openMarker!.sourcePosition + 2
                        );
                        const rawEnd = getRawSpanFromContentSpan(contentToRawSegments, i - 1, i + 1);
                        const rawNameSpan = getRawSpanFromContentSpan(
                            contentToRawSegments,
                            openMarker!.sourcePosition + 2,
                            i - 1
                        );

                        // Record the marker
                        // start + 2 to ignore the */, -1 on the end to ignore the * (/ is next)
                        const markerNameText = content.substring(openMarker!.sourcePosition + 2, i - 1).trim();
                        const marker = recordMarker(
                            fileName,
                            ignoreCase,
                            openMarker!,
                            markerNameText,
                            markerMap,
                            markers,
                            {
                                kind: 'slashStar',
                                full: getTokenRangeCoveringRawSpan(rawTokens, rawFull.rawStart, rawFull.rawEnd),
                                start: getTokenRangeCoveringRawSpan(rawTokens, rawStart.rawStart, rawStart.rawEnd),
                                name: getTokenRangeCoveringRawSpan(rawTokens, rawNameSpan.rawStart, rawNameSpan.rawEnd),
                                end: getTokenRangeCoveringRawSpan(rawTokens, rawEnd.rawStart, rawEnd.rawEnd),
                            }
                        );

                        if (openRanges.length > 0) {
                            openRanges[openRanges.length - 1].marker = marker;
                        }

                        // Set the current start to point to the end of the current marker to ignore its text
                        flush(openMarker!.sourcePosition);
                        lastNormalCharPosition = i + 1;
                        difference += i + 1 - openMarker!.sourcePosition;

                        // Reset the state
                        openMarker = undefined;
                        state = State.none;
                    } else if (validMarkerChars.indexOf(currentChar) < 0) {
                        if (currentChar === '*' && i < content.length - 1 && content.charAt(i + 1) === '/') {
                            // The marker is about to be closed, ignore the 'invalid' char
                        } else {
                            // We've hit a non-valid marker character, so we were actually in a block comment
                            // Bail out the text we've gathered so far back into the output
                            flush(i);
                            lastNormalCharPosition = i;
                            openMarker = undefined;

                            state = State.none;
                        }
                    }
                    break;
            }

            if (currentChar === '\n' && previousChar === '\r') {
                // Ignore trailing \n after a \r
                continue;
            } else if (currentChar === '\n' || currentChar === '\r') {
                line++;
                column = 1;
                continue;
            }

            column++;
            previousChar = currentChar;
        }
    }

    // Add the remaining text
    flush(/* lastSafeCharIndex */ undefined);

    if (openRanges.length > 0) {
        const openRange = openRanges[0];
        reportError(fileName, openRange.sourceLine, openRange.sourceColumn, 'Unterminated range.');
    }

    if (openMarker) {
        reportError(fileName, openMarker.sourceLine, openMarker.sourceColumn, 'Unterminated marker.');
    }

    // put ranges in the correct order
    localRanges = localRanges.sort((a, b) => (a.pos < b.pos ? -1 : a.pos === b.pos && a.end > b.end ? -1 : 1));
    localRanges.forEach((r) => {
        ranges.push(r);
    });

    const contentToRaw: RawContentMapping = { segments: contentToRawOutputSegments };
    const rawToContent: RawContentMapping = { segments: contentToRawOutputSegments };

    return {
        content: output,
        fileOptions: {},
        version: 0,
        fileName,
        fileUri: UriEx.file(fileName, !ignoreCase),
        rawData: {
            tokenRanges: [],
            rawToContent,
            contentToRaw,
        },
    };
}

interface RawSpan {
    rawStart: number;
    rawEnd: number;
}

function getRawSpanFromContentSpan(segments: ContentToRawSegment[], contentStart: number, contentEnd: number): RawSpan {
    if (contentStart === contentEnd) {
        const rawOffset = tryGetRawOffsetFromContentIndex(segments, contentStart) ?? 0;
        return { rawStart: rawOffset, rawEnd: rawOffset };
    }

    const rawStart = tryGetRawOffsetFromContentIndex(segments, contentStart) ?? 0;
    const rawLast = tryGetRawOffsetFromContentIndex(segments, contentEnd - 1) ?? rawStart;
    return { rawStart, rawEnd: rawLast + 1 };
}

function tryGetRawOffsetFromContentIndex(segments: ContentToRawSegment[], contentIndex: number): number | undefined {
    const seg = findItemContainingOffset(
        segments,
        contentIndex,
        (s) => s.contentStart,
        (s) => s.contentEnd
    );
    if (!seg) {
        return undefined;
    }

    return seg.rawStart + (contentIndex - seg.contentStart);
}

function getTokenRangeCoveringRawSpan(rawTokens: RawToken[], rawStart: number, rawEnd: number): RawTokenRange {
    if (rawStart === rawEnd) {
        const tokenIndex = findTokenIndexAtOrAfter(rawTokens, rawStart);
        return { startToken: tokenIndex, endToken: tokenIndex };
    }

    const startToken = findTokenIndexAtOrAfter(rawTokens, rawStart);
    const endToken = findTokenIndexAtOrAfter(rawTokens, rawEnd);
    return { startToken, endToken };
}

function appendOutputMappingSegments(
    sourceSegments: ContentToRawSegment[],
    sourceStart: number,
    sourceEnd: number,
    outputStart: number,
    out: RawContentMappingSegment[]
): void {
    for (const seg of sourceSegments) {
        const overlapStart = Math.max(sourceStart, seg.contentStart);
        const overlapEnd = Math.min(sourceEnd, seg.contentEnd);
        if (overlapStart >= overlapEnd) {
            continue;
        }

        const overlapLen = overlapEnd - overlapStart;
        const rawStart = seg.rawStart + (overlapStart - seg.contentStart);
        const contentStart = outputStart + (overlapStart - sourceStart);
        out.push({
            rawStart,
            rawEnd: rawStart + overlapLen,
            contentStart,
            contentEnd: contentStart + overlapLen,
        });
    }
}

function chompLeadingSpaceWithMapping(
    content: string,
    contentToRawSegments: ContentToRawSegment[]
): { content: string; segments: ContentToRawSegment[] } {
    const lines = content.split('\n');
    for (const line of lines) {
        if (line.length !== 0 && line.charAt(0) !== ' ') {
            return { content, segments: contentToRawSegments };
        }
    }

    // Remove one leading space from each line.
    const newContent = lines.map((s) => s.substr(1)).join('\n');

    // Rebuild mapping segments by walking line-by-line over the original content.
    const newSegments: ContentToRawSegment[] = [];
    let sourcePos = 0;
    let outPos = 0;
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        const lineStart = sourcePos;
        const lineEnd = lineStart + line.length;

        // Keep everything after the removed leading space.
        if (line.length > 0) {
            const keepStart = lineStart + 1;
            const keepEnd = lineEnd;
            appendChompedSegments(contentToRawSegments, keepStart, keepEnd, outPos, newSegments);
            outPos += keepEnd - keepStart;
        }

        sourcePos = lineEnd;

        // Keep newline except for the final line.
        if (lineIndex < lines.length - 1) {
            appendChompedSegments(contentToRawSegments, sourcePos, sourcePos + 1, outPos, newSegments);
            sourcePos += 1;
            outPos += 1;
        }
    }

    return { content: newContent, segments: newSegments };
}

function appendChompedSegments(
    sourceSegments: ContentToRawSegment[],
    sourceStart: number,
    sourceEnd: number,
    outputStart: number,
    out: ContentToRawSegment[]
): void {
    for (const seg of sourceSegments) {
        const overlapStart = Math.max(sourceStart, seg.contentStart);
        const overlapEnd = Math.min(sourceEnd, seg.contentEnd);
        if (overlapStart >= overlapEnd) {
            continue;
        }

        const overlapLen = overlapEnd - overlapStart;
        const rawStart = seg.rawStart + (overlapStart - seg.contentStart);
        const contentStart = outputStart + (overlapStart - sourceStart);
        out.push({
            contentStart,
            contentEnd: contentStart + overlapLen,
            rawStart,
        });
    }
}
