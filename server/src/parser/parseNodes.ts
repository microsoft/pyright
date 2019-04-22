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

export type ParseNodeOrArray = undefined | ParseNode | ParseNode[];
export type RecursiveParseNodeArray = ParseNodeOrArray | ParseNodeOrArray[];

export enum ParseNodeType {
    None,
    Error,

    Argument,
    Assert,
    Assignment,
    AugmentedAssignment,
    Await,
    BinaryOperation,
    Break,
    Call,
    Class,
    Constant,
    Continue,
    Decorator,
    Del,
    Dictionary,
    DictionaryExpandEntry,
    DictionaryKeyEntry,
    Ellipsis,
    If,
    Import,
    ImportAs,
    ImportFrom,
    ImportFromAs,
    Index,
    IndexItems,
    Except,
    For,
    Function,
    Global,
    Lambda,
    List,
    ListComprehension,
    ListComprehensionFor,
    ListComprehensionIf,
    MemberAccess,
    Module,
    ModuleName,
    Name,
    Nonlocal,
    Number,
    Parameter,
    Pass,
    Raise,
    Return,
    Set,
    Slice,
    StatementList,
    String,
    Suite,
    Ternary,
    Tuple,
    Try,
    TypeAnnotation,
    UnaryOperation,
    Unpack,
    While,
    With,
    WithItem,
    Yield,
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

export abstract class ParseNode extends TextRange {
    readonly nodeType: ParseNodeType = ParseNodeType.None;

    // The parent field is filled in by the PostParseWalker,
    // which isn't technically part of the parser.
    parent?: ParseNode;

    constructor(initialRange: TextRange) {
        super(initialRange.start, initialRange.length);
    }

    abstract getChildren(): RecursiveParseNodeArray;

    getChildrenFlattened(): ParseNode[] {
        return this._unflatten(this.getChildren());
    }

    private _unflatten(nodes: RecursiveParseNodeArray): ParseNode[] {
        if (Array.isArray(nodes)) {
            let nodeArray: ParseNode[] = [];
            nodes.forEach(node => {
                if (node) {
                    nodeArray = nodeArray.concat(this._unflatten(node));
                }
            });
            return nodeArray;
        }

        if (nodes) {
            return [nodes];
        }

        return [];
    }
}

export class ModuleNode extends ParseNode {
    readonly nodeType = ParseNodeType.Module;
    statements: StatementNode[] = [];

    getChildren(): RecursiveParseNodeArray {
        return this.statements;
    }
}

export class SuiteNode extends ParseNode {
    readonly nodeType = ParseNodeType.Suite;
    statements: StatementNode[] = [];

    getChildren(): RecursiveParseNodeArray {
        return this.statements;
    }
}

export class IfNode extends ParseNode {
    readonly nodeType = ParseNodeType.If;
    testExpression: ExpressionNode;
    ifSuite: SuiteNode;
    elseSuite?: SuiteNode | IfNode;

    constructor(ifOrElifToken: Token, testExpression: ExpressionNode,
            ifSuite: SuiteNode) {
        super(ifOrElifToken);
        this.testExpression = testExpression;
        this.ifSuite = ifSuite;
        this.extend(this.testExpression);
        this.extend(this.ifSuite);
    }

    getChildren(): RecursiveParseNodeArray {
        return [this.testExpression, this.ifSuite, this.elseSuite];
    }
}

export class WhileNode extends ParseNode {
    readonly nodeType = ParseNodeType.While;
    testExpression: ExpressionNode;
    whileSuite: SuiteNode;
    elseSuite?: SuiteNode;

    getChildren(): RecursiveParseNodeArray {
        return [this.testExpression, this.whileSuite, this.elseSuite];
    }
}

export class ForNode extends ParseNode {
    readonly nodeType = ParseNodeType.For;
    isAsync?: boolean;
    targetExpression: ExpressionNode;
    iterableExpression: ExpressionNode;
    forSuite: SuiteNode;
    elseSuite?: SuiteNode;

