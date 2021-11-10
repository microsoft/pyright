/*
 * indentationUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Provides code to get indentation and re-indent code to the given indentation.
 */

import Char from 'typescript-char';

import {
    findNodeByOffset,
    getFirstAncestorOrSelf,
    getFirstAncestorOrSelfOfKind,
    getStringValueRange,
    getTokenAt,
} from '../analyzer/parseTreeUtils';
import { convertOffsetToPosition, convertTextRangeToRange } from '../common/positionUtils';
import { TextRange } from '../common/textRange';
import { TextRangeCollection } from '../common/textRangeCollection';
import { ModuleNode, ParseNode, ParseNodeType, SuiteNode } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';
import {
    IndentToken,
    KeywordToken,
    KeywordType,
    StringToken,
    StringTokenFlags,
    Token,
    TokenType,
} from '../parser/tokenizerTypes';

export function getIndentation(parseResults: ParseResults, offset: number, preferDedent?: boolean): number {
    // ex)
    // a = """
    //      | <= here
    const strIndent = _tryHandleStringLiterals(parseResults, offset);
    if (strIndent !== undefined) {
        return strIndent;
    }

    // ex)
    // a = 1 + \
    //     | <= here
    // or
    // a = (1 +
    //     | <= here
    const exprIndent = _tryHandleMultilineConstructs(parseResults, offset);
    if (exprIndent !== undefined) {
        return exprIndent;
    }

    preferDedent = preferDedent ?? _shouldDedentAfterKeyword(parseResults.tokenizerOutput.tokens, offset);
    return Math.max(_getIndentation(parseResults, offset, preferDedent).indentation, 0);
}

function _getIndentation(
    parseResults: ParseResults,
    offset: number,
    preferDedent: boolean
): { token?: Token; indentation: number } {
    const tokens = parseResults.tokenizerOutput.tokens;
    const startingToken = _findPreviousNonWhitespaceToken(tokens, offset);
    if (!startingToken) {
        return {
            indentation: 0,
        };
    }

    const node = findNodeByOffset(parseResults.parseTree, TextRange.getEnd(startingToken));
    if (!node) {
        return {
            indentation: 0,
        };
    }

    const suite = getFirstAncestorOrSelfOfKind(node, ParseNodeType.Suite);
    if (!suite) {
        return _getIndentationForNode(parseResults, parseResults.parseTree, node);
    }

    const suiteSpan = convertTextRangeToRange(suite, parseResults.tokenizerOutput.lines);
    if (preferDedent || suiteSpan.start.line === suiteSpan.end.line) {
        // Go one more level up.
        const outerContainer = getFirstAncestorOrSelf(
            suite,
            (n) => n !== suite && n.nodeType === ParseNodeType.Suite
        ) as SuiteNode | undefined;
        return _getIndentationForNode(parseResults, outerContainer ?? parseResults.parseTree, suite);
    }

    return _getIndentationForNode(parseResults, suite, node);
}

function _getIndentationForNode(
    parseResults: ParseResults,
    container: ModuleNode | SuiteNode,
    current: ParseNode
): { token?: Token; indentation: number } {
    if (container.nodeType === ParseNodeType.Module) {
        // It is at the module level
        return {
            token: _getFirstTokenOFStatement(parseResults, container, current),
            indentation: 0,
        };
    }

    if (container.statements.filter((s) => s.length > 0).length === 0) {
        const tabSize = parseResults.tokenizerOutput.predominantTabSequence.length;
        const outerContainer = getFirstAncestorOrSelf(
            container,
            (n) => n !== container && n.nodeType === ParseNodeType.Suite
        ) as SuiteNode | undefined;

        const result = _getIndentationForNode(parseResults, outerContainer ?? parseResults.parseTree, container);
        return {
            token: result.token,
            indentation: result.indentation + tabSize,
        };
    } else {
        const tokens = parseResults.tokenizerOutput.tokens;
        return {
            token: _getFirstTokenOFStatement(parseResults, container, current),
            indentation: _getIndentationFromIndentToken(tokens, tokens.getItemAtPosition(container.start)),
        };
    }
}

