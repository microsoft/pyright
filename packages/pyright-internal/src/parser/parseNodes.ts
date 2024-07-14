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
    FStringEndToken,
    FStringMiddleToken,
    FStringStartToken,
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
    Comprehension,
    ComprehensionFor,
    ComprehensionIf,
    Constant,
    Continue,
    Decorator,
    Del,
    Dictionary,
    DictionaryExpandEntry,

    DictionaryKeyEntry, // 20
    Ellipsis,
    If,
    Import,
    ImportAs,
    ImportFrom,
    ImportFromAs,
    Index,
    Except,
    For,

    FormatString, // 30
    Function,
    Global,
    Lambda,
    List,
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
    TypeParameter,
    TypeParameterList,
    TypeAlias,
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

export interface ParseNodeBase<T extends ParseNodeType> {
    readonly nodeType: T;
    readonly start: number;
    readonly length: number;

    // A unique ID given to each parse node.
    id: number;

    parent: ParseNode | undefined;

    // A reference to information computed in later passes.
    a: object | undefined;

    // Additional details that are specific to the parse node type.
    d: object;
}

let _nextNodeId = 1;
export function getNextNodeId() {
    return _nextNodeId++;
}

export function extendRange(node: ParseNodeBase<any>, newRange: TextRange) {
    const extendedRange = TextRange.extend(node, newRange);

    // Temporarily allow writes to the range fields.
    (node as any).start = extendedRange.start;
    (node as any).length = extendedRange.length;
}

export type ParseNodeArray = (ParseNode | undefined)[];

export interface ModuleNode extends ParseNodeBase<ParseNodeType.Module> {
    d: {
        statements: StatementNode[];
    };
}

export namespace ModuleNode {
    export function create(range: TextRange) {
        const node: ModuleNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Module,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: { statements: [] },
        };

        return node;
    }
}

export interface SuiteNode extends ParseNodeBase<ParseNodeType.Suite> {
    d: {
        statements: StatementNode[];
        typeComment: StringToken | undefined;
    };
}

export namespace SuiteNode {
    export function create(range: TextRange) {
        const node: SuiteNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Suite,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {
                statements: [],
                typeComment: undefined,
            },
        };

        return node;
    }
}

export interface IfNode extends ParseNodeBase<ParseNodeType.If> {
    d: {
        testExpression: ExpressionNode;
        ifSuite: SuiteNode;
        elseSuite: SuiteNode | IfNode | undefined;
    };
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
            parent: undefined,
            a: undefined,
            d: {
                testExpression: testExpression,
                ifSuite: ifSuite,
                elseSuite: elseSuite,
            },
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

export interface WhileNode extends ParseNodeBase<ParseNodeType.While> {
    d: {
        testExpression: ExpressionNode;
        whileSuite: SuiteNode;
        elseSuite?: SuiteNode | undefined;
    };
}

export namespace WhileNode {
    export function create(whileToken: Token, testExpression: ExpressionNode, whileSuite: SuiteNode) {
        const node: WhileNode = {
            start: whileToken.start,
            length: whileToken.length,
            nodeType: ParseNodeType.While,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {
                testExpression: testExpression,
                whileSuite: whileSuite,
            },
        };

        testExpression.parent = node;
        whileSuite.parent = node;

        extendRange(node, whileSuite);

        return node;
    }
}

export interface ForNode extends ParseNodeBase<ParseNodeType.For> {
    d: {
        isAsync?: boolean;
        asyncToken?: Token;
        targetExpression: ExpressionNode;
        iterableExpression: ExpressionNode;
        forSuite: SuiteNode;
        elseSuite?: SuiteNode | undefined;
        typeComment?: StringToken;
    };
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
            parent: undefined,
            a: undefined,
            d: {
                targetExpression: targetExpression,
                iterableExpression: iterableExpression,
                forSuite: forSuite,
            },
        };

        targetExpression.parent = node;
        iterableExpression.parent = node;
        forSuite.parent = node;

        extendRange(node, forSuite);

        return node;
    }
}

export type ComprehensionForIfNode = ComprehensionForNode | ComprehensionIfNode;

export interface ComprehensionForNode extends ParseNodeBase<ParseNodeType.ComprehensionFor> {
    d: {
        isAsync?: boolean;
        asyncToken?: Token;
        targetExpression: ExpressionNode;
        iterableExpression: ExpressionNode;
    };
}

export namespace ComprehensionForNode {
    export function create(startToken: Token, targetExpression: ExpressionNode, iterableExpression: ExpressionNode) {
        const node: ComprehensionForNode = {
            start: startToken.start,
            length: startToken.length,
            nodeType: ParseNodeType.ComprehensionFor,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {
                targetExpression: targetExpression,
                iterableExpression: iterableExpression,
            },
        };

        targetExpression.parent = node;
        iterableExpression.parent = node;

        extendRange(node, targetExpression);
        extendRange(node, iterableExpression);

        return node;
    }
}

export interface ComprehensionIfNode extends ParseNodeBase<ParseNodeType.ComprehensionIf> {
    d: {
        testExpression: ExpressionNode;
    };
}

export namespace ComprehensionIfNode {
    export function create(ifToken: Token, testExpression: ExpressionNode) {
        const node: ComprehensionIfNode = {
            start: ifToken.start,
            length: ifToken.length,
            nodeType: ParseNodeType.ComprehensionIf,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: { testExpression: testExpression },
        };

        testExpression.parent = node;

        extendRange(node, testExpression);

        return node;
    }
}

export interface TryNode extends ParseNodeBase<ParseNodeType.Try> {
    d: {
        trySuite: SuiteNode;
        exceptClauses: ExceptNode[];
        elseSuite?: SuiteNode | undefined;
        finallySuite?: SuiteNode | undefined;
    };
}