    constructor(forToken: Token, targetExpression: ExpressionNode,
            iterableExpression: ExpressionNode, forSuite: SuiteNode) {
        super(forToken);
        this.targetExpression = targetExpression;
        this.iterableExpression = iterableExpression;
        this.forSuite = forSuite;
        this.extend(forSuite);
    }

    getChildren(): RecursiveParseNodeArray {
        return [this.targetExpression, this.iterableExpression, this.forSuite, this.elseSuite];
    }
}

export type ListComprehensionIterNode = ListComprehensionForNode | ListComprehensionIfNode;

export class ListComprehensionForNode extends ParseNode {
    readonly nodeType = ParseNodeType.ListComprehensionFor;
    isAsync?: boolean;
    targetExpression: ExpressionNode;
    iterableExpression: ExpressionNode;

    constructor(startToken: Token, targetExpression: ExpressionNode, iterableExpression: ExpressionNode) {
        super(startToken);
        this.targetExpression = targetExpression;
        this.iterableExpression = iterableExpression;
        this.extend(targetExpression);
        this.extend(iterableExpression);
    }

    getChildren(): RecursiveParseNodeArray {
        return [this.targetExpression, this.iterableExpression];
    }
}

export class ListComprehensionIfNode extends ParseNode {
    readonly nodeType = ParseNodeType.ListComprehensionIf;
    testExpression: ExpressionNode;

    constructor(ifToken: Token, testExpression: ExpressionNode) {
        super(ifToken);
        this.testExpression = testExpression;
        this.extend(testExpression);
    }

    getChildren(): RecursiveParseNodeArray {
        return this.testExpression;
    }
}

export class TryNode extends ParseNode {
    readonly nodeType = ParseNodeType.Try;
    trySuite: SuiteNode;
    exceptClauses: ExceptNode[] = [];
    elseSuite?: SuiteNode;
    finallySuite?: SuiteNode;

    constructor(tryToken: Token, trySuite: SuiteNode) {
        super(tryToken);
        this.trySuite = trySuite;
    }

    getChildren(): RecursiveParseNodeArray {
        return [this.trySuite, this.exceptClauses, this.elseSuite, this.finallySuite];
    }
}

export class ExceptNode extends ParseNode {
    readonly nodeType = ParseNodeType.Except;
    typeExpression?: ExpressionNode;
    name?: NameNode;
    exceptSuite: SuiteNode;

    constructor(exceptToken: Token, exceptSuite: SuiteNode) {
        super(exceptToken);
        this.exceptSuite = exceptSuite;
        this.extend(exceptSuite);
    }

    getChildren(): RecursiveParseNodeArray {
        return [this.typeExpression, this.name, this.exceptSuite];
    }
}

export class FunctionNode extends ParseNode {
    readonly nodeType = ParseNodeType.Function;
    decorators: DecoratorNode[] = [];
    isAsync?: boolean;
    name: NameNode;
    parameters: ParameterNode[] = [];
    returnTypeAnnotation?: ExpressionNode;
    suite: SuiteNode;

    constructor(defToken: Token, name: NameNode, suite: SuiteNode) {
        super(defToken);
        this.name = name;
        this.suite = suite;
        this.extend(suite);
    }

    getChildren(): RecursiveParseNodeArray {
        return [this.decorators, this.name, this.parameters,
            this.returnTypeAnnotation ? this.returnTypeAnnotation : undefined,
            this.suite];
    }
}

export enum ParameterCategory {
    Simple,
    VarArgList,
    VarArgDictionary
}

export class ParameterNode extends ParseNode {
    readonly nodeType = ParseNodeType.Parameter;
    category: ParameterCategory;
    name?: NameNode;
    typeAnnotation?: ExpressionNode;
    defaultValue?: ExpressionNode;

    constructor(startToken: Token, paramCategory: ParameterCategory) {
        super(startToken);
        this.category = paramCategory;
    }

