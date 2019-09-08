/*
* parseNodes.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Definition of parse nodes that make up the Python abstract
* syntax tree (AST).
*/

import { TextRange } from '../common/textRange';
import { IdentifierToken, KeywordToken, NumberToken,
    OperatorType, StringToken, Token } from './tokenizerTypes';

export enum ParseNodeType {
    Error, // 0

    Argument,
    Assert,
    Assignment,
    AugmentedAssignment,
    Await,
    BinaryOperation,
    Break,
    Call,
    Class,

    Constant, // 10
    Continue,
    Decorator,
    Del,
    Dictionary,
    DictionaryExpandEntry,
    DictionaryKeyEntry,
    Ellipsis,
    If,
    Import,

    ImportAs, // 20
    ImportFrom,
    ImportFromAs,
    Index,
    IndexItems,
    Except,
    For,
    FormatString,
    Function,
    Global,

    Lambda, // 30
    List,
    ListComprehension,
    ListComprehensionFor,
    ListComprehensionIf,
    MemberAccess,
    Module,
    ModuleName,
    Name,
    Nonlocal,

    Number, // 40
    Parameter,
    Pass,
    Raise,
    Return,
    Set,
    Slice,
    StatementList,
    StringList,
    String,

    Suite, // 50
    Ternary,
    Tuple,
    Try,
    TypeAnnotation,
    UnaryOperation,
    Unpack,
    While,
    With,
    WithItem,

    Yield, // 60
    YieldFrom
}

export enum ErrorExpressionCategory {
    MissingIn,
    MissingElse,
    MissingExpression,
    MissingDecoratorCallName,
    MissingCallCloseParen,
    MissingIndexCloseBracket,
    MissingMemberAccessName,
    MissingTupleCloseParen,
    MissingListCloseBracket
}

export interface ParseNodeBase extends TextRange {
    readonly nodeType: ParseNodeType;

    // The parent field is filled in by the PostParseWalker,
    // which isn't technically part of the parser.
    parent?: ParseNode;
}

export function extendRange(node: ParseNodeBase, newRange: TextRange) {
    if (newRange.start < node.start) {
        node.length += node.start - newRange.start;
        node.start = newRange.start;
    }

    if (TextRange.getEnd(newRange) > TextRange.getEnd(node)) {
        node.length = TextRange.getEnd(newRange) - node.start;
    }
}

export type ParseNodeArray = (ParseNode | undefined)[];

export interface ModuleNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Module;
    statements: StatementNode[];
}

export namespace ModuleNode {
    export function create(range: TextRange) {
        const node: ModuleNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Module,
            statements: []
        };

        return node;
    }
}

export interface SuiteNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Suite;
    statements: StatementNode[];
}

export namespace SuiteNode {
    export function create(range: TextRange) {
        const node: SuiteNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Suite,
            statements: []
        };

        return node;
    }
}

export interface IfNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.If;
    testExpression: ExpressionNode;
    ifSuite: SuiteNode;
    elseSuite ?: SuiteNode | IfNode;
}

export namespace IfNode {
    export function create(ifOrElifToken: Token, testExpression: ExpressionNode,
            ifSuite: SuiteNode, elseSuite?: SuiteNode) {

        const node: IfNode = {
            start: ifOrElifToken.start,
            length: ifOrElifToken.length,
            nodeType: ParseNodeType.If,
            testExpression,
            ifSuite,
            elseSuite
        };

        extendRange(node, testExpression);
        extendRange(node, ifSuite);
        if (elseSuite) {
            extendRange(node, elseSuite);
        }

        return node;
    }
}

export interface WhileNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.While;
    testExpression: ExpressionNode;
    whileSuite: SuiteNode;
    elseSuite?: SuiteNode;
}

export namespace WhileNode {
    export function create(whileToken: Token, testExpression: ExpressionNode, whileSuite: SuiteNode) {
        const node: WhileNode = {
            start: whileToken.start,
            length: whileToken.length,
            nodeType: ParseNodeType.While,
            testExpression,
            whileSuite
        };

        extendRange(node, whileSuite);

        return node;
    }
}

