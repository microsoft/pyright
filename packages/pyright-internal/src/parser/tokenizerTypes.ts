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
    ExclamationMark,
    FStringStart,
    FStringMiddle,
    FStringEnd,
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
    Type,
    While,
    With,
    Yield,
}

export const softKeywords = [KeywordType.Debug, KeywordType.Match, KeywordType.Case, KeywordType.Type];

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

    // Other conditions
    ReplacementFieldStart = 1 << 7,
    ReplacementFieldEnd = 1 << 8,

    // Error conditions
    Unterminated = 1 << 16,
}

export const enum CommentType {
    Regular,
    IPythonMagic,
    IPythonShellEscape,
    IPythonCellMagic,
    IPythonCellShellEscape,
}

export type TokenPrimitive = string | number | boolean | bigint;

export interface Comment extends TextRange {
    readonly type: CommentType;
    readonly value: string;
    readonly start: number;
    readonly length: number;
}

export namespace Comment {
    export function create(start: number, length: number, value: string, type = CommentType.Regular) {
        const comment: Comment = {
            type,
            start,
            length,
            value,
        };

        return comment;
    }

    export function toArray(comments: Comment[] | undefined) {
        const commentsLength = comments?.length || 0;
        const commentsArray = comments?.map((c) => [c.type, c.start, c.length, c.value]) || [];
        return [commentsLength, ...commentsArray.flat()];
    }

    export function fromArray(data: TokenPrimitive[]): Comment[] | undefined {
        const commentsLength = data[0] as number;
        const commentsArray: Comment[] = [];
        for (let i = 0; i < commentsLength; i++) {
            const slice = data.slice(1 + i * 4);
            commentsArray.push(
                create(slice[1] as number, slice[2] as number, slice[3] as string, slice[0] as CommentType)
            );
        }
        return commentsArray.length > 0 ? commentsArray : undefined;
    }
}

export interface TokenBase extends TextRange {
    readonly type: TokenType;

    // Comments prior to the token.
    readonly comments?: Comment[] | undefined;
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

    export function toArray(token: Token): TokenPrimitive[] {
        switch (token.type) {
            case TokenType.Indent:
                return IndentToken.toArray(token as IndentToken);
            case TokenType.Dedent:
                return DedentToken.toArray(token as DedentToken);
            case TokenType.NewLine:
                return NewLineToken.toArray(token as NewLineToken);
            case TokenType.Keyword:
                return KeywordToken.toArray(token as KeywordToken);
            case TokenType.String:
                return StringToken.toArray(token as StringToken);
            case TokenType.FStringStart:
                return FStringStartToken.toArray(token as FStringStartToken);
            case TokenType.FStringMiddle:
                return FStringMiddleToken.toArray(token as FStringMiddleToken);
            case TokenType.FStringEnd:
                return FStringEndToken.toArray(token as FStringEndToken);
            case TokenType.Number:
                return NumberToken.toArray(token as NumberToken);
            case TokenType.Operator:
                return OperatorToken.toArray(token as OperatorToken);
            case TokenType.Identifier:
                return IdentifierToken.toArray(token as IdentifierToken);
            default:
                return [token.type, token.start, token.length, ...Comment.toArray(token.comments)];
        }
    }

