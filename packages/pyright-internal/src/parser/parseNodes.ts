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
import {
    IdentifierToken,
    KeywordToken,
    KeywordType,
    NumberToken,
    OperatorType,
    StringToken,
    Token,
    TokenType,
} from './tokenizerTypes';

export const enum ParseNodeType {
    Error, // 0

    Argument,
    Assert,
    Assignment,
    AssignmentExpression,
    AugmentedAssignment,
    Await,
    BinaryOperation,
    Break,
    Call,

    Class, // 10
    Constant,
    Continue,
    Decorator,
    Del,
    Dictionary,
    DictionaryExpandEntry,
    DictionaryKeyEntry,
    Ellipsis,
    If,

    Import, // 20
    ImportAs,
    ImportFrom,
    ImportFromAs,
    Index,
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
    YieldFrom,
    FunctionAnnotation,
    Match,
    Case,
    PatternSequence,
    PatternAs,
    PatternLiteral,
    PatternClass,
    PatternCapture,

    PatternMapping, // 70
    PatternMappingKeyEntry,
    PatternMappingExpandEntry,
    PatternValue,
    PatternClassArgument,
}

export const enum ErrorExpressionCategory {
    MissingIn,
    MissingElse,
    MissingExpression,
    MissingIndexOrSlice,
    MissingDecoratorCallName,
    MissingCallCloseParen,
    MissingIndexCloseBracket,
    MissingMemberAccessName,
    MissingTupleCloseParen,
    MissingListCloseBracket,
    MissingFunctionParameterList,
    MissingPattern,
    MissingPatternSubject,
    MissingDictValue,
    MaxDepthExceeded,
}

export interface ParseNodeBase extends TextRange {
    readonly nodeType: ParseNodeType;

    // A unique ID given to each parse node.
    id: number;

    parent?: ParseNode | undefined;

    // For some parse nodes, each child's depth is calculated,
    // and the max child depth is recorded here. This is used
    // to detect long chains of operations that can result in
    // stack overflows during evaluation.
    maxChildDepth?: number;
}

let _nextNodeId = 1;
export function getNextNodeId() {
    return _nextNodeId++;
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
            id: _nextNodeId++,
            statements: [],
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
            id: _nextNodeId++,
            statements: [],
        };

        return node;
    }
}

export interface IfNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.If;
    testExpression: ExpressionNode;
    ifSuite: SuiteNode;
    elseSuite?: SuiteNode | IfNode | undefined;
}

export namespace IfNode {
    export function create(
        ifOrElifToken: Token,
        testExpression: ExpressionNode,
        ifSuite: SuiteNode,
        elseSuite?: SuiteNode
    ) {
        const node: IfNode = {
            start: ifOrElifToken.start,
            length: ifOrElifToken.length,
            nodeType: ParseNodeType.If,
            id: _nextNodeId++,
            testExpression,
            ifSuite,
            elseSuite,
        };

        testExpression.parent = node;
        ifSuite.parent = node;

        extendRange(node, testExpression);
        extendRange(node, ifSuite);
        if (elseSuite) {
            extendRange(node, elseSuite);
            elseSuite.parent = node;
        }

        return node;
    }
}

export interface WhileNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.While;
    testExpression: ExpressionNode;
    whileSuite: SuiteNode;
    elseSuite?: SuiteNode | undefined;
}

export namespace WhileNode {
    export function create(whileToken: Token, testExpression: ExpressionNode, whileSuite: SuiteNode) {
        const node: WhileNode = {
            start: whileToken.start,
            length: whileToken.length,
            nodeType: ParseNodeType.While,
            id: _nextNodeId++,
            testExpression,
            whileSuite,
        };

        testExpression.parent = node;
        whileSuite.parent = node;

        extendRange(node, whileSuite);

        return node;
    }
}

export interface ForNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.For;
    isAsync?: boolean;
    asyncToken?: Token;
    targetExpression: ExpressionNode;
    iterableExpression: ExpressionNode;
    forSuite: SuiteNode;
    elseSuite?: SuiteNode | undefined;
}

export namespace ForNode {
    export function create(
        forToken: Token,
        targetExpression: ExpressionNode,
        iterableExpression: ExpressionNode,
        forSuite: SuiteNode
    ) {
        const node: ForNode = {
            start: forToken.start,
            length: forToken.length,
            nodeType: ParseNodeType.For,
            id: _nextNodeId++,
            targetExpression,
            iterableExpression,
            forSuite,
        };

        targetExpression.parent = node;
        iterableExpression.parent = node;
        forSuite.parent = node;

        extendRange(node, forSuite);

        return node;
    }
}

export type ListComprehensionForIfNode = ListComprehensionForNode | ListComprehensionIfNode;

export interface ListComprehensionForNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.ListComprehensionFor;
    isAsync?: boolean;
    asyncToken?: Token;
    targetExpression: ExpressionNode;
    iterableExpression: ExpressionNode;
}

export namespace ListComprehensionForNode {
    export function create(startToken: Token, targetExpression: ExpressionNode, iterableExpression: ExpressionNode) {
        const node: ListComprehensionForNode = {
            start: startToken.start,
            length: startToken.length,
            nodeType: ParseNodeType.ListComprehensionFor,
            id: _nextNodeId++,
            targetExpression,
            iterableExpression,
        };

        targetExpression.parent = node;
        iterableExpression.parent = node;

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
            id: _nextNodeId++,
            testExpression,
        };