export interface ForNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.For;
    isAsync?: boolean;
    targetExpression: ExpressionNode;
    iterableExpression: ExpressionNode;
    forSuite: SuiteNode;
    elseSuite?: SuiteNode;
}

export namespace ForNode {
    export function create(forToken: Token, targetExpression: ExpressionNode,
            iterableExpression: ExpressionNode, forSuite: SuiteNode) {

        const node: ForNode = {
            start: forToken.start,
            length: forToken.length,
            nodeType: ParseNodeType.For,
            targetExpression,
            iterableExpression,
            forSuite
        };

        extendRange(node, forSuite);

        return node;
    }
}

export type ListComprehensionIterNode = ListComprehensionForNode | ListComprehensionIfNode;

export interface ListComprehensionForNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.ListComprehensionFor;
    isAsync?: boolean;
    targetExpression: ExpressionNode;
    iterableExpression: ExpressionNode;
}

export namespace ListComprehensionForNode {
    export function create(startToken: Token, targetExpression: ExpressionNode, iterableExpression: ExpressionNode) {
        const node: ListComprehensionForNode = {
            start: startToken.start,
            length: startToken.length,
            nodeType: ParseNodeType.ListComprehensionFor,
            targetExpression,
            iterableExpression
        };

        extendRange(node, targetExpression);
        extendRange(node, iterableExpression);

        return node;
    }
}

export interface ListComprehensionIfNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.ListComprehensionIf;
    testExpression: ExpressionNode;
}

export namespace ListComprehensionIfNode {
    export function create(ifToken: Token, testExpression: ExpressionNode) {
        const node: ListComprehensionIfNode = {
            start: ifToken.start,
            length: ifToken.length,
            nodeType: ParseNodeType.ListComprehensionIf,
            testExpression
        };

        extendRange(node, testExpression);

        return node;
    }
}

export interface TryNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Try;
    trySuite: SuiteNode;
    exceptClauses: ExceptNode[];
    elseSuite?: SuiteNode;
    finallySuite?: SuiteNode;
}

export namespace TryNode {
    export function create(tryToken: Token, trySuite: SuiteNode) {
        const node: TryNode = {
            start: tryToken.start,
            length: tryToken.length,
            nodeType: ParseNodeType.Try,
            trySuite,
            exceptClauses: []
        };

        return node;
    }
}

export interface ExceptNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Except;
    typeExpression?: ExpressionNode;
    name?: NameNode;
    exceptSuite: SuiteNode;
}

export namespace ExceptNode {
    export function create(exceptToken: Token, exceptSuite: SuiteNode) {
        const node: ExceptNode = {
            start: exceptToken.start,
            length: exceptToken.length,
            nodeType: ParseNodeType.Except,
            exceptSuite
        };

        extendRange(node, exceptSuite);

        return node;
    }
}

export interface FunctionNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Function;
    decorators: DecoratorNode[];
    isAsync?: boolean;
    name: NameNode;
    parameters: ParameterNode[];
    returnTypeAnnotation?: ExpressionNode;
    suite: SuiteNode;
}

export namespace FunctionNode {
    export function create(defToken: Token, name: NameNode, suite: SuiteNode) {
        const node: FunctionNode = {
            start: defToken.start,
            length: defToken.length,
            nodeType: ParseNodeType.Function,
            decorators: [],
            name,
            parameters: [],
            suite
        };

        extendRange(node, suite);

        return node;
    }
}

export enum ParameterCategory {
    Simple,
    VarArgList,
    VarArgDictionary
}

export interface ParameterNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Parameter;
    category: ParameterCategory;
    name?: NameNode;
    typeAnnotation?: ExpressionNode;
    defaultValue?: ExpressionNode;
}

export namespace ParameterNode {
    export function create(startToken: Token, paramCategory: ParameterCategory) {
        const node: ParameterNode = {
            start: startToken.start,
            length: startToken.length,
            nodeType: ParseNodeType.Parameter,
            category: paramCategory
        };

        return node;
    }
}

