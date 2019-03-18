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
    Divide,
    DivideEqual,
    Equals,
    ExclusiveOr,
    ExclusiveOrEqual,
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

export enum QuoteTypeFlags {
    None = 0x0,
    SingleQuote = 0x1,
    DoubleQuote = 0x2,
    Triplicate = 0x4,
    Raw = 0x8,
    Unicode = 0x10,
    Byte = 0x20
}

export class Token extends TextRange implements Token {
    readonly type: TokenType;

    constructor(type: TokenType, start: number, length: number) {
        super(start, length);
        this.type = type;
    }
}

export class IndentToken extends Token {
    readonly indentAmount: number;

    constructor(start: number, length: number, indentAmount: number) {
        super(TokenType.Indent, start, length);
        this.indentAmount = indentAmount;
    }
}

export class DedentToken extends Token {
    readonly indentAmount: number;
    readonly matchesIndent: boolean;

    constructor(start: number, length: number, indentAmount: number, matchesIndent: boolean) {
        super(TokenType.Dedent, start, length);
        this.indentAmount = indentAmount;
        this.matchesIndent = matchesIndent;
    }
}

export class NewLineToken extends Token {
    readonly newLineType: NewLineType;

    constructor(start: number, length: number, newLineType: NewLineType) {
        super(TokenType.NewLine, start, length);
        this.newLineType = newLineType;
    }
}

export class KeywordToken extends Token {
    readonly keywordType: KeywordType;

    constructor(start: number, length: number, keywordType: KeywordType) {
        super(TokenType.Keyword, start, length);
        this.keywordType = keywordType;
    }
}

export class StringToken extends Token {
    readonly quoteTypeFlags: QuoteTypeFlags;
    readonly value: string;

    constructor(start: number, length: number, quoteTypeFlags: QuoteTypeFlags, value: string) {
        super(TokenType.String, start, length);
        this.quoteTypeFlags = quoteTypeFlags;
        this.value = value;
    }
}

export class NumberToken extends Token {
    readonly value: number;
    readonly isInteger: boolean;

    constructor(start: number, length: number, value: number, isInteger: boolean) {
        super(TokenType.Number, start, length);
        this.value = value;
        this.isInteger = isInteger;
    }
}

export class OperatorToken extends Token {
    readonly operatorType: OperatorType;

    constructor(start: number, length: number, operatorType: OperatorType) {
        super(TokenType.Operator, start, length);
        this.operatorType = operatorType;
    }
}

export class IdentifierToken extends Token {
    readonly value: string;

    constructor(start: number, length: number, value: string) {
        super(TokenType.Identifier, start, length);
        this.value = value;
    }
}
