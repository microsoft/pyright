/*
 * tokenCollection.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Stores a stream of tokens from a python file.
 */

import { assert } from '../common/debug';
import { TextRangeCollection } from '../common/textRangeCollection';
import { Token } from './tokenizerTypes';

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

function* generateCompressedData(
    tokens: Token[],
    tokenPositions: Int32Array,
    numberData: (number | bigint)[]
): Generator<number, void, undefined> {
    let currentPosition = 0;
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const tokenArray = Token.toCompressed(token, numberData);
        tokenPositions[i] = currentPosition;
        currentPosition += tokenArray.length;
        yield* tokenArray;
    }
}

// Special TokenCollection that is optimized for memory usage but is a lot
// slower to fetch actual tokens.
export class TokenCollectionCompressed implements ITokenCollection {
    private _tokenData: Int32Array;
    private _numberData: (number | bigint)[] = [];
    private _tokenPositions: Int32Array;
    constructor(tokens: Token[], private readonly _content: string) {
        this._tokenPositions = new Int32Array(tokens.length);
        this._tokenData = Int32Array.from(generateCompressedData(tokens, this._tokenPositions, this._numberData));
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
        return Token.fromCompressed(this._tokenData, position, this._content, this._numberData);
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
    private _secondImpl?: TokenCollectionCompressed;
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

    compress() {
        // Switch to the slower but more memory efficient implementation.
        if (this._impl instanceof TokenCollectionFast) {
            // && !this._secondImpl) {
            // this._secondImpl = new TokenCollectionCompressed(
            //     (this._impl as TokenCollectionFast).toArray(),
            //     this._content
            // );
            this._assignImpl(
                new TokenCollectionCompressed((this._impl as TokenCollectionFast).toArray(), this._content)
            );
        }
    }

    private _assignImpl(impl: ITokenCollection) {
        // If we already have an impl, make sure values are the same.
        if (this._impl) {
            assert(this._impl.start === impl.start);
            assert(this._impl.end === impl.end);
            assert(this._impl.length === impl.length);
            assert(this._impl.count === impl.count);
        }

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
