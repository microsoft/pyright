/*
* textRange.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Specifies the range of text within a larger string.
*/
import * as lsp from 'vscode-languageserver';

export interface TextRange {
    start: number;
    length: number;
}

export namespace TextRange {
    export function create(start: number, length: number): TextRange {
        if (start < 0) {
            throw new Error('start must be non-negative');
        }
        if (length < 0) {
            throw new Error('length must be non-negative');
        }
        return { start, length };
    }

    export function fromBounds(start: number, end: number): TextRange {
        if (start < 0) {
            throw new Error('start must be non-negative');
        }
        if (start > end) {
            throw new Error('end must be greater than or equal to start');
        }
        return create(start, end - start);
    }

    export function getEnd(range: TextRange): number {
        return range.start + range.length;
    }

    export function contains(range: TextRange, position: number): boolean {
        return position >= range.start && position < getEnd(range);
    }

    export function extend(range: TextRange, extension: TextRange | TextRange[] | undefined) {
        if (extension) {
            if (Array.isArray(extension)) {
                extension.forEach(r => {
                    extend(range, r);
                });
            } else {
                if (extension.start < range.start) {
                    range.length += range.start - extension.start;
                    range.start = extension.start;
                }

                if (getEnd(extension) > getEnd(range)) {
                    range.length += getEnd(extension) - getEnd(range);
                }
            }
        }
    }
}

export interface LineAndColumn {
    // Both line and column are zero-based
    line: number;
    character: number;
}

export interface LineAndColumnRange {
    start: LineAndColumn;
    end: LineAndColumn;
}

export function comparePositions(a: LineAndColumn, b: LineAndColumn) {
    if (a.line < b.line) {
        return -1;
    } else if (a.line > b.line) {
        return 1;
    } else if (a.character < b.character) {
        return -1;
    } else if (a.character > b.character) {
        return 1;
    }
    return 0;
}

export function getEmptyPosition(): LineAndColumn {
    return {
        line: 0,
        character: 0
    };
}

export function doRangesOverlap(a: LineAndColumnRange, b: LineAndColumnRange) {
    if (comparePositions(b.start, a.end) >= 0) {
        return false;
    } else if (comparePositions(a.start, b.end) >= 0) {
        return false;
    }
    return true;
}

export function doesRangeContain(range: LineAndColumnRange, position: LineAndColumn) {
    return comparePositions(range.start, position) >= 0 &&
        comparePositions(range.end, position) <= 0;
}

export function rangesAreEqual(a: LineAndColumnRange, b: LineAndColumnRange) {
    return comparePositions(a.start, b.start) === 0 && comparePositions(a.end, b.end) === 0;
}

export function getEmptyRange(): LineAndColumnRange {
    return {
        start: getEmptyPosition(),
        end: getEmptyPosition()
    };
}

// Represents a range within a particular document.
export interface DocumentLineAndColumnRange {
    path: string;
    range: LineAndColumnRange;
}

export function convertRange(range?: LineAndColumnRange): lsp.Range {
    if (!range) {
        return lsp.Range.create(convertPosition(), convertPosition());
    }
    return lsp.Range.create(convertPosition(range.start), convertPosition(range.end));
}

export function convertPosition(position?: LineAndColumn): lsp.Position {
    return !position ? lsp.Position.create(0, 0) : lsp.Position.create(position.line, position.character);
}