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
    AssignmentExpr,
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

export const enum ErrorExprCategory {
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

export interface ParseNodeBase {
    readonly nodeType: ParseNodeType;
    readonly start: number;
    readonly length: number;

    // A unique ID given to each parse node.
    id: number;

    parent: ParseNode | undefined;

    // For some parse nodes, each child's depth is calculated,
    // and the max child depth is recorded here. This is used
    // to detect long chains of operations that can result in
    // stack overflows during evaluation.
    maxChildDepth: number;

    // All other data specific to each parse node is included
    // in another object referenced by this field. This allows
    // the parse node object to remain "monomorphic" which aids
    // in performance.
    d: object;

    // All other data added to the parse node during analysis
    // phases is stored in this field.
    a: object | undefined;
}

let _nextNodeId = 1;
export function getNextNodeId() {
    return _nextNodeId++;
}

export function extendRange(node: ParseNodeBase, newRange: TextRange) {
    const extendedRange = TextRange.extend(node, newRange);

    // Temporarily allow writes to the range fields.
    (node as any).start = extendedRange.start;
    (node as any).length = extendedRange.length;
}

export type ParseNodeArray = (ParseNode | undefined)[];

export interface ModuleNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Module;
    d: {
        statements: StatementNode[];
    };
}

export namespace ModuleNode {
    export function create(range: TextRange) {
        const node: ModuleNode = {
            nodeType: ParseNodeType.Module,
            start: range.start,
            length: range.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: { statements: [] },
            a: undefined,
        };

        return node;
    }
}

export interface SuiteNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Suite;
    d: {
        statements: StatementNode[];
        typeComment: StringToken | undefined;
    };
}

export namespace SuiteNode {
    export function create(range: TextRange) {
        const node: SuiteNode = {
            nodeType: ParseNodeType.Suite,
            start: range.start,
            length: range.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: { statements: [], typeComment: undefined },
            a: undefined,
        };

        return node;
    }
}

export interface IfNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.If;
    d: {
        testExpr: ExprNode;
        ifSuite: SuiteNode;
        elseSuite: SuiteNode | IfNode | undefined;
    };
}

export namespace IfNode {
    export function create(ifOrElifToken: Token, testExpr: ExprNode, ifSuite: SuiteNode, elseSuite?: SuiteNode) {
        const node: IfNode = {
            nodeType: ParseNodeType.If,
            start: ifOrElifToken.start,
            length: ifOrElifToken.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                testExpr,
                ifSuite,
                elseSuite,
            },
            a: undefined,
        };

        testExpr.parent = node;
        ifSuite.parent = node;

        extendRange(node, testExpr);
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
    d: {
        testExpr: ExprNode;
        whileSuite: SuiteNode;
        elseSuite: SuiteNode | undefined;
    };
}

export namespace WhileNode {
    export function create(whileToken: Token, testExpr: ExprNode, whileSuite: SuiteNode) {
        const node: WhileNode = {
            nodeType: ParseNodeType.While,
            start: whileToken.start,
            length: whileToken.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                testExpr,
                whileSuite,
                elseSuite: undefined,
            },
            a: undefined,
        };

        testExpr.parent = node;
        whileSuite.parent = node;

        extendRange(node, whileSuite);

        return node;
    }
}

export interface ForNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.For;
    d: {
        isAsync: boolean;
        asyncToken: Token | undefined;
        targetExpr: ExprNode;
        iterableExpr: ExprNode;
        forSuite: SuiteNode;
        elseSuite: SuiteNode | undefined;
        typeComment: StringToken | undefined;
    };
}

export namespace ForNode {
    export function create(forToken: Token, targetExpr: ExprNode, iterableExpr: ExprNode, forSuite: SuiteNode) {
        const node: ForNode = {
            nodeType: ParseNodeType.For,
            start: forToken.start,
            length: forToken.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                isAsync: false,
                asyncToken: undefined,
                targetExpr,
                iterableExpr,
                forSuite,
                elseSuite: undefined,
                typeComment: undefined,
            },
            a: undefined,
        };

        targetExpr.parent = node;
        iterableExpr.parent = node;
        forSuite.parent = node;

        extendRange(node, forSuite);

        return node;
    }
}

export type ComprehensionForIfNode = ComprehensionForNode | ComprehensionIfNode;

export interface ComprehensionForNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.ComprehensionFor;
    d: {
        isAsync: boolean;
        asyncToken: Token | undefined;
        targetExpr: ExprNode;
        iterableExpr: ExprNode;
    };
}

export namespace ComprehensionForNode {
    export function create(startToken: Token, targetExpr: ExprNode, iterableExpr: ExprNode) {
        const node: ComprehensionForNode = {
            nodeType: ParseNodeType.ComprehensionFor,
            start: startToken.start,
            length: startToken.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                isAsync: false,
                asyncToken: undefined,
                targetExpr,
                iterableExpr,
            },
            a: undefined,
        };

        targetExpr.parent = node;
        iterableExpr.parent = node;

        extendRange(node, targetExpr);
        extendRange(node, iterableExpr);

        return node;
    }
}

export interface ComprehensionIfNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.ComprehensionIf;
    d: {
        testExpr: ExprNode;
    };
}

export namespace ComprehensionIfNode {
    export function create(ifToken: Token, testExpr: ExprNode) {
        const node: ComprehensionIfNode = {
            nodeType: ParseNodeType.ComprehensionIf,
            start: ifToken.start,
            length: ifToken.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: { testExpr },
            a: undefined,
        };

        testExpr.parent = node;

        extendRange(node, testExpr);

        return node;
    }
}

