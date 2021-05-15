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

export const enum TokenType {
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
    Arrow,
    Backtick,
}

export const enum NewLineType {
    CarriageReturn,
    LineFeed,
    CarriageReturnLineFeed,
    Implied,
}

export const enum OperatorType {
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
    LessOrGreaterThan,
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
    Walrus,

    // These operators are used with tokens
    // of type TokenType.Keyword.
    And,
    Or,
    Not,
    Is,
    IsNot,
    In,
    NotIn,
}

export const enum OperatorFlags {
    Unary = 1 << 0,
    Binary = 1 << 1,
    Assignment = 1 << 2,
    Comparison = 1 << 3,
    Deprecated = 1 << 4,
}

export const enum KeywordType {
    And,
    As,
    Assert,
    Async,
    Await,
    Break,
    Case,
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
    Match,
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
    Yield,
}

export const enum StringTokenFlags {
    None = 0,

    // Quote types
    SingleQuote = 1 << 0,
    DoubleQuote = 1 << 1,
    Triplicate = 1 << 2,

    // String content format
    Raw = 1 << 3,
    Unicode = 1 << 4,
    Bytes = 1 << 5,
    Format = 1 << 6,

    // Error conditions
    Unterminated = 1 << 16,
}

export interface Comment extends TextRange {
    readonly value: string;
    readonly start: number;
    readonly length: number;
}

export namespace Comment {
    export function create(start: number, length: number, value: string) {
        const comment: Comment = {
            start,
            length,
            value,
        };

        return comment;
    }
}

export interface TokenBase extends TextRange {
    readonly type: TokenType;

    // Comments prior to the token.
    readonly comments?: Comment[];
}

export interface Token extends TokenBase {}

export namespace Token {
    export function create(type: TokenType, start: number, length: number, comments: Comment[] | undefined) {
        const token: Token = {
            start,
            length,
            type,
            comments,
        };

        return token;
    }
}

export interface IndentToken extends Token {
    readonly type: TokenType.Indent;
    readonly indentAmount: number;
    readonly isIndentAmbiguous: boolean;
}

export namespace IndentToken {
    export function create(
        start: number,
        length: number,
        indentAmount: number,
        isIndentAmbiguous: boolean,
        comments: Comment[] | undefined
    ) {
        const token: IndentToken = {
            start,
            length,
            type: TokenType.Indent,
            isIndentAmbiguous,
            comments,
            indentAmount,
        };

        return token;
    }
}

export interface DedentToken extends Token {
    readonly type: TokenType.Dedent;
    readonly indentAmount: number;
    readonly matchesIndent: boolean;
}

export namespace DedentToken {
    export function create(
        start: number,
        length: number,
        indentAmount: number,
        matchesIndent: boolean,
        comments: Comment[] | undefined
    ) {
        const token: DedentToken = {
            start,
            length,
            type: TokenType.Dedent,
            comments,
            indentAmount,
            matchesIndent,
        };

        return token;
    }
}

export interface NewLineToken extends Token {
    readonly type: TokenType.NewLine;
    readonly newLineType: NewLineType;
}

export namespace NewLineToken {
    export function create(start: number, length: number, newLineType: NewLineType, comments: Comment[] | undefined) {
        const token: NewLineToken = {
            start,
            length,
            type: TokenType.NewLine,
            comments,
            newLineType,
        };

        return token;
    }
}

export interface KeywordToken extends Token {
    readonly type: TokenType.Keyword;
    readonly keywordType: KeywordType;
}

export namespace KeywordToken {
    export function create(start: number, length: number, keywordType: KeywordType, comments: Comment[] | undefined) {
        const token: KeywordToken = {
            start,
            length,
            type: TokenType.Keyword,
            comments,
            keywordType,
        };

        return token;
    }
}

export interface StringToken extends Token {
    readonly type: TokenType.String;
    readonly flags: StringTokenFlags;

    // Use StringTokenUtils to convert escaped value to unescaped value.
    readonly escapedValue: string;

    // Number of characters in token that appear before
    // the quote marks (e.g. "r" or "UR").
    readonly prefixLength: number;

    // Number of characters in token that make up the quote
    // (either 1 or 3).
    readonly quoteMarkLength: number;
}

export namespace StringToken {
    export function create(
        start: number,
        length: number,
        flags: StringTokenFlags,
        escapedValue: string,
        prefixLength: number,
        comments: Comment[] | undefined
    ) {
        const token: StringToken = {
            start,
            length,
            type: TokenType.String,
            flags,
            escapedValue,
            prefixLength,
            quoteMarkLength: flags & StringTokenFlags.Triplicate ? 3 : 1,
            comments,
        };

        return token;
    }
}

export interface NumberToken extends Token {
    readonly type: TokenType.Number;
    readonly value: number;
    readonly isInteger: boolean;
    readonly isImaginary: boolean;
}

export namespace NumberToken {
    export function create(
        start: number,
        length: number,
        value: number,
        isInteger: boolean,
        isImaginary: boolean,
        comments: Comment[] | undefined
    ) {
        const token: NumberToken = {
            start,
            length,
            type: TokenType.Number,
            isInteger,
            isImaginary,
            value,
            comments,
        };

        return token;
    }
}

export interface OperatorToken extends Token {
    readonly type: TokenType.Operator;
    readonly operatorType: OperatorType;
}

export namespace OperatorToken {
    export function create(start: number, length: number, operatorType: OperatorType, comments: Comment[] | undefined) {
        const token: OperatorToken = {
            start,
            length,
            type: TokenType.Operator,
            operatorType,
            comments,
        };

        return token;
    }
}

export interface IdentifierToken extends Token {
    readonly type: TokenType.Identifier;
    readonly value: string;
}

export namespace IdentifierToken {
    export function create(start: number, length: number, value: string, comments: Comment[] | undefined) {
        const token: IdentifierToken = {
            start,
            length,
            type: TokenType.Identifier,
            value,
            comments,
        };

        return token;
    }
}