export interface ClassNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Class;
    decorators: DecoratorNode[];
    name: NameNode;
    arguments: ArgumentNode[];
    suite: SuiteNode;
}

export namespace ClassNode {
    export function create(classToken: Token, name: NameNode, suite: SuiteNode) {
        const node: ClassNode = {
            start: classToken.start,
            length: classToken.length,
            nodeType: ParseNodeType.Class,
            decorators: [],
            name,
            arguments: [],
            suite
        };

        extendRange(node, suite);

        return node;
    }
}

export interface WithNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.With;
    isAsync?: boolean;
    withItems: WithItemNode[];
    suite: SuiteNode;
}

export namespace WithNode {
    export function create(withToken: Token, suite: SuiteNode) {
        const node: WithNode = {
            start: withToken.start,
            length: withToken.length,
            nodeType: ParseNodeType.With,
            withItems: [],
            suite
        };

        extendRange(node, suite);

        return node;
    }
}

export interface WithItemNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.WithItem;
    expression: ExpressionNode;
    target?: ExpressionNode;
}

export namespace WithItemNode {
    export function create(expression: ExpressionNode) {
        const node: WithItemNode = {
            start: expression.start,
            length: expression.length,
            nodeType: ParseNodeType.WithItem,
            expression
        };

        return node;
    }
}

export interface DecoratorNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Decorator;
    leftExpression: ExpressionNode;
    arguments: ArgumentNode[] | undefined;
}

export namespace DecoratorNode {
    export function create(atToken: Token, leftExpression: ExpressionNode) {
        const node: DecoratorNode = {
            start: atToken.start,
            length: atToken.length,
            nodeType: ParseNodeType.Decorator,
            leftExpression,
            arguments: undefined
        };

        extendRange(node, leftExpression);

        return node;
    }
}

export interface StatementListNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.StatementList;
    statements: ParseNode[];
}

export namespace StatementListNode {
    export function create(atToken: Token) {
        const node: StatementListNode = {
            start: atToken.start,
            length: atToken.length,
            nodeType: ParseNodeType.StatementList,
            statements: []
        };

        return node;
    }
}

export type StatementNode = IfNode | WhileNode | ForNode | TryNode |
    FunctionNode | ClassNode | WithNode | StatementListNode;

export type SmallStatementNode = ExpressionNode | DelNode | PassNode |
    ImportNode | GlobalNode | NonlocalNode | AssertNode;

export type ExpressionNode = ErrorExpressionNode | UnaryExpressionNode |
    BinaryExpressionNode | AssignmentNode | TypeAnnotationExpressionNode |
    AugmentedAssignmentExpressionNode | AwaitExpressionNode |
    TernaryExpressionNode | UnpackExpressionNode | TupleExpressionNode |
    CallExpressionNode | ListComprehensionNode | IndexExpressionNode |
    SliceExpressionNode | YieldExpressionNode | YieldFromExpressionNode |
    MemberAccessExpressionNode | LambdaNode | NameNode | ConstantNode |
    EllipsisNode | NumberNode | StringNode | FormatStringNode |
    StringListNode | DictionaryNode | DictionaryExpandEntryNode |
    ListNode | SetNode;

export function isExpressionNode(node: ParseNode) {
    switch (node.nodeType) {
        case ParseNodeType.Error:
        case ParseNodeType.UnaryOperation:
        case ParseNodeType.BinaryOperation:
        case ParseNodeType.Assignment:
        case ParseNodeType.TypeAnnotation:
        case ParseNodeType.AugmentedAssignment:
        case ParseNodeType.Await:
        case ParseNodeType.Ternary:
        case ParseNodeType.Unpack:
        case ParseNodeType.Tuple:
        case ParseNodeType.Call:
        case ParseNodeType.ListComprehension:
        case ParseNodeType.Index:
        case ParseNodeType.Slice:
        case ParseNodeType.Yield:
        case ParseNodeType.YieldFrom:
        case ParseNodeType.MemberAccess:
        case ParseNodeType.Lambda:
        case ParseNodeType.Name:
        case ParseNodeType.Constant:
        case ParseNodeType.Ellipsis:
        case ParseNodeType.Number:
        case ParseNodeType.String:
        case ParseNodeType.FormatString:
        case ParseNodeType.StringList:
        case ParseNodeType.Dictionary:
        case ParseNodeType.DictionaryExpandEntry:
        case ParseNodeType.List:
        case ParseNodeType.Set:
            return true;

        default:
            return false;
    }
}

