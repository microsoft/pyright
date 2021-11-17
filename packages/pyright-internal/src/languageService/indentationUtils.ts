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
    isDocString,
} from '../analyzer/parseTreeUtils';
import { convertOffsetToPosition, convertTextRangeToRange } from '../common/positionUtils';
import { Range, TextRange } from '../common/textRange';
import { TextRangeCollection } from '../common/textRangeCollection';
import { ModuleNode, ParseNode, ParseNodeType, SuiteNode } from '../parser/parseNodes';
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

interface TokenInfo extends TextRange {
    range: Range;
    text: string;

    kind: 'comment' | 'string' | 'token';
    firstTokenOnLine: boolean;
    multilineDocComment: boolean;
}

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

export function reindentSpan(
    parseResults: ParseResults,
    span: TextRange,
    indentation: number,
    indentFirstToken = true
) {
    let indentDelta = 0;
    const texts: string[] = [];

    // Currently _convertTokenStreams converts text in the span as whitespace and non whitespace
    // and then this function puts those back to string with reidentation if needed.
    //
    // Another approach we can take is converting the text in 2 chunks that require reindentation and not
    // and process chunks that require reindentation line by line (like how it currently does for
    // multiline doc comments) and put chunks that don't require reindentation as it is.
    const tokenInfo = _convertTokenStreams(parseResults, span);
    let previousInfo = tokenInfo[0];

    indentDelta =
        indentation -
        _getIndentationFromText(parseResults, previousInfo.range.start.line, previousInfo.range.start.character)
            .indentation;

    if (previousInfo.multilineDocComment) {
        texts.push(..._reindentLinesFromText(parseResults, previousInfo, indentDelta));
    } else {
        if (indentFirstToken) {
            texts.push(_createIndentationString(parseResults, indentation));
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
                texts.push(..._reindentLinesFromText(parseResults, info, indentDelta));
            } else {
                // Put indentation for the first token on the line.
                texts.push(
                    _createIndentationString(
                        parseResults,
                        Math.max(
                            0,
                            _getIndentationFromText(parseResults, info.range.start.line, info.range.start.character)
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

    return texts.join('');
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
        const tabSize = _getTabSize(parseResults);
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
    const tabSize = _getTabSize(parseResults);

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
    endingLine = Math.max(endingLine, 0);
    for (let i = currentLine; i >= endingLine; i--) {
        const result = _getIndentationFromText(parseResults, i);

        if (!_isBlankLine(parseResults, i, result.charOffset)) {
            // Not blank line.
            // ex) [indentation]i = 1
            return result.indentation;
        }
    }

    return _getIndentationFromText(parseResults, endingLine).indentation;
}

function _findStringToken(tokens: TextRangeCollection<Token>, index: number): Token | undefined {
    const token = _findPreviousNonWhitespaceTokenFromIndex(tokens, index);
    if (!token) {
        return undefined;
    }

    return token.type === TokenType.String ? token : undefined;
}

function _findPreviousNonWhitespaceToken(tokens: TextRangeCollection<Token>, offset: number): Token | undefined {
    const index = tokens.getItemAtPosition(offset);
    if (index < 0) {
        return undefined;
    }

    return _findPreviousNonWhitespaceTokenFromIndex(tokens, index);
}

function _findPreviousNonWhitespaceTokenFromIndex(
    tokens: TextRangeCollection<Token>,
    index: number
): Token | undefined {
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

function _getIndentationFromText(
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
    if (TextRange.getEnd(span) < endToken.start) {
        // ex) |< = span end [endToken]
        endIndex--;
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

    tokenInfoArray.push(...additionalTokens);
    tokenInfoArray.sort((a, b) => a.start - b.start);

    // Update firstTokenOnLine and multilineDocComment
    previousInfo = tokenInfoArray[0];

    if (startIndex === 0) {
        // It is the first token in the file.
        previousInfo.firstTokenOnLine = true;
    } else {
        const previousToken = _findPreviousNonWhitespaceTokenFromIndex(tokens, startIndex - 1)!;
        const previousEnd = convertOffsetToPosition(TextRange.getEnd(previousToken), lines);
        previousInfo.firstTokenOnLine = previousEnd.line !== previousInfo.range.start.line;
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
    const result = _getIndentationFromText(parseResults, line);
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
    return _createIndentationString(parseResults, Math.max(result.indentation + indentDelta, 0)) + text;
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

function _createIndentationString(parseResults: ParseResults, indentation: number) {
    const tab = parseResults.tokenizerOutput.predominantTabSequence;
    const tabLength = tab.length;
    if (tabLength === 1 && tab.charCodeAt(0) === Char.Tab) {
        const spaceCount = indentation % defaultTabSize;
        const tabCount = (indentation - spaceCount) / defaultTabSize;

        return '\t'.repeat(tabCount) + ' '.repeat(spaceCount);
    }

    return ' '.repeat(indentation);
}