        testExpression.parent = node;

        extendRange(node, testExpression);

        return node;
    }
}

export interface TryNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Try;
    trySuite: SuiteNode;
    exceptClauses: ExceptNode[];
    elseSuite?: SuiteNode | undefined;
    finallySuite?: SuiteNode | undefined;
}

export namespace TryNode {
    export function create(tryToken: Token, trySuite: SuiteNode) {
        const node: TryNode = {
            start: tryToken.start,
            length: tryToken.length,
            nodeType: ParseNodeType.Try,
            id: _nextNodeId++,
            trySuite,
            exceptClauses: [],
        };

        trySuite.parent = node;

        extendRange(node, trySuite);

        return node;
    }
}

export interface ExceptNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Except;
    typeExpression?: ExpressionNode | undefined;
    name?: NameNode | undefined;
    exceptSuite: SuiteNode;
    isExceptGroup: boolean;
}

export namespace ExceptNode {
    export function create(exceptToken: Token, exceptSuite: SuiteNode, isExceptGroup: boolean) {
        const node: ExceptNode = {
            start: exceptToken.start,
            length: exceptToken.length,
            nodeType: ParseNodeType.Except,
            id: _nextNodeId++,
            exceptSuite,
            isExceptGroup,
        };

        exceptSuite.parent = node;

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
    returnTypeAnnotation?: ExpressionNode | undefined;
    functionAnnotationComment?: FunctionAnnotationNode | undefined;
    suite: SuiteNode;
}

export namespace FunctionNode {
    export function create(defToken: Token, name: NameNode, suite: SuiteNode) {
        const node: FunctionNode = {
            start: defToken.start,
            length: defToken.length,
            nodeType: ParseNodeType.Function,
            id: _nextNodeId++,
            decorators: [],
            name,
            parameters: [],
            suite,
        };

        name.parent = node;
        suite.parent = node;

        extendRange(node, suite);

        return node;
    }
}

export const enum ParameterCategory {
    Simple,
    VarArgList,
    VarArgDictionary,
}

export interface ParameterNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Parameter;
    category: ParameterCategory;
    name?: NameNode | undefined;
    typeAnnotation?: ExpressionNode | undefined;
    typeAnnotationComment?: ExpressionNode | undefined;
    defaultValue?: ExpressionNode | undefined;
}

export namespace ParameterNode {
    export function create(startToken: Token, paramCategory: ParameterCategory) {
        const node: ParameterNode = {
            start: startToken.start,
            length: startToken.length,
            nodeType: ParseNodeType.Parameter,
            id: _nextNodeId++,
            category: paramCategory,
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
            id: _nextNodeId++,
            decorators: [],
            name,
            arguments: [],
            suite,
        };

        name.parent = node;
        suite.parent = node;

        extendRange(node, suite);

        return node;
    }

    // This variant is used to create a dummy class
    // when the parser encounters decorators with no
    // function or class declaration.
    export function createDummyForDecorators(decorators: DecoratorNode[]) {
        const node: ClassNode = {
            start: decorators[0].start,
            length: 0,
            nodeType: ParseNodeType.Class,
            id: _nextNodeId++,
            decorators,
            name: {
                start: decorators[0].start,
                length: 0,
                id: 0,
                nodeType: ParseNodeType.Name,
                token: {
                    type: TokenType.Identifier,
                    start: 0,
                    length: 0,
                    comments: [],
                    value: '',
                },
                value: '',
            },
            arguments: [],
            suite: {
                start: decorators[0].start,
                length: 0,
                id: 0,
                nodeType: ParseNodeType.Suite,
                statements: [],
            },
        };

        decorators.forEach((decorator) => {
            decorator.parent = node;
            extendRange(node, decorator);
        });

        node.name.parent = node;
        node.suite.parent = node;

        return node;
    }
}

export interface WithNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.With;
    isAsync?: boolean;
    asyncToken?: Token;
    withItems: WithItemNode[];
    suite: SuiteNode;
}

export namespace WithNode {
    export function create(withToken: Token, suite: SuiteNode) {
        const node: WithNode = {
            start: withToken.start,
            length: withToken.length,
            nodeType: ParseNodeType.With,
            id: _nextNodeId++,
            withItems: [],
            suite,
        };

        suite.parent = node;

        extendRange(node, suite);

        return node;
    }
}

export interface WithItemNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.WithItem;
    expression: ExpressionNode;
    target?: ExpressionNode | undefined;
}

export namespace WithItemNode {
    export function create(expression: ExpressionNode) {
        const node: WithItemNode = {
            start: expression.start,
            length: expression.length,
            nodeType: ParseNodeType.WithItem,
            id: _nextNodeId++,
            expression,
        };

        expression.parent = node;

        return node;
    }
}

export interface DecoratorNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Decorator;
    expression: ExpressionNode;
}

export namespace DecoratorNode {
    export function create(atToken: Token, expression: ExpressionNode) {
        const node: DecoratorNode = {
            start: atToken.start,
            length: atToken.length,
            nodeType: ParseNodeType.Decorator,
            id: _nextNodeId++,
            expression,
        };

        expression.parent = node;

        extendRange(node, expression);

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
            id: _nextNodeId++,
            statements: [],
        };