export namespace TryNode {
    export function create(tryToken: Token, trySuite: SuiteNode) {
        const node: TryNode = {
            start: tryToken.start,
            length: tryToken.length,
            nodeType: ParseNodeType.Try,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {
                trySuite: trySuite,
                exceptClauses: [],
            },
        };

        trySuite.parent = node;

        extendRange(node, trySuite);

        return node;
    }
}

export interface ExceptNode extends ParseNodeBase<ParseNodeType.Except> {
    d: {
        typeExpression?: ExpressionNode | undefined;
        name?: NameNode | undefined;
        exceptSuite: SuiteNode;
        isExceptGroup: boolean;
    };
}

export namespace ExceptNode {
    export function create(exceptToken: Token, exceptSuite: SuiteNode, isExceptGroup: boolean) {
        const node: ExceptNode = {
            start: exceptToken.start,
            length: exceptToken.length,
            nodeType: ParseNodeType.Except,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {
                exceptSuite: exceptSuite,
                isExceptGroup: isExceptGroup,
            },
        };

        exceptSuite.parent = node;

        extendRange(node, exceptSuite);

        return node;
    }
}

export interface FunctionNode extends ParseNodeBase<ParseNodeType.Function> {
    d: {
        decorators: DecoratorNode[];
        isAsync: boolean;
        name: NameNode;
        typeParameters: TypeParameterListNode | undefined;
        parameters: ParameterNode[];
        returnTypeAnnotation: ExpressionNode | undefined;
        functionAnnotationComment: FunctionAnnotationNode | undefined;
        suite: SuiteNode;
    };
}

export namespace FunctionNode {
    export function create(defToken: Token, name: NameNode, suite: SuiteNode, typeParameters?: TypeParameterListNode) {
        const node: FunctionNode = {
            start: defToken.start,
            length: defToken.length,
            nodeType: ParseNodeType.Function,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {
                decorators: [],
                isAsync: false,
                name: name,
                typeParameters,
                parameters: [],
                returnTypeAnnotation: undefined,
                functionAnnotationComment: undefined,
                suite: suite,
            },
        };

        name.parent = node;
        suite.parent = node;

        if (typeParameters) {
            typeParameters.parent = node;
        }

        extendRange(node, suite);

        return node;
    }
}

export const enum ParameterCategory {
    Simple,
    ArgsList,
    KwargsDict,
}

export interface ParameterNode extends ParseNodeBase<ParseNodeType.Parameter> {
    d: {
        category: ParameterCategory;
        name: NameNode | undefined;
        typeAnnotation: ExpressionNode | undefined;
        typeAnnotationComment: ExpressionNode | undefined;
        defaultValue: ExpressionNode | undefined;
    };
}

export namespace ParameterNode {
    export function create(startToken: Token, paramCategory: ParameterCategory) {
        const node: ParameterNode = {
            start: startToken.start,
            length: startToken.length,
            nodeType: ParseNodeType.Parameter,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {
                category: paramCategory,
                name: undefined,
                typeAnnotation: undefined,
                typeAnnotationComment: undefined,
                defaultValue: undefined,
            },
        };

        return node;
    }
}

export interface ClassNode extends ParseNodeBase<ParseNodeType.Class> {
    d: {
        decorators: DecoratorNode[];
        name: NameNode;
        typeParameters: TypeParameterListNode | undefined;
        arguments: ArgumentNode[];
        suite: SuiteNode;
    };
}

export namespace ClassNode {
    export function create(
        classToken: Token,
        name: NameNode,
        suite: SuiteNode,
        typeParameters?: TypeParameterListNode
    ) {
        const node: ClassNode = {
            start: classToken.start,
            length: classToken.length,
            nodeType: ParseNodeType.Class,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {
                decorators: [],
                name: name,
                typeParameters,
                arguments: [],
                suite: suite,
            },
        };

        name.parent = node;
        suite.parent = node;

        if (typeParameters) {
            typeParameters.parent = node;
        }

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
            parent: undefined,
            a: undefined,
            d: {
                decorators,
                name: {
                    start: decorators[0].start,
                    length: 0,
                    nodeType: ParseNodeType.Name,
                    id: 0,
                    parent: undefined,
                    a: undefined,
                    d: {
                        token: {
                            type: TokenType.Identifier,
                            start: 0,
                            length: 0,
                            comments: [],
                            value: '',
                        },
                        value: '',
                    },
                },
                typeParameters: undefined,
                arguments: [],
                suite: {
                    start: decorators[0].start,
                    length: 0,
                    nodeType: ParseNodeType.Suite,
                    id: 0,
                    parent: undefined,
                    a: undefined,
                    d: { statements: [], typeComment: undefined },
                },
            },
        };

        decorators.forEach((decorator) => {
            decorator.parent = node;
            extendRange(node, decorator);
        });

        node.d.name.parent = node;
        node.d.suite.parent = node;

        return node;
    }
}

export interface WithNode extends ParseNodeBase<ParseNodeType.With> {
    d: {
        isAsync?: boolean;
        asyncToken?: Token;
        withItems: WithItemNode[];
        suite: SuiteNode;
        typeComment?: StringToken;
    };
}

export namespace WithNode {
    export function create(withToken: Token, suite: SuiteNode) {
        const node: WithNode = {
            start: withToken.start,
            length: withToken.length,
            nodeType: ParseNodeType.With,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {
                withItems: [],
                suite: suite,
            },
        };

        suite.parent = node;

        extendRange(node, suite);

        return node;
    }
}

export interface WithItemNode extends ParseNodeBase<ParseNodeType.WithItem> {
    d: {
        expression: ExpressionNode;
        target?: ExpressionNode | undefined;
    };
}

export namespace WithItemNode {
    export function create(expression: ExpressionNode) {
        const node: WithItemNode = {
            start: expression.start,
            length: expression.length,
            nodeType: ParseNodeType.WithItem,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: { expression },
        };

        expression.parent = node;

        return node;
    }
}