export interface TryNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Try;
    d: {
        trySuite: SuiteNode;
        exceptClauses: ExceptNode[];
        elseSuite: SuiteNode | undefined;
        finallySuite: SuiteNode | undefined;
    };
}

export namespace TryNode {
    export function create(tryToken: Token, trySuite: SuiteNode) {
        const node: TryNode = {
            nodeType: ParseNodeType.Try,
            start: tryToken.start,
            length: tryToken.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                trySuite,
                exceptClauses: [],
                elseSuite: undefined,
                finallySuite: undefined,
            },
            a: undefined,
        };

        trySuite.parent = node;

        extendRange(node, trySuite);

        return node;
    }
}

export interface ExceptNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Except;
    d: {
        typeExpr: ExprNode | undefined;
        name: NameNode | undefined;
        exceptSuite: SuiteNode;
        isExceptGroup: boolean;
    };
}

export namespace ExceptNode {
    export function create(exceptToken: Token, exceptSuite: SuiteNode, isExceptGroup: boolean) {
        const node: ExceptNode = {
            nodeType: ParseNodeType.Except,
            start: exceptToken.start,
            length: exceptToken.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                typeExpr: undefined,
                name: undefined,
                exceptSuite,
                isExceptGroup,
            },
            a: undefined,
        };

        exceptSuite.parent = node;

        extendRange(node, exceptSuite);

        return node;
    }
}

export interface FunctionNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Function;
    d: {
        decorators: DecoratorNode[];
        isAsync: boolean;
        name: NameNode;
        typeParameters: TypeParameterListNode | undefined;
        parameters: ParameterNode[];
        returnTypeAnnotation: ExprNode | undefined;
        functionAnnotationComment: FunctionAnnotationNode | undefined;
        suite: SuiteNode;
    };
}

export namespace FunctionNode {
    export function create(defToken: Token, name: NameNode, suite: SuiteNode, typeParameters?: TypeParameterListNode) {
        const node: FunctionNode = {
            nodeType: ParseNodeType.Function,
            start: defToken.start,
            length: defToken.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                decorators: [],
                isAsync: false,
                name,
                typeParameters,
                parameters: [],
                returnTypeAnnotation: undefined,
                functionAnnotationComment: undefined,
                suite,
            },
            a: undefined,
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

export interface ParameterNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Parameter;
    d: {
        category: ParameterCategory;
        name: NameNode | undefined;
        typeAnnotation: ExprNode | undefined;
        typeAnnotationComment: ExprNode | undefined;
        defaultValue: ExprNode | undefined;
    };
}

export namespace ParameterNode {
    export function create(startToken: Token, paramCategory: ParameterCategory) {
        const node: ParameterNode = {
            nodeType: ParseNodeType.Parameter,
            start: startToken.start,
            length: startToken.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                category: paramCategory,
                name: undefined,
                typeAnnotation: undefined,
                typeAnnotationComment: undefined,
                defaultValue: undefined,
            },
            a: undefined,
        };

        return node;
    }
}

export interface ClassNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Class;
    d: {
        decorators: DecoratorNode[];
        name: NameNode;
        typeParameters?: TypeParameterListNode;
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
            nodeType: ParseNodeType.Class,
            start: classToken.start,
            length: classToken.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                decorators: [],
                name,
                typeParameters,
                arguments: [],
                suite,
            },
            a: undefined,
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
            nodeType: ParseNodeType.Class,
            start: decorators[0].start,
            length: 0,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                decorators,
                name: {
                    nodeType: ParseNodeType.Name,
                    start: decorators[0].start,
                    length: 0,
                    id: 0,
                    parent: undefined,
                    maxChildDepth: 0,
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
                    a: undefined,
                },
                arguments: [],
                suite: {
                    nodeType: ParseNodeType.Suite,
                    start: decorators[0].start,
                    length: 0,
                    id: 0,
                    parent: undefined,
                    maxChildDepth: 0,
                    d: { statements: [], typeComment: undefined },
                    a: undefined,
                },
            },
            a: undefined,
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

export interface WithNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.With;
    d: {
        isAsync: boolean;
        asyncToken: Token | undefined;
        withItems: WithItemNode[];
        suite: SuiteNode;
        typeComment: StringToken | undefined;
    };
}

export namespace WithNode {
    export function create(withToken: Token, suite: SuiteNode) {
        const node: WithNode = {
            nodeType: ParseNodeType.With,
            start: withToken.start,
            length: withToken.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                isAsync: false,
                asyncToken: undefined,
                withItems: [],
                suite,
                typeComment: undefined,
            },
            a: undefined,
        };

        suite.parent = node;

        extendRange(node, suite);

        return node;
    }
}

export interface WithItemNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.WithItem;
    d: {
        expr: ExprNode;
        target: ExprNode | undefined;
    };
}

export namespace WithItemNode {
    export function create(expr: ExprNode) {
        const node: WithItemNode = {
            nodeType: ParseNodeType.WithItem,
            start: expr.start,
            length: expr.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                expr,
                target: undefined,
            },
            a: undefined,
        };

        expr.parent = node;

        return node;
    }
}

export interface DecoratorNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Decorator;
    d: { expr: ExprNode };
}

export namespace DecoratorNode {
    export function create(atToken: Token, expr: ExprNode) {
        const node: DecoratorNode = {
            nodeType: ParseNodeType.Decorator,
            start: atToken.start,
            length: atToken.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                expr,
            },
            a: undefined,
        };

        expr.parent = node;

        extendRange(node, expr);

        return node;
    }
}

export interface StatementListNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.StatementList;
    d: { statements: ParseNode[] };
}