export interface ErrorExpressionNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Error;
    readonly category: ErrorExpressionCategory;
    readonly child?: ExpressionNode;
}

export namespace ErrorExpressionNode {
    export function create(initialRange: TextRange, category: ErrorExpressionCategory,
            child?: ExpressionNode) {

        const node: ErrorExpressionNode = {
            start: initialRange.start,
            length: initialRange.length,
            nodeType: ParseNodeType.Error,
            category,
            child
        };

        if (child) {
            extendRange(node, child);
        }

        return node;
    }
}

export interface UnaryExpressionNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.UnaryOperation;
    expression: ExpressionNode;
    operator: OperatorType;
}

export namespace UnaryExpressionNode {
    export function create(operatorToken: Token, expression: ExpressionNode, operator: OperatorType) {
        const node: UnaryExpressionNode = {
            start: operatorToken.start,
            length: operatorToken.length,
            nodeType: ParseNodeType.UnaryOperation,
            operator,
            expression
        };

        extendRange(node, expression);

        return node;
    }
}

export interface BinaryExpressionNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.BinaryOperation;
    leftExpression: ExpressionNode;
    operator: OperatorType;
    rightExpression: ExpressionNode;
}

export namespace BinaryExpressionNode {
    export function create(leftExpression: ExpressionNode, rightExpression: ExpressionNode,
            operator: OperatorType) {

        const node: BinaryExpressionNode = {
            start: leftExpression.start,
            length: leftExpression.length,
            nodeType: ParseNodeType.BinaryOperation,
            leftExpression,
            operator,
            rightExpression
        };

        extendRange(node, rightExpression);

        return node;
    }
}

export interface AssignmentNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Assignment;
    leftExpression: ExpressionNode;
    rightExpression: ExpressionNode;
    typeAnnotationComment?: ExpressionNode;
}

export namespace AssignmentNode {
    export function create(leftExpression: ExpressionNode, rightExpression: ExpressionNode) {
        const node: AssignmentNode = {
            start: leftExpression.start,
            length: leftExpression.length,
            nodeType: ParseNodeType.Assignment,
            leftExpression,
            rightExpression
        };

        extendRange(node, rightExpression);

        return node;
    }
}

export interface TypeAnnotationExpressionNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.TypeAnnotation;
    valueExpression: ExpressionNode;
    typeAnnotation: ExpressionNode;
}

export namespace TypeAnnotationExpressionNode {
    export function create(valueExpression: ExpressionNode, typeAnnotation: ExpressionNode) {
        const node: TypeAnnotationExpressionNode = {
            start: valueExpression.start,
            length: valueExpression.length,
            nodeType: ParseNodeType.TypeAnnotation,
            valueExpression,
            typeAnnotation
        };

        extendRange(node, typeAnnotation);

        return node;
    }
}

export interface AugmentedAssignmentExpressionNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.AugmentedAssignment;
    leftExpression: ExpressionNode;
    operator: OperatorType;
    rightExpression: ExpressionNode;
}

export namespace AugmentedAssignmentExpressionNode {
    export function create(leftExpression: ExpressionNode, rightExpression: ExpressionNode,
            operator: OperatorType) {

        const node: AugmentedAssignmentExpressionNode = {
            start: leftExpression.start,
            length: leftExpression.length,
            nodeType: ParseNodeType.AugmentedAssignment,
            leftExpression,
            operator,
            rightExpression
        };

        extendRange(node, rightExpression);

        return node;
    }
}

export interface AwaitExpressionNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Await;
    expression: ExpressionNode;
}

export namespace AwaitExpressionNode {
    export function create(awaitToken: Token, expression: ExpressionNode) {
        const node: AwaitExpressionNode = {
            start: awaitToken.start,
            length: awaitToken.length,
            nodeType: ParseNodeType.Await,
            expression
        };

        extendRange(node, expression);

        return node;
    }
}