function _getFirstTokenOFStatement(
    parseResults: ParseResults,
    container: ModuleNode | SuiteNode,
    span: TextRange
): Token {
    const tokens = parseResults.tokenizerOutput.tokens;
    for (const statement of container.statements) {
        if (!TextRange.containsRange(statement, span)) {
            continue;
        }

        return getTokenAt(tokens, statement.start)!;
    }

    return getTokenAt(tokens, container.start)!;
}

function _getIndentationFromIndentToken(tokens: TextRangeCollection<Token>, index: number) {
    for (let i = index; i < tokens.count; i++) {
        const token = _getTokenAtIndex(tokens, i);
        if (token?.type === TokenType.Indent) {
            return (token as IndentToken).indentAmount;
        }
    }

    // At the module level.
    return 0;
}

function _tryHandleMultilineConstructs(parseResults: ParseResults, offset: number): number | undefined {
    const tokens = parseResults.tokenizerOutput.tokens;

    // Make sure we use next token to get line delta.
    // This is just to handle how tokenizer associates new lines to which token.
    // ex) a = 1 + \
    //         | <= here
    //    [b] = 2
    const index = _findNextTokenIndex(tokens, offset);
    if (index < 0) {
        return undefined;
    }

    const lines = parseResults.tokenizerOutput.lines;
    const tabSize = parseResults.tokenizerOutput.predominantTabSequence.length;

    for (let i = index; i > 0; i--) {
        const token = _getTokenAtIndex(tokens, i)!;
        if (TextRange.getEnd(token) < offset) {
            return undefined;
        }

        const previousToken = _getTokenAtIndex(tokens, i - 1)!;
        const tokenSpan = token ? convertTextRangeToRange(token, lines) : undefined;
        const previousTokenSpan = previousToken ? convertTextRangeToRange(previousToken, lines) : undefined;

        if (
            tokenSpan &&
            previousTokenSpan &&
            previousTokenSpan.end.line < tokenSpan.start.line &&
            previousToken!.type !== TokenType.NewLine
        ) {
            const indentationResult = _getIndentation(parseResults, previousToken!.start, /*preferDedent*/ false);
            const currentPosition = convertOffsetToPosition(offset, lines);

            // Handle multiline constructs (explicit or implicit)
            // ex) def foo \
            //         | <= here
            // or
            //     i = \
            //         \
            //         | <= here
            // or
            //     a = (
            //         | <= here
            const lineDelta =
                currentPosition.line -
                (indentationResult.token
                    ? convertOffsetToPosition(indentationResult.token.start, lines).line
                    : previousTokenSpan.start.line);

            const indentation = _getFirstNonBlankLineIndentationFromText(
                parseResults,
                currentPosition.line,
                previousTokenSpan.start.line
            );

            return indentation + (lineDelta === 1 ? tabSize : 0);
        }
    }

    return undefined;
}

function _tryHandleStringLiterals(parseResults: ParseResults, offset: number): number | undefined {
    const tokens = parseResults.tokenizerOutput.tokens;
    const index = tokens.getItemAtPosition(offset);
    if (index < 0) {
        return undefined;
    }

    const token = _findStringToken(tokens, index);
    if (!token || token.type !== TokenType.String) {
        return undefined;
    }

    const stringToken = token as StringToken;
    if (!(stringToken.flags & StringTokenFlags.Triplicate)) {
        // We only care """ string literal
        return undefined;
    }

    if (
        !(stringToken.flags & StringTokenFlags.Unterminated) &&
        !TextRange.contains(getStringValueRange(stringToken), offset)
    ) {
        // ex) We only support these 2 cases.
        //     """
        //     | <= here
        //     or
        //     """
        //     | <= here
        //     """
        return undefined;
    }

    const lines = parseResults.tokenizerOutput.lines;
    const begin = convertOffsetToPosition(token.start, lines);
    const current = convertOffsetToPosition(offset, lines);

    return _getFirstNonBlankLineIndentationFromText(parseResults, current.line, begin.line);
}

function _getFirstNonBlankLineIndentationFromText(parseResults: ParseResults, currentLine: number, endingLine: number) {
    const lines = parseResults.tokenizerOutput.lines;

    endingLine = Math.max(endingLine, 0);
    for (let i = currentLine; i >= endingLine; i--) {
        const indentation = _getIndentationFromText(parseResults, i);
        const endingLength = _getLineEndingLength(parseResults, i);

        const line = lines.getItemAt(i);
        if (indentation !== line.length - endingLength) {
            // Not blank line.
            // ex) [indentation]i = 1
            return indentation;
        }
    }

    return _getIndentationFromText(parseResults, endingLine);
}

