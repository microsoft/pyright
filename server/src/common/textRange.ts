/*
 * textRange.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Specifies the range of text within a larger string.
 */

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
                extension.forEach((r) => {
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

export interface Position {
    // Both line and column are zero-based
    line: number;
    character: number;
}

namespace Position {
    export function is(value: any): value is Position {
        const candidate = value as Position;
        return candidate && candidate.line !== void 0 && candidate.character !== void 0;
    }
}

export interface Range {
    start: Position;
    end: Position;
}

namespace Range {
    export function is(value: any): value is Range {
        const candidate = value as Range;
        return candidate && candidate.start !== void 0 && candidate.end !== void 0;
    }
}

// Represents a range within a particular document.
export interface DocumentRange {
    path: string;
    range: Range;
}

export function comparePositions(a: Position, b: Position) {
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

export function getEmptyPosition(): Position {
    return {
        line: 0,
        character: 0,
    };
}

export function doRangesOverlap(a: Range, b: Range) {
    if (comparePositions(b.start, a.end) >= 0) {
        return false;
    } else if (comparePositions(a.start, b.end) >= 0) {
        return false;
    }
    return true;
}

export function doesRangeContain(range: Range, positionOrRange: Position | Range): boolean {
    if (Position.is(positionOrRange)) {
        return comparePositions(range.start, positionOrRange) <= 0 && comparePositions(range.end, positionOrRange) >= 0;
    }

    return doesRangeContain(range, positionOrRange.start) && doesRangeContain(range, positionOrRange.end);
}

export function rangesAreEqual(a: Range, b: Range) {
    return comparePositions(a.start, b.start) === 0 && comparePositions(a.end, b.end) === 0;
}

export function getEmptyRange(): Range {
    return {
        start: getEmptyPosition(),
        end: getEmptyPosition(),
    };
}
