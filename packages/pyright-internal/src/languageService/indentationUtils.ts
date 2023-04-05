/*
 * indentationUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Provides code to get indentation and re-indent code for the
 * given indentation.
 */

import Char from 'typescript-char';

import {
    findNodeByOffset,
    getFirstAncestorOrSelf,
    getFirstAncestorOrSelfOfKind,
    getStringValueRange,
    getTokenAt,
    isDocString,
} from '../analyzer/parseTreeUtils';
import { appendArray } from '../common/collectionUtils';
import { convertOffsetToPosition, convertTextRangeToRange } from '../common/positionUtils';
import { Range, TextRange } from '../common/textRange';
import { TextRangeCollection } from '../common/textRangeCollection';
import { MatchNode, ModuleNode, ParseNode, ParseNodeType, SuiteNode } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';
import { defaultTabSize } from '../parser/tokenizer';
import {
    IndentToken,
    KeywordToken,
    KeywordType,
    StringToken,
    StringTokenFlags,
    Token,
    TokenType,
} from '../parser/tokenizerTypes';
import { getContainer } from './insertionPointUtils';

interface TokenInfo extends TextRange {
    range: Range;
    text: string;

    kind: 'comment' | 'string' | 'token';
    firstTokenOnLine: boolean;
    multilineDocComment: boolean;
}

export function getNewlineIndentation(
    parseResults: ParseResults,
    newlineOffset: number,
    preferDedent?: boolean
): number {
    // ex)
    // a = """
    //      | <= here
    const strIndent = _tryHandleStringLiterals(parseResults, newlineOffset);
    if (strIndent !== undefined) {
        return strIndent;
    }

    // ex)
    // a = 1 + \
    //     | <= here
    // or
    // a = (1 +
    //     | <= here
    const exprIndent = _tryHandleMultilineConstructs(parseResults, newlineOffset);
    if (exprIndent !== undefined) {
        return exprIndent;
    }

    preferDedent = preferDedent ?? _shouldDedentAfterKeyword(parseResults, newlineOffset);
    return Math.max(_getIndentation(parseResults, newlineOffset, preferDedent).indentation, 0);
}

export function reindentSpan(
    parseResults: ParseResults,
    span: TextRange,
    indentation: number,
    indentFirstToken = true
) {
    let indentDelta = 0;
    const texts: string[] = [];

    // Currently _convertTokenStreams converts text in the span as whitespace and non whitespace
    // and then this function puts those back to string with reindentation if needed.
    //
    // Another approach we can take is converting the text in 2 chunks that require reindentation and not
    // and process chunks that require reindentation line by line (like how it currently does for
    // multiline doc comments) and put chunks that don't require reindentation as it is.
    const tokenInfo = _convertTokenStreams(parseResults, span);
    let previousInfo = tokenInfo[0];

    indentDelta =
        indentation -
        getIndentationFromText(parseResults, previousInfo.range.start.line, previousInfo.range.start.character)
            .indentation;

    if (previousInfo.multilineDocComment) {
        appendArray(texts, _reindentLinesFromText(parseResults, previousInfo, indentDelta));
    } else {
        if (indentFirstToken) {
            texts.push(createIndentationString(parseResults, indentation));
        }

        texts.push(previousInfo.text);
    }

    for (let i = 1; i < tokenInfo.length; i++) {
        const info = tokenInfo[i];
        if (info.firstTokenOnLine) {
            texts.push(
                parseResults.tokenizerOutput.predominantEndOfLineSequence.repeat(
                    info.range.start.line - previousInfo.range.end.line
                )
            );

            if (info.multilineDocComment) {
                appendArray(texts, _reindentLinesFromText(parseResults, info, indentDelta));
            } else {
                // Put indentation for the first token on the line.
                texts.push(
                    createIndentationString(
                        parseResults,
                        Math.max(
                            0,
                            getIndentationFromText(parseResults, info.range.start.line, info.range.start.character)
                                .indentation + indentDelta
                        )
                    )
                );
                texts.push(info.text);
            }
        } else {
            // Put whitespace between 2 tokens on same line
            // token1[space]token2
            texts.push(' '.repeat(info.range.start.character - previousInfo.range.end.character));
            texts.push(info.text);
        }

        previousInfo = info;
    }

    return {
        originalSpan: TextRange.combine(tokenInfo)!,
        text: texts.join(''),
    };
}