export interface TernaryExpressionNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Ternary;
    ifExpression: ExpressionNode;
    testExpression: ExpressionNode;
    elseExpression: ExpressionNode;
}

export namespace TernaryExpressionNode {
    export function create(ifExpression: ExpressionNode, testExpression: ExpressionNode,
            elseExpression: ExpressionNode) {

        const node: TernaryExpressionNode = {
            start: ifExpression.start,
            length: ifExpression.length,
            nodeType: ParseNodeType.Ternary,
            ifExpression,
            testExpression,
            elseExpression
        };

        extendRange(node, elseExpression);

        return node;
    }
}

export interface UnpackExpressionNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Unpack;
    expression: ExpressionNode;
}

export namespace UnpackExpressionNode {
    export function create(starToken: Token, expression: ExpressionNode) {
        const node: UnpackExpressionNode = {
            start: starToken.start,
            length: starToken.length,
            nodeType: ParseNodeType.Unpack,
            expression
        };

        extendRange(node, expression);

        return node;
    }
}

export interface TupleExpressionNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Tuple;
    expressions: ExpressionNode[];
}

export namespace TupleExpressionNode {
    export function create(range: TextRange) {
        const node: TupleExpressionNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Tuple,
            expressions: []
        };

        return node;
    }
}

export interface CallExpressionNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Call;
    leftExpression: ExpressionNode;
    arguments: ArgumentNode[];
}

export namespace CallExpressionNode {
    export function create(leftExpression: ExpressionNode) {
        const node: CallExpressionNode = {
            start: leftExpression.start,
            length: leftExpression.length,
            nodeType: ParseNodeType.Call,
            leftExpression,
            arguments: []
        };

        return node;
    }
}

export interface ListComprehensionNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.ListComprehension;
    expression: ParseNode;
    comprehensions: ListComprehensionIterNode[];
}

export namespace ListComprehensionNode {
    export function create(expression: ParseNode) {
        const node: ListComprehensionNode = {
            start: expression.start,
            length: expression.length,
            nodeType: ParseNodeType.ListComprehension,
            expression,
            comprehensions: []
        };

        return node;
    }
}

export interface IndexItemsNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.IndexItems;
    items: ExpressionNode[];
}

export namespace IndexItemsNode {
    export function create(openBracketToken: Token, closeBracketToken: Token, items: ExpressionNode[]) {
        const node: IndexItemsNode = {
            start: openBracketToken.start,
            length: openBracketToken.length,
            nodeType: ParseNodeType.IndexItems,
            items
        };

        extendRange(node, closeBracketToken);

        return node;
    }
}

export interface IndexExpressionNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Index;
    baseExpression: ExpressionNode;
    items: IndexItemsNode;
}

export namespace IndexExpressionNode {
    export function create(baseExpression: ExpressionNode, items: IndexItemsNode) {
        const node: IndexExpressionNode = {
            start: baseExpression.start,
            length: baseExpression.length,
            nodeType: ParseNodeType.Index,
            baseExpression,
            items
        };

        extendRange(node, items);

        return node;
    }
}

export interface SliceExpressionNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Slice;
    startValue?: ExpressionNode;
    endValue?: ExpressionNode;
    stepValue?: ExpressionNode;
}

export namespace SliceExpressionNode {
    export function create(range: TextRange) {
        const node: SliceExpressionNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Slice
        };

        return node;
    }
}

export interface YieldExpressionNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Yield;
    expression: ExpressionNode;
}

export namespace YieldExpressionNode {
    export function create(yieldToken: Token, expression: ExpressionNode) {
        const node: YieldExpressionNode = {
            start: yieldToken.start,
            length: yieldToken.length,
            nodeType: ParseNodeType.Yield,
            expression
        };

        extendRange(node, expression);

        return node;
    }
}

export interface YieldFromExpressionNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.YieldFrom;
    expression: ExpressionNode;
}

