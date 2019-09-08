/*
* tokenizerTypes.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Based on code from vscode-python repository:
*  https://github.com/Microsoft/vscode-python
*
* Interface, enumeration and class definitions used within
* the Python tokenizer.
*/

import { TextRange } from '../common/textRange';

export enum TokenType {
    Invalid,
    EndOfStream,
    NewLine,
    Indent,
    Dedent,
    String,
    Number,
    Identifier,
    Keyword,
    Operator,
    Colon,
    Semicolon,
    Comma,
    OpenParenthesis,
    CloseParenthesis,
    OpenBracket,
    CloseBracket,
    OpenCurlyBrace,
    CloseCurlyBrace,
    Ellipsis,
    Dot,
    Arrow
}

export enum NewLineType {
    CarriageReturn,
    LineFeed,
    CarriageReturnLineFeed,
    Implied
}

export enum OperatorType {
    // These operators are used with tokens
    // of type TokenType.Operator.
    Add,
    AddEqual,
    Assign,
    BitwiseAnd,
    BitwiseAndEqual,
    BitwiseInvert,
    BitwiseOr,
    BitwiseOrEqual,
    BitwiseXor,
    BitwiseXorEqual,
    Divide,
    DivideEqual,
    Equals,
    FloorDivide,
    FloorDivideEqual,
    GreaterThan,
    GreaterThanOrEqual,
    LeftShift,
    LeftShiftEqual,
    LessThan,
    LessThanOrEqual,
    MatrixMultiply,
    MatrixMultiplyEqual,
    Mod,
    ModEqual,
    Multiply,
    MultiplyEqual,
    NotEquals,
    Power,
    PowerEqual,
    RightShift,
    RightShiftEqual,
    Subtract,
    SubtractEqual,

    // These operators are used with tokens
    // of type TokenType.Keyword.
    And,
    Or,
    Not,
    Is,
    IsNot,
    In,
    NotIn
}

export enum OperatorFlags {
    Unary = 0x1,
    Binary = 0x2,
    Assignment = 0x4,
    Comparison = 0x8
}

export enum KeywordType {
    And,
    As,
    Assert,
    Async,
    Await,
    Break,
    Class,
    Continue,
    Debug,
    Def,
    Del,
    Elif,
    Else,
    Except,
    False,
    Finally,
    For,
    From,
    Global,
    If,
    Import,
    In,
    Is,
    Lambda,
    None,
    Nonlocal,
    Not,
    Or,
    Pass,
    Raise,
    Return,
    True,
    Try,
    While,
    With,
    Yield
}

export enum StringTokenFlags {
    None = 0x0,

    // Quote types
    SingleQuote = 0x1,
    DoubleQuote = 0x2,
    Triplicate = 0x4,

    // String content format
    Raw = 0x8,
    Unicode = 0x10,
    Bytes = 0x20,
    Format = 0x40,

    // Error conditions
    Unterminated = 0x1000
}

export class Comment {
    readonly value: string;
    readonly range: TextRange;

    constructor(start: number, length: number, value: string) {
        this.range = { start, length };
        this.value = value;
    }
}

export class Token implements TextRange {
    readonly type: TokenType;

    // Comments prior to the token.
    readonly start: number;
    readonly length: number;
    readonly comments?: Comment[];

    constructor(type: TokenType, start: number, length: number,
            comments: Comment[] | undefined) {

        this.start = start;
        this.length = length;
        this.type = type;
        this.comments = comments;
    }
}

export class IndentToken extends Token {
    readonly indentAmount: number;

    constructor(start: number, length: number, indentAmount: number,
            comments: Comment[] | undefined) {

        super(TokenType.Indent, start, length, comments);
        this.indentAmount = indentAmount;
    }
}

export class DedentToken extends Token {
    readonly indentAmount: number;
    readonly matchesIndent: boolean;

    constructor(start: number, length: number, indentAmount: number,
            matchesIndent: boolean, comments: Comment[] | undefined) {

        super(TokenType.Dedent, start, length, comments);
        this.indentAmount = indentAmount;
        this.matchesIndent = matchesIndent;
    }
}

export class NewLineToken extends Token {
    readonly newLineType: NewLineType;

    constructor(start: number, length: number, newLineType: NewLineType,
            comments: Comment[] | undefined) {

        super(TokenType.NewLine, start, length, comments);
        this.newLineType = newLineType;
    }
}

export class KeywordToken extends Token {
    readonly keywordType: KeywordType;

    constructor(start: number, length: number, keywordType: KeywordType,
            comments: Comment[] | undefined) {

        super(TokenType.Keyword, start, length, comments);
        this.keywordType = keywordType;
    }
}

export class StringToken extends Token {
    readonly flags: StringTokenFlags;

    // Use StringTokenUtils to convert escaped value to unescaped value.
    readonly escapedValue: string;

    // Number of characters in token that appear before
    // the quote marks (e.g. "r" or "UR").
    readonly prefixLength: number;

    // Number of characters in token that make up the quote
    // (either 1 or 3).
    readonly quoteMarkLength: number;

    constructor(start: number, length: number, flags: StringTokenFlags, escapedValue: string,
            prefixLength: number, comments: Comment[] | undefined) {

        super(TokenType.String, start, length, comments);
        this.flags = flags;
        this.escapedValue = escapedValue;
        this.prefixLength = prefixLength;
        this.quoteMarkLength = (flags & StringTokenFlags.Triplicate) ? 3 : 1;
    }
}

export class NumberToken extends Token {
    readonly value: number;
    readonly isInteger: boolean;

    constructor(start: number, length: number, value: number, isInteger: boolean,
            comments: Comment[] | undefined) {

        super(TokenType.Number, start, length, comments);
        this.value = value;
        this.isInteger = isInteger;
    }
}

export class OperatorToken extends Token {
    readonly operatorType: OperatorType;

    constructor(start: number, length: number, operatorType: OperatorType,
            comments: Comment[] | undefined) {

        super(TokenType.Operator, start, length, comments);
        this.operatorType = operatorType;
    }
}

export class IdentifierToken extends Token {
    readonly value: string;

    constructor(start: number, length: number, value: string,
            comments: Comment[] | undefined) {

        super(TokenType.Identifier, start, length, comments);
        this.value = value;
    }
}
