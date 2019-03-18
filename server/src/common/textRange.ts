/*
* textRange.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Specifies the range of text within a larger string.
*/

export class TextRange {
    start: number;
    length: number;

    constructor(start: number, length: number) {
        if (start < 0) {
            throw new Error('start must be non-negative');
        }
        if (length < 0) {
            throw new Error('length must be non-negative');
        }
        this.start = start;
        this.length = length;
    }

    get end(): number {
        return this.start + this.length;
    }

    contains(position: number): boolean {
        return position >= this.start && position < this.end;
    }

    extend(range: TextRange | TextRange[] | undefined) {
        if (range) {
            if (Array.isArray(range)) {
                range.forEach(r => {
                    this.extend(r);
                });
            } else {
                if (range.start < this.start) {
                    this.length += this.start - range.start;
                    this.start = range.start;
                }

                if (range.end > this.end) {
                    this.length += range.end - this.end;
                }
            }
        }
    }
}