export namespace YieldFromExpressionNode {
    export function create(yieldToken: Token, expression: ExpressionNode) {
        const node: YieldFromExpressionNode = {
            start: yieldToken.start,
            length: yieldToken.length,
            nodeType: ParseNodeType.YieldFrom,
            expression
        };

        extendRange(node, expression);

        return node;
    }
}

export interface MemberAccessExpressionNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.MemberAccess;
    leftExpression: ExpressionNode;
    memberName: NameNode;
}

export namespace MemberAccessExpressionNode {
    export function create(leftExpression: ExpressionNode, memberName: NameNode) {
        const node: MemberAccessExpressionNode = {
            start: leftExpression.start,
            length: leftExpression.length,
            nodeType: ParseNodeType.MemberAccess,
            leftExpression,
            memberName
        };

        extendRange(node, memberName);

        return node;
    }
}

export interface LambdaNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Lambda;
    parameters: ParameterNode[];
    expression: ExpressionNode;
}

export namespace LambdaNode {
    export function create(lambdaToken: Token, expression: ExpressionNode) {
        const node: LambdaNode = {
            start: lambdaToken.start,
            length: lambdaToken.length,
            nodeType: ParseNodeType.Lambda,
            parameters: [],
            expression
        };

        extendRange(node, expression);

        return node;
    }
}

export interface NameNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Name;
    nameToken: IdentifierToken;
}

export namespace NameNode {
    export function create(nameToken: IdentifierToken) {
        const node: NameNode = {
            start: nameToken.start,
            length: nameToken.length,
            nodeType: ParseNodeType.Name,
            nameToken
        };

        return node;
    }
}

export interface ConstantNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Constant;
    token: KeywordToken;
}

export namespace ConstantNode {
    export function create(token: KeywordToken) {
        const node: ConstantNode = {
            start: token.start,
            length: token.length,
            nodeType: ParseNodeType.Constant,
            token
        };

        return node;
    }
}

export interface EllipsisNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Ellipsis;
}

export namespace EllipsisNode {
    export function create(range: TextRange) {
        const node: EllipsisNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Ellipsis
        };

        return node;
    }
}

export interface NumberNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Number;
    token: NumberToken;
}

export namespace NumberNode {
    export function create(token: NumberToken) {
        const node: NumberNode = {
            start: token.start,
            length: token.length,
            nodeType: ParseNodeType.Number,
            token
        };

        return node;
    }
}

export interface StringNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.String;
    token: StringToken;
    value: string;
    hasUnescapeErrors: boolean;
}

export namespace StringNode {
    export function create(token: StringToken, unescapedValue: string, hasUnescapeErrors: boolean) {
        const node: StringNode = {
            start: token.start,
            length: token.length,
            nodeType: ParseNodeType.String,
            token,
            value: unescapedValue,
            hasUnescapeErrors
        };

        return node;
    }
}

export interface FormatStringNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.FormatString;
    token: StringToken;
    value: string;
    hasUnescapeErrors: boolean;
    expressions: ExpressionNode[];
}

export namespace FormatStringNode {
    export function create(token: StringToken, unescapedValue: string, hasUnescapeErrors: boolean,
            expressions: ExpressionNode[]) {

        const node: FormatStringNode = {
            start: token.start,
            length: token.length,
            nodeType: ParseNodeType.FormatString,
            token,
            value: unescapedValue,
            hasUnescapeErrors,
            expressions
        };

        return node;
    }
}

export interface StringListNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.StringList;
    strings: (StringNode | FormatStringNode)[];

    // If strings are found within the context of
    // a type annotation, they are further parsed
    // into an expression.
    typeAnnotation?: ExpressionNode;
}

export namespace StringListNode {
    export function create(strings: (StringNode | FormatStringNode)[]) {
        const node: StringListNode = {
            start: strings[0].start,
            length: strings[0].length,
            nodeType: ParseNodeType.StringList,
            strings
        };

        if (strings.length > 0) {
            extendRange(node, strings[strings.length - 1]);
        }

        return node;
    }
}

export interface DictionaryNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Dictionary;
    entries: DictionaryEntryNode[];
}