        return node;
    }
}

export type StatementNode =
    | IfNode
    | WhileNode
    | ForNode
    | TryNode
    | FunctionNode
    | ClassNode
    | WithNode
    | StatementListNode
    | MatchNode
    | ErrorNode;

export type SmallStatementNode =
    | ExpressionNode
    | DelNode
    | PassNode
    | ImportNode
    | GlobalNode
    | NonlocalNode
    | AssertNode;

export type ExpressionNode =
    | ErrorNode
    | UnaryOperationNode
    | BinaryOperationNode
    | AssignmentNode
    | TypeAnnotationNode
    | AssignmentExpressionNode
    | AugmentedAssignmentNode
    | AwaitNode
    | TernaryNode
    | UnpackNode
    | TupleNode
    | CallNode
    | ListComprehensionNode
    | IndexNode
    | SliceNode
    | YieldNode
    | YieldFromNode
    | MemberAccessNode
    | LambdaNode
    | NameNode
    | ConstantNode
    | EllipsisNode
    | NumberNode
    | StringNode
    | FormatStringNode
    | StringListNode
    | DictionaryNode
    | DictionaryExpandEntryNode
    | ListNode
    | SetNode
    | DecoratorNode
    | FunctionAnnotationNode;

export function isExpressionNode(node: ParseNode): node is ExpressionNode {
    switch (node.nodeType) {
        case ParseNodeType.Error:
        case ParseNodeType.UnaryOperation:
        case ParseNodeType.BinaryOperation:
        case ParseNodeType.AssignmentExpression:
        case ParseNodeType.TypeAnnotation:
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

export interface ErrorNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Error;
    readonly category: ErrorExpressionCategory;
    readonly child?: ExpressionNode | undefined;
    readonly decorators?: DecoratorNode[] | undefined;
}

export namespace ErrorNode {
    export function create(
        initialRange: TextRange,
        category: ErrorExpressionCategory,
        child?: ExpressionNode,
        decorators?: DecoratorNode[]
    ) {
        const node: ErrorNode = {
            start: initialRange.start,
            length: initialRange.length,
            nodeType: ParseNodeType.Error,
            id: _nextNodeId++,
            category,
            child,
            decorators,
        };

        if (child) {
            child.parent = node;
            extendRange(node, child);
        }

        if (decorators) {
            decorators.forEach((decorator) => {
                decorator.parent = node;
            });

            if (decorators.length > 0) {
                extendRange(node, decorators[0]);
            }
        }

        return node;
    }
}

export interface UnaryOperationNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.UnaryOperation;
    expression: ExpressionNode;
    operatorToken: Token;
    operator: OperatorType;
}

export namespace UnaryOperationNode {
    export function create(operatorToken: Token, expression: ExpressionNode, operator: OperatorType) {
        const node: UnaryOperationNode = {
            start: operatorToken.start,
            length: operatorToken.length,
            nodeType: ParseNodeType.UnaryOperation,
            id: _nextNodeId++,
            operator,
            operatorToken,
            expression,
        };

        expression.parent = node;
        node.maxChildDepth = 1 + (expression.maxChildDepth ?? 0);

        extendRange(node, expression);

        return node;
    }
}

export interface BinaryOperationNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.BinaryOperation;
    leftExpression: ExpressionNode;
    operatorToken: Token;
    operator: OperatorType;
    rightExpression: ExpressionNode;
    parenthesized?: boolean;
}

export namespace BinaryOperationNode {
    export function create(
        leftExpression: ExpressionNode,
        rightExpression: ExpressionNode,
        operatorToken: Token,
        operator: OperatorType
    ) {
        const node: BinaryOperationNode = {
            start: leftExpression.start,
            length: leftExpression.length,
            nodeType: ParseNodeType.BinaryOperation,
            id: _nextNodeId++,
            leftExpression,
            operatorToken,
            operator,
            rightExpression,
        };

        leftExpression.parent = node;
        rightExpression.parent = node;

        node.maxChildDepth = 1 + Math.max(leftExpression.maxChildDepth ?? 0, rightExpression.maxChildDepth ?? 0);

        extendRange(node, rightExpression);

        return node;
    }
}

export interface AssignmentExpressionNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.AssignmentExpression;
    name: NameNode;
    rightExpression: ExpressionNode;
}

export namespace AssignmentExpressionNode {
    export function create(name: NameNode, rightExpression: ExpressionNode) {
        const node: AssignmentExpressionNode = {
            start: name.start,
            length: name.length,
            nodeType: ParseNodeType.AssignmentExpression,
            id: _nextNodeId++,
            name,
            rightExpression,
        };

        name.parent = node;
        rightExpression.parent = node;

        extendRange(node, rightExpression);

        return node;
    }
}

export interface AssignmentNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Assignment;
    leftExpression: ExpressionNode;
    rightExpression: ExpressionNode;
    typeAnnotationComment?: ExpressionNode | undefined;
}

export namespace AssignmentNode {
    export function create(leftExpression: ExpressionNode, rightExpression: ExpressionNode) {
        const node: AssignmentNode = {
            start: leftExpression.start,
            length: leftExpression.length,
            nodeType: ParseNodeType.Assignment,
            id: _nextNodeId++,
            leftExpression,
            rightExpression,
        };

        leftExpression.parent = node;
        rightExpression.parent = node;

        extendRange(node, rightExpression);

        return node;
    }
}