    export function fromArray(data: TokenPrimitive[]) {
        switch (data[0] as TokenType) {
            case TokenType.Indent:
                return IndentToken.fromArray(data);
            case TokenType.Dedent:
                return DedentToken.fromArray(data);
            case TokenType.NewLine:
                return NewLineToken.fromArray(data);
            case TokenType.Keyword:
                return KeywordToken.fromArray(data);
            case TokenType.String:
                return StringToken.fromArray(data);
            case TokenType.FStringStart:
                return FStringStartToken.fromArray(data);
            case TokenType.FStringMiddle:
                return FStringMiddleToken.fromArray(data);
            case TokenType.FStringEnd:
                return FStringEndToken.fromArray(data);
            case TokenType.Number:
                return NumberToken.fromArray(data);
            case TokenType.Operator:
                return OperatorToken.fromArray(data);
            case TokenType.Identifier:
                return IdentifierToken.fromArray(data);
            default:
                return create(
                    data[0] as TokenType,
                    data[1] as number,
                    data[2] as number,
                    Comment.fromArray(data.slice(3))
                );
        }
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

    export function toArray(token: IndentToken): TokenPrimitive[] {
        return [
            token.type,
            token.start,
            token.length,
            token.indentAmount,
            token.isIndentAmbiguous,
            ...Comment.toArray(token.comments),
        ];
    }

    export function fromArray(data: TokenPrimitive[]) {
        return create(
            data[1] as number,
            data[2] as number,
            data[3] as number,
            data[4] as boolean,
            Comment.fromArray(data.slice(5))
        );
    }
}

export interface DedentToken extends Token {
    readonly type: TokenType.Dedent;
    readonly indentAmount: number;
    readonly matchesIndent: boolean;
    readonly isDedentAmbiguous: boolean;
}

export namespace DedentToken {
    export function create(
        start: number,
        length: number,
        indentAmount: number,
        matchesIndent: boolean,
        isDedentAmbiguous: boolean,
        comments: Comment[] | undefined
    ) {
        const token: DedentToken = {
            start,
            length,
            type: TokenType.Dedent,
            comments,
            indentAmount,
            matchesIndent,
            isDedentAmbiguous,
        };

        return token;
    }

    export function toArray(token: DedentToken): TokenPrimitive[] {
        return [
            token.type,
            token.start,
            token.length,
            token.indentAmount,
            token.matchesIndent,
            token.isDedentAmbiguous,
            ...Comment.toArray(token.comments),
        ];
    }