export namespace DictionaryNode {
    export function create(range: TextRange) {
        const node: DictionaryNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Dictionary,
            entries: []
        };

        return node;
    }
}

export interface DictionaryKeyEntryNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.DictionaryKeyEntry;
    keyExpression: ExpressionNode;
    valueExpression: ExpressionNode;
}

export namespace DictionaryKeyEntryNode {
    export function create(keyExpression: ExpressionNode, valueExpression: ExpressionNode) {
        const node: DictionaryKeyEntryNode = {
            start: keyExpression.start,
            length: keyExpression.length,
            nodeType: ParseNodeType.DictionaryKeyEntry,
            keyExpression,
            valueExpression
        };

        extendRange(node, valueExpression);

        return node;
    }
}

export interface DictionaryExpandEntryNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.DictionaryExpandEntry;
    expandExpression: ExpressionNode;
}

export namespace DictionaryExpandEntryNode {
    export function create(expandExpression: ExpressionNode) {
        const node: DictionaryExpandEntryNode = {
            start: expandExpression.start,
            length: expandExpression.length,
            nodeType: ParseNodeType.DictionaryExpandEntry,
            expandExpression
        };

        return node;
    }
}

export type DictionaryEntryNode = DictionaryKeyEntryNode | DictionaryExpandEntryNode | ListComprehensionNode;

export interface SetNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Set;
    entries: ExpressionNode[];
}

export namespace SetNode {
    export function create(range: TextRange) {
        const node: SetNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Set,
            entries: []
        };

        return node;
    }
}

export interface ListNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.List;
    entries: ExpressionNode[];
}

export namespace ListNode {
    export function create(range: TextRange) {
        const node: ListNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.List,
            entries: []
        };

        return node;
    }
}

export enum ArgumentCategory {
    Simple,
    UnpackedList,
    UnpackedDictionary
}

export interface ArgumentNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Argument;
    argumentCategory: ArgumentCategory;
    name?: NameNode;
    valueExpression: ExpressionNode;
}

export namespace ArgumentNode {
    export function create(startToken: Token, valueExpression: ExpressionNode, argCategory: ArgumentCategory) {
        const node: ArgumentNode = {
            start: startToken.start,
            length: startToken.length,
            nodeType: ParseNodeType.Argument,
            valueExpression,
            argumentCategory: argCategory
        };

        extendRange(node, valueExpression);

        return node;
    }
}

export interface DelNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Del;
    expressions: ExpressionNode[];
}

export namespace DelNode {
    export function create(delToken: Token) {
        const node: DelNode = {
            start: delToken.start,
            length: delToken.length,
            nodeType: ParseNodeType.Del,
            expressions: []
        };

        return node;
    }
}

export interface PassNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Pass;
}

export namespace PassNode {
    export function create(passToken: TextRange) {
        const node: PassNode = {
            start: passToken.start,
            length: passToken.length,
            nodeType: ParseNodeType.Pass
        };

        return node;
    }
}

export interface ImportNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Import;
    list: ImportAsNode[];
}

export namespace ImportNode {
    export function create(passToken: TextRange) {
        const node: ImportNode = {
            start: passToken.start,
            length: passToken.length,
            nodeType: ParseNodeType.Import,
            list: []
        };

        return node;
    }
}

export interface ModuleNameNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.ModuleName;
    leadingDots: number;
    nameParts: NameNode[];

    // This is an error condition used only for type completion.
    hasTrailingDot?: boolean;
}

export namespace ModuleNameNode {
    export function create(range: TextRange) {
        const node: ModuleNameNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.ModuleName,
            leadingDots: 0,
            nameParts: []
        };

        return node;
    }
}

export interface ImportAsNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.ImportAs;
    module: ModuleNameNode;
    alias?: NameNode;
}

export namespace ImportAsNode {
    export function create(module: ModuleNameNode) {
        const node: ImportAsNode = {
            start: module.start,
            length: module.length,
            nodeType: ParseNodeType.ImportAs,
            module
        };

        return node;
    }
}