export interface TypeAnnotationNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.TypeAnnotation;
    valueExpression: ExpressionNode;
    typeAnnotation: ExpressionNode;
}

export namespace TypeAnnotationNode {
    export function create(valueExpression: ExpressionNode, typeAnnotation: ExpressionNode) {
        const node: TypeAnnotationNode = {
            start: valueExpression.start,
            length: valueExpression.length,
            nodeType: ParseNodeType.TypeAnnotation,
            id: _nextNodeId++,
            valueExpression,
            typeAnnotation,
        };

        valueExpression.parent = node;
        typeAnnotation.parent = node;

        extendRange(node, typeAnnotation);

        return node;
    }
}

export interface FunctionAnnotationNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.FunctionAnnotation;
    isParamListEllipsis: boolean;
    paramTypeAnnotations: ExpressionNode[];
    returnTypeAnnotation: ExpressionNode;
}

export namespace FunctionAnnotationNode {
    export function create(
        openParenToken: Token,
        isParamListEllipsis: boolean,
        paramTypeAnnotations: ExpressionNode[],
        returnTypeAnnotation: ExpressionNode
    ) {
        const node: FunctionAnnotationNode = {
            start: openParenToken.start,
            length: openParenToken.length,
            nodeType: ParseNodeType.FunctionAnnotation,
            id: _nextNodeId++,
            isParamListEllipsis,
            paramTypeAnnotations,
            returnTypeAnnotation,
        };

        paramTypeAnnotations.forEach((p) => {
            p.parent = node;
        });
        returnTypeAnnotation.parent = node;

        extendRange(node, returnTypeAnnotation);

        return node;
    }
}

export interface AugmentedAssignmentNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.AugmentedAssignment;
    leftExpression: ExpressionNode;
    operator: OperatorType;
    rightExpression: ExpressionNode;

    // The destExpression is a copy of the leftExpression
    // node. We use it as a place to hang the result type,
    // as opposed to the source type.
    destExpression: ExpressionNode;
}

export namespace AugmentedAssignmentNode {
    export function create(
        leftExpression: ExpressionNode,
        rightExpression: ExpressionNode,
        operator: OperatorType,
        destExpression: ExpressionNode
    ) {
        const node: AugmentedAssignmentNode = {
            start: leftExpression.start,
            length: leftExpression.length,
            nodeType: ParseNodeType.AugmentedAssignment,
            id: _nextNodeId++,
            leftExpression,
            operator,
            rightExpression,
            destExpression,
        };

        leftExpression.parent = node;
        rightExpression.parent = node;
        destExpression.parent = node;

        extendRange(node, rightExpression);

        return node;
    }
}

export interface AwaitNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Await;
    expression: ExpressionNode;
}

export namespace AwaitNode {
    export function create(awaitToken: Token, expression: ExpressionNode) {
        const node: AwaitNode = {
            start: awaitToken.start,
            length: awaitToken.length,
            nodeType: ParseNodeType.Await,
            id: _nextNodeId++,
            expression,
        };

        expression.parent = node;

        extendRange(node, expression);

        return node;
    }
}

export interface TernaryNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Ternary;
    ifExpression: ExpressionNode;
    testExpression: ExpressionNode;
    elseExpression: ExpressionNode;
}

export namespace TernaryNode {
    export function create(
        ifExpression: ExpressionNode,
        testExpression: ExpressionNode,
        elseExpression: ExpressionNode
    ) {
        const node: TernaryNode = {
            start: ifExpression.start,
            length: ifExpression.length,
            nodeType: ParseNodeType.Ternary,
            id: _nextNodeId++,
            ifExpression,
            testExpression,
            elseExpression,
        };

        ifExpression.parent = node;
        testExpression.parent = node;
        elseExpression.parent = node;

        extendRange(node, elseExpression);

        return node;
    }
}

export interface UnpackNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Unpack;
    expression: ExpressionNode;
}

export namespace UnpackNode {
    export function create(starToken: Token, expression: ExpressionNode) {
        const node: UnpackNode = {
            start: starToken.start,
            length: starToken.length,
            nodeType: ParseNodeType.Unpack,
            id: _nextNodeId++,
            expression,
        };

        expression.parent = node;

        extendRange(node, expression);

        return node;
    }
}

export interface TupleNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Tuple;
    expressions: ExpressionNode[];
    enclosedInParens: boolean;
}

export namespace TupleNode {
    export function create(range: TextRange, enclosedInParens: boolean) {
        const node: TupleNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Tuple,
            id: _nextNodeId++,
            expressions: [],
            enclosedInParens,
        };

        return node;
    }
}

export interface CallNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Call;
    leftExpression: ExpressionNode;
    arguments: ArgumentNode[];
    trailingComma: boolean;
}

export namespace CallNode {
    export function create(leftExpression: ExpressionNode, argList: ArgumentNode[], trailingComma: boolean) {
        const node: CallNode = {
            start: leftExpression.start,
            length: leftExpression.length,
            nodeType: ParseNodeType.Call,
            id: _nextNodeId++,
            leftExpression,
            arguments: argList,
            trailingComma,
        };

        leftExpression.parent = node;

        node.maxChildDepth = 1 + (leftExpression.maxChildDepth ?? 0);

        if (argList.length > 0) {
            argList.forEach((arg) => {
                arg.parent = node;
            });
            extendRange(node, argList[argList.length - 1]);
        }

        return node;
    }
}