    getChildren(): RecursiveParseNodeArray {
        return [this.name,
            this.typeAnnotation ? this.typeAnnotation : undefined,
            this.defaultValue];
    }
}

export class ClassNode extends ParseNode {
    readonly nodeType = ParseNodeType.Class;
    decorators: DecoratorNode[] = [];
    name: NameNode;
    arguments: ArgumentNode[] = [];
    suite: SuiteNode;

    constructor(classToken: Token, name: NameNode, suite: SuiteNode) {
        super(classToken);
        this.name = name;
        this.suite = suite;
        this.extend(suite);
    }

    getChildren(): RecursiveParseNodeArray {
        return [this.decorators, this.name, this.arguments, this.suite];
    }
}

export class WithNode extends ParseNode {
    readonly nodeType = ParseNodeType.With;
    isAsync?: boolean;
    withItems: WithItemNode[] = [];
    suite: SuiteNode;

    constructor(withToken: Token, suite: SuiteNode) {
        super(withToken);
        this.suite = suite;
        this.extend(suite);
    }

    getChildren(): RecursiveParseNodeArray {
        return [this.withItems, this.suite];
    }
}

export class WithItemNode extends ParseNode {
    readonly nodeType = ParseNodeType.WithItem;
    expression: ExpressionNode;
    target?: ExpressionNode;

    constructor(expression: ExpressionNode) {
        super(expression);
        this.expression = expression;
    }

    getChildren(): RecursiveParseNodeArray {
        return [this.expression, this.target];
    }
}

export class DecoratorNode extends ParseNode {
    readonly nodeType = ParseNodeType.Decorator;
    leftExpression: ExpressionNode;
    arguments: ArgumentNode[] | undefined;

    constructor(atToken: Token, leftExpression: ExpressionNode) {
        super(atToken);
        this.leftExpression = leftExpression;
        this.extend(leftExpression);
    }

    getChildren(): RecursiveParseNodeArray {
        return [this.leftExpression, this.arguments];
    }
}

export class StatementListNode extends ParseNode {
    readonly nodeType = ParseNodeType.StatementList;
    statements: ParseNode[] = [];

    getChildren(): RecursiveParseNodeArray {
        return this.statements;
    }
}

export type StatementNode = IfNode | WhileNode | ForNode | TryNode |
    FunctionNode | ClassNode | WithNode | StatementListNode;

export type SmallStatementNode = ExpressionNode | DelNode | PassNode |
    ImportNode | GlobalNode | NonlocalNode | AssertNode;

export abstract class ExpressionNode extends ParseNode {
}

export class ErrorExpressionNode extends ExpressionNode {
    readonly nodeType = ParseNodeType.Error;
    readonly category: ErrorExpressionCategory;
    readonly child?: ParseNode;

    constructor(initialRange: TextRange, category: ErrorExpressionCategory,
            child?: ParseNode) {

        super(initialRange);

        this.category = category;
        if (child) {
            this.child = child;
            this.extend(child);
        }
    }

    getChildren(): RecursiveParseNodeArray {
        return this.child;
    }
}

export class UnaryExpressionNode extends ExpressionNode {
    readonly nodeType = ParseNodeType.UnaryOperation;
    expression: ExpressionNode;
    operator: OperatorType;

    constructor(expression: ExpressionNode, operator: OperatorType) {
        super(expression);
        this.expression = expression;
        this.operator = operator;
        this.extend(expression);
    }

    getChildren(): RecursiveParseNodeArray {
        return this.expression;
    }
}

export class BinaryExpressionNode extends ExpressionNode {
    readonly nodeType = ParseNodeType.BinaryOperation;
    leftExpression: ExpressionNode;
    operator: OperatorType;
    rightExpression: ExpressionNode;

    constructor(leftExpression: ExpressionNode, rightExpression: ExpressionNode,
            operator: OperatorType) {
        super(leftExpression);
        this.leftExpression = leftExpression;
        this.rightExpression = rightExpression;
        this.operator = operator;
        this.extend(rightExpression);
    }