export namespace StatementListNode {
    export function create(atToken: Token) {
        const node: StatementListNode = {
            nodeType: ParseNodeType.StatementList,
            start: atToken.start,
            length: atToken.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: { statements: [] },
            a: undefined,
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

export type SmallStatementNode = ExprNode | DelNode | PassNode | ImportNode | GlobalNode | NonlocalNode | AssertNode;

export type ExprNode =
    | ErrorNode
    | UnaryOperationNode
    | BinaryOperationNode
    | AssignmentNode
    | TypeAnnotationNode
    | AssignmentExprNode
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

export function isExprNode(node: ParseNode): node is ExprNode {
    switch (node.nodeType) {
        case ParseNodeType.Error:
        case ParseNodeType.UnaryOperation:
        case ParseNodeType.BinaryOperation:
        case ParseNodeType.AssignmentExpr:
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

export interface ErrorNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Error;
    d: {
        readonly category: ErrorExprCategory;
        readonly child?: ExprNode | undefined;
        readonly decorators?: DecoratorNode[] | undefined;
    };
}

export namespace ErrorNode {
    export function create(
        initialRange: TextRange,
        category: ErrorExprCategory,
        child?: ExprNode,
        decorators?: DecoratorNode[]
    ) {
        const node: ErrorNode = {
            nodeType: ParseNodeType.Error,
            start: initialRange.start,
            length: initialRange.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                category,
                child,
                decorators,
            },
            a: undefined,
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
    d: {
        expr: ExprNode;
        operatorToken: Token;
        operator: OperatorType;
        parenthesized: boolean;
    };
}

export namespace UnaryOperationNode {
    export function create(operatorToken: Token, expr: ExprNode, operator: OperatorType) {
        const node: UnaryOperationNode = {
            nodeType: ParseNodeType.UnaryOperation,
            start: operatorToken.start,
            length: operatorToken.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                operator,
                operatorToken,
                expr,
                parenthesized: false,
            },
            a: undefined,
        };

        expr.parent = node;
        node.maxChildDepth = 1 + (expr.maxChildDepth ?? 0);

        extendRange(node, expr);

        return node;
    }
}

export interface BinaryOperationNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.BinaryOperation;
    d: {
        leftExpr: ExprNode;
        rightExpr: ExprNode;
        operatorToken: Token;
        operator: OperatorType;
        parenthesized: boolean;
    };
}

export namespace BinaryOperationNode {
    export function create(leftExpr: ExprNode, rightExpr: ExprNode, operatorToken: Token, operator: OperatorType) {
        const node: BinaryOperationNode = {
            nodeType: ParseNodeType.BinaryOperation,
            start: leftExpr.start,
            length: leftExpr.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                leftExpr,
                rightExpr,
                operatorToken,
                operator,
                parenthesized: false,
            },
            a: undefined,
        };

        leftExpr.parent = node;
        rightExpr.parent = node;

        node.maxChildDepth = 1 + Math.max(leftExpr.maxChildDepth ?? 0, rightExpr.maxChildDepth ?? 0);

        extendRange(node, rightExpr);

        return node;
    }
}

export interface AssignmentExprNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.AssignmentExpr;
    d: {
        name: NameNode;
        walrusToken: Token;
        rightExpr: ExprNode;
        isParenthesized: boolean;
    };
}

export namespace AssignmentExprNode {
    export function create(name: NameNode, walrusToken: Token, rightExpr: ExprNode) {
        const node: AssignmentExprNode = {
            start: name.start,
            length: name.length,
            nodeType: ParseNodeType.AssignmentExpr,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                name,
                walrusToken,
                rightExpr,
                isParenthesized: false,
            },
            a: undefined,
        };

        name.parent = node;
        rightExpr.parent = node;

        extendRange(node, rightExpr);

        return node;
    }
}

export interface AssignmentNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Assignment;
    d: {
        leftExpr: ExprNode;
        rightExpr: ExprNode;
        typeAnnotationComment: ExprNode | undefined;
        chainedTypeAnnotationComment: ExprNode | undefined;
    };
}

export namespace AssignmentNode {
    export function create(leftExpr: ExprNode, rightExpr: ExprNode) {
        const node: AssignmentNode = {
            nodeType: ParseNodeType.Assignment,
            start: leftExpr.start,
            length: leftExpr.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                leftExpr,
                rightExpr,
                typeAnnotationComment: undefined,
                chainedTypeAnnotationComment: undefined,
            },
            a: undefined,
        };

        leftExpr.parent = node;
        rightExpr.parent = node;

        extendRange(node, rightExpr);

        return node;
    }
}

export enum TypeParameterCategory {
    TypeVar,
    TypeVarTuple,
    ParamSpec,
}

export interface TypeParameterNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.TypeParameter;
    d: {
        name: NameNode;
        typeParamCategory: TypeParameterCategory;
        boundExpr: ExprNode | undefined;
        defaultExpr: ExprNode | undefined;
    };
}

export namespace TypeParameterNode {
    export function create(
        name: NameNode,
        typeParamCategory: TypeParameterCategory,
        boundExpr?: ExprNode,
        defaultExpr?: ExprNode
    ) {
        const node: TypeParameterNode = {
            nodeType: ParseNodeType.TypeParameter,
            start: name.start,
            length: name.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                name,
                typeParamCategory,
                boundExpr,
                defaultExpr,
            },
            a: undefined,
        };

        name.parent = node;

        if (boundExpr) {
            boundExpr.parent = node;
            extendRange(node, boundExpr);
        }

        if (defaultExpr) {
            defaultExpr.parent = node;
            extendRange(node, defaultExpr);
        }

        return node;
    }
}