export interface ListComprehensionNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.ListComprehension;
    expression: ParseNode;
    forIfNodes: ListComprehensionForIfNode[];
    isParenthesized?: boolean;
}

export namespace ListComprehensionNode {
    export function create(expression: ParseNode) {
        const node: ListComprehensionNode = {
            start: expression.start,
            length: expression.length,
            nodeType: ParseNodeType.ListComprehension,
            id: _nextNodeId++,
            expression,
            forIfNodes: [],
        };

        expression.parent = node;

        return node;
    }
}

export interface IndexNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Index;
    baseExpression: ExpressionNode;
    items: ArgumentNode[];
    trailingComma: boolean;
}

export namespace IndexNode {
    export function create(
        baseExpression: ExpressionNode,
        items: ArgumentNode[],
        trailingComma: boolean,
        closeBracketToken: Token
    ) {
        const node: IndexNode = {
            start: baseExpression.start,
            length: baseExpression.length,
            nodeType: ParseNodeType.Index,
            id: _nextNodeId++,
            baseExpression,
            items,
            trailingComma,
        };

        baseExpression.parent = node;
        items.forEach((item) => {
            item.parent = node;
        });

        extendRange(node, closeBracketToken);

        node.maxChildDepth = 1 + (baseExpression.maxChildDepth ?? 0);

        return node;
    }
}

export interface SliceNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Slice;
    startValue?: ExpressionNode | undefined;
    endValue?: ExpressionNode | undefined;
    stepValue?: ExpressionNode | undefined;
}

export namespace SliceNode {
    export function create(range: TextRange) {
        const node: SliceNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Slice,
            id: _nextNodeId++,
        };

        return node;
    }
}

export interface YieldNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Yield;
    expression?: ExpressionNode | undefined;
}

export namespace YieldNode {
    export function create(yieldToken: Token, expression?: ExpressionNode) {
        const node: YieldNode = {
            start: yieldToken.start,
            length: yieldToken.length,
            nodeType: ParseNodeType.Yield,
            id: _nextNodeId++,
            expression,
        };

        if (expression) {
            expression.parent = node;
            extendRange(node, expression);
        }

        return node;
    }
}

export interface YieldFromNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.YieldFrom;
    expression: ExpressionNode;
}

export namespace YieldFromNode {
    export function create(yieldToken: Token, expression: ExpressionNode) {
        const node: YieldFromNode = {
            start: yieldToken.start,
            length: yieldToken.length,
            nodeType: ParseNodeType.YieldFrom,
            id: _nextNodeId++,
            expression,
        };

        expression.parent = node;

        extendRange(node, expression);

        return node;
    }
}

export interface MemberAccessNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.MemberAccess;
    leftExpression: ExpressionNode;
    memberName: NameNode;
}

export namespace MemberAccessNode {
    export function create(leftExpression: ExpressionNode, memberName: NameNode) {
        const node: MemberAccessNode = {
            start: leftExpression.start,
            length: leftExpression.length,
            nodeType: ParseNodeType.MemberAccess,
            id: _nextNodeId++,
            leftExpression,
            memberName,
        };

        leftExpression.parent = node;
        memberName.parent = node;

        extendRange(node, memberName);

        node.maxChildDepth = 1 + (leftExpression.maxChildDepth ?? 0);

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
            id: _nextNodeId++,
            parameters: [],
            expression,
        };

        expression.parent = node;

        extendRange(node, expression);

        return node;
    }
}

export interface NameNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Name;
    token: IdentifierToken;
    value: string;
}

export namespace NameNode {
    export function create(nameToken: IdentifierToken) {
        const node: NameNode = {
            start: nameToken.start,
            length: nameToken.length,
            nodeType: ParseNodeType.Name,
            id: _nextNodeId++,
            token: nameToken,
            value: nameToken.value,
        };

        return node;
    }
}

export interface ConstantNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Constant;
    constType: KeywordType;
}

export namespace ConstantNode {
    export function create(token: KeywordToken) {
        const node: ConstantNode = {
            start: token.start,
            length: token.length,
            nodeType: ParseNodeType.Constant,
            id: _nextNodeId++,
            constType: token.keywordType,
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
            nodeType: ParseNodeType.Ellipsis,
            id: _nextNodeId++,
        };

        return node;
    }
}

export interface NumberNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Number;
    value: number | bigint;
    isInteger: boolean;
    isImaginary: boolean;
}