export interface DecoratorNode extends ParseNodeBase<ParseNodeType.Decorator> {
    d: {
        expression: ExpressionNode;
    };
}

export namespace DecoratorNode {
    export function create(atToken: Token, expression: ExpressionNode) {
        const node: DecoratorNode = {
            start: atToken.start,
            length: atToken.length,
            nodeType: ParseNodeType.Decorator,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: { expression },
        };

        expression.parent = node;

        extendRange(node, expression);

        return node;
    }
}

export interface StatementListNode extends ParseNodeBase<ParseNodeType.StatementList> {
    d: {
        statements: ParseNode[];
    };
}

export namespace StatementListNode {
    export function create(atToken: Token) {
        const node: StatementListNode = {
            start: atToken.start,
            length: atToken.length,
            nodeType: ParseNodeType.StatementList,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: { statements: [] },
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
    | TypeAliasNode
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
    | ComprehensionNode
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
    | ListNode
    | SetNode;

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
        case ParseNodeType.Comprehension:
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
        case ParseNodeType.List:
        case ParseNodeType.Set:
            return true;

        default:
            return false;
    }
}

export interface ErrorNode extends ParseNodeBase<ParseNodeType.Error> {
    d: {
        readonly category: ErrorExpressionCategory;
        readonly child: ExpressionNode | undefined;
        readonly decorators?: DecoratorNode[] | undefined;
    };
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
            parent: undefined,
            a: undefined,
            d: {
                category,
                child,
                decorators,
            },
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

export interface UnaryOperationNode extends ParseNodeBase<ParseNodeType.UnaryOperation> {
    d: {
        expression: ExpressionNode;
        operatorToken: Token;
        operator: OperatorType;
        isParenthesized: boolean;
    };
}

export namespace UnaryOperationNode {
    export function create(operatorToken: Token, expression: ExpressionNode, operator: OperatorType) {
        const node: UnaryOperationNode = {
            start: operatorToken.start,
            length: operatorToken.length,
            nodeType: ParseNodeType.UnaryOperation,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {
                operator,
                operatorToken,
                expression,
                isParenthesized: false,
            },
        };

        expression.parent = node;

        extendRange(node, expression);

        return node;
    }
}

export interface BinaryOperationNode extends ParseNodeBase<ParseNodeType.BinaryOperation> {
    d: {
        leftExpression: ExpressionNode;
        operatorToken: Token;
        operator: OperatorType;
        rightExpression: ExpressionNode;
        isParenthesized: boolean;
    };
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
            parent: undefined,
            a: undefined,
            d: {
                leftExpression,
                operatorToken,
                operator,
                rightExpression,
                isParenthesized: false,
            },
        };

        leftExpression.parent = node;
        rightExpression.parent = node;

        extendRange(node, rightExpression);

        return node;
    }
}

export interface AssignmentExpressionNode extends ParseNodeBase<ParseNodeType.AssignmentExpression> {
    d: {
        name: NameNode;
        walrusToken: Token;
        rightExpression: ExpressionNode;
        isParenthesized: boolean;
    };
}

export namespace AssignmentExpressionNode {
    export function create(name: NameNode, walrusToken: Token, rightExpression: ExpressionNode) {
        const node: AssignmentExpressionNode = {
            start: name.start,
            length: name.length,
            nodeType: ParseNodeType.AssignmentExpression,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {
                name,
                walrusToken,
                rightExpression,
                isParenthesized: false,
            },
        };

        name.parent = node;
        rightExpression.parent = node;

        extendRange(node, rightExpression);

        return node;
    }
}

export interface AssignmentNode extends ParseNodeBase<ParseNodeType.Assignment> {
    d: {
        leftExpression: ExpressionNode;
        rightExpression: ExpressionNode;
        typeAnnotationComment?: ExpressionNode | undefined;
        chainedTypeAnnotationComment?: ExpressionNode | undefined;
    };
}

export namespace AssignmentNode {
    export function create(leftExpression: ExpressionNode, rightExpression: ExpressionNode) {
        const node: AssignmentNode = {
            start: leftExpression.start,
            length: leftExpression.length,
            nodeType: ParseNodeType.Assignment,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {
                leftExpression,
                rightExpression,
            },
        };

        leftExpression.parent = node;
        rightExpression.parent = node;

        extendRange(node, rightExpression);

        return node;
    }
}

export enum TypeParameterCategory {
    TypeVar,
    TypeVarTuple,
    ParamSpec,
}

export interface TypeParameterNode extends ParseNodeBase<ParseNodeType.TypeParameter> {
    d: {
        name: NameNode;
        typeParamCategory: TypeParameterCategory;
        boundExpression?: ExpressionNode;
        defaultExpression?: ExpressionNode;
    };
}

export namespace TypeParameterNode {
    export function create(
        name: NameNode,
        typeParamCategory: TypeParameterCategory,
        boundExpression?: ExpressionNode,
        defaultExpression?: ExpressionNode
    ) {
        const node: TypeParameterNode = {
            start: name.start,
            length: name.length,
            nodeType: ParseNodeType.TypeParameter,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {
                name: name,
                typeParamCategory,
                boundExpression,
                defaultExpression,
            },
        };

        name.parent = node;

        if (boundExpression) {
            boundExpression.parent = node;
            extendRange(node, boundExpression);
        }

        if (defaultExpression) {
            defaultExpression.parent = node;
            extendRange(node, defaultExpression);
        }

        return node;
    }
}

export interface TypeParameterListNode extends ParseNodeBase<ParseNodeType.TypeParameterList> {
    d: {
        parameters: TypeParameterNode[];
    };
}

export namespace TypeParameterListNode {
    export function create(startToken: Token, endToken: Token, parameters: TypeParameterNode[]) {
        const node: TypeParameterListNode = {
            start: startToken.start,
            length: startToken.length,
            nodeType: ParseNodeType.TypeParameterList,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: { parameters: parameters },
        };

        extendRange(node, endToken);

        parameters.forEach((param) => {
            extendRange(node, param);
            param.parent = node;
        });

        return node;
    }
}

