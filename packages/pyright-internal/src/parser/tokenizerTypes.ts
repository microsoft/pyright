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

    export function toCompressed(comments: Comment[] | undefined): number[] {
        // String value isn't necessary to save because start + length encapsulates where in the
        // original text the comment was.
        const commentsArray = comments?.map((c) => [c.type, c.start, c.length]) || [];
        return commentsArray.flat();
    }

    export function fromCompressed(
        data: Int32Array,
        base: string,
        start: number,
        length: number
    ): Comment[] | undefined {
        const commentsArray: Comment[] = [];
        for (let i = 0; i < length; i++) {
            const sliceIndex = start + i * 4;
            const commentStart = data[sliceIndex + 1];
            const commentLength = data[sliceIndex + 2];
            commentsArray.push(
                create(
                    commentStart,
                    commentLength,
                    base.slice(commentStart, commentStart + commentLength),
                    data[sliceIndex] as CommentType
                )
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

    export function extractTokenType(data: number): TokenType {
        return data & 0xffff;
    }

    export function extractCommentLength(data: number) {
        return data >> 16;
    }

    export function combineTypeAndLength(type: TokenType, comments: Comment[] | undefined): number {
        const commentLength = comments?.length || 0;
        return (type & 0xffff) | (commentLength << 16);
    }

    export function toCompressed(token: Token, numberData: (number | bigint)[]): number[] {
        switch (token.type) {
            case TokenType.Indent:
                return IndentToken.toCompressed(token as IndentToken);
            case TokenType.Dedent:
                return DedentToken.toCompressed(token as DedentToken);
            case TokenType.NewLine:
                return NewLineToken.toCompressed(token as NewLineToken);
            case TokenType.Keyword:
                return KeywordToken.toCompressed(token as KeywordToken);
            case TokenType.String:
                return StringToken.toCompressed(token as StringToken);
            case TokenType.FStringStart:
                return FStringStartToken.toCompressed(token as FStringStartToken);
            case TokenType.FStringMiddle:
                return FStringMiddleToken.toCompressed(token as FStringMiddleToken);
            case TokenType.FStringEnd:
                return FStringEndToken.toCompressed(token as FStringEndToken);
            case TokenType.Number:
                return NumberToken.toCompressed(token as NumberToken, numberData);
            case TokenType.Operator:
                return OperatorToken.toCompressed(token as OperatorToken);
            case TokenType.Identifier:
                return IdentifierToken.toCompressed(token as IdentifierToken);
            default:
                // Type and comments length are merged. Assuming less than 32k comments.
                return [
                    combineTypeAndLength(token.type, token.comments),
                    token.start,
                    token.length,
                    ...Comment.toCompressed(token.comments),
                ];
        }
    }

    export function fromCompressed(data: Int32Array, start: number, base: string, numberData: (number | bigint)[]) {
        const tokenType = extractTokenType(data[start]);
        switch (tokenType) {
            case TokenType.Indent:
                return IndentToken.fromCompressed(data, start, base);
            case TokenType.Dedent:
                return DedentToken.fromCompressed(data, start, base);
            case TokenType.NewLine:
                return NewLineToken.fromCompressed(data, start, base);
            case TokenType.Keyword:
                return KeywordToken.fromCompressed(data, start, base);
            case TokenType.String:
                return StringToken.fromCompressed(data, start, base);
            case TokenType.FStringStart:
                return FStringStartToken.fromCompressed(data, start, base);
            case TokenType.FStringMiddle:
                return FStringMiddleToken.fromCompressed(data, start, base);
            case TokenType.FStringEnd:
                return FStringEndToken.fromCompressed(data, start);
            case TokenType.Number:
                return NumberToken.fromCompressed(data, start, base, numberData);
            case TokenType.Operator:
                return OperatorToken.fromCompressed(data, start, base);
            case TokenType.Identifier:
                return IdentifierToken.fromCompressed(data, start, base);
            default:
                return create(
                    tokenType,
                    data[start + 1],
                    data[start + 2],
                    Comment.fromCompressed(data, base, start + 3, extractCommentLength(data[start]))
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

    export function toCompressed(token: IndentToken): number[] {
        return [
            Token.combineTypeAndLength(token.type, token.comments),
            token.start,
            token.length,
            token.indentAmount,
            token.isIndentAmbiguous ? 1 : 0,
            ...Comment.toCompressed(token.comments),
        ];
    }

    export function fromCompressed(data: Int32Array, start: number, base: string) {
        return create(
            data[start + 1],
            data[start + 2],
            data[start + 3],
            data[start + 4] ? true : false,
            Comment.fromCompressed(data, base, start + 5, Token.extractCommentLength(data[start]))
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

    export function toCompressed(token: DedentToken): number[] {
        return [
            Token.combineTypeAndLength(token.type, token.comments),
            token.start,
            token.length,
            token.indentAmount,
            token.matchesIndent ? 1 : 0,
            token.isDedentAmbiguous ? 1 : 0,
            ...Comment.toCompressed(token.comments),
        ];
    }

    export function fromCompressed(data: Int32Array, start: number, base: string) {
        return create(
            data[start + 1],
            data[start + 2],
            data[start + 3],
            data[start + 4] ? true : false,
            data[start + 5] ? true : false,
            Comment.fromCompressed(data, base, start + 6, Token.extractCommentLength(data[start]))
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

    export function toCompressed(token: NewLineToken): number[] {
        return [
            Token.combineTypeAndLength(token.type, token.comments),
            token.start,
            token.length,
            token.newLineType,
            ...Comment.toCompressed(token.comments),
        ];
    }

    export function fromCompressed(data: Int32Array, start: number, base: string) {
        return create(
            data[start + 1] as number,
            data[start + 2] as number,
            data[start + 3] as NewLineType,
            Comment.fromCompressed(data, base, start + 4, Token.extractCommentLength(data[start]))
        );
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

    export function toCompressed(token: KeywordToken): number[] {
        return [
            Token.combineTypeAndLength(token.type, token.comments),
            token.start,
            token.length,
            token.keywordType,
            ...Comment.toCompressed(token.comments),
        ];
    }

    export function fromCompressed(data: Int32Array, start: number, base: string) {
        return create(
            data[start + 1] as number,
            data[start + 2] as number,
            data[start + 3] as KeywordType,
            Comment.fromCompressed(data, base, start + 4, Token.extractCommentLength(data[start]))
        );
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

    export function toCompressed(token: StringToken): number[] {
        // Start + length + prefixLength and flags can be used to generate the string
        // from the original string, so no need to store the original string.
        return [
            Token.combineTypeAndLength(token.type, token.comments),
            token.start,
            token.length,
            token.flags,
            token.prefixLength,
            ...Comment.toCompressed(token.comments),
        ];
    }

    export function computeEscapedString(
        base: string,
        tokenStart: number,
        tokenLength: number,
        prefixLength: number,
        flags: StringTokenFlags
    ): string {
        const stringOffset = prefixLength + (flags & StringTokenFlags.Triplicate ? 3 : 1);
        const stringLength =
            tokenLength -
            stringOffset -
            (flags & StringTokenFlags.Unterminated ? 0 : flags & StringTokenFlags.Triplicate ? 3 : 1);
        return base.slice(tokenStart + stringOffset, tokenStart + stringOffset + stringLength);
    }

    export function fromCompressed(data: Int32Array, start: number, base: string): StringToken {
        const tokenStart = data[start + 1];
        const tokenLength = data[start + 2];
        const flags = data[start + 3] as StringTokenFlags;
        const prefixLength = data[start + 4];
        return create(
            tokenStart,
            tokenLength,
            flags,
            StringToken.computeEscapedString(base, tokenStart, tokenLength, prefixLength, flags),
            prefixLength,
            Comment.fromCompressed(data, base, start + 5, Token.extractCommentLength(data[start]))
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

    export function toCompressed(token: FStringStartToken): number[] {
        return [
            Token.combineTypeAndLength(token.type, token.comments),
            token.start,
            token.length,
            token.flags,
            token.prefixLength,
            ...Comment.toCompressed(token.comments),
        ];
    }

    export function fromCompressed(data: Int32Array, start: number, base: string): FStringStartToken {
        return create(
            data[start + 1] as number,
            data[start + 2] as number,
            data[start + 3] as StringTokenFlags,
            data[start + 4] as number,
            Comment.fromCompressed(data, base, start + 5, Token.extractCommentLength(data[start]))
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

    export function toCompressed(token: FStringMiddleToken): number[] {
        // Start + length in the original string describe the escaped value so no need
        // to return it.
        return [Token.combineTypeAndLength(token.type, undefined), token.start, token.length, token.flags];
    }

    export function fromCompressed(data: Int32Array, start: number, base: string): FStringMiddleToken {
        const stringStart = data[start + 1];
        const stringLength = data[start + 2];
        return create(
            stringStart,
            stringLength,
            data[start + 3] as StringTokenFlags,
            base.slice(stringStart, stringStart + stringLength)
        );
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

    export function toCompressed(token: FStringEndToken): number[] {
        return [Token.combineTypeAndLength(token.type, undefined), token.start, token.length, token.flags];
    }

    export function fromCompressed(data: Int32Array, start: number): FStringEndToken {
        return create(data[start + 1] as number, data[start + 2] as number, data[start + 3] as StringTokenFlags);
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

    export function toCompressed(token: NumberToken, numberData: (number | bigint)[]): number[] {
        const numberDataPosition = numberData.length;
        numberData.push(token.value);
        return [
            Token.combineTypeAndLength(token.type, token.comments),
            token.start,
            token.length,
            numberDataPosition,
            token.isInteger ? 1 : 0,
            token.isImaginary ? 1 : 0,
            ...Comment.toCompressed(token.comments),
        ];
    }

    export function fromCompressed(
        data: Int32Array,
        start: number,
        base: string,
        numberData: (number | bigint)[]
    ): NumberToken {
        const numberDataPosition = data[start + 3];
        return create(
            data[start + 1] as number,
            data[start + 2] as number,
            numberData[numberDataPosition],
            data[start + 4] ? true : false,
            data[start + 5] ? true : false,
            Comment.fromCompressed(data, base, start + 6, Token.extractCommentLength(data[start]))
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

    export function toCompressed(token: OperatorToken): number[] {
        return [
            Token.combineTypeAndLength(token.type, token.comments),
            token.start,
            token.length,
            token.operatorType,
            ...Comment.toCompressed(token.comments),
        ];
    }

    export function fromCompressed(data: Int32Array, start: number, base: string): OperatorToken {
        return create(
            data[start + 1] as number,
            data[start + 2] as number,
            data[start + 3] as OperatorType,
            Comment.fromCompressed(data, base, start + 4, Token.extractCommentLength(data[start]))
        );
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

    export function toCompressed(token: IdentifierToken): number[] {
        // Value usually comes from the base string. If it's empty it won't. Use a - as
        // a flag to indicate this case.
        const minimizedLength = token.value ? token.length : -token.length;
        return [
            Token.combineTypeAndLength(token.type, token.comments),
            token.start,
            minimizedLength,
            ...Comment.toCompressed(token.comments),
        ];
    }

    export function fromCompressed(data: Int32Array, start: number, base: string): IdentifierToken {
        const stringStart = data[start + 1];
        const stringLength = data[start + 2];
        const value = stringLength < 0 ? '' : base.slice(stringStart, stringStart + stringLength);
        return create(
            stringStart,
            Math.abs(stringLength),
            value,
            Comment.fromCompressed(data, base, start + 3, Token.extractCommentLength(data[start]))
        );
    }
}