export namespace NumberNode {
    export function create(token: NumberToken) {
        const node: NumberNode = {
            start: token.start,
            length: token.length,
            nodeType: ParseNodeType.Number,
            id: _nextNodeId++,
            value: token.value,
            isInteger: token.isInteger,
            isImaginary: token.isImaginary,
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
            id: _nextNodeId++,
            token,
            value: unescapedValue,
            hasUnescapeErrors,
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
    export function create(
        token: StringToken,
        unescapedValue: string,
        hasUnescapeErrors: boolean,
        expressions: ExpressionNode[]
    ) {
        const node: FormatStringNode = {
            start: token.start,
            length: token.length,
            nodeType: ParseNodeType.FormatString,
            id: _nextNodeId++,
            token,
            value: unescapedValue,
            hasUnescapeErrors,
            expressions,
        };

        expressions.forEach((expr) => {
            expr.parent = node;
        });

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

    // Indicates that the string list is enclosed in parens.
    isParenthesized?: boolean;
}

export namespace StringListNode {
    export function create(strings: (StringNode | FormatStringNode)[]) {
        const node: StringListNode = {
            start: strings[0].start,
            length: strings[0].length,
            nodeType: ParseNodeType.StringList,
            id: _nextNodeId++,
            strings,
        };

        if (strings.length > 0) {
            strings.forEach((str) => {
                str.parent = node;
            });
            extendRange(node, strings[strings.length - 1]);
        }

        return node;
    }
}

export interface DictionaryNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Dictionary;
    entries: DictionaryEntryNode[];
    trailingCommaToken?: Token;
}

export namespace DictionaryNode {
    export function create(range: TextRange) {
        const node: DictionaryNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Dictionary,
            id: _nextNodeId++,
            entries: [],
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
            id: _nextNodeId++,
            keyExpression,
            valueExpression,
        };

        keyExpression.parent = node;
        valueExpression.parent = node;

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
            id: _nextNodeId++,
            expandExpression,
        };

        expandExpression.parent = node;

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
            id: _nextNodeId++,
            entries: [],
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
            id: _nextNodeId++,
            entries: [],
        };

        return node;
    }
}

export const enum ArgumentCategory {
    Simple,
    UnpackedList,
    UnpackedDictionary,
}

export interface ArgumentNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Argument;
    argumentCategory: ArgumentCategory;
    name?: NameNode | undefined;
    valueExpression: ExpressionNode;
}

export namespace ArgumentNode {
    export function create(
        startToken: Token | undefined,
        valueExpression: ExpressionNode,
        argCategory: ArgumentCategory
    ) {
        const node: ArgumentNode = {
            start: startToken ? startToken.start : valueExpression.start,
            length: startToken ? startToken.length : valueExpression.length,
            nodeType: ParseNodeType.Argument,
            id: _nextNodeId++,
            valueExpression,
            argumentCategory: argCategory,
        };

        valueExpression.parent = node;

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
            id: _nextNodeId++,
            expressions: [],
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
            nodeType: ParseNodeType.Pass,
            id: _nextNodeId++,
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
            id: _nextNodeId++,
            list: [],
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
            id: _nextNodeId++,
            leadingDots: 0,
            nameParts: [],
        };

        return node;
    }
}

export interface ImportAsNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.ImportAs;
    module: ModuleNameNode;
    alias?: NameNode | undefined;
}

export namespace ImportAsNode {
    export function create(module: ModuleNameNode) {
        const node: ImportAsNode = {
            start: module.start,
            length: module.length,
            nodeType: ParseNodeType.ImportAs,
            id: _nextNodeId++,
            module,
        };

        module.parent = node;

        return node;
    }
}

export interface ImportFromNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.ImportFrom;
    module: ModuleNameNode;
    imports: ImportFromAsNode[];
    isWildcardImport: boolean;
    usesParens: boolean;
    wildcardToken?: Token;
    missingImportKeyword?: boolean;
}

export namespace ImportFromNode {
    export function create(fromToken: Token, module: ModuleNameNode) {
        const node: ImportFromNode = {
            start: fromToken.start,
            length: fromToken.length,
            nodeType: ParseNodeType.ImportFrom,
            id: _nextNodeId++,
            module,
            imports: [],
            isWildcardImport: false,
            usesParens: false,
        };

        module.parent = node;

        extendRange(node, module);

        return node;
    }
}

export interface ImportFromAsNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.ImportFromAs;
    name: NameNode;
    alias?: NameNode | undefined;
}

export namespace ImportFromAsNode {
    export function create(name: NameNode) {
        const node: ImportFromAsNode = {
            start: name.start,
            length: name.length,
            nodeType: ParseNodeType.ImportFromAs,
            id: _nextNodeId++,
            name,
        };

        name.parent = node;

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
            id: _nextNodeId++,
            nameList: [],
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
            id: _nextNodeId++,
            nameList: [],
        };

        return node;
    }
}

export interface AssertNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Assert;
    testExpression: ExpressionNode;
    exceptionExpression?: ExpressionNode | undefined;
}

export namespace AssertNode {
    export function create(assertToken: Token, testExpression: ExpressionNode) {
        const node: AssertNode = {
            start: assertToken.start,
            length: assertToken.length,
            nodeType: ParseNodeType.Assert,
            id: _nextNodeId++,
            testExpression,
        };

        testExpression.parent = node;

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
            nodeType: ParseNodeType.Break,
            id: _nextNodeId++,
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
            nodeType: ParseNodeType.Continue,
            id: _nextNodeId++,
        };

        return node;
    }
}

export interface ReturnNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Return;
    returnExpression?: ExpressionNode | undefined;
}

export namespace ReturnNode {
    export function create(range: TextRange) {
        const node: ReturnNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Return,
            id: _nextNodeId++,
        };

        return node;
    }
}