export interface TypeAliasNode extends ParseNodeBase<ParseNodeType.TypeAlias> {
    d: {
        name: NameNode;
        typeParameters?: TypeParameterListNode;
        expression: ExpressionNode;
    };
}

export namespace TypeAliasNode {
    export function create(
        typeToken: KeywordToken,
        name: NameNode,
        expression: ExpressionNode,
        typeParameters?: TypeParameterListNode
    ) {
        const node: TypeAliasNode = {
            start: typeToken.start,
            length: typeToken.length,
            nodeType: ParseNodeType.TypeAlias,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {
                name,
                typeParameters,
                expression,
            },
        };

        name.parent = node;
        expression.parent = node;

        if (typeParameters) {
            typeParameters.parent = node;
        }

        extendRange(node, expression);

        return node;
    }
}

export interface TypeAnnotationNode extends ParseNodeBase<ParseNodeType.TypeAnnotation> {
    d: {
        valueExpression: ExpressionNode;
        typeAnnotation: ExpressionNode;
    };
}

export namespace TypeAnnotationNode {
    export function create(valueExpression: ExpressionNode, typeAnnotation: ExpressionNode) {
        const node: TypeAnnotationNode = {
            start: valueExpression.start,
            length: valueExpression.length,
            nodeType: ParseNodeType.TypeAnnotation,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {
                valueExpression,
                typeAnnotation,
            },
        };

        valueExpression.parent = node;
        typeAnnotation.parent = node;

        extendRange(node, typeAnnotation);

        return node;
    }
}

export interface FunctionAnnotationNode extends ParseNodeBase<ParseNodeType.FunctionAnnotation> {
    d: {
        isParamListEllipsis: boolean;
        paramTypeAnnotations: ExpressionNode[];
        returnTypeAnnotation: ExpressionNode;
    };
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
            parent: undefined,
            a: undefined,
            d: {
                isParamListEllipsis,
                paramTypeAnnotations,
                returnTypeAnnotation,
            },
        };

        paramTypeAnnotations.forEach((p) => {
            p.parent = node;
        });
        returnTypeAnnotation.parent = node;

        extendRange(node, returnTypeAnnotation);

        return node;
    }
}

export interface AugmentedAssignmentNode extends ParseNodeBase<ParseNodeType.AugmentedAssignment> {
    d: {
        leftExpression: ExpressionNode;
        operator: OperatorType;
        rightExpression: ExpressionNode;

        // The destExpression is a copy of the leftExpression
        // node. We use it as a place to hang the result type,
        // as opposed to the source type.
        destExpression: ExpressionNode;
    };
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
            parent: undefined,
            a: undefined,
            d: {
                leftExpression,
                operator,
                rightExpression,
                destExpression,
            },
        };

        leftExpression.parent = node;
        rightExpression.parent = node;
        destExpression.parent = node;

        extendRange(node, rightExpression);

        return node;
    }
}

export interface AwaitNode extends ParseNodeBase<ParseNodeType.Await> {
    d: {
        expression: ExpressionNode;
        isParenthesized?: boolean;
    };
}

export namespace AwaitNode {
    export function create(awaitToken: Token, expression: ExpressionNode) {
        const node: AwaitNode = {
            start: awaitToken.start,
            length: awaitToken.length,
            nodeType: ParseNodeType.Await,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: { expression },
        };

        expression.parent = node;

        extendRange(node, expression);

        return node;
    }
}

export interface TernaryNode extends ParseNodeBase<ParseNodeType.Ternary> {
    d: {
        ifExpression: ExpressionNode;
        testExpression: ExpressionNode;
        elseExpression: ExpressionNode;
    };
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
            parent: undefined,
            a: undefined,
            d: {
                ifExpression,
                testExpression,
                elseExpression,
            },
        };

        ifExpression.parent = node;
        testExpression.parent = node;
        elseExpression.parent = node;

        extendRange(node, elseExpression);

        return node;
    }
}

export interface UnpackNode extends ParseNodeBase<ParseNodeType.Unpack> {
    d: {
        expression: ExpressionNode;
        starToken: Token;
    };
}

export namespace UnpackNode {
    export function create(starToken: Token, expression: ExpressionNode) {
        const node: UnpackNode = {
            start: starToken.start,
            length: starToken.length,
            nodeType: ParseNodeType.Unpack,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {
                expression,
                starToken,
            },
        };

        expression.parent = node;

        extendRange(node, expression);

        return node;
    }
}

export interface TupleNode extends ParseNodeBase<ParseNodeType.Tuple> {
    d: {
        expressions: ExpressionNode[];
        isParenthesized: boolean;
    };
}

export namespace TupleNode {
    export function create(range: TextRange, isParenthesized: boolean) {
        const node: TupleNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Tuple,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {
                expressions: [],
                isParenthesized,
            },
        };

        return node;
    }
}

export interface CallNode extends ParseNodeBase<ParseNodeType.Call> {
    d: {
        leftExpression: ExpressionNode;
        arguments: ArgumentNode[];
        trailingComma: boolean;
    };
}

export namespace CallNode {
    export function create(leftExpression: ExpressionNode, argList: ArgumentNode[], trailingComma: boolean) {
        const node: CallNode = {
            start: leftExpression.start,
            length: leftExpression.length,
            nodeType: ParseNodeType.Call,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {
                leftExpression,
                arguments: argList,
                trailingComma,
            },
        };

        leftExpression.parent = node;

        if (argList.length > 0) {
            argList.forEach((arg) => {
                arg.parent = node;
            });
            extendRange(node, argList[argList.length - 1]);
        }

        return node;
    }
}

export interface ComprehensionNode extends ParseNodeBase<ParseNodeType.Comprehension> {
    d: {
        expression: ParseNode;
        forIfNodes: ComprehensionForIfNode[];
        isGenerator: boolean;
        isParenthesized?: boolean;
    };
}

