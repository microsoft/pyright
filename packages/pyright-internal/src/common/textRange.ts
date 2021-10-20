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

    export function containsRange(range: TextRange, span: TextRange): boolean {
        return span.start >= range.start && getEnd(span) <= getEnd(range);
    }

    export function overlaps(range: TextRange, position: number): boolean {
        return position >= range.start && position <= getEnd(range);
    }

    export function overlapsRange(range: TextRange, other: TextRange): boolean {
        return overlaps(range, other.start) || overlaps(other, range.start);
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

    export function combine(ranges: TextRange[]): TextRange | undefined {
        if (ranges.length === 0) {
            return undefined;
        }

        const combinedRange = ranges[0];
        for (let i = 1; i < ranges.length; i++) {
            extend(combinedRange, ranges[i]);
        }
        return combinedRange;
    }
}

export interface Position {
    // Both line and column are zero-based
    line: number;
    character: number;
}

export namespace Position {
    export function is(value: any): value is Position {
        const candidate = value as Position;
        return candidate && candidate.line !== void 0 && candidate.character !== void 0;
    }

    export function print(value: Position): string {
        return `(${value.line}:${value.character})`;
    }
}

export interface Range {
    start: Position;
    end: Position;
}

export namespace Range {
    export function is(value: any): value is Range {
        const candidate = value as Range;
        return candidate && candidate.start !== void 0 && candidate.end !== void 0;
    }

    export function print(value: Range): string {
        return `${Position.print(value.start)}-${Position.print(value.end)}`;
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

export function doRangesIntersect(a: Range, b: Range) {
    if (comparePositions(b.start, a.end) > 0) {
        return false;
    } else if (comparePositions(a.start, b.end) > 0) {
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

export function positionsAreEqual(a: Position, b: Position) {
    return comparePositions(a, b) === 0;
}

export function rangesAreEqual(a: Range, b: Range) {
    return positionsAreEqual(a.start, b.start) && positionsAreEqual(a.end, b.end);
}

export function getEmptyRange(): Range {
    return {
        start: getEmptyPosition(),
        end: getEmptyPosition(),
    };
}

export function isEmptyPosition(pos: Position) {
    return pos.character === 0 && pos.line === 0;
}

export function isEmptyRange(range: Range) {
    return isEmptyPosition(range.start) && isEmptyPosition(range.end);
}

export function extendRange(range: Range, extension: Range | Range[] | undefined) {
    if (extension) {
        if (Array.isArray(extension)) {
            extension.forEach((r) => {
                extendRange(range, r);
            });
        } else {
            if (comparePositions(extension.start, range.start) < 0) {
                range.start = extension.start;
            }

            if (comparePositions(extension.end, range.end) > 0) {
                range.end = extension.end;
            }
        }
    }
}

export function combineRange(ranges: Range[]): Range | undefined {
    if (ranges.length === 0) {
        return undefined;
    }

    const combinedRange = ranges[0];
    for (let i = 1; i < ranges.length; i++) {
        extendRange(combinedRange, ranges[i]);
    }

    return combinedRange;
}