export interface RaiseNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Raise;
    typeExpression?: ExpressionNode | undefined;
    valueExpression?: ExpressionNode | undefined;
    tracebackExpression?: ExpressionNode | undefined;
}

export namespace RaiseNode {
    export function create(range: TextRange) {
        const node: RaiseNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Raise,
            id: _nextNodeId++,
        };

        return node;
    }
}

export interface MatchNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Match;
    subjectExpression: ExpressionNode;
    cases: CaseNode[];
}

export namespace MatchNode {
    export function create(matchToken: TextRange, subjectExpression: ExpressionNode) {
        const node: MatchNode = {
            start: matchToken.start,
            length: matchToken.length,
            nodeType: ParseNodeType.Match,
            id: _nextNodeId++,
            subjectExpression,
            cases: [],
        };

        subjectExpression.parent = node;

        extendRange(node, subjectExpression);

        return node;
    }
}

export interface CaseNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Case;
    pattern: PatternAtomNode;
    isIrrefutable: boolean;
    guardExpression?: ExpressionNode | undefined;
    suite: SuiteNode;
}

export namespace CaseNode {
    export function create(
        caseToken: TextRange,
        pattern: PatternAtomNode,
        isIrrefutable: boolean,
        guardExpression: ExpressionNode | undefined,
        suite: SuiteNode
    ) {
        const node: CaseNode = {
            start: caseToken.start,
            length: caseToken.length,
            nodeType: ParseNodeType.Case,
            id: _nextNodeId++,
            pattern,
            isIrrefutable,
            guardExpression,
            suite,
        };

        extendRange(node, suite);

        pattern.parent = node;
        suite.parent = node;

        if (guardExpression) {
            guardExpression.parent = node;
        }

        return node;
    }
}

export interface PatternSequenceNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.PatternSequence;
    entries: PatternAsNode[];
    starEntryIndex: number | undefined;
}

export namespace PatternSequenceNode {
    export function create(firstToken: TextRange, entries: PatternAsNode[]) {
        const starEntryIndex = entries.findIndex(
            (entry) =>
                entry.orPatterns.length === 1 &&
                entry.orPatterns[0].nodeType === ParseNodeType.PatternCapture &&
                entry.orPatterns[0].isStar
        );

        const node: PatternSequenceNode = {
            start: firstToken.start,
            length: firstToken.length,
            nodeType: ParseNodeType.PatternSequence,
            id: _nextNodeId++,
            entries,
            starEntryIndex: starEntryIndex >= 0 ? starEntryIndex : undefined,
        };

        if (entries.length > 0) {
            extendRange(node, entries[entries.length - 1]);
        }

        entries.forEach((entry) => {
            entry.parent = node;
        });

        return node;
    }
}

export interface PatternAsNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.PatternAs;
    orPatterns: PatternAtomNode[];
    target?: NameNode | undefined;
}

export namespace PatternAsNode {
    export function create(orPatterns: PatternAtomNode[], target?: NameNode) {
        const node: PatternAsNode = {
            start: orPatterns[0].start,
            length: orPatterns[0].length,
            nodeType: ParseNodeType.PatternAs,
            id: _nextNodeId++,
            orPatterns,
            target,
        };

        if (orPatterns.length > 1) {
            extendRange(node, orPatterns[orPatterns.length - 1]);
        }

        orPatterns.forEach((pattern) => {
            pattern.parent = node;
        });

        if (target) {
            extendRange(node, target);
            target.parent = node;
        }

        return node;
    }
}

export interface PatternLiteralNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.PatternLiteral;
    expression: ExpressionNode;
}

export namespace PatternLiteralNode {
    export function create(expression: ExpressionNode) {
        const node: PatternLiteralNode = {
            start: expression.start,
            length: expression.length,
            nodeType: ParseNodeType.PatternLiteral,
            id: _nextNodeId++,
            expression,
        };

        expression.parent = node;

        return node;
    }
}

export interface PatternClassNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.PatternClass;
    className: NameNode | MemberAccessNode;
    arguments: PatternClassArgumentNode[];
}

export namespace PatternClassNode {
    export function create(className: NameNode | MemberAccessNode, args: PatternClassArgumentNode[]) {
        const node: PatternClassNode = {
            start: className.start,
            length: className.length,
            nodeType: ParseNodeType.PatternClass,
            id: _nextNodeId++,
            className,
            arguments: args,
        };

        className.parent = node;
        args.forEach((arg) => {
            arg.parent = node;
        });

        if (args.length > 0) {
            extendRange(node, args[args.length - 1]);
        }

        return node;
    }
}

export interface PatternClassArgumentNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.PatternClassArgument;
    name?: NameNode | undefined;
    pattern: PatternAsNode;
}

export namespace PatternClassArgumentNode {
    export function create(pattern: PatternAsNode, name?: NameNode) {
        const node: PatternClassArgumentNode = {
            start: pattern.start,
            length: pattern.length,
            nodeType: ParseNodeType.PatternClassArgument,
            id: _nextNodeId++,
            pattern,
            name,
        };

        pattern.parent = node;

        if (name) {
            extendRange(node, name);
            name.parent = node;
        }

        return node;
    }
}

export interface PatternCaptureNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.PatternCapture;
    target: NameNode;
    isStar: boolean;
    isWildcard: boolean;
}