export function getModuleStatementIndentation(parseResults: ParseResults) {
    if (parseResults.parseTree.statements.length === 0) {
        return getNewlineIndentation(parseResults, parseResults.parseTree.length, /* preferDedent */ true);
    }

    return getNewlineIndentation(parseResults, parseResults.parseTree.statements[0].start, /* preferDedent */ true);
}

function _getIndentation(
    parseResults: ParseResults,
    offset: number,
    preferDedent: boolean
): { token?: Token; indentation: number } {
    const tokens = parseResults.tokenizerOutput.tokens;
    const startingToken = findNonWhitespaceTokenAtOrBeforeOffset(tokens, offset);
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

    // Special-case the match statement since it does not contain a suite. Case statements do,
    // but match does not.
    if (node.nodeType === ParseNodeType.Match) {
        const tabSize = _getTabSize(parseResults);
        const outerContainer = getContainer(node, /*includeSelf*/ false);
        const result = _getIndentationForNode(parseResults, offset, outerContainer ?? parseResults.parseTree, node);
        result.indentation += tabSize;
        return result;
    }

    const suite = getFirstAncestorOrSelfOfKind(node, ParseNodeType.Suite);
    if (!suite) {
        return _getIndentationForNode(parseResults, offset, parseResults.parseTree, node);
    }

    const suiteSpan = convertTextRangeToRange(suite, parseResults.tokenizerOutput.lines);
    if (preferDedent || (suiteSpan.start.line === suiteSpan.end.line && suite.statements.length > 0)) {
        // Go one more level up.
        const outerContainer = getContainer(suite, /*includeSelf*/ false);
        return _getIndentationForNode(parseResults, offset, outerContainer ?? parseResults.parseTree, suite);
    }

    return _getIndentationForNode(parseResults, offset, suite, node);
}

function _getIndentationForNode(
    parseResults: ParseResults,
    offset: number,
    container: ModuleNode | SuiteNode | MatchNode,
    current: ParseNode
): { token?: Token; indentation: number } {
    if (container.nodeType === ParseNodeType.Module) {
        // It is at the module level
        return {
            token: _getFirstTokenOfStatement(parseResults, container, current),
            indentation: 0,
        };
    }

    if (
        container.nodeType === ParseNodeType.Match ||
        _containsNoIndentBeforeFirstStatement(parseResults, offset, container)
    ) {
        const tabSize = _getTabSize(parseResults);
        const outerContainer = getContainer(container, /*includeSelf*/ false);
        const result = _getIndentationForNode(
            parseResults,
            offset,
            outerContainer ?? parseResults.parseTree,
            container
        );
        return {
            token: result.token,
            indentation: result.indentation + tabSize,
        };
    } else {
        const tokens = parseResults.tokenizerOutput.tokens;
        return {
            token: _getFirstTokenOfStatement(parseResults, container, current),
            indentation: _getIndentationFromIndentToken(tokens, tokens.getItemAtPosition(container.start)),
        };
    }
}

function _containsNoIndentBeforeFirstStatement(parseResults: ParseResults, offset: number, suite: SuiteNode): boolean {
    const statements = suite.statements.filter((s) => s.length > 0);
    if (statements.length === 0) {
        // There is no statement in the suite.
        // ex)
        // def foo():
        // | <= here
        return true;
    }

    if (statements.length === 1) {
        if (statements[0].nodeType !== ParseNodeType.StatementList || statements[0].statements.length === 1) {
            if (statements[0].start >= offset) {
                const statementLine = parseResults.tokenizerOutput.lines.getItemAtPosition(statements[0].start);
                const offsetLine = parseResults.tokenizerOutput.lines.getItemAtPosition(offset);
                if (statementLine === offsetLine) {
                    // We are calculating indent for only statement in suite.
                    // ex)
                    // def foo():
                    //     |pass <= offset before first statement
                    return true;
                }
            }
        }
    }

    // If suite contains no indent before first statement, then consider user is in the middle of writing block
    // and parser is in broken state.
    // ex)
    // def foo():
    //     while True:
    //     | <= here
    // def bar():
    //     pass
    //
    // parser will think "def bar" belongs to "while True" with invalid indentation.
    const tokens = parseResults.tokenizerOutput.tokens;
    const start = tokens.getItemAtPosition(suite.start);
    const end = tokens.getItemAtPosition(suite.statements[0].start);

    for (let i = start; i <= end; i++) {
        const token = _getTokenAtIndex(tokens, i);
        if (token?.type === TokenType.Indent) {
            return false;
        }
    }

    return true;
}

