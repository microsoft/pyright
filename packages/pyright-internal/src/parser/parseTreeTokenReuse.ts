/*
 * parseTreeTokenReuse.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

import { AssignmentNode, ParseNode, ParseNodeType } from './parseNodes';
import {
    DedentToken,
    FStringEndToken,
    FStringMiddleToken,
    FStringStartToken,
    IdentifierToken,
    IndentToken,
    KeywordToken,
    NewLineToken,
    NumberToken,
    OperatorToken,
    StringToken,
    Token,
    TokenType,
} from './tokenizerTypes';

export class ParseTreeTokenCursor {
    private readonly _frames: CursorFrame[] = [];
    private _atOffset: Token[] | undefined;
    private _tokenAtOffset: Token | undefined;
    private _root: ParseNode | undefined;
    private _depth = -1;
    private _lookahead: Token | undefined;
    private _offset = -1;
    private _previousToken: Token | undefined;
    private _previousStart = -1;

    constructor(root: ParseNode) {
        this._root = root;
    }

    next<Type extends TokenType>(start: number, length: number, type: Type): TokensByType[Type] | undefined {
        if (this._offset !== start) {
            this._offset = start;
            this._tokenAtOffset = undefined;
            if (this._atOffset?.length) {
                this._atOffset.length = 0;
            }
            let token = this._lookahead ?? this._nextToken();
            while (token && token.start < start) {
                token = this._nextToken();
            }
            if (token && token.start === start) {
                const firstToken = token;
                token = this._nextToken();
                if (!token || token.start !== start) {
                    this._tokenAtOffset = firstToken;
                } else {
                    // Only same-position collisions need a buffer; most positions have zero or one candidate.
                    const atOffset = (this._atOffset ??= []);
                    atOffset.push(firstToken);
                    do {
                        atOffset.push(token);
                        token = this._nextToken();
                    } while (token && token.start === start);
                }
            }
            this._lookahead = token;
        }
        const token = this._tokenAtOffset;
        if (token && token.length === length && isTokenType(token, type)) {
            this._tokenAtOffset = undefined;
            return token;
        }
        const atOffset = this._atOffset;
        if (!atOffset) {
            return undefined;
        }
        for (let index = 0; index < atOffset.length; index++) {
            const token = atOffset[index];
            if (token.length === length && isTokenType(token, type)) {
                atOffset[index] = atOffset[atOffset.length - 1];
                atOffset.pop();
                return token;
            }
        }
        return undefined;
    }

    private _nextToken(): Token | undefined {
        if (this._root) {
            const root = this._root;
            this._root = undefined;
            this._enter(root);
        }
        while (this._depth >= 0) {
            const frame = this._frames[this._depth];
            let token: Token;
            if (frame.child && (!frame.token || frame.child.start < frame.token.start)) {
                const child = frame.child;
                this._advanceChild(frame);
                switch (child.nodeType) {
                    case ParseNodeType.Name:
                    case ParseNodeType.String:
                        token = child.d.token;
                        break;
                    case ParseNodeType.Number:
                    case ParseNodeType.Constant:
                    case ParseNodeType.Ellipsis:
                    case ParseNodeType.Break:
                    case ParseNodeType.Continue:
                    case ParseNodeType.Pass:
                        continue;
                    default:
                        this._enter(child);
                        continue;
                }
            } else if (frame.token) {
                token = frame.token;
                this._advanceToken(frame);
            } else {
                frame.node = undefined;
                frame.child = null;
                frame.assignmentTarget = undefined;
                frame.assignmentValue = undefined;
                this._depth--;
                continue;
            }
            if (
                token === this._previousToken ||
                (token.length === 0 && (token.type === TokenType.Identifier || token.type === TokenType.Keyword))
            ) {
                continue;
            }
            if (token.start < this._previousStart) {
                throw new Error('Retained parse-tree tokens are not in source order');
            }
            this._previousToken = token;
            this._previousStart = token.start;
            return token;
        }
        return undefined;
    }

    private _enter(node: ParseNode) {
        const depth = ++this._depth;
        let frame = this._frames[depth];
        if (!frame) {
            frame = {
                node: undefined,
                childIndex: 0,
                tokenIndex: 0,
                child: null,
                token: null,
                assignmentTarget: undefined,
                assignmentValue: undefined,
                fieldIndex: 0,
                formatIndex: 0,
            };
            this._frames.push(frame);
        }
        frame.node = node;
        frame.childIndex = 0;
        frame.tokenIndex = 0;
        frame.assignmentTarget = undefined;
        frame.assignmentValue = undefined;
        frame.fieldIndex = 0;
        frame.formatIndex = 0;
        if (node.nodeType === ParseNodeType.Assignment) {
            let target = node;
            while (target.d.rightExpr.nodeType === ParseNodeType.Assignment) {
                target = target.d.rightExpr;
            }
            frame.assignmentTarget = target;
            frame.assignmentValue = target.d.rightExpr;
        }
        this._updateChild(frame);
        frame.token = getNodeToken(node, 0);
        while (frame.token === undefined) {
            frame.token = getNodeToken(node, ++frame.tokenIndex);
        }
    }

    private _getChild(frame: CursorFrame): ParseNode | undefined | null {
        const node = frame.node!;
        if (node.nodeType === ParseNodeType.Assignment) {
            if (frame.assignmentTarget) {
                return frame.assignmentTarget.d.leftExpr;
            }
            return frame.childIndex === 1 ? frame.assignmentValue : null;
        }
        if (node.nodeType === ParseNodeType.FormatString) {
            const field = node.d.fieldExprs[frame.fieldIndex];
            const format = node.d.formatExprs[frame.formatIndex];
            return field && (!format || field.start <= format.start) ? field : format ?? null;
        }
        return getChildAt(node, frame.childIndex);
    }

    private _advanceChild(frame: CursorFrame) {
        const node = frame.node!;
        if (node.nodeType === ParseNodeType.Assignment && frame.assignmentTarget) {
            if (frame.assignmentTarget === node) {
                frame.assignmentTarget = undefined;
                frame.childIndex = 1;
            } else {
                const parent = frame.assignmentTarget.parent;
                if (parent?.nodeType !== ParseNodeType.Assignment || parent.d.rightExpr !== frame.assignmentTarget) {
                    throw new Error('Chained assignment has inconsistent parent links');
                }
                frame.assignmentTarget = parent;
            }
        } else if (node.nodeType === ParseNodeType.FormatString) {
            if (frame.child === node.d.fieldExprs[frame.fieldIndex]) {
                frame.fieldIndex++;
            } else {
                frame.formatIndex++;
            }
        } else {
            frame.childIndex++;
        }
        this._updateChild(frame);
    }

    private _updateChild(frame: CursorFrame) {
        frame.child = this._getChild(frame);
        while (frame.child === undefined) {
            frame.childIndex++;
            frame.child = this._getChild(frame);
        }
    }

    private _advanceToken(frame: CursorFrame) {
        frame.token = getNodeToken(frame.node!, ++frame.tokenIndex);
        while (frame.token === undefined) {
            frame.token = getNodeToken(frame.node!, ++frame.tokenIndex);
        }
    }
}

function getNodeToken(node: ParseNode, index: number): Token | undefined | null {
    switch (node.nodeType) {
        case ParseNodeType.Name:
        case ParseNodeType.String:
            return index === 0 ? node.d.token : null;
        case ParseNodeType.BinaryOperation:
        case ParseNodeType.UnaryOperation:
            return index === 0 ? node.d.operatorToken : null;
        case ParseNodeType.FormatString:
            return index === 0
                ? node.d.token
                : index <= node.d.middleTokens.length
                ? node.d.middleTokens[index - 1]
                : null;
        case ParseNodeType.If:
        case ParseNodeType.While:
        case ParseNodeType.Try:
        case ParseNodeType.Function:
        case ParseNodeType.Class:
        case ParseNodeType.StatementList:
        case ParseNodeType.TypeAlias:
        case ParseNodeType.Match:
            return index === 0 ? node.d.firstToken : null;
        case ParseNodeType.For:
        case ParseNodeType.With:
            return index === 0 ? node.d.asyncToken : index === 1 ? node.d.firstToken : null;
        case ParseNodeType.ComprehensionFor:
            return index === 0 ? node.d.asyncToken : null;
        case ParseNodeType.Except:
            return index === 0 ? node.d.exceptToken : null;
        case ParseNodeType.AssignmentExpression:
            return index === 0 ? node.d.walrusToken : null;
        case ParseNodeType.Await:
            return index === 0 ? node.d.awaitToken : null;
        case ParseNodeType.Unpack:
            return index === 0 ? node.d.starToken : null;
        case ParseNodeType.Dictionary:
            return index === 0 ? node.d.trailingCommaToken : null;
        case ParseNodeType.Import:
            return index === 0 ? node.d.lazyToken : null;
        case ParseNodeType.ImportFrom:
            return index === 0 ? node.d.lazyToken : index === 1 ? node.d.wildcardToken : null;
        default:
            return null;
    }
}

function getChildAt(node: ParseNode, index: number): ParseNode | undefined | null {
    switch (node.nodeType) {
        case ParseNodeType.Error: {
            if (node.d.decorators && index < node.d.decorators.length) return node.d.decorators[index];
            index -= node.d.decorators?.length ?? 0;
            if (index === 0) return node.d.child;
            index--;
            return null;
        }
        case ParseNodeType.Argument: {
            if (index === 0) return node.d.name;
            index--;
            if (index === 0) return node.d.valueExpr;
            index--;
            return null;
        }
        case ParseNodeType.Assert: {
            if (index === 0) return node.d.testExpr;
            index--;
            if (index === 0) return node.d.exceptionExpr;
            index--;
            return null;
        }
        case ParseNodeType.AssignmentExpression: {
            if (index === 0) return node.d.name;
            index--;
            if (index === 0) return node.d.rightExpr;
            index--;
            return null;
        }
        case ParseNodeType.Assignment: {
            if (index === 0) return node.d.leftExpr;
            index--;
            if (index === 0) return node.d.rightExpr;
            index--;
            return null;
        }
        case ParseNodeType.AugmentedAssignment: {
            if (index === 0) return node.d.leftExpr;
            index--;
            if (index === 0) return node.d.rightExpr;
            index--;
            return null;
        }
        case ParseNodeType.Await: {
            if (index === 0) return node.d.expr;
            index--;
            return null;
        }
        case ParseNodeType.BinaryOperation: {
            if (index === 0) return node.d.leftExpr;
            index--;
            if (index === 0) return node.d.rightExpr;
            index--;
            return null;
        }
        case ParseNodeType.Break: {
            return null;
        }
        case ParseNodeType.Call: {
            if (index === 0) return node.d.leftExpr;
            index--;
            if (index < node.d.args.length) return node.d.args[index];
            index -= node.d.args.length;
            return null;
        }
        case ParseNodeType.Case: {
            if (index === 0) return node.d.pattern;
            index--;
            if (index === 0) return node.d.guardExpr;
            index--;
            if (index === 0) return node.d.suite;
            index--;
            return null;
        }
        case ParseNodeType.Class: {
            if (index < node.d.decorators.length) return node.d.decorators[index];
            index -= node.d.decorators.length;
            if (index === 0) return node.d.name;
            index--;
            if (index === 0) return node.d.typeParams;
            index--;
            if (index < node.d.arguments.length) return node.d.arguments[index];
            index -= node.d.arguments.length;
            if (index === 0) return node.d.suite;
            index--;
            return null;
        }
        case ParseNodeType.Comprehension: {
            if (index === 0) return node.d.expr;
            index--;
            if (index < node.d.forIfNodes.length) return node.d.forIfNodes[index];
            index -= node.d.forIfNodes.length;
            return null;
        }
        case ParseNodeType.ComprehensionFor: {
            if (index === 0) return node.d.targetExpr;
            index--;
            if (index === 0) return node.d.iterableExpr;
            index--;
            return null;
        }
        case ParseNodeType.ComprehensionIf: {
            if (index === 0) return node.d.testExpr;
            index--;
            return null;
        }
        case ParseNodeType.Constant: {
            return null;
        }
        case ParseNodeType.Continue: {
            return null;
        }
        case ParseNodeType.Decorator: {
            if (index === 0) return node.d.expr;
            index--;
            return null;
        }
        case ParseNodeType.Del: {
            if (index < node.d.targets.length) return node.d.targets[index];
            index -= node.d.targets.length;
            return null;
        }
        case ParseNodeType.Dictionary: {
            if (index < node.d.items.length) return node.d.items[index];
            index -= node.d.items.length;
            return null;
        }
        case ParseNodeType.DictionaryExpandEntry: {
            if (index === 0) return node.d.expr;
            index--;
            return null;
        }
        case ParseNodeType.DictionaryKeyEntry: {
            if (index === 0) return node.d.keyExpr;
            index--;
            if (index === 0) return node.d.valueExpr;
            index--;
            return null;
        }
        case ParseNodeType.Ellipsis: {
            return null;
        }
        case ParseNodeType.If: {
            if (index === 0) return node.d.testExpr;
            index--;
            if (index === 0) return node.d.ifSuite;
            index--;
            if (index === 0) return node.d.elseSuite;
            index--;
            return null;
        }
        case ParseNodeType.Import: {
            if (index < node.d.list.length) return node.d.list[index];
            index -= node.d.list.length;
            return null;
        }
        case ParseNodeType.ImportAs: {
            if (index === 0) return node.d.module;
            index--;
            if (index === 0) return node.d.alias;
            index--;
            return null;
        }
        case ParseNodeType.ImportFrom: {
            if (index === 0) return node.d.module;
            index--;
            if (index < node.d.imports.length) return node.d.imports[index];
            index -= node.d.imports.length;
            return null;
        }
        case ParseNodeType.ImportFromAs: {
            if (index === 0) return node.d.name;
            index--;
            if (index === 0) return node.d.alias;
            index--;
            return null;
        }
        case ParseNodeType.Index: {
            if (index === 0) return node.d.leftExpr;
            index--;
            if (index < node.d.items.length) return node.d.items[index];
            index -= node.d.items.length;
            return null;
        }
        case ParseNodeType.Except: {
            if (index === 0) return node.d.typeExpr;
            index--;
            if (index === 0) return node.d.name;
            index--;
            if (index === 0) return node.d.exceptSuite;
            index--;
            return null;
        }
        case ParseNodeType.For: {
            if (index === 0) return node.d.targetExpr;
            index--;
            if (index === 0) return node.d.iterableExpr;
            index--;
            if (index === 0) return node.d.forSuite;
            index--;
            if (index === 0) return node.d.elseSuite;
            index--;
            return null;
        }
        case ParseNodeType.FormatString: {
            if (index < node.d.fieldExprs.length) return node.d.fieldExprs[index];
            index -= node.d.fieldExprs.length;
            if (node.d.formatExprs && index < node.d.formatExprs.length) return node.d.formatExprs[index];
            index -= node.d.formatExprs?.length ?? 0;
            return null;
        }
        case ParseNodeType.Function: {
            if (index < node.d.decorators.length) return node.d.decorators[index];
            index -= node.d.decorators.length;
            if (index === 0) return node.d.name;
            index--;
            if (index === 0) return node.d.typeParams;
            index--;
            if (index < node.d.params.length) return node.d.params[index];
            index -= node.d.params.length;
            if (index === 0) return node.d.returnAnnotation;
            index--;
            if (index === 0) return node.d.suite;
            index--;
            return null;
        }
        case ParseNodeType.FunctionAnnotation: {
            if (index < node.d.paramAnnotations.length) return node.d.paramAnnotations[index];
            index -= node.d.paramAnnotations.length;
            if (index === 0) return node.d.returnAnnotation;
            index--;
            return null;
        }
        case ParseNodeType.Global: {
            if (index < node.d.targets.length) return node.d.targets[index];
            index -= node.d.targets.length;
            return null;
        }
        case ParseNodeType.Lambda: {
            if (index < node.d.params.length) return node.d.params[index];
            index -= node.d.params.length;
            if (index === 0) return node.d.expr;
            index--;
            return null;
        }
        case ParseNodeType.List: {
            if (index < node.d.items.length) return node.d.items[index];
            index -= node.d.items.length;
            return null;
        }
        case ParseNodeType.Match: {
            if (index === 0) return node.d.expr;
            index--;
            if (index < node.d.cases.length) return node.d.cases[index];
            index -= node.d.cases.length;
            return null;
        }
        case ParseNodeType.MemberAccess: {
            if (index === 0) return node.d.leftExpr;
            index--;
            if (index === 0) return node.d.member;
            index--;
            return null;
        }
        case ParseNodeType.ModuleName: {
            if (index < node.d.nameParts.length) return node.d.nameParts[index];
            index -= node.d.nameParts.length;
            return null;
        }
        case ParseNodeType.Module: {
            if (index < node.d.statements.length) return node.d.statements[index];
            index -= node.d.statements.length;
            return null;
        }
        case ParseNodeType.Name: {
            return null;
        }
        case ParseNodeType.Nonlocal: {
            if (index < node.d.targets.length) return node.d.targets[index];
            index -= node.d.targets.length;
            return null;
        }
        case ParseNodeType.Number: {
            return null;
        }
        case ParseNodeType.Parameter: {
            if (index === 0) return node.d.name;
            index--;
            if (index === 0) return node.d.annotation;
            index--;
            if (index === 0) return node.d.defaultValue;
            index--;
            return null;
        }
        case ParseNodeType.Pass: {
            return null;
        }
        case ParseNodeType.PatternAs: {
            if (index < node.d.orPatterns.length) return node.d.orPatterns[index];
            index -= node.d.orPatterns.length;
            if (index === 0) return node.d.target;
            index--;
            return null;
        }
        case ParseNodeType.PatternClass: {
            if (index === 0) return node.d.className;
            index--;
            if (index < node.d.args.length) return node.d.args[index];
            index -= node.d.args.length;
            return null;
        }
        case ParseNodeType.PatternClassArgument: {
            if (index === 0) return node.d.name;
            index--;
            if (index === 0) return node.d.pattern;
            index--;
            return null;
        }
        case ParseNodeType.PatternCapture: {
            if (index === 0) return node.d.target;
            index--;
            return null;
        }
        case ParseNodeType.PatternLiteral: {
            if (index === 0) return node.d.expr;
            index--;
            return null;
        }
        case ParseNodeType.PatternMappingExpandEntry: {
            if (index === 0) return node.d.target;
            index--;
            return null;
        }
        case ParseNodeType.PatternMappingKeyEntry: {
            if (index === 0) return node.d.keyPattern;
            index--;
            if (index === 0) return node.d.valuePattern;
            index--;
            return null;
        }
        case ParseNodeType.PatternMapping: {
            if (index < node.d.entries.length) return node.d.entries[index];
            index -= node.d.entries.length;
            return null;
        }
        case ParseNodeType.PatternSequence: {
            if (index < node.d.entries.length) return node.d.entries[index];
            index -= node.d.entries.length;
            return null;
        }
        case ParseNodeType.PatternValue: {
            if (index === 0) return node.d.expr;
            index--;
            return null;
        }
        case ParseNodeType.Raise: {
            if (index === 0) return node.d.expr;
            index--;
            if (index === 0) return node.d.fromExpr;
            index--;
            return null;
        }
        case ParseNodeType.Return: {
            if (index === 0) return node.d.expr;
            index--;
            return null;
        }
        case ParseNodeType.Set: {
            if (index < node.d.items.length) return node.d.items[index];
            index -= node.d.items.length;
            return null;
        }
        case ParseNodeType.Slice: {
            if (index === 0) return node.d.startValue;
            index--;
            if (index === 0) return node.d.endValue;
            index--;
            if (index === 0) return node.d.stepValue;
            index--;
            return null;
        }
        case ParseNodeType.StatementList: {
            if (index < node.d.statements.length) return node.d.statements[index];
            index -= node.d.statements.length;
            return null;
        }
        case ParseNodeType.StringList: {
            if (index < node.d.strings.length) return node.d.strings[index];
            index -= node.d.strings.length;
            return null;
        }
        case ParseNodeType.String: {
            return null;
        }
        case ParseNodeType.Suite: {
            if (index < node.d.statements.length) return node.d.statements[index];
            index -= node.d.statements.length;
            return null;
        }
        case ParseNodeType.Ternary: {
            if (index === 0) return node.d.ifExpr;
            index--;
            if (index === 0) return node.d.testExpr;
            index--;
            if (index === 0) return node.d.elseExpr;
            index--;
            return null;
        }
        case ParseNodeType.Tuple: {
            if (index < node.d.items.length) return node.d.items[index];
            index -= node.d.items.length;
            return null;
        }
        case ParseNodeType.Try: {
            if (index === 0) return node.d.trySuite;
            index--;
            if (index < node.d.exceptClauses.length) return node.d.exceptClauses[index];
            index -= node.d.exceptClauses.length;
            if (index === 0) return node.d.elseSuite;
            index--;
            if (index === 0) return node.d.finallySuite;
            index--;
            return null;
        }
        case ParseNodeType.TypeAlias: {
            if (index === 0) return node.d.name;
            index--;
            if (index === 0) return node.d.typeParams;
            index--;
            if (index === 0) return node.d.expr;
            index--;
            return null;
        }
        case ParseNodeType.TypeAnnotation: {
            if (index === 0) return node.d.valueExpr;
            index--;
            if (index === 0) return node.d.annotation;
            index--;
            return null;
        }
        case ParseNodeType.TypeParameter: {
            if (index === 0) return node.d.name;
            index--;
            if (index === 0) return node.d.boundExpr;
            index--;
            if (index === 0) return node.d.defaultExpr;
            index--;
            return null;
        }
        case ParseNodeType.TypeParameterList: {
            if (index < node.d.params.length) return node.d.params[index];
            index -= node.d.params.length;
            return null;
        }
        case ParseNodeType.UnaryOperation: {
            if (index === 0) return node.d.expr;
            index--;
            return null;
        }
        case ParseNodeType.Unpack: {
            if (index === 0) return node.d.expr;
            index--;
            return null;
        }
        case ParseNodeType.While: {
            if (index === 0) return node.d.testExpr;
            index--;
            if (index === 0) return node.d.whileSuite;
            index--;
            if (index === 0) return node.d.elseSuite;
            index--;
            return null;
        }
        case ParseNodeType.With: {
            if (index < node.d.withItems.length) return node.d.withItems[index];
            index -= node.d.withItems.length;
            if (index === 0) return node.d.suite;
            index--;
            return null;
        }
        case ParseNodeType.WithItem: {
            if (index === 0) return node.d.expr;
            index--;
            if (index === 0) return node.d.target;
            index--;
            return null;
        }
        case ParseNodeType.Yield: {
            if (index === 0) return node.d.expr;
            index--;
            return null;
        }
        case ParseNodeType.YieldFrom: {
            if (index === 0) return node.d.expr;
            index--;
            return null;
        }
        default:
            throw new Error('Unsupported parse node in retained-token cursor');
    }
}

function isTokenType<Type extends TokenType>(token: Token, type: Type): token is TokensByType[Type] {
    return token.type === type;
}

export interface TokensByType extends Record<TokenType, Token> {
    [TokenType.Identifier]: IdentifierToken;
    [TokenType.Keyword]: KeywordToken;
    [TokenType.Operator]: OperatorToken;
    [TokenType.Number]: NumberToken;
    [TokenType.String]: StringToken;
    [TokenType.NewLine]: NewLineToken;
    [TokenType.Indent]: IndentToken;
    [TokenType.Dedent]: DedentToken;
    [TokenType.FStringStart]: FStringStartToken;
    [TokenType.FStringMiddle]: FStringMiddleToken;
    [TokenType.FStringEnd]: FStringEndToken;
}

interface CursorFrame {
    node: ParseNode | undefined;
    childIndex: number;
    tokenIndex: number;
    child: ParseNode | undefined | null;
    token: Token | undefined | null;
    assignmentTarget: AssignmentNode | undefined;
    assignmentValue: ParseNode | undefined;
    fieldIndex: number;
    formatIndex: number;
}