export interface ImportFromNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.ImportFrom;
    module: ModuleNameNode;
    imports: ImportFromAsNode[];
    isWildcardImport: boolean;
    usesParens: boolean;
    missingImportKeyword?: boolean;
}

export namespace ImportFromNode {
    export function create(fromToken: Token, module: ModuleNameNode) {
        const node: ImportFromNode = {
            start: fromToken.start,
            length: fromToken.length,
            nodeType: ParseNodeType.ImportFrom,
            module,
            imports: [],
            isWildcardImport: false,
            usesParens: false
        };

        extendRange(node, module);

        return node;
    }
}

export interface ImportFromAsNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.ImportFromAs;
    name: NameNode;
    alias?: NameNode;
}

export namespace ImportFromAsNode {
    export function create(name: NameNode) {
        const node: ImportFromAsNode = {
            start: name.start,
            length: name.length,
            nodeType: ParseNodeType.ImportFromAs,
            name
        };

        return node;
    }
}

export interface GlobalNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Global;
    nameList: NameNode[];
}

export namespace GlobalNode {
    export function create(range: TextRange) {
        const node: GlobalNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Global,
            nameList: []
        };

        return node;
    }
}

export interface NonlocalNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Nonlocal;
    nameList: NameNode[];
}

export namespace NonlocalNode {
    export function create(range: TextRange) {
        const node: NonlocalNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Nonlocal,
            nameList: []
        };

        return node;
    }
}

export interface AssertNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Assert;
    testExpression: ExpressionNode;
    exceptionExpression?: ExpressionNode;
}

export namespace AssertNode {
    export function create(assertToken: Token, testExpression: ExpressionNode) {
        const node: AssertNode = {
            start: assertToken.start,
            length: assertToken.length,
            nodeType: ParseNodeType.Assert,
            testExpression
        };

        extendRange(node, testExpression);

        return node;
    }
}

export interface BreakNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Break;
}

export namespace BreakNode {
    export function create(range: TextRange) {
        const node: BreakNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Break
        };

        return node;
    }
}

export interface ContinueNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Continue;
}

export namespace ContinueNode {
    export function create(range: TextRange) {
        const node: ContinueNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Continue
        };

        return node;
    }
}

export interface ReturnNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Return;
    returnExpression?: ExpressionNode;
}

export namespace ReturnNode {
    export function create(range: TextRange) {
        const node: ReturnNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Return
        };

        return node;
    }
}

export interface RaiseNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Raise;
    typeExpression?: ExpressionNode;
    valueExpression?: ExpressionNode;
    tracebackExpression?: ExpressionNode;
}

export namespace RaiseNode {
    export function create(range: TextRange) {
        const node: RaiseNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Raise
        };

        return node;
    }
}

export type ParseNode = ErrorExpressionNode | ArgumentNode | AssertNode | AssignmentNode |
    AugmentedAssignmentExpressionNode | AwaitExpressionNode | BinaryExpressionNode |
    BreakNode | CallExpressionNode | ClassNode | ConstantNode | ContinueNode |
    DecoratorNode | DelNode | DictionaryNode | DictionaryEntryNode | DictionaryExpandEntryNode |
    DictionaryKeyEntryNode | EllipsisNode | IfNode | ImportNode | ImportAsNode | ImportFromNode |
    ImportFromAsNode | IndexExpressionNode | IndexItemsNode | ExceptNode | ForNode | FormatStringNode |
    FunctionNode | GlobalNode | LambdaNode | ListNode | ListComprehensionNode | ListComprehensionForNode |
    ListComprehensionIfNode | MemberAccessExpressionNode | ModuleNameNode | ModuleNode | NameNode |
    NonlocalNode | NumberNode | ParameterNode | PassNode | RaiseNode | ReturnNode | SetNode |
    SliceExpressionNode | StatementListNode | StringListNode | StringNode | SuiteNode |
    TernaryExpressionNode | TupleExpressionNode | TryNode | TypeAnnotationExpressionNode |
    UnaryExpressionNode | UnpackExpressionNode | WhileNode | WithNode | WithItemNode |
    YieldExpressionNode | YieldFromExpressionNode;