    getChildren(): RecursiveParseNodeArray {
        return [this.leftExpression, this.rightExpression];
    }
}

export class AssignmentNode extends ExpressionNode {
    readonly nodeType = ParseNodeType.Assignment;
    leftExpression: ExpressionNode;
    rightExpression: ExpressionNode;

    typeAnnotationComment?: ExpressionNode;

    constructor(leftExpression: ExpressionNode, rightExpression: ExpressionNode) {
        super(leftExpression);
        this.leftExpression = leftExpression;
        this.rightExpression = rightExpression;
        this.extend(rightExpression);
    }

    getChildren(): RecursiveParseNodeArray {
        return [this.leftExpression, this.rightExpression, this.typeAnnotationComment];
    }
}

export class TypeAnnotationExpressionNode extends ExpressionNode {
    readonly nodeType = ParseNodeType.TypeAnnotation;
    valueExpression: ExpressionNode;
    typeAnnotation: ExpressionNode;

    constructor(valueExpression: ExpressionNode, typeAnnotation: ExpressionNode) {
        super(valueExpression);
        this.valueExpression = valueExpression;
        this.typeAnnotation = typeAnnotation;
        this.extend(typeAnnotation);
    }

    getChildren(): RecursiveParseNodeArray {
        return [this.valueExpression, this.typeAnnotation];
    }
}

export class AugmentedAssignmentExpressionNode extends ExpressionNode {
    readonly nodeType = ParseNodeType.AugmentedAssignment;
    leftExpression: ExpressionNode;
    operator: OperatorType;
    rightExpression: ExpressionNode;

    constructor(leftExpression: ExpressionNode, rightExpression: ExpressionNode, operator: OperatorType) {
        super(leftExpression);
        this.leftExpression = leftExpression;
        this.rightExpression = rightExpression;
        this.operator = operator;
        this.extend(rightExpression);
    }

    getChildren(): RecursiveParseNodeArray {
        return [this.leftExpression, this.rightExpression];
    }
}

export class AwaitExpressionNode extends ExpressionNode {
    readonly nodeType = ParseNodeType.Await;
    expression: ExpressionNode;

    constructor(awaitToken: Token, expression: ExpressionNode) {
        super(awaitToken);
        this.expression = expression;
        this.extend(expression);
    }

    getChildren(): RecursiveParseNodeArray {
        return this.expression;
    }
}

export class TernaryExpressionNode extends ExpressionNode {
    readonly nodeType = ParseNodeType.Ternary;
    ifExpression: ExpressionNode;
    testExpression: ExpressionNode;
    elseExpression: ExpressionNode;

    constructor(ifExpression: ExpressionNode, testExpression: ExpressionNode, elseExpression: ExpressionNode) {
        super(ifExpression);
        this.ifExpression = ifExpression;
        this.testExpression = testExpression;
        this.elseExpression = elseExpression;
        this.extend(elseExpression);
    }

    getChildren(): RecursiveParseNodeArray {
        return [this.ifExpression, this.testExpression, this.elseExpression];
    }
}

export class UnpackExpressionNode extends ExpressionNode {
    readonly nodeType = ParseNodeType.Unpack;
    expression: ExpressionNode;

    constructor(starToken: Token, expression: ExpressionNode) {
        super(starToken);
        this.expression = expression;
        this.extend(expression);
    }

    getChildren(): RecursiveParseNodeArray {
        return this.expression;
    }
}

export class TupleExpressionNode extends ExpressionNode {
    readonly nodeType = ParseNodeType.Tuple;
    expressions: ExpressionNode[] = [];

    getChildren(): RecursiveParseNodeArray {
        return this.expressions;
    }
}

export class CallExpressionNode extends ExpressionNode {
    readonly nodeType = ParseNodeType.Call;
    leftExpression: ExpressionNode;
    arguments: ArgumentNode[] = [];