export interface TypeParameterListNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.TypeParameterList;
    d: { parameters: TypeParameterNode[] };
}

export namespace TypeParameterListNode {
    export function create(startToken: Token, endToken: Token, parameters: TypeParameterNode[]) {
        const node: TypeParameterListNode = {
            nodeType: ParseNodeType.TypeParameterList,
            start: startToken.start,
            length: startToken.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: { parameters },
            a: undefined,
        };

        extendRange(node, endToken);

        parameters.forEach((param) => {
            extendRange(node, param);
            param.parent = node;
        });

        return node;
    }
}

export interface TypeAliasNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.TypeAlias;
    d: {
        name: NameNode;
        typeParameters: TypeParameterListNode | undefined;
        expr: ExprNode;
    };
}

export namespace TypeAliasNode {
    export function create(
        typeToken: KeywordToken,
        name: NameNode,
        expr: ExprNode,
        typeParameters?: TypeParameterListNode
    ) {
        const node: TypeAliasNode = {
            nodeType: ParseNodeType.TypeAlias,
            start: typeToken.start,
            length: typeToken.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                name,
                typeParameters,
                expr,
            },
            a: undefined,
        };

        name.parent = node;
        expr.parent = node;

        if (typeParameters) {
            typeParameters.parent = node;
        }

        extendRange(node, expr);

        return node;
    }
}

export interface TypeAnnotationNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.TypeAnnotation;
    d: {
        valueExpr: ExprNode;
        typeAnnotation: ExprNode;
    };
}

export namespace TypeAnnotationNode {
    export function create(valueExpr: ExprNode, typeAnnotation: ExprNode) {
        const node: TypeAnnotationNode = {
            nodeType: ParseNodeType.TypeAnnotation,
            start: valueExpr.start,
            length: valueExpr.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                valueExpr,
                typeAnnotation,
            },
            a: undefined,
        };

        valueExpr.parent = node;
        typeAnnotation.parent = node;

        extendRange(node, typeAnnotation);

        return node;
    }
}

export interface FunctionAnnotationNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.FunctionAnnotation;
    d: {
        isParamListEllipsis: boolean;
        paramTypeAnnotations: ExprNode[];
        returnTypeAnnotation: ExprNode;
    };
}

export namespace FunctionAnnotationNode {
    export function create(
        openParenToken: Token,
        isParamListEllipsis: boolean,
        paramTypeAnnotations: ExprNode[],
        returnTypeAnnotation: ExprNode
    ) {
        const node: FunctionAnnotationNode = {
            nodeType: ParseNodeType.FunctionAnnotation,
            start: openParenToken.start,
            length: openParenToken.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                isParamListEllipsis,
                paramTypeAnnotations,
                returnTypeAnnotation,
            },
            a: undefined,
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
    d: {
        leftExpr: ExprNode;
        rightExpr: ExprNode;
        operator: OperatorType;

        // The destExpression is a copy of the leftExpression
        // node. We use it as a place to hang the result type,
        // as opposed to the source type.
        destExpr: ExprNode;
    };
}

export namespace AugmentedAssignmentNode {
    export function create(leftExpr: ExprNode, rightExpr: ExprNode, operator: OperatorType, destExpr: ExprNode) {
        const node: AugmentedAssignmentNode = {
            nodeType: ParseNodeType.AugmentedAssignment,
            start: leftExpr.start,
            length: leftExpr.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                leftExpr,
                rightExpr,
                operator,
                destExpr,
            },
            a: undefined,
        };

        leftExpr.parent = node;
        rightExpr.parent = node;
        destExpr.parent = node;

        extendRange(node, rightExpr);

        return node;
    }
}

export interface AwaitNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Await;
    d: {
        expr: ExprNode;
        parenthesized: boolean | undefined;
    };
}

export namespace AwaitNode {
    export function create(awaitToken: Token, expr: ExprNode) {
        const node: AwaitNode = {
            nodeType: ParseNodeType.Await,
            start: awaitToken.start,
            length: awaitToken.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                expr,
                parenthesized: false,
            },
            a: undefined,
        };

        expr.parent = node;

        extendRange(node, expr);

        return node;
    }
}

export interface TernaryNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Ternary;
    d: {
        ifExpr: ExprNode;
        testExpr: ExprNode;
        elseExpr: ExprNode;
    };
}

export namespace TernaryNode {
    export function create(ifExpr: ExprNode, testExpr: ExprNode, elseExpr: ExprNode) {
        const node: TernaryNode = {
            nodeType: ParseNodeType.Ternary,
            start: ifExpr.start,
            length: ifExpr.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                ifExpr,
                testExpr,
                elseExpr,
            },
            a: undefined,
        };

        ifExpr.parent = node;
        testExpr.parent = node;
        elseExpr.parent = node;

        extendRange(node, elseExpr);

        return node;
    }
}

export interface UnpackNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Unpack;
    d: {
        expr: ExprNode;
        starToken: Token;
    };
}

export namespace UnpackNode {
    export function create(starToken: Token, expr: ExprNode) {
        const node: UnpackNode = {
            nodeType: ParseNodeType.Unpack,
            start: starToken.start,
            length: starToken.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                expr,
                starToken,
            },
            a: undefined,
        };

        expr.parent = node;

        extendRange(node, expr);

        return node;
    }
}

export interface TupleNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Tuple;
    d: {
        exprs: ExprNode[];
        enclosedInParens: boolean;
    };
}

export namespace TupleNode {
    export function create(range: TextRange, enclosedInParens: boolean) {
        const node: TupleNode = {
            nodeType: ParseNodeType.Tuple,
            start: range.start,
            length: range.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                exprs: [],
                enclosedInParens,
            },
            a: undefined,
        };

