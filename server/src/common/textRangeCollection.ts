/*
* textRangeCollection.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Based on code from vscode-python repository:
*  https://github.com/Microsoft/vscode-python
*
* Class that maintains an ordered list of text ranges and allows
* for indexing and fast lookups within this list.
*/

import { TextRange } from './textRange';

export class TextRangeCollection<T extends TextRange> {
    private items: T[];

    constructor(items: T[]) {
        this.items = items;
    }

    get start(): number {
        return this.items.length > 0 ? this.items[0].start : 0;
    }

    get end(): number {
        return this.items.length > 0 ? this.items[this.items.length - 1].end : 0;
    }

    get length(): number {
        return this.end - this.start;
    }

    get count(): number {
        return this.items.length;
    }

    contains(position: number) {
        return position >= this.start && position < this.end;
    }

    getItemAt(index: number): T {
        if (index < 0 || index >= this.items.length) {
            throw new Error('index is out of range');
        }
        return this.items[index];
    }

    getItemAtPosition(position: number): number {
        if (this.count === 0) {
            return -1;
        }
        if (position < this.start) {
            return -1;
        }
        if (position >= this.end) {
            return -1;
        }

        let min = 0;
        let max = this.count - 1;

        while (min <= max) {
            const mid = Math.floor(min + (max - min) / 2);
            const item = this.items[mid];

            if (item.start === position) {
                return mid;
            }

            if (position < item.start) {
                max = mid - 1;
            } else {
                min = mid + 1;
            }
        }
        return -1;
    }

    getItemContaining(position: number): number {
        if (this.count === 0) {
            return -1;
        }
        if (position < this.start) {
            return -1;
        }
        if (position > this.end) {
            return -1;
        }

        let min = 0;
        let max = this.count - 1;

        while (min <= max) {
            const mid = Math.floor(min + (max - min) / 2);
            const item = this.items[mid];

            if (item.contains(position)) {
                return mid;
            }
            if (mid < this.count - 1 && item.end <= position && position < this.items[mid + 1].start) {
                return -1;
            }

            if (position < item.start) {
                max = mid - 1;
            } else {
                min = mid + 1;
            }
        }
        return -1;
    }
}