    constructor(leftExpression: ExpressionNode) {
        super(leftExpression);
        this.leftExpression = leftExpression;
    }

    getChildren(): RecursiveParseNodeArray {
        return [this.leftExpression, this.arguments];
    }
}

export class ListComprehensionNode<T extends ParseNode = ExpressionNode> extends ExpressionNode {
    readonly nodeType = ParseNodeType.ListComprehension;
    baseExpression: T;
    comprehensions: ListComprehensionIterNode[] = [];

    constructor(baseExpression: T) {
        super(baseExpression);
        this.baseExpression = baseExpression;
    }

    getChildren(): RecursiveParseNodeArray {
        return [this.baseExpression, this.comprehensions];
    }
}

export class IndexItemsNode extends ParseNode {
    readonly nodeType = ParseNodeType.IndexItems;
    items: ExpressionNode[];

    constructor(openBracketToken: Token, closeBracketToken: Token, items: ExpressionNode[]) {
        super(openBracketToken);
        this.items = items;
        this.extend(closeBracketToken);
    }

    getChildren(): RecursiveParseNodeArray {
        return this.items;
    }
}

export class IndexExpressionNode extends ExpressionNode {
    readonly nodeType = ParseNodeType.Index;
    baseExpression: ExpressionNode;
    items: IndexItemsNode;

    constructor(baseExpression: ExpressionNode, items: IndexItemsNode) {
        super(baseExpression);
        this.baseExpression = baseExpression;
        this.items = items;
        this.extend(items);
    }

    getChildren(): RecursiveParseNodeArray {
        return [this.baseExpression, this.items];
    }
}

export class SliceExpressionNode extends ExpressionNode {
    readonly nodeType = ParseNodeType.Slice;
    startValue?: ExpressionNode;
    endValue?: ExpressionNode;
    stepValue?: ExpressionNode;

    getChildren(): RecursiveParseNodeArray {
        return [this.startValue, this.endValue, this.stepValue];
    }
}

export class YieldExpressionNode extends ExpressionNode {
    readonly nodeType = ParseNodeType.Yield;
    expression: ExpressionNode;

    constructor(yieldToken: Token, expression: ExpressionNode) {
        super(yieldToken);
        this.expression = expression;
        this.extend(expression);
    }

    getChildren(): RecursiveParseNodeArray {
        return this.expression;
    }
}

export class YieldFromExpressionNode extends ExpressionNode {
    readonly nodeType = ParseNodeType.YieldFrom;
    expression: ExpressionNode;

    constructor(yieldToken: Token, expression: ExpressionNode) {
        super(yieldToken);
        this.expression = expression;
        this.extend(expression);
    }

    getChildren(): RecursiveParseNodeArray {
        return this.expression;
    }
}

export class MemberAccessExpressionNode extends ExpressionNode {
    readonly nodeType = ParseNodeType.MemberAccess;
    leftExpression: ExpressionNode;
    memberName: NameNode;

    constructor(leftExpression: ExpressionNode, memberName: NameNode) {
        super(leftExpression);
        this.leftExpression = leftExpression;
        this.memberName = memberName;
        this.extend(memberName);
    }

    getChildren(): RecursiveParseNodeArray {
        return [this.leftExpression, this.memberName];
    }
}

export class LambdaNode extends ExpressionNode {
    readonly nodeType = ParseNodeType.Lambda;
    parameters: ParameterNode[] = [];
    expression: ExpressionNode;

    constructor(lambdaToken: Token, expression: ExpressionNode) {
        super(lambdaToken);
        this.expression = expression;
        this.extend(expression);
    }

    getChildren(): RecursiveParseNodeArray {
        return [this.parameters, this.expression];
    }
}

export class NameNode extends ExpressionNode {
    readonly nodeType = ParseNodeType.Name;
    nameToken: IdentifierToken;

