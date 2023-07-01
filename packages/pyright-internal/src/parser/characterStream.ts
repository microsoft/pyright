/*
 * characterStream.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Based on code from vscode-python repository:
 *  https://github.com/Microsoft/vscode-python
 *
 * Class that represents a stream of characters.
 */

import { Char } from '../common/charCodes';
import { isLineBreak, isWhiteSpace } from './characters';

export class CharacterStream {
    private _text: string;
    private _position: number;
    private _currentChar: number;
    private _isEndOfStream: boolean;

    constructor(text: string) {
        this._text = text;
        this._position = 0;
        this._currentChar = text.length > 0 ? text.charCodeAt(0) : 0;
        this._isEndOfStream = text.length === 0;
    }

    get position(): number {
        return this._position;
    }

    set position(value: number) {
        this._position = value;
        this._checkBounds();
    }

    get currentChar(): number {
        return this._currentChar;
    }

    get nextChar(): number {
        return this.position + 1 < this._text.length ? this._text.charCodeAt(this.position + 1) : 0;
    }

    get prevChar(): number {
        return this.position - 1 >= 0 ? this._text.charCodeAt(this.position - 1) : 0;
    }

    get length(): number {
        return this._text.length;
    }

    getText(): string {
        return this._text;
    }

    // We also expose a (non-property) method that is
    // the equivalent of currentChar above. This allows
    // us to work around assumptions in the TypeScript
    // compiler that method calls (e.g. moveNext()) don't
    // modify properties.
    getCurrentChar(): number {
        return this._currentChar;
    }

    isEndOfStream(): boolean {
        return this._isEndOfStream;
    }

    lookAhead(offset: number): number {
        const pos = this._position + offset;
        return pos < 0 || pos >= this._text.length ? 0 : this._text.charCodeAt(pos);
    }

    advance(offset: number) {
        this.position += offset;
    }

    moveNext(): boolean {
        if (this._position < this._text.length - 1) {
            // Most common case, no need to check bounds extensively
            this._position += 1;
            this._currentChar = this._text.charCodeAt(this._position);
            return true;
        }
        this.advance(1);
        return !this.isEndOfStream();
    }

    isAtWhiteSpace(): boolean {
        return isWhiteSpace(this.currentChar);
    }

    isAtLineBreak(): boolean {
        return isLineBreak(this.currentChar);
    }

    skipLineBreak(): void {
        if (this._currentChar === Char.CarriageReturn) {
            this.moveNext();
            if (this.currentChar === Char.LineFeed) {
                this.moveNext();
            }
        } else if (this._currentChar === Char.LineFeed) {
            this.moveNext();
        }
    }

    skipWhitespace(): void {
        while (!this.isEndOfStream() && this.isAtWhiteSpace()) {
            this.moveNext();
        }
    }

    skipToEol(): void {
        while (!this.isEndOfStream() && !this.isAtLineBreak()) {
            this.moveNext();
        }
    }

    skipToWhitespace(): void {
        while (!this.isEndOfStream() && !this.isAtWhiteSpace()) {
            this.moveNext();
        }
    }

    charCodeAt(index: number): number {
        return this._text.charCodeAt(index);
    }

    private _checkBounds(): void {
        if (this._position < 0) {
            this._position = 0;
        }

        this._isEndOfStream = this._position >= this._text.length;
        if (this._isEndOfStream) {
            this._position = this._text.length;
        }

        this._currentChar = this._isEndOfStream ? 0 : this._text.charCodeAt(this._position);
    }
}