export namespace PatternCaptureNode {
    export function create(target: NameNode, starToken?: TextRange) {
        const node: PatternCaptureNode = {
            start: target.start,
            length: target.length,
            nodeType: ParseNodeType.PatternCapture,
            id: _nextNodeId++,
            target,
            isStar: starToken !== undefined,
            isWildcard: target.value === '_',
        };

        target.parent = node;

        if (starToken) {
            extendRange(node, starToken);
        }

        return node;
    }
}

export interface PatternMappingNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.PatternMapping;
    entries: PatternMappingEntryNode[];
}

export namespace PatternMappingNode {
    export function create(startToken: TextRange, entries: PatternMappingEntryNode[]) {
        const node: PatternMappingNode = {
            start: startToken.start,
            length: startToken.length,
            nodeType: ParseNodeType.PatternMapping,
            id: _nextNodeId++,
            entries,
        };

        if (entries.length > 0) {
            extendRange(node, entries[entries.length - 1]);
        }

        entries.forEach((entry) => {
            entry.parent = node;
        });

        return node;
    }
}

export type PatternMappingEntryNode = PatternMappingKeyEntryNode | PatternMappingExpandEntryNode;

export interface PatternMappingKeyEntryNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.PatternMappingKeyEntry;
    keyPattern: PatternLiteralNode | PatternValueNode | ErrorNode;
    valuePattern: PatternAsNode | ErrorNode;
}

export namespace PatternMappingKeyEntryNode {
    export function create(
        keyPattern: PatternLiteralNode | PatternValueNode | ErrorNode,
        valuePattern: PatternAsNode | ErrorNode
    ) {
        const node: PatternMappingKeyEntryNode = {
            start: keyPattern.start,
            length: keyPattern.length,
            nodeType: ParseNodeType.PatternMappingKeyEntry,
            id: _nextNodeId++,
            keyPattern,
            valuePattern,
        };

        keyPattern.parent = node;
        valuePattern.parent = node;

        extendRange(node, valuePattern);

        return node;
    }
}

export interface PatternMappingExpandEntryNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.PatternMappingExpandEntry;
    target: NameNode;
}

export namespace PatternMappingExpandEntryNode {
    export function create(starStarToken: TextRange, target: NameNode) {
        const node: PatternMappingExpandEntryNode = {
            start: starStarToken.start,
            length: starStarToken.length,
            nodeType: ParseNodeType.PatternMappingExpandEntry,
            id: _nextNodeId++,
            target,
        };

        target.parent = node;

        extendRange(node, target);

        return node;
    }
}

export interface PatternValueNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.PatternValue;
    expression: MemberAccessNode;
}

export namespace PatternValueNode {
    export function create(expression: MemberAccessNode) {
        const node: PatternValueNode = {
            start: expression.start,
            length: expression.length,
            nodeType: ParseNodeType.PatternValue,
            id: _nextNodeId++,
            expression,
        };

        expression.parent = node;

        return node;
    }
}

export type PatternAtomNode =
    | PatternSequenceNode
    | PatternLiteralNode
    | PatternClassNode
    | PatternAsNode
    | PatternCaptureNode
    | PatternMappingNode
    | PatternValueNode
    | ErrorNode;

export type ParseNode =
    | ErrorNode
    | ArgumentNode
    | AssertNode
    | AssignmentExpressionNode
    | AssignmentNode
    | AugmentedAssignmentNode
    | AwaitNode
    | BinaryOperationNode
    | BreakNode
    | CallNode
    | CaseNode
    | ClassNode
    | ConstantNode
    | ContinueNode
    | DecoratorNode
    | DelNode
    | DictionaryNode
    | DictionaryEntryNode
    | DictionaryExpandEntryNode
    | DictionaryKeyEntryNode
    | EllipsisNode
    | IfNode
    | ImportNode
    | ImportAsNode
    | ImportFromNode
    | ImportFromAsNode
    | IndexNode
    | ExceptNode
    | ForNode
    | FormatStringNode
    | FunctionNode
    | FunctionAnnotationNode
    | GlobalNode
    | LambdaNode
    | ListNode
    | ListComprehensionNode
    | ListComprehensionForNode
    | ListComprehensionIfNode
    | MatchNode
    | MemberAccessNode
    | ModuleNameNode
    | ModuleNode
    | NameNode
    | NonlocalNode
    | NumberNode
    | ParameterNode
    | PassNode
    | PatternAsNode
    | PatternClassNode
    | PatternClassArgumentNode
    | PatternCaptureNode
    | PatternLiteralNode
    | PatternMappingExpandEntryNode
    | PatternMappingKeyEntryNode
    | PatternMappingNode
    | PatternSequenceNode
    | PatternValueNode
    | RaiseNode
    | ReturnNode
    | SetNode
    | SliceNode
    | StatementListNode
    | StringListNode
    | StringNode
    | SuiteNode
    | TernaryNode
    | TupleNode
    | TryNode
    | TypeAnnotationNode
    | UnaryOperationNode
    | UnpackNode
    | WhileNode
    | WithNode
    | WithItemNode
    | YieldNode
    | YieldFromNode;

export type EvaluationScopeNode = LambdaNode | FunctionNode | ModuleNode | ClassNode | ListComprehensionNode;
export type ExecutionScopeNode = LambdaNode | FunctionNode | ModuleNode;