    constructor(nameToken: IdentifierToken) {
        super(nameToken);
        this.nameToken = nameToken;
    }

    getChildren(): RecursiveParseNodeArray {
        return undefined;
    }
}

export class ConstantNode extends ExpressionNode {
    readonly nodeType = ParseNodeType.Constant;
    token: KeywordToken;

    constructor(token: KeywordToken) {
        super(token);
        this.token = token;
    }

    getChildren(): RecursiveParseNodeArray {
        return undefined;
    }
}

export class EllipsisNode extends ExpressionNode {
    readonly nodeType = ParseNodeType.Ellipsis;

    getChildren(): RecursiveParseNodeArray {
        return undefined;
    }
}

export class NumberNode extends ExpressionNode {
    readonly nodeType = ParseNodeType.Number;
    token: NumberToken;

    constructor(token: NumberToken) {
        super(token);
        this.token = token;
    }

    getChildren(): RecursiveParseNodeArray {
        return undefined;
    }
}

export class StringNode extends ExpressionNode {
    readonly nodeType = ParseNodeType.String;
    tokens: StringToken[];

    // If strings are found within the context of
    // a type annotation, they are further parsed
    // into an expression.
    typeAnnotation?: ExpressionNode;

    constructor(tokens: StringToken[]) {
        super(tokens[0]);
        this.tokens = tokens;
    }

    getChildren(): RecursiveParseNodeArray {
        return this.typeAnnotation ? [this.typeAnnotation] : undefined;
    }

    getValue(): string {
        return this.tokens.map(t => t.value).join('');
    }
}

export class DictionaryNode extends ExpressionNode {
    readonly nodeType = ParseNodeType.Dictionary;
    entries: DictionaryEntryNode[] = [];

    getChildren(): RecursiveParseNodeArray {
        return this.entries;
    }
}

export class DictionaryKeyEntryNode extends ParseNode {
    readonly nodeType = ParseNodeType.DictionaryKeyEntry;
    keyExpression: ExpressionNode;
    valueExpression: ExpressionNode;

    constructor(keyExpression: ExpressionNode, valueExpression: ExpressionNode) {
        super(keyExpression);
        this.keyExpression = keyExpression;
        this.valueExpression = valueExpression;
        this.extend(valueExpression);
    }

    getChildren(): RecursiveParseNodeArray {
        return [this.keyExpression, this.valueExpression];
    }
}

export class DictionaryExpandEntryNode extends ExpressionNode {
    readonly nodeType = ParseNodeType.DictionaryExpandEntry;
    expandExpression: ExpressionNode;

    constructor(expandExpression: ExpressionNode) {
        super(expandExpression);
        this.expandExpression = expandExpression;
    }

    getChildren(): RecursiveParseNodeArray {
        return this.expandExpression;
    }
}

export type DictionaryEntryNode = DictionaryKeyEntryNode | DictionaryExpandEntryNode |
    ListComprehensionNode<DictionaryKeyEntryNode> | ListComprehensionNode<DictionaryExpandEntryNode>;

export class SetNode extends ExpressionNode {
    readonly nodeType = ParseNodeType.Set;
    entries: ExpressionNode[] = [];

    getChildren(): RecursiveParseNodeArray {
        return this.entries;
    }
}

export class ListNode extends ExpressionNode {
    readonly nodeType = ParseNodeType.List;
    entries: ExpressionNode[] = [];

    getChildren(): RecursiveParseNodeArray {
        return this.entries;
    }
}

export enum ArgumentCategory {
    Simple,
    UnpackedList,
    UnpackedDictionary
}

export class ArgumentNode extends ParseNode {
    readonly nodeType = ParseNodeType.Argument;
    argumentCategory: ArgumentCategory;
    name?: NameNode;
    valueExpression: ExpressionNode;

    constructor(startToken: Token, valueExpression: ExpressionNode, argCategory: ArgumentCategory) {
        super(startToken);
        this.valueExpression = valueExpression;
        this.argumentCategory = argCategory;
        this.extend(valueExpression);
    }