function _getFirstTokenOfStatement(
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
    const lines = parseResults.tokenizerOutput.lines;

    // Make sure we use next token to get line delta.
    // This is just to handle how tokenizer associates new lines to which token.
    // ex) a = 1 + \
    //         | <= here
    //    [b] = 2
    const index = _findNextTokenIndex(tokens, offset);
    if (index < 0) {
        return undefined;
    }

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
            previousTokenSpan.start.line < tokenSpan.start.line &&
            previousToken!.type !== TokenType.NewLine
        ) {
            return _getIndentationForNextLine(parseResults, previousToken, token, offset);
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

function _isOpenToken(token: Token) {
    return (
        token.type === TokenType.OpenParenthesis ||
        token.type === TokenType.OpenBracket ||
        token.type === TokenType.OpenCurlyBrace
    );
}

function _isCloseToken(token: Token) {
    return (
        token.type === TokenType.CloseParenthesis ||
        token.type === TokenType.CloseBracket ||
        token.type === TokenType.CloseCurlyBrace
    );
}

function _getIndentationForNextLine(parseResults: ParseResults, prevToken: Token, nextToken: Token, offset: number) {
    // Get the last token on the same line as the previous token
    const lines = parseResults.tokenizerOutput.lines;
    const lineIndex = convertOffsetToPosition(prevToken.start, lines).line;
    const line = lines.getItemAt(lineIndex);
    const tabSize = _getTabSize(parseResults);
    let token: Token | undefined = prevToken;

    // Go backwards through tokens up until the front of the line
    let whitespaceOnly = true;
    let closeCount = 0;
    while (token && token.start >= line.start) {
        if (_isCloseToken(token)) {
            whitespaceOnly = false;
            closeCount += 1;
        } else if (_isOpenToken(token) && closeCount === 0) {
            // Special case for parenthesis
            if (token.type === TokenType.OpenParenthesis && whitespaceOnly) {
                const baseIndentation = _getIndentation(parseResults, token.start, false).indentation;

                // In PEP 8, this should be this case here:
                // # Add 4 spaces (an extra level of indentation) to distinguish arguments from the rest.
                // def long_function_name(
                //         var_one, var_two, var_three,
                //         var_four):
                //     print(var_one)
                //
                const node = findNodeByOffset(parseResults.parseTree, token.start - 1);
                const funcNode = getFirstAncestorOrSelfOfKind(node, ParseNodeType.Function);
                if (
                    funcNode &&
                    funcNode.nodeType === ParseNodeType.Function &&
                    convertOffsetToPosition(funcNode.start, lines).line === lineIndex
                ) {
                    return baseIndentation + tabSize * 2;
                }

                // Not inside a function, just need one tab. See this in PEP 8
                // # Hanging indents should add a level.
                // foo = long_function_name(
                //     var_one, var_two,
                //     var_three, var_four)
                return baseIndentation + tabSize;
            } else if (whitespaceOnly) {
                return _getIndentation(parseResults, token.start, false).indentation + tabSize;
            } else {
                // In PEP 8, this should be this case here:
                // # Aligned with opening delimiter.
                // def long_function_name(var_one, var_two,
                //                        var_three, var_four)
                // + 1 is to accommodate for the parenthesis.
                return token.start - line.start + 1;
            }
        } else if (_isOpenToken(token) && closeCount > 0) {
            closeCount--;
            whitespaceOnly = false;
        } else if (!_isWhitespaceToken(token.type)) {
            // Found a non whitespace token before we returned.
            whitespaceOnly = false;
        }
        token = findNonWhitespaceTokenAtOrBeforeOffset(parseResults.tokenizerOutput.tokens, token.start - 1);
    }

    // No parenthesis found
    return _getFirstNonBlankLineIndentationFromText(
        parseResults,
        convertOffsetToPosition(offset, parseResults.tokenizerOutput.lines).line,
        lineIndex
    );
}

function _getFirstNonBlankLineIndentationFromText(parseResults: ParseResults, currentLine: number, endingLine: number) {
    endingLine = Math.max(endingLine, 0);
    for (let i = currentLine; i >= endingLine; i--) {
        const result = getIndentationFromText(parseResults, i);

        if (!_isBlankLine(parseResults, i, result.charOffset)) {
            // Not blank line.
            // ex) [indentation]i = 1
            return result.indentation;
        }
    }

    return getIndentationFromText(parseResults, endingLine).indentation;
}

function _findStringToken(tokens: TextRangeCollection<Token>, index: number): Token | undefined {
    const token = _findNonWhitespaceTokenAtOrBeforeIndex(tokens, index);
    if (!token) {
        return undefined;
    }

    return token.type === TokenType.String ? token : undefined;
}

export function findNonWhitespaceTokenAtOrBeforeOffset(
    tokens: TextRangeCollection<Token>,
    offset: number
): Token | undefined {
    const index = tokens.getItemAtPosition(offset);
    if (index < 0) {
        return undefined;
    }

    return _findNonWhitespaceTokenAtOrBeforeIndex(tokens, index);
}

function _findNonWhitespaceTokenAtOrBeforeIndex(tokens: TextRangeCollection<Token>, index: number): Token | undefined {
    for (let i = index; i >= 0; i--) {
        const token = _getTokenAtIndex(tokens, i);
        if (!token) {
            break;
        }

        if (_isWhitespaceToken(token.type)) {
            continue;
        }

        return token;
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

function _shouldDedentAfterKeyword(parseResults: ParseResults, offset: number) {
    // For now, we won't include all small statements that can put at single line.
    // See parser.ts to see all small statements or see python grammar.
    // ex) def foo(): pass
    const tokens = parseResults.tokenizerOutput.tokens;
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
                // Dedent if we found one of these keywords
                if (
                    keyword.keywordType === KeywordType.Pass ||
                    keyword.keywordType === KeywordType.Return ||
                    keyword.keywordType === KeywordType.Break ||
                    keyword.keywordType === KeywordType.Continue ||
                    keyword.keywordType === KeywordType.Raise
                ) {
                    return true;
                }

                // Otherwise, unless the keyword can be used as a return/raise value, don't dedent.
                if (
                    keyword.keywordType !== KeywordType.True &&
                    keyword.keywordType !== KeywordType.False &&
                    keyword.keywordType !== KeywordType.None &&
                    keyword.keywordType !== KeywordType.Debug
                ) {
                    return false;
                }
            }
        }

        // Dedent if we've found a return or raise statement
        const node = findNodeByOffset(parseResults.parseTree, token.start);
        const returnOrRaise = getFirstAncestorOrSelf(
            node,
            (x) => x.nodeType === ParseNodeType.Return || x.nodeType === ParseNodeType.Raise
        );
        return !!returnOrRaise;
    }

    return false;
}