export namespace ComprehensionNode {
    export function create(expression: ParseNode, isGenerator: boolean) {
        const node: ComprehensionNode = {
            start: expression.start,
            length: expression.length,
            nodeType: ParseNodeType.Comprehension,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {
                expression,
                forIfNodes: [],
                isGenerator,
            },
        };

        expression.parent = node;

        return node;
    }
}

export interface IndexNode extends ParseNodeBase<ParseNodeType.Index> {
    d: {
        baseExpression: ExpressionNode;
        items: ArgumentNode[];
        trailingComma: boolean;
    };
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
            parent: undefined,
            a: undefined,
            d: {
                baseExpression,
                items,
                trailingComma,
            },
        };

        baseExpression.parent = node;
        items.forEach((item) => {
            item.parent = node;
        });

        extendRange(node, closeBracketToken);

        return node;
    }
}

export interface SliceNode extends ParseNodeBase<ParseNodeType.Slice> {
    d: {
        startValue?: ExpressionNode | undefined;
        endValue?: ExpressionNode | undefined;
        stepValue?: ExpressionNode | undefined;
    };
}

export namespace SliceNode {
    export function create(range: TextRange) {
        const node: SliceNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Slice,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {},
        };

        return node;
    }
}

export interface YieldNode extends ParseNodeBase<ParseNodeType.Yield> {
    d: {
        expression?: ExpressionNode | undefined;
    };
}

export namespace YieldNode {
    export function create(yieldToken: Token, expression?: ExpressionNode) {
        const node: YieldNode = {
            start: yieldToken.start,
            length: yieldToken.length,
            nodeType: ParseNodeType.Yield,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: { expression },
        };

        if (expression) {
            expression.parent = node;
            extendRange(node, expression);
        }

        return node;
    }
}

export interface YieldFromNode extends ParseNodeBase<ParseNodeType.YieldFrom> {
    d: {
        expression: ExpressionNode;
    };
}

export namespace YieldFromNode {
    export function create(yieldToken: Token, expression: ExpressionNode) {
        const node: YieldFromNode = {
            start: yieldToken.start,
            length: yieldToken.length,
            nodeType: ParseNodeType.YieldFrom,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: { expression },
        };

        expression.parent = node;

        extendRange(node, expression);

        return node;
    }
}

export interface MemberAccessNode extends ParseNodeBase<ParseNodeType.MemberAccess> {
    d: {
        leftExpression: ExpressionNode;
        memberName: NameNode;
    };
}

export namespace MemberAccessNode {
    export function create(leftExpression: ExpressionNode, memberName: NameNode) {
        const node: MemberAccessNode = {
            start: leftExpression.start,
            length: leftExpression.length,
            nodeType: ParseNodeType.MemberAccess,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {
                leftExpression,
                memberName,
            },
        };

        leftExpression.parent = node;
        memberName.parent = node;

        extendRange(node, memberName);

        return node;
    }
}

export interface LambdaNode extends ParseNodeBase<ParseNodeType.Lambda> {
    d: {
        parameters: ParameterNode[];
        expression: ExpressionNode;
    };
}

export namespace LambdaNode {
    export function create(lambdaToken: Token, expression: ExpressionNode) {
        const node: LambdaNode = {
            start: lambdaToken.start,
            length: lambdaToken.length,
            nodeType: ParseNodeType.Lambda,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {
                parameters: [],
                expression,
            },
        };

        expression.parent = node;

        extendRange(node, expression);

        return node;
    }
}

export interface NameNode extends ParseNodeBase<ParseNodeType.Name> {
    d: {
        token: IdentifierToken;
        value: string;
    };
}

export namespace NameNode {
    export function create(nameToken: IdentifierToken) {
        const node: NameNode = {
            start: nameToken.start,
            length: nameToken.length,
            nodeType: ParseNodeType.Name,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {
                token: nameToken,
                value: nameToken.value,
            },
        };

        return node;
    }
}

export interface ConstantNode extends ParseNodeBase<ParseNodeType.Constant> {
    d: {
        constType: KeywordType;
    };
}

export namespace ConstantNode {
    export function create(token: KeywordToken) {
        const node: ConstantNode = {
            start: token.start,
            length: token.length,
            nodeType: ParseNodeType.Constant,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: { constType: token.keywordType },
        };

        return node;
    }
}

export interface EllipsisNode extends ParseNodeBase<ParseNodeType.Ellipsis> {}

export namespace EllipsisNode {
    export function create(range: TextRange) {
        const node: EllipsisNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Ellipsis,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {},
        };

        return node;
    }
}

export interface NumberNode extends ParseNodeBase<ParseNodeType.Number> {
    d: {
        value: number | bigint;
        isInteger: boolean;
        isImaginary: boolean;
    };
}

export namespace NumberNode {
    export function create(token: NumberToken) {
        const node: NumberNode = {
            start: token.start,
            length: token.length,
            nodeType: ParseNodeType.Number,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {
                value: token.value,
                isInteger: token.isInteger,
                isImaginary: token.isImaginary,
            },
        };

        return node;
    }
}

export interface StringNode extends ParseNodeBase<ParseNodeType.String> {
    d: {
        token: StringToken;
        value: string;
    };
}

export namespace StringNode {
    export function create(token: StringToken, value: string) {
        const node: StringNode = {
            start: token.start,
            length: token.length,
            nodeType: ParseNodeType.String,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {
                token,
                value,
            },
        };

        return node;
    }
}

export interface FormatStringNode extends ParseNodeBase<ParseNodeType.FormatString> {
    d: {
        token: FStringStartToken;
        middleTokens: FStringMiddleToken[];
        fieldExpressions: ExpressionNode[];
        formatExpressions: ExpressionNode[];

        // Include a dummy "value" to simplify other code.
        value: '';
    };
}