    export function fromArray(data: TokenPrimitive[]) {
        return create(
            data[1] as number,
            data[2] as number,
            data[3] as number,
            data[4] as boolean,
            data[5] as boolean,
            Comment.fromArray(data.slice(6))
        );
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

    export function toArray(token: NewLineToken): TokenPrimitive[] {
        return [token.type, token.start, token.length, token.newLineType, ...Comment.toArray(token.comments)];
    }

    export function fromArray(data: TokenPrimitive[]) {
        return create(data[1] as number, data[2] as number, data[3] as NewLineType, Comment.fromArray(data.slice(4)));
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

    export function toArray(token: KeywordToken): TokenPrimitive[] {
        return [token.type, token.start, token.length, token.keywordType, ...Comment.toArray(token.comments)];
    }

    export function fromArray(data: TokenPrimitive[]) {
        return create(data[1] as number, data[2] as number, data[3] as KeywordType, Comment.fromArray(data.slice(4)));
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

    export function toArray(token: StringToken): TokenPrimitive[] {
        return [
            token.type,
            token.start,
            token.length,
            token.flags,
            token.escapedValue,
            token.prefixLength,
            ...Comment.toArray(token.comments),
        ];
    }

    export function fromArray(data: TokenPrimitive[]): StringToken {
        return create(
            data[1] as number,
            data[2] as number,
            data[3] as StringTokenFlags,
            data[4] as string,
            data[5] as number,
            Comment.fromArray(data.slice(6))
        );
    }
}

export interface FStringStartToken extends Token {
    readonly type: TokenType.FStringStart;
    readonly flags: StringTokenFlags;

    // Number of characters in token that appear before
    // the quote marks (e.g. "r" or "UR").
    readonly prefixLength: number;

    // Number of characters in token that make up the quote
    // (either 1 or 3).
    readonly quoteMarkLength: number;
}

export namespace FStringStartToken {
    export function create(
        start: number,
        length: number,
        flags: StringTokenFlags,
        prefixLength: number,
        comments: Comment[] | undefined
    ) {
        const token: FStringStartToken = {
            start,
            length,
            type: TokenType.FStringStart,
            flags,
            prefixLength,
            quoteMarkLength: flags & StringTokenFlags.Triplicate ? 3 : 1,
            comments,
        };

        return token;
    }

    export function toArray(token: FStringStartToken): TokenPrimitive[] {
        return [
            token.type,
            token.start,
            token.length,
            token.flags,
            token.prefixLength,
            ...Comment.toArray(token.comments),
        ];
    }

    export function fromArray(data: TokenPrimitive[]): FStringStartToken {
        return create(
            data[1] as number,
            data[2] as number,
            data[3] as StringTokenFlags,
            data[4] as number,
            Comment.fromArray(data.slice(5))
        );
    }
}

export interface FStringMiddleToken extends Token {
    readonly type: TokenType.FStringMiddle;
    readonly flags: StringTokenFlags;

    // Use StringTokenUtils to convert escaped value to unescaped value.
    readonly escapedValue: string;
}

export namespace FStringMiddleToken {
    export function create(start: number, length: number, flags: StringTokenFlags, escapedValue: string) {
        const token: FStringMiddleToken = {
            start,
            length,
            type: TokenType.FStringMiddle,
            flags,
            escapedValue,
        };

        return token;
    }

    export function toArray(token: FStringMiddleToken): TokenPrimitive[] {
        return [
            token.type,
            token.start,
            token.length,
            token.flags,
            token.escapedValue,
            ...Comment.toArray(token.comments),
        ];
    }

    export function fromArray(data: TokenPrimitive[]): FStringMiddleToken {
        return create(data[1] as number, data[2] as number, data[3] as StringTokenFlags, data[4] as string);
    }
}

export interface FStringEndToken extends Token {
    readonly type: TokenType.FStringEnd;
    readonly flags: StringTokenFlags;
}

export namespace FStringEndToken {
    export function create(start: number, length: number, flags: StringTokenFlags) {
        const token: FStringEndToken = {
            start,
            length,
            type: TokenType.FStringEnd,
            flags,
        };

        return token;
    }

    export function toArray(token: FStringEndToken): TokenPrimitive[] {
        return [token.type, token.start, token.length, token.flags, ...Comment.toArray(token.comments)];
    }

    export function fromArray(data: TokenPrimitive[]): FStringEndToken {
        return create(data[1] as number, data[2] as number, data[3] as StringTokenFlags);
    }
}

export interface NumberToken extends Token {
    readonly type: TokenType.Number;
    readonly value: number | bigint;
    readonly isInteger: boolean;
    readonly isImaginary: boolean;
}

export namespace NumberToken {
    export function create(
        start: number,
        length: number,
        value: number | bigint,
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

    export function toArray(token: NumberToken): TokenPrimitive[] {
        return [
            token.type,
            token.start,
            token.length,
            token.value,
            token.isInteger,
            token.isImaginary,
            ...Comment.toArray(token.comments),
        ];
    }

    export function fromArray(data: TokenPrimitive[]): NumberToken {
        return create(
            data[1] as number,
            data[2] as number,
            data[3] as number | bigint,
            data[4] as boolean,
            data[5] as boolean,
            Comment.fromArray(data.slice(6))
        );
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

    export function toArray(token: OperatorToken): TokenPrimitive[] {
        return [token.type, token.start, token.length, token.operatorType, ...Comment.toArray(token.comments)];
    }

    export function fromArray(data: TokenPrimitive[]): OperatorToken {
        return create(data[1] as number, data[2] as number, data[3] as OperatorType, Comment.fromArray(data.slice(4)));
    }
}

export interface IdentifierToken extends Token {
    readonly type: TokenType.Identifier;
    readonly value: string;
}

export namespace IdentifierToken {
    export function create(start: number, length: number, value: string, comments: Comment[] | undefined) {
        // Perform "NFKC normalization", as per the Python lexical spec.
        const normalizedValue = value.normalize('NFKC');

        const token: IdentifierToken = {
            start,
            length,
            type: TokenType.Identifier,
            value: normalizedValue,
            comments,
        };

        return token;
    }

    export function toArray(token: IdentifierToken): TokenPrimitive[] {
        return [token.type, token.start, token.length, token.value, ...Comment.toArray(token.comments)];
    }

    export function fromArray(data: TokenPrimitive[]): IdentifierToken {
        return create(data[1] as number, data[2] as number, data[3] as string, Comment.fromArray(data.slice(4)));
    }
}
