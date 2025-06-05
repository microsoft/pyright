/*
 * tokenizer.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Based on code from vscode-python repository:
 *  https://github.com/Microsoft/vscode-python
 *
 * Converts a Python program text stream into a stream of tokens.
 */

import { Char } from '../common/charCodes';
import { cloneStr } from '../common/core';
import { TextRange } from '../common/textRange';
import { TextRangeCollection } from '../common/textRangeCollection';
import {
    isBinary,
    isDecimal,
    isHex,
    isIdentifierChar,
    isIdentifierStartChar,
    isOctal,
    isSurrogateChar,
} from './characters';
import { CharacterStream } from './characterStream';
import {
    Comment,
    CommentType,
    DedentToken,
    FStringEndToken,
    FStringMiddleToken,
    FStringStartToken,
    IdentifierToken,
    IndentToken,
    KeywordToken,
    KeywordType,
    NewLineToken,
    NewLineType,
    NumberToken,
    OperatorFlags,
    OperatorToken,
    OperatorType,
    StringToken,
    StringTokenFlags,
    Token,
    TokenType,
} from './tokenizerTypes';

// This must be a Map, as operations like {}["constructor"] succeed.
const _keywords: Map<string, KeywordType> = new Map([
    ['and', KeywordType.And],
    ['as', KeywordType.As],
    ['assert', KeywordType.Assert],
    ['async', KeywordType.Async],
    ['await', KeywordType.Await],
    ['break', KeywordType.Break],
    ['case', KeywordType.Case],
    ['class', KeywordType.Class],
    ['continue', KeywordType.Continue],
    ['__debug__', KeywordType.Debug],
    ['def', KeywordType.Def],
    ['del', KeywordType.Del],
    ['elif', KeywordType.Elif],
    ['else', KeywordType.Else],
    ['except', KeywordType.Except],
    ['finally', KeywordType.Finally],
    ['for', KeywordType.For],
    ['from', KeywordType.From],
    ['global', KeywordType.Global],
    ['if', KeywordType.If],
    ['import', KeywordType.Import],
    ['in', KeywordType.In],
    ['is', KeywordType.Is],
    ['lambda', KeywordType.Lambda],
    ['match', KeywordType.Match],
    ['nonlocal', KeywordType.Nonlocal],
    ['not', KeywordType.Not],
    ['or', KeywordType.Or],
    ['pass', KeywordType.Pass],
    ['raise', KeywordType.Raise],
    ['return', KeywordType.Return],
    ['try', KeywordType.Try],
    ['type', KeywordType.Type],
    ['while', KeywordType.While],
    ['with', KeywordType.With],
    ['yield', KeywordType.Yield],
    ['False', KeywordType.False],
    ['None', KeywordType.None],
    ['True', KeywordType.True],
]);

const _softKeywords = new Set(['match', 'case', 'type']);

const _operatorInfo: { [key: number]: OperatorFlags } = {
    [OperatorType.Add]: OperatorFlags.Unary | OperatorFlags.Binary,
    [OperatorType.AddEqual]: OperatorFlags.Assignment,
    [OperatorType.Assign]: OperatorFlags.Assignment,
    [OperatorType.BitwiseAnd]: OperatorFlags.Binary,
    [OperatorType.BitwiseAndEqual]: OperatorFlags.Assignment,
    [OperatorType.BitwiseInvert]: OperatorFlags.Unary,
    [OperatorType.BitwiseOr]: OperatorFlags.Binary,
    [OperatorType.BitwiseOrEqual]: OperatorFlags.Assignment,
    [OperatorType.BitwiseXor]: OperatorFlags.Binary,
    [OperatorType.BitwiseXorEqual]: OperatorFlags.Assignment,
    [OperatorType.Divide]: OperatorFlags.Binary,
    [OperatorType.DivideEqual]: OperatorFlags.Assignment,
    [OperatorType.Equals]: OperatorFlags.Binary | OperatorFlags.Comparison,
    [OperatorType.FloorDivide]: OperatorFlags.Binary,
    [OperatorType.FloorDivideEqual]: OperatorFlags.Assignment,
    [OperatorType.GreaterThan]: OperatorFlags.Binary | OperatorFlags.Comparison,
    [OperatorType.GreaterThanOrEqual]: OperatorFlags.Binary | OperatorFlags.Comparison,
    [OperatorType.LeftShift]: OperatorFlags.Binary,
    [OperatorType.LeftShiftEqual]: OperatorFlags.Assignment,
    [OperatorType.LessOrGreaterThan]: OperatorFlags.Binary | OperatorFlags.Comparison | OperatorFlags.Deprecated,
    [OperatorType.LessThan]: OperatorFlags.Binary | OperatorFlags.Comparison,
    [OperatorType.LessThanOrEqual]: OperatorFlags.Binary | OperatorFlags.Comparison,
    [OperatorType.MatrixMultiply]: OperatorFlags.Binary,
    [OperatorType.MatrixMultiplyEqual]: OperatorFlags.Assignment,
    [OperatorType.Mod]: OperatorFlags.Binary,
    [OperatorType.ModEqual]: OperatorFlags.Assignment,
    [OperatorType.Multiply]: OperatorFlags.Binary,
    [OperatorType.MultiplyEqual]: OperatorFlags.Assignment,
    [OperatorType.NotEquals]: OperatorFlags.Binary | OperatorFlags.Comparison,
    [OperatorType.Power]: OperatorFlags.Binary,
    [OperatorType.PowerEqual]: OperatorFlags.Assignment,
    [OperatorType.RightShift]: OperatorFlags.Binary,
    [OperatorType.RightShiftEqual]: OperatorFlags.Assignment,
    [OperatorType.Subtract]: OperatorFlags.Binary,
    [OperatorType.SubtractEqual]: OperatorFlags.Assignment,

    [OperatorType.And]: OperatorFlags.Binary,
    [OperatorType.Or]: OperatorFlags.Binary,
    [OperatorType.Not]: OperatorFlags.Unary,
    [OperatorType.Is]: OperatorFlags.Binary,
    [OperatorType.IsNot]: OperatorFlags.Binary,
    [OperatorType.In]: OperatorFlags.Binary,
    [OperatorType.NotIn]: OperatorFlags.Binary,
};

const _byteOrderMarker = 0xfeff;