export namespace FormatStringNode {
    export function create(
        startToken: FStringStartToken,
        endToken: FStringEndToken | undefined,
        middleTokens: FStringMiddleToken[],
        fieldExpressions: ExpressionNode[],
        formatExpressions: ExpressionNode[]
    ) {
        const node: FormatStringNode = {
            start: startToken.start,
            length: startToken.length,
            nodeType: ParseNodeType.FormatString,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {
                token: startToken,
                middleTokens,
                fieldExpressions,
                formatExpressions,
                value: '',
            },
        };

        fieldExpressions.forEach((expr) => {
            expr.parent = node;
            extendRange(node, expr);
        });

        if (formatExpressions) {
            formatExpressions.forEach((expr) => {
                expr.parent = node;
                extendRange(node, expr);
            });
        }

        if (endToken) {
            extendRange(node, endToken);
        }

        return node;
    }
}

export interface StringListNode extends ParseNodeBase<ParseNodeType.StringList> {
    d: {
        strings: (StringNode | FormatStringNode)[];

        // If strings are found within the context of
        // a type annotation, they are further parsed
        // into an expression.
        typeAnnotation: ExpressionNode | undefined;

        // Indicates that the string list is enclosed in parens.
        isParenthesized: boolean;
    };
}

export namespace StringListNode {
    export function create(strings: (StringNode | FormatStringNode)[]) {
        const node: StringListNode = {
            start: strings[0].start,
            length: strings[0].length,
            nodeType: ParseNodeType.StringList,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {
                strings,
                typeAnnotation: undefined,
                isParenthesized: false,
            },
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

export interface DictionaryNode extends ParseNodeBase<ParseNodeType.Dictionary> {
    d: {
        entries: DictionaryEntryNode[];
        trailingCommaToken: Token | undefined;
    };
}

export namespace DictionaryNode {
    export function create(range: TextRange) {
        const node: DictionaryNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Dictionary,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {
                entries: [],
                trailingCommaToken: undefined,
            },
        };

        return node;
    }
}

export interface DictionaryKeyEntryNode extends ParseNodeBase<ParseNodeType.DictionaryKeyEntry> {
    d: {
        keyExpression: ExpressionNode;
        valueExpression: ExpressionNode;
    };
}

export namespace DictionaryKeyEntryNode {
    export function create(keyExpression: ExpressionNode, valueExpression: ExpressionNode) {
        const node: DictionaryKeyEntryNode = {
            start: keyExpression.start,
            length: keyExpression.length,
            nodeType: ParseNodeType.DictionaryKeyEntry,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {
                keyExpression,
                valueExpression,
            },
        };

        keyExpression.parent = node;
        valueExpression.parent = node;

        extendRange(node, valueExpression);

        return node;
    }
}

export interface DictionaryExpandEntryNode extends ParseNodeBase<ParseNodeType.DictionaryExpandEntry> {
    d: {
        expandExpression: ExpressionNode;
    };
}

export namespace DictionaryExpandEntryNode {
    export function create(expandExpression: ExpressionNode) {
        const node: DictionaryExpandEntryNode = {
            start: expandExpression.start,
            length: expandExpression.length,
            nodeType: ParseNodeType.DictionaryExpandEntry,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: { expandExpression },
        };

        expandExpression.parent = node;

        return node;
    }
}

export type DictionaryEntryNode = DictionaryKeyEntryNode | DictionaryExpandEntryNode | ComprehensionNode;

export interface SetNode extends ParseNodeBase<ParseNodeType.Set> {
    d: { entries: ExpressionNode[] };
}

export namespace SetNode {
    export function create(range: TextRange) {
        const node: SetNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Set,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: { entries: [] },
        };

        return node;
    }
}

export interface ListNode extends ParseNodeBase<ParseNodeType.List> {
    d: {
        entries: ExpressionNode[];
    };
}

export namespace ListNode {
    export function create(range: TextRange) {
        const node: ListNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.List,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: { entries: [] },
        };

        return node;
    }
}

export const enum ArgumentCategory {
    Simple,
    UnpackedList,
    UnpackedDictionary,
}

export interface ArgumentNode extends ParseNodeBase<ParseNodeType.Argument> {
    d: {
        argumentCategory: ArgumentCategory;
        name: NameNode | undefined;
        valueExpression: ExpressionNode;
    };
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
            parent: undefined,
            a: undefined,
            d: {
                valueExpression: valueExpression,
                name: undefined,
                argumentCategory: argCategory,
            },
        };

        valueExpression.parent = node;

        extendRange(node, valueExpression);

        return node;
    }
}

export interface DelNode extends ParseNodeBase<ParseNodeType.Del> {
    d: {
        expressions: ExpressionNode[];
    };
}

export namespace DelNode {
    export function create(delToken: Token) {
        const node: DelNode = {
            start: delToken.start,
            length: delToken.length,
            nodeType: ParseNodeType.Del,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: { expressions: [] },
        };

        return node;
    }
}

export interface PassNode extends ParseNodeBase<ParseNodeType.Pass> {}

export namespace PassNode {
    export function create(passToken: TextRange) {
        const node: PassNode = {
            start: passToken.start,
            length: passToken.length,
            nodeType: ParseNodeType.Pass,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {},
        };

        return node;
    }
}

export interface ImportNode extends ParseNodeBase<ParseNodeType.Import> {
    d: {
        list: ImportAsNode[];
    };
}

export namespace ImportNode {
    export function create(importToken: TextRange) {
        const node: ImportNode = {
            start: importToken.start,
            length: importToken.length,
            nodeType: ParseNodeType.Import,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: { list: [] },
        };

        return node;
    }
}

export interface ModuleNameNode extends ParseNodeBase<ParseNodeType.ModuleName> {
    d: {
        leadingDots: number;
        nameParts: NameNode[];

        // This is an error condition used only for type completion.
        hasTrailingDot?: boolean;
    };
}