    getChildren(): RecursiveParseNodeArray {
        return this.valueExpression;
    }
}

export class DelNode extends ParseNode {
    readonly nodeType = ParseNodeType.Del;
    expressions: ExpressionNode[] = [];

    constructor(delToken: Token) {
        super(delToken);
    }

    getChildren(): RecursiveParseNodeArray {
        return this.expressions;
    }
}

export class PassNode extends ParseNode {
    readonly nodeType = ParseNodeType.Pass;

    getChildren(): RecursiveParseNodeArray {
        return undefined;
    }
}

export class ImportNode extends ParseNode {
    readonly nodeType = ParseNodeType.Import;
    list: ImportAsNode[] = [];

    getChildren(): RecursiveParseNodeArray {
        return this.list;
    }
}

export class ModuleNameNode extends ParseNode {
    readonly nodeType = ParseNodeType.ModuleName;
    leadingDots = 0;
    nameParts: NameNode[] = [];

    getChildren(): RecursiveParseNodeArray {
        return undefined;
    }
}

export class ImportAsNode extends ParseNode {
    readonly nodeType = ParseNodeType.ImportAs;
    module: ModuleNameNode;
    alias?: NameNode;

    constructor(module: ModuleNameNode) {
        super(module);
        this.module = module;
    }

    getChildren(): RecursiveParseNodeArray {
        return [this.module, this.alias];
    }
}

export class ImportFromNode extends ParseNode {
    readonly nodeType = ParseNodeType.ImportFrom;
    module: ModuleNameNode;

    constructor(fromToken: Token, module: ModuleNameNode) {
        super(fromToken);
        this.module = module;
        this.extend(module);
    }

    // An empty list implies "import *".
    imports: ImportFromAsNode[] = [];

    getChildren(): RecursiveParseNodeArray {
        return [this.module, this.imports];
    }
}

export class ImportFromAsNode extends ParseNode {
    readonly nodeType = ParseNodeType.ImportFromAs;
    name: NameNode;
    alias?: NameNode;

    constructor(name: NameNode) {
        super(name);
        this.name = name;
    }

    getChildren(): RecursiveParseNodeArray {
        return [this.name, this.alias];
    }
}

export class GlobalNode extends ParseNode {
    readonly nodeType = ParseNodeType.Global;
    nameList: NameNode[] = [];

    getChildren(): RecursiveParseNodeArray {
        return this.nameList;
    }
}

export class NonlocalNode extends ParseNode {
    readonly nodeType = ParseNodeType.Nonlocal;
    nameList: NameNode[] = [];

    getChildren(): RecursiveParseNodeArray {
        return this.nameList;
    }
}

export class AssertNode extends ParseNode {
    readonly nodeType = ParseNodeType.Assert;
    expressions: ExpressionNode[] = [];

    getChildren(): RecursiveParseNodeArray {
        return this.expressions;
    }
}

export class BreakNode extends ParseNode {
    readonly nodeType = ParseNodeType.Break;

    getChildren(): RecursiveParseNodeArray {
        return undefined;
    }
}

export class ContinueNode extends ParseNode {
    readonly nodeType = ParseNodeType.Continue;

    getChildren(): RecursiveParseNodeArray {
        return undefined;
    }
}

export class ReturnNode extends ParseNode {
    readonly nodeType = ParseNodeType.Return;
    returnExpression?: ExpressionNode;

    getChildren(): RecursiveParseNodeArray {
        return this.returnExpression;
    }
}

export class RaiseNode extends ParseNode {
    readonly nodeType = ParseNodeType.Raise;
    typeExpression?: ExpressionNode;
    valueExpression?: ExpressionNode;
    tracebackExpression?: ExpressionNode;

    getChildren(): RecursiveParseNodeArray {
        return [this.typeExpression, this.valueExpression, this.tracebackExpression];
    }
}
