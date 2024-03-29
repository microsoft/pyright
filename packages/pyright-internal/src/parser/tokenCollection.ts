/*
 * tokenCollection.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Stores a stream of tokens from a python file.
 */

import { TextRangeCollection } from '../common/textRangeCollection';
import { Token, TokenPrimitive } from './tokenizerTypes';

// Interface implemented by a TokenCollection
interface ITokenCollection {
    start: number;
    end: number;
    length: number;
    count: number;
    contains(position: number): boolean;
    getItemAt(index: number): Token;
    getItemAtPosition(position: number): number;
}

class TokenCollectionFast extends TextRangeCollection<Token> implements ITokenCollection {
    constructor(private readonly _tokens: Token[]) {
        super(_tokens);
    }

    toArray(): Token[] {
        return this._tokens;
    }
}

// Special TokenCollection that is optimized for memory usage but is a lot
// slower to fetch actual tokens.
export class TokenCollectionSlim implements ITokenCollection {
    private _tokenData: TokenPrimitive[] = [];
    private _tokenPositions: Int32Array;
    constructor(tokens: Token[]) {
        this._tokenPositions = new Int32Array(tokens.length);
        tokens.forEach((t, i) => {
            // Turn each token into a flat array.
            const array = Token.toArray(t);

            // Remember the position of this token for quicker lookup later.
            this._tokenPositions[i] = this._tokenData.length;

            // Store the flat array in the collection.
            this._tokenData.push(...array);
        });
    }

    get start(): number {
        // Start of the first token is always at position 1.
        return this._tokenData.length > 0 ? (this._tokenData[1] as number) : 0;
    }

    get end(): number {
        // Find the last token and return its end position.
        const position = this._tokenPositions.length > 0 ? this._tokenPositions[this._tokenPositions.length - 1] : -1;
        if (position < 0) {
            return 0;
        }
        const start = this._tokenData[position + 1] as number;
        const length = this._tokenData[position + 2] as number;
        return start + length;
    }

    get length(): number {
        return this.end - this.start;
    }

    get count(): number {
        return this._tokenPositions.length;
    }

    contains(position: number) {
        return position >= this.start && position < this.end;
    }

    getItemAt(index: number): Token {
        if (index < 0 || index >= this._tokenPositions.length) {
            throw new Error('index is out of range');
        }
        const position = this._tokenPositions[index];
        return Token.fromArray(this._tokenData, position);
    }

    getItemStart(index: number): number {
        if (index < 0 || index >= this._tokenPositions.length) {
            throw new Error('index is out of range');
        }

        // Start is always second entry in a token array.
        return this._tokenData[this._tokenPositions[index] + 1] as number;
    }

    // Returns the nearest item prior to the position.
    // The position may not be contained within the item.
    getItemAtPosition(position: number): number {
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

        while (min < max) {
            const mid = Math.floor(min + (max - min) / 2);
            const item = this.getItemStart(mid);

            // Is the position past the start of this item but before
            // the start of the next item? If so, we found our item.
            if (position >= item) {
                if (mid >= this.count - 1 || position < this.getItemStart(mid + 1)) {
                    return mid;
                }
            }

            if (position < item) {
                max = mid - 1;
            } else {
                min = mid + 1;
            }
        }
        return min;
    }
}

export class TokenCollection implements ITokenCollection {
    private _impl!: ITokenCollection;
    start!: number;
    end!: number;
    length!: number;
    count!: number;
    private _secondImpl?: TokenCollectionSlim;
    constructor(private _content: string, tokens: Token[]) {
        // Start out with the faster implementation.
        this._assignImpl(new TokenCollectionFast(tokens));
    }
    contains(position: number): boolean {
        return this._impl.contains(position);
    }
    getItemAt(index: number): Token {
        return this._impl.getItemAt(index);
    }
    getItemAtPosition(position: number): number {
        return this._impl.getItemAtPosition(position);
    }

    minimize() {
        // Switch to the slower but more memory efficient implementation.
        if (this._impl instanceof TokenCollectionFast && !this._secondImpl) {
            this._secondImpl = new TokenCollectionSlim((this._impl as TokenCollectionFast).toArray());
            //this._assignImpl(new TokenCollectionSlim((this._impl as TokenCollectionFast).toArray()));
        }
    }

    private _assignImpl(impl: ITokenCollection) {
        this._impl = impl;
        this.start = impl.start;
        this.end = impl.end;
        this.length = impl.length;
        this.count = impl.count;

        // Reassign all methods for faster execution.
        this.contains = impl.contains.bind(impl);
        this.getItemAt = impl.getItemAt.bind(impl);
        this.getItemAtPosition = impl.getItemAtPosition.bind(impl);
    }
}