export namespace ModuleNameNode {
    export function create(range: TextRange) {
        const node: ModuleNameNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.ModuleName,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {
                leadingDots: 0,
                nameParts: [],
            },
        };

        return node;
    }
}

export interface ImportAsNode extends ParseNodeBase<ParseNodeType.ImportAs> {
    d: {
        module: ModuleNameNode;
        alias?: NameNode | undefined;
    };
}

export namespace ImportAsNode {
    export function create(module: ModuleNameNode) {
        const node: ImportAsNode = {
            start: module.start,
            length: module.length,
            nodeType: ParseNodeType.ImportAs,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: { module: module },
        };

        module.parent = node;

        return node;
    }
}

export interface ImportFromNode extends ParseNodeBase<ParseNodeType.ImportFrom> {
    d: {
        module: ModuleNameNode;
        imports: ImportFromAsNode[];
        isWildcardImport: boolean;
        usesParens: boolean;
        wildcardToken?: Token;
        missingImportKeyword?: boolean;
    };
}

export namespace ImportFromNode {
    export function create(fromToken: Token, module: ModuleNameNode) {
        const node: ImportFromNode = {
            start: fromToken.start,
            length: fromToken.length,
            nodeType: ParseNodeType.ImportFrom,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {
                module,
                imports: [],
                isWildcardImport: false,
                usesParens: false,
            },
        };

        module.parent = node;

        extendRange(node, module);

        return node;
    }
}

export interface ImportFromAsNode extends ParseNodeBase<ParseNodeType.ImportFromAs> {
    d: {
        name: NameNode;
        alias?: NameNode | undefined;
    };
}

export namespace ImportFromAsNode {
    export function create(name: NameNode) {
        const node: ImportFromAsNode = {
            start: name.start,
            length: name.length,
            nodeType: ParseNodeType.ImportFromAs,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: { name: name },
        };

        name.parent = node;

        return node;
    }
}

export interface GlobalNode extends ParseNodeBase<ParseNodeType.Global> {
    d: {
        nameList: NameNode[];
    };
}

export namespace GlobalNode {
    export function create(range: TextRange) {
        const node: GlobalNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Global,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: { nameList: [] },
        };

        return node;
    }
}

export interface NonlocalNode extends ParseNodeBase<ParseNodeType.Nonlocal> {
    d: {
        nameList: NameNode[];
    };
}

export namespace NonlocalNode {
    export function create(range: TextRange) {
        const node: NonlocalNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Nonlocal,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: { nameList: [] },
        };

        return node;
    }
}

export interface AssertNode extends ParseNodeBase<ParseNodeType.Assert> {
    d: {
        testExpression: ExpressionNode;
        exceptionExpression?: ExpressionNode | undefined;
    };
}

export namespace AssertNode {
    export function create(assertToken: Token, testExpression: ExpressionNode) {
        const node: AssertNode = {
            start: assertToken.start,
            length: assertToken.length,
            nodeType: ParseNodeType.Assert,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: { testExpression },
        };

        testExpression.parent = node;

        extendRange(node, testExpression);

        return node;
    }
}

export interface BreakNode extends ParseNodeBase<ParseNodeType.Break> {}

export namespace BreakNode {
    export function create(range: TextRange) {
        const node: BreakNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Break,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {},
        };

        return node;
    }
}

export interface ContinueNode extends ParseNodeBase<ParseNodeType.Continue> {}

export namespace ContinueNode {
    export function create(range: TextRange) {
        const node: ContinueNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Continue,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {},
        };

        return node;
    }
}

export interface ReturnNode extends ParseNodeBase<ParseNodeType.Return> {
    d: {
        returnExpression?: ExpressionNode | undefined;
    };
}

export namespace ReturnNode {
    export function create(range: TextRange) {
        const node: ReturnNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Return,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {},
        };

        return node;
    }
}

export interface RaiseNode extends ParseNodeBase<ParseNodeType.Raise> {
    d: {
        typeExpression?: ExpressionNode | undefined;
        valueExpression?: ExpressionNode | undefined;
        tracebackExpression?: ExpressionNode | undefined;
    };
}

export namespace RaiseNode {
    export function create(range: TextRange) {
        const node: RaiseNode = {
            start: range.start,
            length: range.length,
            nodeType: ParseNodeType.Raise,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {},
        };

        return node;
    }
}

export interface MatchNode extends ParseNodeBase<ParseNodeType.Match> {
    d: {
        subjectExpression: ExpressionNode;
        cases: CaseNode[];
    };
}

export namespace MatchNode {
    export function create(matchToken: TextRange, subjectExpression: ExpressionNode) {
        const node: MatchNode = {
            start: matchToken.start,
            length: matchToken.length,
            nodeType: ParseNodeType.Match,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {
                subjectExpression,
                cases: [],
            },
        };

        subjectExpression.parent = node;

        extendRange(node, subjectExpression);

        return node;
    }
}