        return node;
    }
}

export interface CallNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Call;
    d: {
        leftExpr: ExprNode;
        arguments: ArgumentNode[];
        trailingComma: boolean;
    };
}

export namespace CallNode {
    export function create(leftExpr: ExprNode, argList: ArgumentNode[], trailingComma: boolean) {
        const node: CallNode = {
            nodeType: ParseNodeType.Call,
            start: leftExpr.start,
            length: leftExpr.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                leftExpr,
                arguments: argList,
                trailingComma,
            },
            a: undefined,
        };

        leftExpr.parent = node;

        node.maxChildDepth = 1 + (leftExpr.maxChildDepth ?? 0);

        if (argList.length > 0) {
            argList.forEach((arg) => {
                arg.parent = node;
            });
            extendRange(node, argList[argList.length - 1]);
        }

        return node;
    }
}

export interface ComprehensionNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Comprehension;
    d: {
        expr: ParseNode;
        forIfNodes: ComprehensionForIfNode[];
        isGenerator: boolean;
        isParenthesized: boolean;
    };
}

export namespace ComprehensionNode {
    export function create(expr: ParseNode, isGenerator: boolean) {
        const node: ComprehensionNode = {
            nodeType: ParseNodeType.Comprehension,
            start: expr.start,
            length: expr.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                expr,
                forIfNodes: [],
                isGenerator,
                isParenthesized: false,
            },
            a: undefined,
        };

        expr.parent = node;

        return node;
    }
}

export interface IndexNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Index;
    d: {
        baseExpr: ExprNode;
        items: ArgumentNode[];
        trailingComma: boolean;
    };
}

export namespace IndexNode {
    export function create(
        baseExpr: ExprNode,
        items: ArgumentNode[],
        trailingComma: boolean,
        closeBracketToken: Token
    ) {
        const node: IndexNode = {
            nodeType: ParseNodeType.Index,
            start: baseExpr.start,
            length: baseExpr.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                baseExpr,
                items,
                trailingComma,
            },
            a: undefined,
        };

        baseExpr.parent = node;
        items.forEach((item) => {
            item.parent = node;
        });

        extendRange(node, closeBracketToken);

        node.maxChildDepth = 1 + (baseExpr.maxChildDepth ?? 0);

        return node;
    }
}

export interface SliceNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Slice;
    d: {
        startValue: ExprNode | undefined;
        endValue: ExprNode | undefined;
        stepValue: ExprNode | undefined;
    };
}

export namespace SliceNode {
    export function create(range: TextRange) {
        const node: SliceNode = {
            nodeType: ParseNodeType.Slice,
            start: range.start,
            length: range.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                startValue: undefined,
                endValue: undefined,
                stepValue: undefined,
            },
            a: undefined,
        };

        return node;
    }
}

export interface YieldNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Yield;
    d: { expr: ExprNode | undefined };
}

export namespace YieldNode {
    export function create(yieldToken: Token, expr?: ExprNode) {
        const node: YieldNode = {
            nodeType: ParseNodeType.Yield,
            start: yieldToken.start,
            length: yieldToken.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: { expr },
            a: undefined,
        };

        if (expr) {
            expr.parent = node;
            extendRange(node, expr);
        }

        return node;
    }
}

export interface YieldFromNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.YieldFrom;
    d: { expr: ExprNode };
}

export namespace YieldFromNode {
    export function create(yieldToken: Token, expr: ExprNode) {
        const node: YieldFromNode = {
            nodeType: ParseNodeType.YieldFrom,
            start: yieldToken.start,
            length: yieldToken.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: { expr },
            a: undefined,
        };

        expr.parent = node;

        extendRange(node, expr);

        return node;
    }
}

export interface MemberAccessNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.MemberAccess;
    d: {
        leftExpr: ExprNode;
        memberName: NameNode;
    };
}

export namespace MemberAccessNode {
    export function create(leftExpr: ExprNode, memberName: NameNode) {
        const node: MemberAccessNode = {
            nodeType: ParseNodeType.MemberAccess,
            start: leftExpr.start,
            length: leftExpr.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                leftExpr,
                memberName,
            },
            a: undefined,
        };

        leftExpr.parent = node;
        memberName.parent = node;

        extendRange(node, memberName);

        node.maxChildDepth = 1 + (leftExpr.maxChildDepth ?? 0);

        return node;
    }
}

export interface LambdaNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Lambda;
    d: {
        parameters: ParameterNode[];
        expr: ExprNode;
    };
}

export namespace LambdaNode {
    export function create(lambdaToken: Token, expr: ExprNode) {
        const node: LambdaNode = {
            nodeType: ParseNodeType.Lambda,
            start: lambdaToken.start,
            length: lambdaToken.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                parameters: [],
                expr,
            },
            a: undefined,
        };

        expr.parent = node;

        extendRange(node, expr);

        return node;
    }
}

export interface NameNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Name;
    d: {
        token: IdentifierToken;
        value: string;
    };
}

export namespace NameNode {
    export function create(nameToken: IdentifierToken) {
        const node: NameNode = {
            nodeType: ParseNodeType.Name,
            start: nameToken.start,
            length: nameToken.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                token: nameToken,
                value: nameToken.value,
            },
            a: undefined,
        };

        return node;
    }
}

export interface ConstantNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Constant;
    d: { constType: KeywordType };
}