const defaultTabSize = 8;
const magicsRegEx = /\\\s*$/;
const typeIgnoreCommentRegEx = /((^|#)\s*)type:\s*ignore(\s*\[([\s\w-,]*)\]|\s|$)/;
const pyrightIgnoreCommentRegEx = /((^|#)\s*)pyright:\s*ignore(\s*\[([\s\w-,]*)\]|\s|$)/;
const underscoreRegEx = /_/g;

export interface TokenizerOutput {
    // List of all tokens.
    tokens: TextRangeCollection<Token>;

    // List of ranges that comprise the lines.
    lines: TextRangeCollection<TextRange>;

    // Map of all line numbers that end in a "type: ignore" comment.
    typeIgnoreLines: Map<number, IgnoreComment>;

    // Map of all line numbers that end in a "pyright: ignore" comment.
    pyrightIgnoreLines: Map<number, IgnoreComment>;

    // Program starts with a "type: ignore" comment.
    typeIgnoreAll: IgnoreComment | undefined;

    // Line-end sequence ('/n', '/r', or '/r/n').
    predominantEndOfLineSequence: string;

    // True if the tokenizer was able to identify the file's predominant
    // tab sequence. False if predominantTabSequence is set to our default.
    hasPredominantTabSequence: boolean;

    // Tab sequence ('/t or consecutive spaces).
    predominantTabSequence: string;

    // Does the code mostly use single or double quote
    // characters for string literals?
    predominantSingleQuoteCharacter: string;
}

interface StringScannerOutput {
    escapedValue: string;
    flags: StringTokenFlags;
}

interface IndentInfo {
    tab1Spaces: number;
    tab8Spaces: number;
    isSpacePresent: boolean;
    isTabPresent: boolean;
}

export interface IgnoreCommentRule {
    text: string;
    range: TextRange;
}

export interface IgnoreComment {
    range: TextRange;
    rulesList: IgnoreCommentRule[] | undefined;
}

interface FStringReplacementFieldContext {
    inFormatSpecifier: boolean;
    parenDepth: number;
}

interface FStringContext {
    startToken: FStringStartToken;
    replacementFieldStack: FStringReplacementFieldContext[];
    activeReplacementField?: FStringReplacementFieldContext;
}

enum MagicsKind {
    None,
    Line,
    Cell,
}

export class Tokenizer {
    private _cs = new CharacterStream('');
    private _tokens: Token[] = [];
    private _prevLineStart = 0;
    private _parenDepth = 0;
    private _lineRanges: TextRange[] = [];
    private _indentAmounts: IndentInfo[] = [];
    private _typeIgnoreAll: IgnoreComment | undefined;
    private _typeIgnoreLines = new Map<number, IgnoreComment>();
    private _pyrightIgnoreLines = new Map<number, IgnoreComment>();
    private _comments: Comment[] | undefined;
    private _fStringStack: FStringContext[] = [];
    private _activeFString: FStringContext | undefined;

    // Total times CR, CR/LF, and LF are used to terminate
    // lines. Used to determine the predominant line ending.
    private _crCount = 0;
    private _crLfCount = 0;
    private _lfCount = 0;

    // Number of times an indent token is emitted.
    private _indentCount = 0;

    // Number of times an indent token is emitted and a tab character
    // is present (used to determine predominant tab sequence).
    private _indentTabCount = 0;

    // Number of spaces that are added for an indent token
    // (used to determine predominant tab sequence).
    private _indentSpacesTotal = 0;

    // Number of single or double quote string literals found
    // in the code.
    private _singleQuoteCount = 0;
    private _doubleQuoteCount = 0;

    // Assume Jupyter notebook tokenization rules?
    private _useNotebookMode = false;

    tokenize(
        text: string,
        start?: number,
        length?: number,
        initialParenDepth = 0,
        useNotebookMode = false
    ): TokenizerOutput {
        if (start === undefined) {
            start = 0;
        } else if (start < 0 || start > text.length) {
            throw new Error(`Invalid range start (start=${start}, text.length=${text.length})`);
        }

        if (length === undefined) {
            length = text.length;
        } else if (length < 0 || start + length > text.length) {
            throw new Error(`Invalid range length (start=${start}, length=${length}, text.length=${text.length})`);
        } else if (start + length < text.length) {
            text = text.slice(0, start + length);
        }

        this._cs = new CharacterStream(text);
        this._cs.position = start;
        this._tokens = [];
        this._prevLineStart = 0;
        this._parenDepth = initialParenDepth;
        this._lineRanges = [];
        this._indentAmounts = [];
        this._useNotebookMode = useNotebookMode;

        const end = start + length;

        if (start === 0) {
            this._readIndentationAfterNewLine();
        }

        while (!this._cs.isEndOfStream()) {
            this._addNextToken();

            if (this._cs.position >= end) {
                break;
            }
        }

        // Insert any implied FStringEnd tokens.
        while (this._activeFString) {
            this._tokens.push(
                FStringEndToken.create(
                    this._cs.position,
                    0,
                    this._activeFString.startToken.flags | StringTokenFlags.Unterminated
                )
            );
            this._activeFString = this._fStringStack.pop();
        }

        // Insert an implied new line to make parsing easier.
        if (this._tokens.length === 0 || this._tokens[this._tokens.length - 1].type !== TokenType.NewLine) {
            if (this._parenDepth === 0) {
                this._tokens.push(NewLineToken.create(this._cs.position, 0, NewLineType.Implied, this._getComments()));
            }
        }

        // Insert any implied dedent tokens.
        this._setIndent(this._cs.position, 0, 0, /* isSpacePresent */ false, /* isTabPresent */ false);

        // Add a final end-of-stream token to make parsing easier.
        this._tokens.push(Token.create(TokenType.EndOfStream, this._cs.position, 0, this._getComments()));

        // Add the final line range.
        this._addLineRange();

        // If the last line ended in a line-end character, add an empty line.
        if (this._lineRanges.length > 0) {
            const lastLine = this._lineRanges[this._lineRanges.length - 1];
            const lastCharOfLastLine = text.charCodeAt(lastLine.start + lastLine.length - 1);
            if (lastCharOfLastLine === Char.CarriageReturn || lastCharOfLastLine === Char.LineFeed) {
                this._lineRanges.push({ start: this._cs.position, length: 0 });
            }
        }

        let predominantEndOfLineSequence = '\n';
        if (this._crCount > this._crLfCount && this._crCount > this._lfCount) {
            predominantEndOfLineSequence = '\r';
        } else if (this._crLfCount > this._crCount && this._crLfCount > this._lfCount) {
            predominantEndOfLineSequence = '\r\n';
        }

        let predominantTabSequence = '    ';
        let hasPredominantTabSequence = false;
        // If more than half of the indents use tab sequences,
        // assume we're using tabs rather than spaces.
        if (this._indentTabCount > this._indentCount / 2) {
            hasPredominantTabSequence = true;
            predominantTabSequence = '\t';
        } else if (this._indentCount > 0) {
            hasPredominantTabSequence = true;
            // Compute the average number of spaces per indent
            // to estimate the predominant tab value.
            let averageSpacePerIndent = Math.round(this._indentSpacesTotal / this._indentCount);
            if (averageSpacePerIndent < 1) {
                averageSpacePerIndent = 1;
            } else if (averageSpacePerIndent > defaultTabSize) {
                averageSpacePerIndent = defaultTabSize;
            }
            predominantTabSequence = '';
            for (let i = 0; i < averageSpacePerIndent; i++) {
                predominantTabSequence += ' ';
            }
        }

        return {
            tokens: new TextRangeCollection(this._tokens),
            lines: new TextRangeCollection(this._lineRanges),
            typeIgnoreLines: this._typeIgnoreLines,
            typeIgnoreAll: this._typeIgnoreAll,
            pyrightIgnoreLines: this._pyrightIgnoreLines,
            predominantEndOfLineSequence,
            hasPredominantTabSequence,
            predominantTabSequence,
            predominantSingleQuoteCharacter: this._singleQuoteCount >= this._doubleQuoteCount ? "'" : '"',
        };
    }

    static getOperatorInfo(operatorType: OperatorType): OperatorFlags {
        return _operatorInfo[operatorType];
    }

    static isWhitespace(token: Token) {
        return token.type === TokenType.NewLine || token.type === TokenType.Indent || token.type === TokenType.Dedent;
    }

    static isPythonKeyword(name: string, includeSoftKeywords = false): boolean {
        const keyword = _keywords.get(name);
        if (!keyword) {
            return false;
        }

        if (includeSoftKeywords) {
            return true;
        }

        return !_softKeywords.has(name);
    }

    static isPythonIdentifier(value: string) {
        for (let i = 0; i < value.length; i++) {
            if (i === 0 ? !isIdentifierStartChar(value.charCodeAt(i)) : !isIdentifierChar(value.charCodeAt(i))) {
                return false;
            }
        }

        return true;
    }

    static isOperatorAssignment(operatorType?: OperatorType): boolean {
        if (operatorType === undefined || _operatorInfo[operatorType] === undefined) {
            return false;
        }
        return (_operatorInfo[operatorType] & OperatorFlags.Assignment) !== 0;
    }

    static isOperatorComparison(operatorType?: OperatorType): boolean {
        if (operatorType === undefined || _operatorInfo[operatorType] === undefined) {
            return false;
        }
        return (_operatorInfo[operatorType] & OperatorFlags.Comparison) !== 0;
    }

    private _addNextToken(): void {
        // Are we in the middle of an f-string but not in a replacement field?
        if (
            this._activeFString &&
            (!this._activeFString.activeReplacementField ||
                this._activeFString.activeReplacementField.inFormatSpecifier)
        ) {
            this._handleFStringMiddle();
        } else {
            this._cs.skipWhitespace();
        }

        if (this._cs.isEndOfStream()) {
            return;
        }

        if (!this._handleCharacter()) {
            this._cs.moveNext();
        }
    }

    // Consumes one or more characters from the character stream and pushes
    // tokens onto the token list. Returns true if the caller should advance
    // to the next character.
    private _handleCharacter(): boolean {
        // f-strings, b-strings, etc
        const stringPrefixLength = this._getStringPrefixLength();

        if (stringPrefixLength >= 0) {
            let stringPrefix = '';
            if (stringPrefixLength > 0) {
                stringPrefix = this._cs.getText().slice(this._cs.position, this._cs.position + stringPrefixLength);
                // Indeed a string
                this._cs.advance(stringPrefixLength);
            }

            const quoteTypeFlags = this._getQuoteTypeFlags(stringPrefix);
            if (quoteTypeFlags !== StringTokenFlags.None) {
                this._handleString(quoteTypeFlags, stringPrefixLength);
                return true;
            }
        }

        if (this._cs.currentChar === Char.Hash) {
            this._handleComment();
            return true;
        }

        if (this._useNotebookMode) {
            const kind = this._getIPythonMagicsKind();
            if (kind === MagicsKind.Line) {
                this._handleIPythonMagics(
                    this._cs.currentChar === Char.Percent ? CommentType.IPythonMagic : CommentType.IPythonShellEscape
                );
                return true;
            }

            if (kind === MagicsKind.Cell) {
                this._handleIPythonMagics(
                    this._cs.currentChar === Char.Percent
                        ? CommentType.IPythonCellMagic
                        : CommentType.IPythonCellShellEscape
                );
                return true;
            }
        }

        switch (this._cs.currentChar) {
            case _byteOrderMarker: {
                // Skip the BOM if it's at the start of the file.
                if (this._cs.position === 0) {
                    return false;
                }
                return this._handleInvalid();
            }

            case Char.CarriageReturn: {
                const length = this._cs.nextChar === Char.LineFeed ? 2 : 1;
                const newLineType = length === 2 ? NewLineType.CarriageReturnLineFeed : NewLineType.CarriageReturn;
                this._handleNewLine(length, newLineType);
                return true;
            }

            case Char.LineFeed: {
                this._handleNewLine(1, NewLineType.LineFeed);
                return true;
            }

            case Char.Backslash: {
                if (this._cs.nextChar === Char.CarriageReturn) {
                    if (this._cs.lookAhead(2) === Char.LineFeed) {
                        this._cs.advance(3);
                    } else {
                        this._cs.advance(2);
                    }

                    this._addLineRange();

                    if (this._tokens.length > 0 && this._tokens[this._tokens.length - 1].type === TokenType.NewLine) {
                        this._readIndentationAfterNewLine();
                    }
                    return true;
                }

                if (this._cs.nextChar === Char.LineFeed) {
                    this._cs.advance(2);
                    this._addLineRange();

                    if (this._tokens.length > 0 && this._tokens[this._tokens.length - 1].type === TokenType.NewLine) {
                        this._readIndentationAfterNewLine();
                    }
                    return true;
                }

                return this._handleInvalid();
            }

            case Char.OpenParenthesis: {
                this._parenDepth++;
                this._tokens.push(Token.create(TokenType.OpenParenthesis, this._cs.position, 1, this._getComments()));
                break;
            }

            case Char.CloseParenthesis: {
                if (this._parenDepth > 0) {
                    this._parenDepth--;
                }
                this._tokens.push(Token.create(TokenType.CloseParenthesis, this._cs.position, 1, this._getComments()));
                break;
            }

            case Char.OpenBracket: {
                this._parenDepth++;
                this._tokens.push(Token.create(TokenType.OpenBracket, this._cs.position, 1, this._getComments()));
                break;
            }

            case Char.CloseBracket: {
                if (this._parenDepth > 0) {
                    this._parenDepth--;
                }
                this._tokens.push(Token.create(TokenType.CloseBracket, this._cs.position, 1, this._getComments()));
                break;
            }

            case Char.OpenBrace: {
                this._parenDepth++;
                this._tokens.push(Token.create(TokenType.OpenCurlyBrace, this._cs.position, 1, this._getComments()));

                if (this._activeFString) {
                    // Are we starting a new replacement field?
                    if (
                        !this._activeFString.activeReplacementField ||
                        this._activeFString.activeReplacementField.inFormatSpecifier
                    ) {
                        // If there is already an active replacement field, push it
                        // on the stack so we can pop it later.
                        if (this._activeFString.activeReplacementField) {
                            this._activeFString.replacementFieldStack.push(this._activeFString.activeReplacementField);
                        }

                        // Create a new active replacement field context.
                        this._activeFString.activeReplacementField = {
                            inFormatSpecifier: false,
                            parenDepth: this._parenDepth,
                        };
                    }
                }
                break;
            }

            case Char.CloseBrace: {
                if (
                    this._activeFString &&
                    this._activeFString.activeReplacementField?.parenDepth === this._parenDepth
                ) {
                    this._activeFString.activeReplacementField = this._activeFString.replacementFieldStack.pop();
                }

                if (this._parenDepth > 0) {
                    this._parenDepth--;
                }
                this._tokens.push(Token.create(TokenType.CloseCurlyBrace, this._cs.position, 1, this._getComments()));
                break;
            }

            case Char.Comma: {
                this._tokens.push(Token.create(TokenType.Comma, this._cs.position, 1, this._getComments()));
                break;
            }

            case Char.Backtick: {
                this._tokens.push(Token.create(TokenType.Backtick, this._cs.position, 1, this._getComments()));
                break;
            }

            case Char.Semicolon: {
                this._tokens.push(Token.create(TokenType.Semicolon, this._cs.position, 1, this._getComments()));
                break;
            }

            case Char.Colon: {
                if (this._cs.nextChar === Char.Equal) {
                    if (
                        !this._activeFString ||
                        !this._activeFString.activeReplacementField ||
                        this._activeFString.activeReplacementField.parenDepth !== this._parenDepth
                    ) {
                        this._tokens.push(
                            OperatorToken.create(this._cs.position, 2, OperatorType.Walrus, this._getComments())
                        );
                        this._cs.advance(1);
                        break;
                    }
                }

                this._tokens.push(Token.create(TokenType.Colon, this._cs.position, 1, this._getComments()));

                if (
                    this._activeFString?.activeReplacementField &&
                    this._parenDepth === this._activeFString.activeReplacementField.parenDepth
                ) {
                    this._activeFString.activeReplacementField.inFormatSpecifier = true;
                }
                break;
            }

            default: {
                if (this._isPossibleNumber()) {
                    if (this._tryNumber()) {
                        return true;
                    }
                }

                if (this._cs.currentChar === Char.Period) {
                    if (this._cs.nextChar === Char.Period && this._cs.lookAhead(2) === Char.Period) {
                        this._tokens.push(Token.create(TokenType.Ellipsis, this._cs.position, 3, this._getComments()));
                        this._cs.advance(3);
                        return true;
                    }
                    this._tokens.push(Token.create(TokenType.Dot, this._cs.position, 1, this._getComments()));
                    break;
                }

                if (!this._tryIdentifier()) {
                    if (!this._tryOperator()) {
                        return this._handleInvalid();
                    }
                }
                return true;
            }
        }
        return false;
    }

    private _addLineRange() {
        const lineLength = this._cs.position - this._prevLineStart;
        if (lineLength > 0) {
            this._lineRanges.push({ start: this._prevLineStart, length: lineLength });
        }

        this._prevLineStart = this._cs.position;
    }

    private _handleNewLine(length: number, newLineType: NewLineType) {
        if (this._parenDepth === 0 && newLineType !== NewLineType.Implied) {
            // New lines are ignored within parentheses.
            // We'll also avoid adding multiple newlines in a row to simplify parsing.
            if (this._tokens.length === 0 || this._tokens[this._tokens.length - 1].type !== TokenType.NewLine) {
                this._tokens.push(NewLineToken.create(this._cs.position, length, newLineType, this._getComments()));
            }
        }
        if (newLineType === NewLineType.CarriageReturn) {
            this._crCount++;
        } else if (newLineType === NewLineType.CarriageReturnLineFeed) {
            this._crLfCount++;
        } else {
            this._lfCount++;
        }
        this._cs.advance(length);
        this._addLineRange();
        this._readIndentationAfterNewLine();
    }

    private _readIndentationAfterNewLine() {
        let tab1Spaces = 0;
        let tab8Spaces = 0;
        let isTabPresent = false;
        let isSpacePresent = false;

        const startOffset = this._cs.position;

        while (!this._cs.isEndOfStream()) {
            switch (this._cs.currentChar) {
                case Char.Space:
                    tab1Spaces++;
                    tab8Spaces++;
                    isSpacePresent = true;
                    this._cs.moveNext();
                    break;

                case Char.Tab:
                    // Translate tabs into spaces assuming both 1-space
                    // and 8-space tab stops.
                    tab1Spaces++;
                    tab8Spaces += defaultTabSize - (tab8Spaces % defaultTabSize);
                    isTabPresent = true;
                    this._cs.moveNext();
                    break;

                case Char.FormFeed:
                    tab1Spaces = 0;
                    tab8Spaces = 0;
                    isTabPresent = false;
                    isSpacePresent = false;
                    this._cs.moveNext();
                    break;

                case Char.Hash:
                case Char.LineFeed:
                case Char.CarriageReturn:
                    // Blank line -- no need to adjust indentation.
                    return;

                default:
                    // Non-blank line. Set the current indent level.
                    this._setIndent(startOffset, tab1Spaces, tab8Spaces, isSpacePresent, isTabPresent);
                    return;
            }
        }
    }

    // The caller must specify two space count values. The first assumes
    // that tabs are translated into one-space tab stops. The second assumes
    // that tabs are translated into eight-space tab stops.
    private _setIndent(
        startOffset: number,
        tab1Spaces: number,
        tab8Spaces: number,
        isSpacePresent: boolean,
        isTabPresent: boolean
    ) {
        // Indentations are ignored within a parenthesized clause.
        if (this._parenDepth > 0) {
            return;
        }

        // Insert indent or dedent tokens as necessary.
        if (this._indentAmounts.length === 0) {
            if (tab8Spaces > 0) {
                this._indentCount++;
                if (isTabPresent) {
                    this._indentTabCount++;
                }
                this._indentSpacesTotal += tab8Spaces;

                this._indentAmounts.push({
                    tab1Spaces,
                    tab8Spaces,
                    isSpacePresent,
                    isTabPresent,
                });
                this._tokens.push(IndentToken.create(startOffset, tab1Spaces, tab8Spaces, false, this._getComments()));
            }
        } else {
            const prevTabInfo = this._indentAmounts[this._indentAmounts.length - 1];
            if (prevTabInfo.tab8Spaces < tab8Spaces) {
                // The Python spec says that if there is ambiguity about how tabs should
                // be translated into spaces because the user has intermixed tabs and
                // spaces, it should be an error. We'll record this condition in the token
                // so the parser can later report it.
                const isIndentAmbiguous =
                    ((prevTabInfo.isSpacePresent && isTabPresent) || (prevTabInfo.isTabPresent && isSpacePresent)) &&
                    prevTabInfo.tab1Spaces >= tab1Spaces;

                this._indentCount++;
                if (isTabPresent) {
                    this._indentTabCount++;
                }
                this._indentSpacesTotal += tab8Spaces - this._indentAmounts[this._indentAmounts.length - 1].tab8Spaces;

                this._indentAmounts.push({
                    tab1Spaces,
                    tab8Spaces,
                    isSpacePresent,
                    isTabPresent,
                });

                this._tokens.push(
                    IndentToken.create(startOffset, tab1Spaces, tab8Spaces, isIndentAmbiguous, this._getComments())
                );
            } else if (prevTabInfo.tab8Spaces === tab8Spaces) {
                // The Python spec says that if there is ambiguity about how tabs should
                // be translated into spaces because the user has intermixed tabs and
                // spaces, it should be an error. We'll record this condition in the token
                // so the parser can later report it.
                if ((prevTabInfo.isSpacePresent && isTabPresent) || (prevTabInfo.isTabPresent && isSpacePresent)) {
                    this._tokens.push(
                        IndentToken.create(startOffset, tab1Spaces, tab8Spaces, true, this._getComments())
                    );
                }
            } else {
                // The Python spec says that if there is ambiguity about how tabs should
                // be translated into spaces because the user has intermixed tabs and
                // spaces, it should be an error. We'll record this condition in the token
                // so the parser can later report it.
                let isDedentAmbiguous =
                    (prevTabInfo.isSpacePresent && isTabPresent) || (prevTabInfo.isTabPresent && isSpacePresent);

                // The Python spec says that dedent amounts need to match the indent
                // amount exactly. An error is generated at runtime if it doesn't.
                // We'll record that error condition within the token, allowing the
                // parser to report it later.
                const dedentPoints: number[] = [];
                while (
                    this._indentAmounts.length > 0 &&
                    this._indentAmounts[this._indentAmounts.length - 1].tab8Spaces > tab8Spaces
                ) {
                    dedentPoints.push(
                        this._indentAmounts.length > 1
                            ? this._indentAmounts[this._indentAmounts.length - 2].tab8Spaces
                            : 0
                    );
                    this._indentAmounts.pop();
                }

                dedentPoints.forEach((dedentAmount, index) => {
                    const matchesIndent = index < dedentPoints.length - 1 || dedentAmount === tab8Spaces;
                    const actualDedentAmount = index < dedentPoints.length - 1 ? dedentAmount : tab8Spaces;
                    this._tokens.push(
                        DedentToken.create(
                            this._cs.position,
                            0,
                            actualDedentAmount,
                            matchesIndent,
                            isDedentAmbiguous,
                            this._getComments()
                        )
                    );

                    isDedentAmbiguous = false;
                });
            }
        }
    }

    private _tryIdentifier(): boolean {
        const swallowRemainingChars = () => {
            while (true) {
                if (isIdentifierChar(this._cs.currentChar)) {
                    this._cs.moveNext();
                } else if (isIdentifierChar(this._cs.currentChar, this._cs.nextChar)) {
                    this._cs.moveNext();
                    this._cs.moveNext();
                } else {
                    break;
                }
            }
        };

        const start = this._cs.position;
        if (isIdentifierStartChar(this._cs.currentChar)) {
            this._cs.moveNext();
            swallowRemainingChars();
        } else if (isIdentifierStartChar(this._cs.currentChar, this._cs.nextChar)) {
            this._cs.moveNext();
            this._cs.moveNext();
            swallowRemainingChars();
        }

        if (this._cs.position > start) {
            const value = this._cs.getText().slice(start, this._cs.position);
            if (_keywords.has(value)) {
                this._tokens.push(
                    KeywordToken.create(start, this._cs.position - start, _keywords.get(value)!, this._getComments())
                );
            } else {
                this._tokens.push(
                    IdentifierToken.create(start, this._cs.position - start, cloneStr(value), this._getComments())
                );
            }
            return true;
        }
        return false;
    }

    private _isPossibleNumber(): boolean {
        if (isDecimal(this._cs.currentChar)) {
            return true;
        }

        if (this._cs.currentChar === Char.Period && isDecimal(this._cs.nextChar)) {
            return true;
        }

        return false;
    }

    private _tryNumber(): boolean {
        const start = this._cs.position;

        if (this._cs.currentChar === Char._0) {
            let radix = 0;
            let leadingChars = 0;

            // Try hex => hexinteger: "0" ("x" | "X") (["_"] hexdigit)+
            if ((this._cs.nextChar === Char.x || this._cs.nextChar === Char.X) && isHex(this._cs.lookAhead(2))) {
                this._cs.advance(2);
                leadingChars = 2;
                while (isHex(this._cs.currentChar)) {
                    this._cs.moveNext();
                }
                radix = 16;
            }

            // Try binary => bininteger: "0" ("b" | "B") (["_"] bindigit)+
            else if (
                (this._cs.nextChar === Char.b || this._cs.nextChar === Char.B) &&
                isBinary(this._cs.lookAhead(2))
            ) {
                this._cs.advance(2);
                leadingChars = 2;
                while (isBinary(this._cs.currentChar)) {
                    this._cs.moveNext();
                }
                radix = 2;
            }

            // Try octal => octinteger: "0" ("o" | "O") (["_"] octdigit)+
            else if ((this._cs.nextChar === Char.o || this._cs.nextChar === Char.O) && isOctal(this._cs.lookAhead(2))) {
                this._cs.advance(2);
                leadingChars = 2;
                while (isOctal(this._cs.currentChar)) {
                    this._cs.moveNext();
                }
                radix = 8;
            }

            if (radix > 0) {
                const text = this._cs.getText().slice(start, this._cs.position);
                const simpleIntText = text.replace(underscoreRegEx, '');
                let intValue: number | bigint = parseInt(simpleIntText.slice(leadingChars), radix);

                if (!isNaN(intValue)) {
                    const bigIntValue = BigInt(simpleIntText);
                    if (
                        !isFinite(intValue) ||
                        intValue < Number.MIN_SAFE_INTEGER ||
                        intValue > Number.MAX_SAFE_INTEGER
                    ) {
                        intValue = bigIntValue;
                    }

                    this._tokens.push(
                        NumberToken.create(start, text.length, intValue, true, false, this._getComments())
                    );
                    return true;
                }
            }
        }

        let isDecimalInteger = false;
        let mightBeFloatingPoint = false;
        // Try decimal int =>
        //    decinteger: nonzerodigit (["_"] digit)* | "0" (["_"] "0")*
        //    nonzerodigit: "1"..."9"
        //    digit: "0"..."9"
        if (this._cs.currentChar >= Char._1 && this._cs.currentChar <= Char._9) {
            while (isDecimal(this._cs.currentChar)) {
                mightBeFloatingPoint = true;
                this._cs.moveNext();
            }
            isDecimalInteger =
                this._cs.currentChar !== Char.Period &&
                this._cs.currentChar !== Char.e &&
                this._cs.currentChar !== Char.E;
        }

        // "0" (["_"] "0")*
        if (this._cs.currentChar === Char._0) {
            mightBeFloatingPoint = true;
            while (this._cs.currentChar === Char._0 || this._cs.currentChar === Char.Underscore) {
                this._cs.moveNext();
            }
            isDecimalInteger =
                this._cs.currentChar !== Char.Period &&
                this._cs.currentChar !== Char.e &&
                this._cs.currentChar !== Char.E &&
                (this._cs.currentChar < Char._1 || this._cs.currentChar > Char._9);
        }

        if (isDecimalInteger) {
            let text = this._cs.getText().slice(start, this._cs.position);
            const simpleIntText = text.replace(underscoreRegEx, '');
            let intValue: number | bigint = parseInt(simpleIntText, 10);

            if (!isNaN(intValue)) {
                let isImaginary = false;

                const bigIntValue = BigInt(simpleIntText);
                if (
                    !isFinite(intValue) ||
                    bigIntValue < Number.MIN_SAFE_INTEGER ||
                    bigIntValue > Number.MAX_SAFE_INTEGER
                ) {
                    intValue = bigIntValue;
                }

                if (this._cs.currentChar === Char.j || this._cs.currentChar === Char.J) {
                    isImaginary = true;
                    text += String.fromCharCode(this._cs.currentChar);
                    this._cs.moveNext();
                }

                this._tokens.push(
                    NumberToken.create(start, text.length, intValue, true, isImaginary, this._getComments())
                );
                return true;
            }
        }

        // Floating point. Sign and leading digits were already skipped over.
        this._cs.position = start;
        if (
            mightBeFloatingPoint ||
            (this._cs.currentChar === Char.Period && this._cs.nextChar >= Char._0 && this._cs.nextChar <= Char._9)
        ) {
            if (this._skipFloatingPointCandidate()) {
                let text = this._cs.getText().slice(start, this._cs.position);
                const value = parseFloat(text);
                if (!isNaN(value)) {
                    let isImaginary = false;
                    if (this._cs.currentChar === Char.j || this._cs.currentChar === Char.J) {
                        isImaginary = true;
                        text += String.fromCharCode(this._cs.currentChar);
                        this._cs.moveNext();
                    }
                    this._tokens.push(
                        NumberToken.create(
                            start,
                            this._cs.position - start,
                            value,
                            false,
                            isImaginary,
                            this._getComments()
                        )
                    );
                    return true;
                }
            }
        }

        this._cs.position = start;
        return false;
    }

    private _tryOperator(): boolean {
        let length = 0;
        const nextChar = this._cs.nextChar;
        let operatorType: OperatorType;

        switch (this._cs.currentChar) {
            case Char.Plus:
                length = nextChar === Char.Equal ? 2 : 1;
                operatorType = length === 2 ? OperatorType.AddEqual : OperatorType.Add;
                break;

            case Char.Ampersand:
                length = nextChar === Char.Equal ? 2 : 1;
                operatorType = length === 2 ? OperatorType.BitwiseAndEqual : OperatorType.BitwiseAnd;
                break;

            case Char.Bar:
                length = nextChar === Char.Equal ? 2 : 1;
                operatorType = length === 2 ? OperatorType.BitwiseOrEqual : OperatorType.BitwiseOr;
                break;

            case Char.Caret:
                length = nextChar === Char.Equal ? 2 : 1;
                operatorType = length === 2 ? OperatorType.BitwiseXorEqual : OperatorType.BitwiseXor;
                break;

            case Char.Equal:
                if (
                    this._activeFString?.activeReplacementField &&
                    this._activeFString?.activeReplacementField.parenDepth === this._parenDepth &&
                    !this._activeFString.activeReplacementField.inFormatSpecifier &&
                    nextChar !== Char.Equal
                ) {
                    length = 1;
                    operatorType = OperatorType.Assign;
                    break;
                }

                length = nextChar === Char.Equal ? 2 : 1;
                operatorType = length === 2 ? OperatorType.Equals : OperatorType.Assign;
                break;

            case Char.ExclamationMark:
                if (nextChar !== Char.Equal) {
                    if (this._activeFString) {
                        // Handle the conversion separator (!) within an f-string.
                        this._tokens.push(
                            Token.create(TokenType.ExclamationMark, this._cs.position, 1, this._getComments())
                        );
                        this._cs.advance(1);
                        return true;
                    }

                    return false;
                }
                length = 2;
                operatorType = OperatorType.NotEquals;
                break;

            case Char.Percent:
                length = nextChar === Char.Equal ? 2 : 1;
                operatorType = length === 2 ? OperatorType.ModEqual : OperatorType.Mod;
                break;

            case Char.Tilde:
                length = 1;
                operatorType = OperatorType.BitwiseInvert;
                break;

            case Char.Hyphen:
                if (nextChar === Char.Greater) {
                    this._tokens.push(Token.create(TokenType.Arrow, this._cs.position, 2, this._getComments()));
                    this._cs.advance(2);
                    return true;
                }

                length = nextChar === Char.Equal ? 2 : 1;
                operatorType = length === 2 ? OperatorType.SubtractEqual : OperatorType.Subtract;
                break;

            case Char.Asterisk:
                if (nextChar === Char.Asterisk) {
                    length = this._cs.lookAhead(2) === Char.Equal ? 3 : 2;
                    operatorType = length === 3 ? OperatorType.PowerEqual : OperatorType.Power;
                } else {
                    length = nextChar === Char.Equal ? 2 : 1;
                    operatorType = length === 2 ? OperatorType.MultiplyEqual : OperatorType.Multiply;
                }
                break;

            case Char.Slash:
                if (nextChar === Char.Slash) {
                    length = this._cs.lookAhead(2) === Char.Equal ? 3 : 2;
                    operatorType = length === 3 ? OperatorType.FloorDivideEqual : OperatorType.FloorDivide;
                } else {
                    length = nextChar === Char.Equal ? 2 : 1;
                    operatorType = length === 2 ? OperatorType.DivideEqual : OperatorType.Divide;
                }
                break;

            case Char.Less:
                if (nextChar === Char.Less) {
                    length = this._cs.lookAhead(2) === Char.Equal ? 3 : 2;
                    operatorType = length === 3 ? OperatorType.LeftShiftEqual : OperatorType.LeftShift;
                } else if (nextChar === Char.Greater) {
                    length = 2;
                    operatorType = OperatorType.LessOrGreaterThan;
                } else {
                    length = nextChar === Char.Equal ? 2 : 1;
                    operatorType = length === 2 ? OperatorType.LessThanOrEqual : OperatorType.LessThan;
                }
                break;

            case Char.Greater:
                if (nextChar === Char.Greater) {
                    length = this._cs.lookAhead(2) === Char.Equal ? 3 : 2;
                    operatorType = length === 3 ? OperatorType.RightShiftEqual : OperatorType.RightShift;
                } else {
                    length = nextChar === Char.Equal ? 2 : 1;
                    operatorType = length === 2 ? OperatorType.GreaterThanOrEqual : OperatorType.GreaterThan;
                }
                break;

            case Char.At:
                length = nextChar === Char.Equal ? 2 : 1;
                operatorType = length === 2 ? OperatorType.MatrixMultiplyEqual : OperatorType.MatrixMultiply;
                break;

            default:
                return false;
        }
        this._tokens.push(OperatorToken.create(this._cs.position, length, operatorType, this._getComments()));
        this._cs.advance(length);
        return length > 0;
    }

    private _handleInvalid(): boolean {
        const start = this._cs.position;
        while (true) {
            if (
                this._cs.currentChar === Char.LineFeed ||
                this._cs.currentChar === Char.CarriageReturn ||
                this._cs.isAtWhiteSpace() ||
                this._cs.isEndOfStream()
            ) {
                break;
            }

            if (isSurrogateChar(this._cs.currentChar)) {
                this._cs.moveNext();
                this._cs.moveNext();
            } else {
                this._cs.moveNext();
            }
        }
        const length = this._cs.position - start;
        if (length > 0) {
            this._tokens.push(Token.create(TokenType.Invalid, start, length, this._getComments()));
            return true;
        }
        return false;
    }

    private _getComments(): Comment[] | undefined {
        const prevComments = this._comments;
        this._comments = undefined;
        return prevComments;
    }

    private _getIPythonMagicsKind(): MagicsKind {
        const curChar = this._cs.currentChar;
        if (curChar !== Char.Percent && curChar !== Char.ExclamationMark) {
            return MagicsKind.None;
        }

        const prevToken = this._tokens.length > 0 ? this._tokens[this._tokens.length - 1] : undefined;
        if (prevToken !== undefined && !Tokenizer.isWhitespace(prevToken)) {
            return MagicsKind.None;
        }

        if (this._cs.nextChar === curChar) {
            // Eat up next magic char.
            this._cs.moveNext();
            return MagicsKind.Cell;
        }

        return MagicsKind.Line;
    }

    private _handleIPythonMagics(type: CommentType): void {
        const start = this._cs.position + 1;

        let begin = start;
        while (true) {
            this._cs.skipToEol();

            if (type === CommentType.IPythonMagic || type === CommentType.IPythonShellEscape) {
                const length = this._cs.position - begin;
                const value = this._cs.getText().slice(begin, begin + length);

                // is it multiline magics?
                // %magic command \
                //        next arguments
                if (!value.match(magicsRegEx)) {
                    break;
                }
            }

            this._cs.moveNext();
            begin = this._cs.position + 1;

            if (this._cs.isEndOfStream()) {
                break;
            }
        }

        const length = this._cs.position - start;
        const comment = Comment.create(start, length, this._cs.getText().slice(start, start + length), type);
        this._addComments(comment);
    }

    private _handleComment(): void {
        const start = this._cs.position + 1;
        this._cs.skipToEol();

        const length = this._cs.position - start;
        const comment = Comment.create(start, length, this._cs.getText().slice(start, start + length));

        const typeIgnoreRegexMatch = comment.value.match(typeIgnoreCommentRegEx);
        if (typeIgnoreRegexMatch) {
            const commentStart = start + (typeIgnoreRegexMatch.index ?? 0);
            const textRange: TextRange = {
                start: commentStart + typeIgnoreRegexMatch[1].length,
                length: typeIgnoreRegexMatch[0].length - typeIgnoreRegexMatch[1].length,
            };
            const ignoreComment: IgnoreComment = {
                range: textRange,
                rulesList: this._getIgnoreCommentRulesList(commentStart, typeIgnoreRegexMatch),
            };

            if (this._tokens.findIndex((t) => t.type !== TokenType.NewLine && t && t.type !== TokenType.Indent) < 0) {
                this._typeIgnoreAll = ignoreComment;
            } else {
                this._typeIgnoreLines.set(this._lineRanges.length, ignoreComment);
            }
        }

        const pyrightIgnoreRegexMatch = comment.value.match(pyrightIgnoreCommentRegEx);
        if (pyrightIgnoreRegexMatch) {
            const commentStart = start + (pyrightIgnoreRegexMatch.index ?? 0);
            const textRange: TextRange = {
                start: commentStart + pyrightIgnoreRegexMatch[1].length,
                length: pyrightIgnoreRegexMatch[0].length - pyrightIgnoreRegexMatch[1].length,
            };
            const ignoreComment: IgnoreComment = {
                range: textRange,
                rulesList: this._getIgnoreCommentRulesList(commentStart, pyrightIgnoreRegexMatch),
            };
            this._pyrightIgnoreLines.set(this._lineRanges.length, ignoreComment);
        }

        this._addComments(comment);
    }

    // Extracts the individual rules within a "type: ignore [x, y, z]" comment.
    private _getIgnoreCommentRulesList(start: number, match: RegExpMatchArray): IgnoreCommentRule[] | undefined {
        if (match.length < 5 || match[4] === undefined) {
            return undefined;
        }

        const splitElements = match[4].split(',');
        const commentRules: IgnoreCommentRule[] = [];
        let currentOffset = start + match[0].indexOf('[') + 1;

        for (const element of splitElements) {
            const frontTrimmed = element.trimStart();
            currentOffset += element.length - frontTrimmed.length;
            const endTrimmed = frontTrimmed.trimEnd();

            if (endTrimmed.length > 0) {
                commentRules.push({
                    range: { start: currentOffset, length: endTrimmed.length },
                    text: cloneStr(endTrimmed),
                });
            }

            currentOffset += frontTrimmed.length + 1;
        }

        return commentRules;
    }

    private _addComments(comment: Comment) {
        if (this._comments) {
            this._comments.push(comment);
        } else {
            this._comments = [comment];
        }
    }

    private _getStringPrefixLength(): number {
        if (this._cs.currentChar === Char.SingleQuote || this._cs.currentChar === Char.DoubleQuote) {
            // Simple string, no prefix
            return 0;
        }

        if (this._cs.nextChar === Char.SingleQuote || this._cs.nextChar === Char.DoubleQuote) {
            switch (this._cs.currentChar) {
                case Char.f:
                case Char.F:
                case Char.r:
                case Char.R:
                case Char.b:
                case Char.B:
                case Char.u:
                case Char.U:
                    // Single-char prefix like u"" or r""
                    return 1;
                default:
                    break;
            }
        }

        if (this._cs.lookAhead(2) === Char.SingleQuote || this._cs.lookAhead(2) === Char.DoubleQuote) {
            const prefix = this._cs
                .getText()
                .slice(this._cs.position, this._cs.position + 2)
                .toLowerCase();
            switch (prefix) {
                case 'rf':
                case 'fr':
                case 'br':
                case 'rb':
                    return 2;
                default:
                    break;
            }
        }
        return -1;
    }

    private _getQuoteTypeFlags(prefix: string): StringTokenFlags {
        let flags = StringTokenFlags.None;

        prefix = prefix.toLowerCase();
        for (let i = 0; i < prefix.length; i++) {
            switch (prefix[i]) {
                case 'u':
                    flags |= StringTokenFlags.Unicode;
                    break;

                case 'b':
                    flags |= StringTokenFlags.Bytes;
                    break;

                case 'r':
                    flags |= StringTokenFlags.Raw;
                    break;

                case 'f':
                    flags |= StringTokenFlags.Format;
                    break;
            }
        }

        if (this._cs.currentChar === Char.SingleQuote) {
            flags |= StringTokenFlags.SingleQuote;
            if (this._cs.nextChar === Char.SingleQuote && this._cs.lookAhead(2) === Char.SingleQuote) {
                flags |= StringTokenFlags.Triplicate;
            }
        } else if (this._cs.currentChar === Char.DoubleQuote) {
            flags |= StringTokenFlags.DoubleQuote;
            if (this._cs.nextChar === Char.DoubleQuote && this._cs.lookAhead(2) === Char.DoubleQuote) {
                flags |= StringTokenFlags.Triplicate;
            }
        }

        return flags;
    }

    private _handleString(flags: StringTokenFlags, stringPrefixLength: number): void {
        const start = this._cs.position - stringPrefixLength;

        if (flags & StringTokenFlags.Format) {
            if (flags & StringTokenFlags.Triplicate) {
                this._cs.advance(3);
            } else {
                this._cs.moveNext();
            }

            const end = this._cs.position;

            const fStringStartToken = FStringStartToken.create(
                start,
                end - start,
                flags,
                stringPrefixLength,
                this._getComments()
            );

            // Create a new f-string context and push it on the stack.
            const fStringContext: FStringContext = {
                startToken: fStringStartToken,
                replacementFieldStack: [],
            };

            if (this._activeFString) {
                this._fStringStack.push(this._activeFString);
            }
            this._activeFString = fStringContext;

            this._tokens.push(fStringStartToken);
        } else {
            if (flags & StringTokenFlags.Triplicate) {
                this._cs.advance(3);
            } else {
                this._cs.moveNext();

                if (flags & StringTokenFlags.SingleQuote) {
                    this._singleQuoteCount++;
                } else {
                    this._doubleQuoteCount++;
                }
            }

            const stringLiteralInfo = this._skipToEndOfStringLiteral(flags);
            const end = this._cs.position;

            // If this is an unterminated string, see if it matches the string type
            // of an active f-string. If so, we'll treat it as an f-string end
            // token rather than an unterminated regular string. This helps with
            // parse error recovery if a closing bracket is missing in an f-string.
            if (
                (stringLiteralInfo.flags & StringTokenFlags.Unterminated) !== 0 &&
                this._activeFString?.activeReplacementField
            ) {
                if (
                    (flags &
                        (StringTokenFlags.Bytes |
                            StringTokenFlags.Unicode |
                            StringTokenFlags.Raw |
                            StringTokenFlags.Format)) ===
                    0
                ) {
                    const quoteTypeMask =
                        StringTokenFlags.Triplicate | StringTokenFlags.DoubleQuote | StringTokenFlags.SingleQuote;
                    if ((this._activeFString.startToken.flags & quoteTypeMask) === (flags & quoteTypeMask)) {
                        // Unwind to the start of this string token and terminate any replacement fields
                        // that are active. This will cause the tokenizer to re-process the quote as an
                        // FStringEnd token.
                        this._cs.position = start;
                        while (this._activeFString.replacementFieldStack.length > 0) {
                            this._activeFString.activeReplacementField =
                                this._activeFString.replacementFieldStack.pop();
                        }
                        this._parenDepth = this._activeFString.activeReplacementField!.parenDepth - 1;
                        this._activeFString.activeReplacementField = undefined;
                        return;
                    }
                }
            }

            this._tokens.push(
                StringToken.create(
                    start,
                    end - start,
                    stringLiteralInfo.flags,
                    stringLiteralInfo.escapedValue,
                    stringPrefixLength,
                    this._getComments()
                )
            );
        }
    }

    // Scans for either the FString end token or a replacement field.
    private _handleFStringMiddle(): void {
        const activeFString = this._activeFString!;
        const inFormatSpecifier = !!this._activeFString!.activeReplacementField?.inFormatSpecifier;
        const start = this._cs.position;
        const flags = activeFString.startToken.flags;
        const stringLiteralInfo = this._skipToEndOfStringLiteral(flags, inFormatSpecifier);
        const end = this._cs.position;

        const isUnterminated = (stringLiteralInfo.flags & StringTokenFlags.Unterminated) !== 0;
        const sawReplacementFieldStart = (stringLiteralInfo.flags & StringTokenFlags.ReplacementFieldStart) !== 0;
        const sawReplacementFieldEnd = (stringLiteralInfo.flags & StringTokenFlags.ReplacementFieldEnd) !== 0;
        const sawEndQuote = !isUnterminated && !sawReplacementFieldStart && !sawReplacementFieldEnd;

        let middleTokenLength = end - start;
        if (sawEndQuote) {
            middleTokenLength -= activeFString.startToken.quoteMarkLength;
        }

        if (middleTokenLength > 0 || isUnterminated) {
            this._tokens.push(
                FStringMiddleToken.create(
                    start,
                    middleTokenLength,
                    stringLiteralInfo.flags,
                    stringLiteralInfo.escapedValue
                )
            );
        }

        if (sawEndQuote) {
            this._tokens.push(
                FStringEndToken.create(
                    start + middleTokenLength,
                    activeFString.startToken.quoteMarkLength,
                    stringLiteralInfo.flags
                )
            );

            this._activeFString = this._fStringStack.pop();
        } else if (isUnterminated) {
            this._activeFString = this._fStringStack.pop();
        }
    }

    private _skipToEndOfStringLiteral(flags: StringTokenFlags, inFormatSpecifier = false): StringScannerOutput {
        const quoteChar = flags & StringTokenFlags.SingleQuote ? Char.SingleQuote : Char.DoubleQuote;
        const isTriplicate = (flags & StringTokenFlags.Triplicate) !== 0;
        const isFString = (flags & StringTokenFlags.Format) !== 0;
        let isInNamedUnicodeEscape = false;
        const start = this._cs.position;
        let escapedValueLength = 0;
        const getEscapedValue = () => this._cs.getText().slice(start, start + escapedValueLength);

        while (true) {
            if (this._cs.isEndOfStream()) {
                // Hit the end of file without a termination.
                flags |= StringTokenFlags.Unterminated;
                return {
                    escapedValue: getEscapedValue(),
                    flags,
                };
            }

            if (this._cs.currentChar === Char.Backslash) {
                escapedValueLength++;

                // Move past the escape (backslash) character.
                this._cs.moveNext();

                // Handle the special escape sequence /N{name} for unicode characters.
                if (
                    !isInNamedUnicodeEscape &&
                    this._cs.getCurrentChar() === Char.N &&
                    this._cs.nextChar === Char.OpenBrace
                ) {
                    flags |= StringTokenFlags.NamedUnicodeEscape;
                    isInNamedUnicodeEscape = true;
                } else {
                    // If this is an f-string, the only escapes that are allowed is for
                    // a single or double quote symbol or a newline/carriage return.
                    const isEscapedQuote =
                        this._cs.getCurrentChar() === Char.SingleQuote ||
                        this._cs.getCurrentChar() === Char.DoubleQuote;
                    const isEscapedNewLine =
                        this._cs.getCurrentChar() === Char.CarriageReturn ||
                        this._cs.getCurrentChar() === Char.LineFeed;
                    const isEscapedBackslash = this._cs.getCurrentChar() === Char.Backslash;

                    if (!isFString || isEscapedBackslash || isEscapedQuote || isEscapedNewLine) {
                        if (isEscapedNewLine) {
                            if (
                                this._cs.getCurrentChar() === Char.CarriageReturn &&
                                this._cs.nextChar === Char.LineFeed
                            ) {
                                escapedValueLength++;
                                this._cs.moveNext();
                            }
                            escapedValueLength++;
                            this._cs.moveNext();
                            this._addLineRange();
                        } else {
                            escapedValueLength++;
                            this._cs.moveNext();
                        }
                    }
                }
            } else if (this._cs.currentChar === Char.LineFeed || this._cs.currentChar === Char.CarriageReturn) {
                if (!isTriplicate) {
                    if (!isFString || !this._activeFString?.activeReplacementField) {
                        // Unterminated single-line string
                        flags |= StringTokenFlags.Unterminated;
                        return {
                            escapedValue: getEscapedValue(),
                            flags,
                        };
                    }
                }

                // Skip over the new line (either one or two characters).
                if (this._cs.currentChar === Char.CarriageReturn && this._cs.nextChar === Char.LineFeed) {
                    escapedValueLength++;
                    this._cs.moveNext();
                }

                escapedValueLength++;
                this._cs.moveNext();
                this._addLineRange();
            } else if (!isTriplicate && this._cs.currentChar === quoteChar) {
                this._cs.moveNext();
                break;
            } else if (
                isTriplicate &&
                this._cs.currentChar === quoteChar &&
                this._cs.nextChar === quoteChar &&
                this._cs.lookAhead(2) === quoteChar
            ) {
                this._cs.advance(3);
                break;
            } else if (!isInNamedUnicodeEscape && isFString && this._cs.currentChar === Char.OpenBrace) {
                if (inFormatSpecifier || this._cs.nextChar !== Char.OpenBrace) {
                    flags |= StringTokenFlags.ReplacementFieldStart;
                    break;
                } else {
                    escapedValueLength++;
                    this._cs.moveNext();
                    escapedValueLength++;
                    this._cs.moveNext();
                }
            } else if (isInNamedUnicodeEscape && this._cs.currentChar === Char.CloseBrace) {
                isInNamedUnicodeEscape = false;
                escapedValueLength++;
                this._cs.moveNext();
            } else if (isFString && this._cs.currentChar === Char.CloseBrace) {
                if (inFormatSpecifier || this._cs.nextChar !== Char.CloseBrace) {
                    flags |= StringTokenFlags.ReplacementFieldEnd;
                    break;
                } else {
                    escapedValueLength++;
                    this._cs.moveNext();
                    escapedValueLength++;
                    this._cs.moveNext();
                }
            } else {
                escapedValueLength++;
                this._cs.moveNext();
            }
        }

        return {
            escapedValue: getEscapedValue(),
            flags,
        };
    }

    private _skipFloatingPointCandidate(): boolean {
        // Determine end of the potential floating point number
        const start = this._cs.position;
        this._skipFractionalNumber();
        if (this._cs.position > start) {
            // Optional exponent sign
            if (this._cs.currentChar === Char.e || this._cs.currentChar === Char.E) {
                this._cs.moveNext();

                // Skip exponent value
                this._skipDecimalNumber(/* allowSign */ true);
            }
        }
        return this._cs.position > start;
    }

    private _skipFractionalNumber(): void {
        this._skipDecimalNumber(false);
        if (this._cs.currentChar === Char.Period) {
            // Optional period
            this._cs.moveNext();
        }
        this._skipDecimalNumber(false);
    }

    private _skipDecimalNumber(allowSign: boolean): void {
        if (allowSign && (this._cs.currentChar === Char.Hyphen || this._cs.currentChar === Char.Plus)) {
            // Optional sign
            this._cs.moveNext();
        }
        while (isDecimal(this._cs.currentChar)) {
            // Skip integer part
            this._cs.moveNext();
        }
    }
}