function _isBlankLine(parseResults: ParseResults, line: number, charOffset: number) {
    const endingLength = _getLineEndingLength(parseResults, line);
    const lineSpan = parseResults.tokenizerOutput.lines.getItemAt(line);

    return charOffset === lineSpan.length - endingLength;
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

export function getIndentationFromText(
    parseResults: ParseResults,
    line: number,
    uptoLineOffset?: number
): { indentation: number; charOffset: number } {
    let indentation = 0;
    let charOffset = 0;

    const tabSize = _getTabSize(parseResults);
    const range = parseResults.tokenizerOutput.lines.getItemAt(line);
    for (let i = 0; i < range.length; i++) {
        const charCode = parseResults.text.charCodeAt(range.start + i);
        switch (charCode) {
            case Char.Space:
                charOffset++;
                indentation++;
                break;

            case Char.Tab:
                charOffset++;
                indentation += tabSize;
                break;

            default:
                if (!uptoLineOffset || uptoLineOffset === i) {
                    return {
                        charOffset,
                        indentation,
                    };
                }

                // calculate indentation upto line offset given.
                charOffset++;
                indentation++;
        }
    }

    return {
        charOffset,
        indentation,
    };
}

function _convertTokenStreams(parseResults: ParseResults, span: TextRange) {
    // Existing token stream contains text and whitespace mixed, making it difficult
    // to process for re-indentation. This will convert those to strictly text and whitespace.
    const tokens = parseResults.tokenizerOutput.tokens;

    let startIndex = Math.max(tokens.getItemAtPosition(span.start), 0);
    const startToken = _getTokenAtIndex(tokens, startIndex)!;
    if (TextRange.getEnd(startToken) < span.start) {
        // ex) firstToken | <= span start.
        startIndex++;
    }

    let endIndex = Math.min(tokens.getItemAtPosition(TextRange.getEnd(span)), tokens.length - 1);
    const endToken = _getTokenAtIndex(tokens, endIndex)!;
    if (TextRange.getEnd(span) <= endToken.start) {
        // ex) |< = span end [endToken]
        endIndex--;
    }

    // If the next token is a newline, we want to include it in the range
    // so that we can include comments if there is any.
    if (endIndex < tokens.length - 1 && _isWhitespaceToken(tokens.getItemAt(endIndex + 1)!.type)) {
        endIndex++;
    }

    const tokenInfoArray: TokenInfo[] = [];
    const lines = parseResults.tokenizerOutput.lines;

    for (let i = startIndex; i <= endIndex; i++) {
        const token = _getTokenAtIndex(tokens, i)!;

        if (token.comments) {
            for (const comment of token.comments) {
                tokenInfoArray.push({
                    start: comment.start,
                    length: comment.length,
                    range: convertTextRangeToRange(comment, lines),
                    text: comment.value,

                    kind: 'comment',
                    firstTokenOnLine: false,
                    multilineDocComment: false,
                });
            }
        }

        if (_isWhitespaceToken(token.type) || token.length === 0) {
            continue;
        }

        tokenInfoArray.push({
            start: token.start,
            length: token.length,
            range: convertTextRangeToRange(token, lines),
            text: parseResults.text.substr(token.start, token.length),

            kind: token.type === TokenType.String ? 'string' : 'token',
            firstTokenOnLine: false,
            multilineDocComment: false,
        });
    }

    if (tokenInfoArray.length === 0) {
        return tokenInfoArray;
    }

    tokenInfoArray.sort((a, b) => a.start - b.start);

    // Handle text in whitespace that is not part of token stream.
    let previousInfo = tokenInfoArray[0];
    const additionalTokens: TokenInfo[] = [];
    if (previousInfo.kind === 'comment') {
        // ex) token [#] comment
        const start = startIndex === 0 ? 0 : TextRange.getEnd(_getTokenAtIndex(tokens, startIndex - 1)!);
        _addTokenInfoIfMatch(parseResults, start, previousInfo.start, Char.Hash, additionalTokens);
    }

    for (let i = 1; i < tokenInfoArray.length; i++) {
        const info = tokenInfoArray[i];

        // Another approach is just blindly go through the range looking for
        // non whitespace char rather than looking for specific cases like below.
        if (previousInfo.kind !== 'comment') {
            for (
                let whitespaceLine = previousInfo.range.end.line;
                whitespaceLine < info.range.start.line;
                whitespaceLine++
            ) {
                const lineTextRange = lines.getItemAt(whitespaceLine);
                const lastCharOffset = lineTextRange.length - _getLineEndingLength(parseResults, whitespaceLine) - 1;
                if (lastCharOffset >= 0) {
                    // ex) i = 1 \ <= explicit multiline construct
                    //           +
                    //             2
                    const start = lineTextRange.start + lastCharOffset;
                    _addTokenInfoIfMatch(parseResults, start, start + 1, Char.Backslash, additionalTokens);
                }
            }
        }

        if (info.kind === 'comment') {
            const start =
                previousInfo.range.end.line === info.range.start.line
                    ? TextRange.getEnd(previousInfo)
                    : lines.getItemAt(info.range.start.line).start;

            // ex) token [#] comment
            _addTokenInfoIfMatch(parseResults, start, info.start, Char.Hash, additionalTokens);
        }

        previousInfo = info;
    }

    appendArray(tokenInfoArray, additionalTokens);
    tokenInfoArray.sort((a, b) => a.start - b.start);

    // Update firstTokenOnLine and multilineDocComment
    previousInfo = tokenInfoArray[0];

    if (startIndex === 0) {
        // It is the first token in the file.
        previousInfo.firstTokenOnLine = true;
    } else {
        const previousNonWhitespaceToken = _findNonWhitespaceTokenAtOrBeforeIndex(tokens, startIndex - 1);
        if (previousNonWhitespaceToken) {
            const previousEnd = convertOffsetToPosition(TextRange.getEnd(previousNonWhitespaceToken), lines);
            previousInfo.firstTokenOnLine = previousEnd.line !== previousInfo.range.start.line;
        } else {
            previousInfo.firstTokenOnLine = true;
        }
    }

    previousInfo.multilineDocComment = _isMultilineDocComment(parseResults, previousInfo);

    for (let i = 1; i < tokenInfoArray.length; i++) {
        const info = tokenInfoArray[i];

        info.firstTokenOnLine = previousInfo.range.end.line !== info.range.start.line;
        info.multilineDocComment = _isMultilineDocComment(parseResults, info);

        previousInfo = info;
    }

    return tokenInfoArray;
}

function _addTokenInfoIfMatch(
    parseResults: ParseResults,
    start: number,
    end: number,
    charCode: number,
    tokens: TokenInfo[]
) {
    for (let i = start; i < end; i++) {
        if (parseResults.text.charCodeAt(i) === charCode) {
            tokens.push({
                start: i,
                length: 1,
                range: convertTextRangeToRange(TextRange.create(i, 1), parseResults.tokenizerOutput.lines),
                text: String.fromCharCode(charCode),

                kind: 'token',
                firstTokenOnLine: false,
                multilineDocComment: false,
            });
        }
    }
}

function _isWhitespaceToken(type: TokenType): boolean {
    switch (type) {
        case TokenType.Dedent:
        case TokenType.NewLine:
        case TokenType.Indent:
        case TokenType.EndOfStream:
            return true;

        default:
            return false;
    }
}

function _isMultilineDocComment(parseResults: ParseResults, info: TokenInfo) {
    if (info.kind !== 'string' || !info.firstTokenOnLine || info.range.start.line === info.range.end.line) {
        return false;
    }

    const node = findNodeByOffset(parseResults.parseTree, info.start);
    if (
        node?.nodeType !== ParseNodeType.String ||
        node.parent?.nodeType !== ParseNodeType.StringList ||
        node.parent.parent?.nodeType !== ParseNodeType.StatementList
    ) {
        return false;
    }

    return isDocString(node.parent.parent);
}

function _reindentLinesFromText(parseResults: ParseResults, info: TokenInfo, indentDelta: number) {
    const texts: string[] = [];
    for (let i = info.range.start.line; i <= info.range.end.line; i++) {
        texts.push(_reindentLineFromText(parseResults, i, indentDelta, i === info.range.end.line ? info : undefined));
    }

    return texts;
}

function _reindentLineFromText(
    parseResults: ParseResults,
    line: number,
    indentDelta: number,
    range?: TextRange
): string {
    const result = getIndentationFromText(parseResults, line);
    if (_isBlankLine(parseResults, line, result.charOffset)) {
        return '';
    }

    let lineRange = parseResults.tokenizerOutput.lines.getItemAt(line);
    if (range) {
        lineRange = TextRange.fromBounds(
            lineRange.start,
            Math.min(TextRange.getEnd(range), TextRange.getEnd(lineRange))
        );
    }

    const text = parseResults.text.substr(lineRange.start + result.charOffset, lineRange.length - result.charOffset);
    return createIndentationString(parseResults, Math.max(result.indentation + indentDelta, 0)) + text;
}

function _getTabSize(parseResults: ParseResults) {
    const tab = parseResults.tokenizerOutput.predominantTabSequence;
    const tabLength = tab.length;
    if (tabLength === 1 && tab.charCodeAt(0) === Char.Tab) {
        // Tokenizer will use 8 for Char.Tab and put that info in indentToken's indent size.
        return defaultTabSize;
    }

    return tabLength;
}

export function createIndentationString(parseResults: ParseResults, indentation: number) {
    const tab = parseResults.tokenizerOutput.predominantTabSequence;
    const tabLength = tab.length;
    if (tabLength === 1 && tab.charCodeAt(0) === Char.Tab) {
        const spaceCount = indentation % defaultTabSize;
        const tabCount = (indentation - spaceCount) / defaultTabSize;

        return '\t'.repeat(tabCount) + ' '.repeat(spaceCount);
    }

    return ' '.repeat(indentation);
}