export namespace ConstantNode {
    export function create(token: KeywordToken) {
        const node: ConstantNode = {
            nodeType: ParseNodeType.Constant,
            start: token.start,
            length: token.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: { constType: token.keywordType },
            a: undefined,
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
            nodeType: ParseNodeType.Ellipsis,
            start: range.start,
            length: range.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {},
            a: undefined,
        };

        return node;
    }
}

export interface NumberNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Number;
    d: {
        value: number | bigint;
        isInteger: boolean;
        isImaginary: boolean;
    };
}

export namespace NumberNode {
    export function create(token: NumberToken) {
        const node: NumberNode = {
            nodeType: ParseNodeType.Number,
            start: token.start,
            length: token.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                value: token.value,
                isInteger: token.isInteger,
                isImaginary: token.isImaginary,
            },
            a: undefined,
        };

        return node;
    }
}

export interface StringNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.String;
    d: {
        token: StringToken;
        value: string;
    };
}

export namespace StringNode {
    export function create(token: StringToken, unescapedValue: string) {
        const node: StringNode = {
            nodeType: ParseNodeType.String,
            start: token.start,
            length: token.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                token,
                value: unescapedValue,
            },
            a: undefined,
        };

        return node;
    }
}

export interface FormatStringNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.FormatString;
    d: {
        token: FStringStartToken;
        middleTokens: FStringMiddleToken[];
        fieldExprs: ExprNode[];
        formatExprs: ExprNode[];

        // Include a dummy "value" to simplify other code.
        value: '';
    };
}

export namespace FormatStringNode {
    export function create(
        startToken: FStringStartToken,
        endToken: FStringEndToken | undefined,
        middleTokens: FStringMiddleToken[],
        fieldExprs: ExprNode[],
        formatExprs: ExprNode[]
    ) {
        const node: FormatStringNode = {
            nodeType: ParseNodeType.FormatString,
            start: startToken.start,
            length: startToken.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                token: startToken,
                middleTokens,
                fieldExprs,
                formatExprs,
                value: '',
            },
            a: undefined,
        };

        fieldExprs.forEach((expr) => {
            expr.parent = node;
            extendRange(node, expr);
        });

        if (formatExprs) {
            formatExprs.forEach((expr) => {
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

export interface StringListNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.StringList;
    d: {
        strings: (StringNode | FormatStringNode)[];

        // If strings are found within the context of
        // a type annotation, they are further parsed
        // into an expression.
        typeAnnotation: ExprNode | undefined;

        // Indicates that the string list is enclosed in parens.
        isParenthesized: boolean;
    };
}

export namespace StringListNode {
    export function create(strings: (StringNode | FormatStringNode)[]) {
        const node: StringListNode = {
            nodeType: ParseNodeType.StringList,
            start: strings[0].start,
            length: strings[0].length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                strings,
                typeAnnotation: undefined,
                isParenthesized: false,
            },
            a: undefined,
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
    d: {
        entries: DictionaryEntryNode[];
        trailingCommaToken: Token | undefined;
    };
}

export namespace DictionaryNode {
    export function create(range: TextRange) {
        const node: DictionaryNode = {
            nodeType: ParseNodeType.Dictionary,
            start: range.start,
            length: range.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                entries: [],
                trailingCommaToken: undefined,
            },
            a: undefined,
        };

        return node;
    }
}

export interface DictionaryKeyEntryNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.DictionaryKeyEntry;
    d: {
        keyExpr: ExprNode;
        valueExpr: ExprNode;
    };
}

export namespace DictionaryKeyEntryNode {
    export function create(keyExpr: ExprNode, valueExpr: ExprNode) {
        const node: DictionaryKeyEntryNode = {
            nodeType: ParseNodeType.DictionaryKeyEntry,
            start: keyExpr.start,
            length: keyExpr.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                keyExpr,
                valueExpr,
            },
            a: undefined,
        };

        keyExpr.parent = node;
        valueExpr.parent = node;

        extendRange(node, valueExpr);

        return node;
    }
}

export interface DictionaryExpandEntryNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.DictionaryExpandEntry;
    d: { expandExpr: ExprNode };
}

export namespace DictionaryExpandEntryNode {
    export function create(expandExpr: ExprNode) {
        const node: DictionaryExpandEntryNode = {
            nodeType: ParseNodeType.DictionaryExpandEntry,
            start: expandExpr.start,
            length: expandExpr.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: { expandExpr },
            a: undefined,
        };

        expandExpr.parent = node;

        return node;
    }
}

export type DictionaryEntryNode = DictionaryKeyEntryNode | DictionaryExpandEntryNode | ComprehensionNode;

export interface SetNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Set;
    d: { entries: ExprNode[] };
}

export namespace SetNode {
    export function create(range: TextRange) {
        const node: SetNode = {
            nodeType: ParseNodeType.Set,
            start: range.start,
            length: range.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: { entries: [] },
            a: undefined,
        };

        return node;
    }
}

export interface ListNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.List;
    d: { entries: ExprNode[] };
}

export namespace ListNode {
    export function create(range: TextRange) {
        const node: ListNode = {
            nodeType: ParseNodeType.List,
            start: range.start,
            length: range.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: { entries: [] },
            a: undefined,
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
    d: {
        argumentCategory: ArgumentCategory;
        name: NameNode | undefined;
        valueExpr: ExprNode;
    };
}

export namespace ArgumentNode {
    export function create(startToken: Token | undefined, valueExpr: ExprNode, argCategory: ArgumentCategory) {
        const node: ArgumentNode = {
            nodeType: ParseNodeType.Argument,
            start: startToken ? startToken.start : valueExpr.start,
            length: startToken ? startToken.length : valueExpr.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                valueExpr,
                name: undefined,
                argumentCategory: argCategory,
            },
            a: undefined,
        };

        valueExpr.parent = node;

        extendRange(node, valueExpr);

        return node;
    }
}

export interface DelNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Del;
    d: { exprs: ExprNode[] };
}

