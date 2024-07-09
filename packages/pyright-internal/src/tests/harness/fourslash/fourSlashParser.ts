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
    FourSlashData,
    FourSlashFile,
    GlobalMetadataOptionNames,
    Marker,
    MetadataOptionNames,
    Range,
    fileMetadataNames,
} from './fourSlashTypes';

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

    // Regex for parsing options in the format "@Alpha: Value of any sort"
    const optionRegex = /^\s*@(\w+):\s*(.*)\s*/;

    // List of all the subfiles we've parsed out
    const files: FourSlashFile[] = [];
    // Global options
    const globalOptions: { [s: string]: string } = {};
    // Marker positions

    // Split up the input file by line
    // Note: IE JS engine incorrectly handles consecutive delimiters here when using RegExp split, so
    // we have to string-based splitting instead and try to figure out the delimiting chars
    const lines = contents.split('\n');
    let i = 0;

    const markerPositions = new Map<string, Marker>();
    const markers: Marker[] = [];
    const ranges: Range[] = [];

    // Stuff related to the subfile we're parsing
    let currentFileContent: string | undefined;
    let currentFileName = normalizeSlashes(fileName);
    let currentFileOptions: { [s: string]: string } = {};

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
            currentFileName,
            ignoreCase,
            markerPositions,
            markers,
            ranges
        );
        file.fileOptions = currentFileOptions;

        // Store result file
        files.push(file);

        currentFileContent = undefined;
        currentFileOptions = {};
        currentFileName = fileName;
    }

    for (let line of lines) {
        i++;
        if (line.length > 0 && line.charAt(line.length - 1) === '\r') {
            line = line.substr(0, line.length - 1);
        }

        if (line.substr(0, 4) === '////') {
            const text = line.substr(4);
            currentFileContent = currentFileContent === undefined ? text : currentFileContent + '\n' + text;
        } else if (line.substr(0, 3) === '///' && currentFileContent !== undefined) {
            throw new Error(`Three-slash line in the middle of four-slash region at line ${i}`);
        } else if (line.substr(0, 2) === '//') {
            // Comment line, check for global/file @options and record them
            const match = optionRegex.exec(line.substr(2));
            if (match) {
                const key = match[1].toLowerCase();
                const value = match[2];
                if (!contains(fileMetadataNames, key)) {
                    // Check if the match is already existed in the global options
                    if (globalOptions[key] !== undefined) {
                        throw new Error(`Global option '${key}' already exists`);
                    }
                    globalOptions[key] = value;

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
                            break;
                        }
                        default:
                            // Add other fileMetadata flag
                            currentFileOptions[key] = value;
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
    }

    return {
        markerPositions,
        markers,
        globalOptions,
        files,
        ranges,
    };
}

interface LocationInformation {
    position: number;
    sourcePosition: number;
    sourceLine: number;
    sourceColumn: number;
}

interface RangeLocationInformation extends LocationInformation {
    marker?: Marker | undefined;
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
    markers: Marker[]
): Marker | undefined {
    let markerValue: any;
    try {
        // Attempt to parse the marker value as JSON
        markerValue = JSON.parse('{ ' + text + ' }');
    } catch (e: any) {
        reportError(fileName, location.sourceLine, location.sourceColumn, `Unable to parse marker text ${e.message}`);
    }

    if (markerValue === undefined) {
        reportError(fileName, location.sourceLine, location.sourceColumn, 'Object markers can not be empty');
        return undefined;
    }

    const marker: Marker = {
        fileName,
        fileUri: UriEx.file(fileName, !ignoreCase),
        position: location.position,
        data: markerValue,
    };

    // Object markers can be anonymous
    if (markerValue.name) {
        markerMap.set(markerValue.name, marker);
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
    markers: Marker[]
): Marker | undefined {
    const marker: Marker = {
        fileName,
        fileUri: UriEx.file(fileName, !ignoreCase),
        position: location.position,
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
    fileName: string,
    ignoreCase: boolean,
    markerMap: Map<string, Marker>,
    markers: Marker[],
    ranges: Range[]
): FourSlashFile {
    content = chompLeadingSpace(content);

    // Any slash-star comment with a character not in this string is not a marker.
    const validMarkerChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz$1234567890_';

    /// The file content (minus metacharacters) so far
    let output = '';

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
        output =
            output +
            content.substr(
                lastNormalCharPosition,
                lastSafeCharIndex === undefined ? undefined : lastSafeCharIndex - lastNormalCharPosition
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
                        openRanges.push({
                            position: i - 1 - difference,
                            sourcePosition: i - 1,
                            sourceLine: line,
                            sourceColumn: column,
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

                        const range: Range = {
                            fileName,
                            fileUri: UriEx.file(fileName, !ignoreCase),
                            pos: rangeStart!.position,
                            end: i - 1 - difference,
                            marker: rangeStart!.marker,
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
                        // Record the marker
                        const objectMarkerNameText = content.substring(openMarker!.sourcePosition + 2, i - 1).trim();
                        const marker = recordObjectMarker(
                            fileName,
                            ignoreCase,
                            openMarker!,
                            objectMarkerNameText,
                            markerMap,
                            markers
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
                        // Record the marker
                        // start + 2 to ignore the */, -1 on the end to ignore the * (/ is next)
                        const markerNameText = content.substring(openMarker!.sourcePosition + 2, i - 1).trim();
                        const marker = recordMarker(
                            fileName,
                            ignoreCase,
                            openMarker!,
                            markerNameText,
                            markerMap,
                            markers
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

    return {
        content: output,
        fileOptions: {},
        version: 0,
        fileName,
        fileUri: UriEx.file(fileName, !ignoreCase),
    };
}

function chompLeadingSpace(content: string) {
    const lines = content.split('\n');
    for (const line of lines) {
        if (line.length !== 0 && line.charAt(0) !== ' ') {
            return content;
        }
    }

    return lines.map((s) => s.substr(1)).join('\n');
}
