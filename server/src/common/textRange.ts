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