export namespace DelNode {
    export function create(delToken: Token) {
        const node: DelNode = {
            nodeType: ParseNodeType.Del,
            start: delToken.start,
            length: delToken.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: { exprs: [] },
            a: undefined,
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
            nodeType: ParseNodeType.Pass,
            start: passToken.start,
            length: passToken.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {},
            a: undefined,
        };

        return node;
    }
}

export interface ImportNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Import;
    d: { list: ImportAsNode[] };
}

export namespace ImportNode {
    export function create(passToken: TextRange) {
        const node: ImportNode = {
            nodeType: ParseNodeType.Import,
            start: passToken.start,
            length: passToken.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: { list: [] },
            a: undefined,
        };

        return node;
    }
}

export interface ModuleNameNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.ModuleName;
    d: {
        leadingDots: number;
        nameParts: NameNode[];

        // This is an error condition used only for type completion.
        hasTrailingDot: boolean;
    };
}

export namespace ModuleNameNode {
    export function create(range: TextRange) {
        const node: ModuleNameNode = {
            nodeType: ParseNodeType.ModuleName,
            start: range.start,
            length: range.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                leadingDots: 0,
                nameParts: [],
                hasTrailingDot: false,
            },
            a: undefined,
        };

        return node;
    }
}

export interface ImportAsNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.ImportAs;
    d: {
        module: ModuleNameNode;
        alias: NameNode | undefined;
    };
}

export namespace ImportAsNode {
    export function create(module: ModuleNameNode) {
        const node: ImportAsNode = {
            nodeType: ParseNodeType.ImportAs,
            start: module.start,
            length: module.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                module,
                alias: undefined,
            },
            a: undefined,
        };

        module.parent = node;

        return node;
    }
}

export interface ImportFromNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.ImportFrom;
    d: {
        module: ModuleNameNode;
        imports: ImportFromAsNode[];
        isWildcardImport: boolean;
        usesParens: boolean;
        wildcardToken: Token | undefined;
        missingImportKeyword: boolean;
    };
}

export namespace ImportFromNode {
    export function create(fromToken: Token, module: ModuleNameNode) {
        const node: ImportFromNode = {
            nodeType: ParseNodeType.ImportFrom,
            start: fromToken.start,
            length: fromToken.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                module,
                imports: [],
                isWildcardImport: false,
                usesParens: false,
                wildcardToken: undefined,
                missingImportKeyword: false,
            },
            a: undefined,
        };

        module.parent = node;

        extendRange(node, module);

        return node;
    }
}

export interface ImportFromAsNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.ImportFromAs;
    d: {
        name: NameNode;
        alias: NameNode | undefined;
    };
}

export namespace ImportFromAsNode {
    export function create(name: NameNode) {
        const node: ImportFromAsNode = {
            nodeType: ParseNodeType.ImportFromAs,
            start: name.start,
            length: name.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                name,
                alias: undefined,
            },
            a: undefined,
        };

        name.parent = node;

        return node;
    }
}

export interface GlobalNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Global;
    d: { nameList: NameNode[] };
}

export namespace GlobalNode {
    export function create(range: TextRange) {
        const node: GlobalNode = {
            nodeType: ParseNodeType.Global,
            start: range.start,
            length: range.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: { nameList: [] },
            a: undefined,
        };

        return node;
    }
}

export interface NonlocalNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Nonlocal;
    d: { nameList: NameNode[] };
}

export namespace NonlocalNode {
    export function create(range: TextRange) {
        const node: NonlocalNode = {
            nodeType: ParseNodeType.Nonlocal,
            start: range.start,
            length: range.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: { nameList: [] },
            a: undefined,
        };

        return node;
    }
}

export interface AssertNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Assert;
    d: {
        testExpr: ExprNode;
        exceptionExpr: ExprNode | undefined;
    };
}

export namespace AssertNode {
    export function create(assertToken: Token, testExpr: ExprNode) {
        const node: AssertNode = {
            nodeType: ParseNodeType.Assert,
            start: assertToken.start,
            length: assertToken.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                testExpr,
                exceptionExpr: undefined,
            },
            a: undefined,
        };

        testExpr.parent = node;

        extendRange(node, testExpr);

        return node;
    }
}

export interface BreakNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Break;
}

export namespace BreakNode {
    export function create(range: TextRange) {
        const node: BreakNode = {
            nodeType: ParseNodeType.Break,
            start: range.start,
            length: range.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {},
            a: undefined,
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
            nodeType: ParseNodeType.Continue,
            start: range.start,
            length: range.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {},
            a: undefined,
        };

        return node;
    }
}

export interface ReturnNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Return;
    d: { returnExpr: ExprNode | undefined };
}

export namespace ReturnNode {
    export function create(range: TextRange) {
        const node: ReturnNode = {
            nodeType: ParseNodeType.Return,
            start: range.start,
            length: range.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                returnExpr: undefined,
            },
            a: undefined,
        };

        return node;
    }
}

export interface RaiseNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Raise;
    d: {
        typeExpr: ExprNode | undefined;
        valueExpr: ExprNode | undefined;
        tracebackExpr: ExprNode | undefined;
    };
}

export namespace RaiseNode {
    export function create(range: TextRange) {
        const node: RaiseNode = {
            nodeType: ParseNodeType.Raise,
            start: range.start,
            length: range.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                typeExpr: undefined,
                valueExpr: undefined,
                tracebackExpr: undefined,
            },
            a: undefined,
        };