export interface CaseNode extends ParseNodeBase<ParseNodeType.Case> {
    d: {
        pattern: PatternAtomNode;
        isIrrefutable: boolean;
        guardExpression?: ExpressionNode | undefined;
        suite: SuiteNode;
    };
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
            parent: undefined,
            a: undefined,
            d: {
                pattern,
                isIrrefutable,
                guardExpression,
                suite,
            },
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

export interface PatternSequenceNode extends ParseNodeBase<ParseNodeType.PatternSequence> {
    d: {
        entries: PatternAsNode[];
        starEntryIndex: number | undefined;
    };
}

export namespace PatternSequenceNode {
    export function create(firstToken: TextRange, entries: PatternAsNode[]) {
        const starEntryIndex = entries.findIndex(
            (entry) =>
                entry.d.orPatterns.length === 1 &&
                entry.d.orPatterns[0].nodeType === ParseNodeType.PatternCapture &&
                entry.d.orPatterns[0].d.isStar
        );

        const node: PatternSequenceNode = {
            start: firstToken.start,
            length: firstToken.length,
            nodeType: ParseNodeType.PatternSequence,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {
                entries,
                starEntryIndex: starEntryIndex >= 0 ? starEntryIndex : undefined,
            },
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

export interface PatternAsNode extends ParseNodeBase<ParseNodeType.PatternAs> {
    d: {
        orPatterns: PatternAtomNode[];
        target?: NameNode | undefined;
    };
}

export namespace PatternAsNode {
    export function create(orPatterns: PatternAtomNode[], target?: NameNode) {
        const node: PatternAsNode = {
            start: orPatterns[0].start,
            length: orPatterns[0].length,
            nodeType: ParseNodeType.PatternAs,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {
                orPatterns,
                target,
            },
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

export interface PatternLiteralNode extends ParseNodeBase<ParseNodeType.PatternLiteral> {
    d: {
        expression: ExpressionNode;
    };
}

export namespace PatternLiteralNode {
    export function create(expression: ExpressionNode) {
        const node: PatternLiteralNode = {
            start: expression.start,
            length: expression.length,
            nodeType: ParseNodeType.PatternLiteral,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: { expression },
        };

        expression.parent = node;

        return node;
    }
}

export interface PatternClassNode extends ParseNodeBase<ParseNodeType.PatternClass> {
    d: {
        className: NameNode | MemberAccessNode;
        arguments: PatternClassArgumentNode[];
    };
}

export namespace PatternClassNode {
    export function create(className: NameNode | MemberAccessNode, args: PatternClassArgumentNode[]) {
        const node: PatternClassNode = {
            start: className.start,
            length: className.length,
            nodeType: ParseNodeType.PatternClass,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {
                className,
                arguments: args,
            },
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

export interface PatternClassArgumentNode extends ParseNodeBase<ParseNodeType.PatternClassArgument> {
    d: {
        name?: NameNode | undefined;
        pattern: PatternAsNode;
    };
}

export namespace PatternClassArgumentNode {
    export function create(pattern: PatternAsNode, name?: NameNode) {
        const node: PatternClassArgumentNode = {
            start: pattern.start,
            length: pattern.length,
            nodeType: ParseNodeType.PatternClassArgument,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {
                pattern,
                name,
            },
        };

        pattern.parent = node;

        if (name) {
            extendRange(node, name);
            name.parent = node;
        }

        return node;
    }
}

export interface PatternCaptureNode extends ParseNodeBase<ParseNodeType.PatternCapture> {
    d: {
        target: NameNode;
        isStar: boolean;
        isWildcard: boolean;
    };
}

export namespace PatternCaptureNode {
    export function create(target: NameNode, starToken?: TextRange) {
        const node: PatternCaptureNode = {
            start: target.start,
            length: target.length,
            nodeType: ParseNodeType.PatternCapture,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: {
                target,
                isStar: starToken !== undefined,
                isWildcard: target.d.value === '_',
            },
        };

        target.parent = node;

        if (starToken) {
            extendRange(node, starToken);
        }

        return node;
    }
}

export interface PatternMappingNode extends ParseNodeBase<ParseNodeType.PatternMapping> {
    d: {
        entries: PatternMappingEntryNode[];
    };
}

export namespace PatternMappingNode {
    export function create(startToken: TextRange, entries: PatternMappingEntryNode[]) {
        const node: PatternMappingNode = {
            start: startToken.start,
            length: startToken.length,
            nodeType: ParseNodeType.PatternMapping,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: { entries },
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

export interface PatternMappingKeyEntryNode extends ParseNodeBase<ParseNodeType.PatternMappingKeyEntry> {
    d: {
        keyPattern: PatternLiteralNode | PatternValueNode | ErrorNode;
        valuePattern: PatternAsNode | ErrorNode;
    };
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
            parent: undefined,
            a: undefined,
            d: {
                keyPattern,
                valuePattern,
            },
        };

        keyPattern.parent = node;
        valuePattern.parent = node;

        extendRange(node, valuePattern);

        return node;
    }
}

export interface PatternMappingExpandEntryNode extends ParseNodeBase<ParseNodeType.PatternMappingExpandEntry> {
    d: {
        target: NameNode;
    };
}

export namespace PatternMappingExpandEntryNode {
    export function create(starStarToken: TextRange, target: NameNode) {
        const node: PatternMappingExpandEntryNode = {
            start: starStarToken.start,
            length: starStarToken.length,
            nodeType: ParseNodeType.PatternMappingExpandEntry,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: { target },
        };

        target.parent = node;

        extendRange(node, target);

        return node;
    }
}

export interface PatternValueNode extends ParseNodeBase<ParseNodeType.PatternValue> {
    d: {
        expression: MemberAccessNode;
    };
}

export namespace PatternValueNode {
    export function create(expression: MemberAccessNode) {
        const node: PatternValueNode = {
            start: expression.start,
            length: expression.length,
            nodeType: ParseNodeType.PatternValue,
            id: _nextNodeId++,
            parent: undefined,
            a: undefined,
            d: { expression },
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
    | ComprehensionNode
    | ComprehensionForNode
    | ComprehensionIfNode
    | ConstantNode
    | ContinueNode
    | DecoratorNode
    | DelNode
    | DictionaryNode
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
    | TypeAliasNode
    | TypeAnnotationNode
    | TypeParameterNode
    | TypeParameterListNode
    | UnaryOperationNode
    | UnpackNode
    | WhileNode
    | WithNode
    | WithItemNode
    | YieldNode
    | YieldFromNode;

export type EvaluationScopeNode =
    | LambdaNode
    | FunctionNode
    | ModuleNode
    | ClassNode
    | ComprehensionNode
    | TypeParameterListNode;
export type ExecutionScopeNode = LambdaNode | FunctionNode | ModuleNode | TypeParameterListNode;
export type TypeParameterScopeNode = FunctionNode | ClassNode | TypeAliasNode;