function _findStringToken(tokens: TextRangeCollection<Token>, index: number): Token | undefined {
    for (let i = index; i >= 0; i--) {
        const token = _getTokenAtIndex(tokens, i);
        if (!token) {
            return undefined;
        }

        switch (token.type) {
            case TokenType.NewLine:
            case TokenType.Dedent:
            case TokenType.EndOfStream:
                continue;

            case TokenType.String:
                return token;

            default:
                break;
        }
    }

    return undefined;
}

function _findPreviousNonWhitespaceToken(tokens: TextRangeCollection<Token>, offset: number): Token | undefined {
    const index = tokens.getItemAtPosition(offset);
    if (index < 0) {
        return undefined;
    }

    for (let i = index; i >= 0; i--) {
        const token = _getTokenAtIndex(tokens, i)!;

        switch (token.type) {
            case TokenType.Dedent:
            case TokenType.NewLine:
            case TokenType.Indent:
            case TokenType.EndOfStream:
                continue;

            default:
                return token;
        }
    }

    return undefined;
}

function _findNextTokenIndex(tokens: TextRangeCollection<Token>, offset: number): number {
    const index = tokens.getItemAtPosition(offset);
    if (index < 0) {
        return index;
    }

    for (let i = index + 1; i < tokens.count; i++) {
        const token = _getTokenAtIndex(tokens, i);
        if (token?.type === TokenType.Dedent || token?.type === TokenType.NewLine) {
            continue;
        }

        return i;
    }

    return tokens.count - 1;
}

function _getTokenAtIndex(tokens: TextRangeCollection<Token>, index: number) {
    if (index < 0) {
        return undefined;
    }

    return tokens.getItemAt(index);
}

function _shouldDedentAfterKeyword(tokens: TextRangeCollection<Token>, offset: number) {
    // Keeping the PTVS smart indenter behavior.
    // For now, we won't include all small statements that can put at single line.
    // See parser.ts to see all small statements or see python grammar.
    // ex) def foo(): pass
    const index = tokens.getItemAtPosition(offset);
    if (index < 0) {
        return false;
    }

    for (let i = index; i >= 0; i--) {
        const token = _getTokenAtIndex(tokens, i);
        if (!token) {
            return false;
        }

        switch (token.type) {
            case TokenType.Dedent:
            case TokenType.NewLine:
            case TokenType.EndOfStream:
                continue;

            case TokenType.Keyword: {
                const previousToken = _getTokenAtIndex(tokens, i - 1);
                if (previousToken?.type === TokenType.Colon) {
                    // Not for single line construct.
                    // ex) def foo(): pass
                    return false;
                }

                const keyword = token as KeywordToken;
                return (
                    keyword.keywordType === KeywordType.Pass ||
                    keyword.keywordType === KeywordType.Return ||
                    keyword.keywordType === KeywordType.Break ||
                    keyword.keywordType === KeywordType.Continue ||
                    keyword.keywordType === KeywordType.Raise
                );
            }

            default:
                return false;
        }
    }

    return false;
}

function _getLineEndingLength(parseResults: ParseResults, line: number) {
    let length = 0;
    const range = parseResults.tokenizerOutput.lines.getItemAt(line);

    for (let i = range.length - 1; i >= 0; i--) {
        const charCode = parseResults.text.charCodeAt(range.start + i);
        switch (charCode) {
            case Char.FormFeed:
            case Char.Hash:
            case Char.LineFeed:
            case Char.CarriageReturn:
                length++;
                break;

            default:
                return length;
        }
    }

    return length;
}

function _getIndentationFromText(parseResults: ParseResults, line: number) {
    let indentation = 0;

    const tabSize = parseResults.tokenizerOutput.predominantTabSequence.length;
    const range = parseResults.tokenizerOutput.lines.getItemAt(line);
    for (let i = 0; i < range.length; i++) {
        const charCode = parseResults.text.charCodeAt(range.start + i);
        switch (charCode) {
            case Char.Space:
                indentation++;
                break;

            case Char.Tab:
                indentation += tabSize;
                break;

            default:
                return indentation;
        }
    }

    return indentation;
}