        return node;
    }
}

export interface MatchNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Match;
    d: {
        subjectExpr: ExprNode;
        cases: CaseNode[];
    };
}

export namespace MatchNode {
    export function create(matchToken: TextRange, subjectExpr: ExprNode) {
        const node: MatchNode = {
            nodeType: ParseNodeType.Match,
            start: matchToken.start,
            length: matchToken.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                subjectExpr,
                cases: [],
            },
            a: undefined,
        };

        subjectExpr.parent = node;

        extendRange(node, subjectExpr);

        return node;
    }
}

export interface CaseNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.Case;
    d: {
        pattern: PatternAtomNode;
        isIrrefutable: boolean;
        guardExpr: ExprNode | undefined;
        suite: SuiteNode;
    };
}

export namespace CaseNode {
    export function create(
        caseToken: TextRange,
        pattern: PatternAtomNode,
        isIrrefutable: boolean,
        guardExpr: ExprNode | undefined,
        suite: SuiteNode
    ) {
        const node: CaseNode = {
            nodeType: ParseNodeType.Case,
            start: caseToken.start,
            length: caseToken.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                pattern,
                isIrrefutable,
                guardExpr,
                suite,
            },
            a: undefined,
        };

        extendRange(node, suite);

        pattern.parent = node;
        suite.parent = node;

        if (guardExpr) {
            guardExpr.parent = node;
        }

        return node;
    }
}

export interface PatternSequenceNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.PatternSequence;
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
            nodeType: ParseNodeType.PatternSequence,
            start: firstToken.start,
            length: firstToken.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                entries,
                starEntryIndex: starEntryIndex >= 0 ? starEntryIndex : undefined,
            },
            a: undefined,
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
    d: {
        orPatterns: PatternAtomNode[];
        target: NameNode | undefined;
    };
}

export namespace PatternAsNode {
    export function create(orPatterns: PatternAtomNode[], target?: NameNode) {
        const node: PatternAsNode = {
            nodeType: ParseNodeType.PatternAs,
            start: orPatterns[0].start,
            length: orPatterns[0].length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                orPatterns,
                target,
            },
            a: undefined,
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
    d: { expr: ExprNode };
}

export namespace PatternLiteralNode {
    export function create(expr: ExprNode) {
        const node: PatternLiteralNode = {
            nodeType: ParseNodeType.PatternLiteral,
            start: expr.start,
            length: expr.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                expr,
            },
            a: undefined,
        };

        expr.parent = node;

        return node;
    }
}

export interface PatternClassNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.PatternClass;
    d: {
        className: NameNode | MemberAccessNode;
        arguments: PatternClassArgumentNode[];
    };
}

export namespace PatternClassNode {
    export function create(className: NameNode | MemberAccessNode, args: PatternClassArgumentNode[]) {
        const node: PatternClassNode = {
            nodeType: ParseNodeType.PatternClass,
            start: className.start,
            length: className.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                className,
                arguments: args,
            },
            a: undefined,
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
    d: {
        name: NameNode | undefined;
        pattern: PatternAsNode;
    };
}

export namespace PatternClassArgumentNode {
    export function create(pattern: PatternAsNode, name?: NameNode) {
        const node: PatternClassArgumentNode = {
            nodeType: ParseNodeType.PatternClassArgument,
            start: pattern.start,
            length: pattern.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                pattern,
                name,
            },
            a: undefined,
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
    d: {
        target: NameNode;
        isStar: boolean;
        isWildcard: boolean;
    };
}

export namespace PatternCaptureNode {
    export function create(target: NameNode, starToken?: TextRange) {
        const node: PatternCaptureNode = {
            nodeType: ParseNodeType.PatternCapture,
            start: target.start,
            length: target.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                target,
                isStar: starToken !== undefined,
                isWildcard: target.d.value === '_',
            },
            a: undefined,
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
    d: { entries: PatternMappingEntryNode[] };
}

export namespace PatternMappingNode {
    export function create(startToken: TextRange, entries: PatternMappingEntryNode[]) {
        const node: PatternMappingNode = {
            nodeType: ParseNodeType.PatternMapping,
            start: startToken.start,
            length: startToken.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: { entries },
            a: undefined,
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
            nodeType: ParseNodeType.PatternMappingKeyEntry,
            start: keyPattern.start,
            length: keyPattern.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: {
                keyPattern,
                valuePattern,
            },
            a: undefined,
        };

        keyPattern.parent = node;
        valuePattern.parent = node;

        extendRange(node, valuePattern);

        return node;
    }
}

export interface PatternMappingExpandEntryNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.PatternMappingExpandEntry;
    d: { target: NameNode };
}

export namespace PatternMappingExpandEntryNode {
    export function create(starStarToken: TextRange, target: NameNode) {
        const node: PatternMappingExpandEntryNode = {
            nodeType: ParseNodeType.PatternMappingExpandEntry,
            start: starStarToken.start,
            length: starStarToken.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: { target },
            a: undefined,
        };

        target.parent = node;

        extendRange(node, target);

        return node;
    }
}

export interface PatternValueNode extends ParseNodeBase {
    readonly nodeType: ParseNodeType.PatternValue;
    d: { expr: MemberAccessNode };
}

export namespace PatternValueNode {
    export function create(expr: MemberAccessNode) {
        const node: PatternValueNode = {
            nodeType: ParseNodeType.PatternValue,
            start: expr.start,
            length: expr.length,
            id: _nextNodeId++,
            parent: undefined,
            maxChildDepth: 0,
            d: { expr },
            a: undefined,
        };

        expr.parent = node;

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
    | AssignmentExprNode
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
