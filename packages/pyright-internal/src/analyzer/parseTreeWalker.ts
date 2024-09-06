/*
 * parseTreeWalker.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Class that traverses a parse tree.
 */

import * as debug from '../common/debug';
import {
    ArgumentNode,
    AssertNode,
    AssignmentExpressionNode,
    AssignmentNode,
    AugmentedAssignmentNode,
    AwaitNode,
    BinaryOperationNode,
    BreakNode,
    CallNode,
    CaseNode,
    ClassNode,
    ComprehensionForNode,
    ComprehensionIfNode,
    ComprehensionNode,
    ConstantNode,
    ContinueNode,
    DecoratorNode,
    DelNode,
    DictionaryExpandEntryNode,
    DictionaryKeyEntryNode,
    DictionaryNode,
    EllipsisNode,
    ErrorNode,
    ExceptNode,
    ForNode,
    FormatStringNode,
    FunctionAnnotationNode,
    FunctionNode,
    GlobalNode,
    IfNode,
    ImportAsNode,
    ImportFromAsNode,
    ImportFromNode,
    ImportNode,
    IndexNode,
    LambdaNode,
    ListNode,
    MatchNode,
    MemberAccessNode,
    ModuleNameNode,
    ModuleNode,
    NameNode,
    NonlocalNode,
    NumberNode,
    ParameterNode,
    ParseNode,
    ParseNodeArray,
    ParseNodeType,
    PassNode,
    PatternAsNode,
    PatternCaptureNode,
    PatternClassArgumentNode,
    PatternClassNode,
    PatternLiteralNode,
    PatternMappingExpandEntryNode,
    PatternMappingKeyEntryNode,
    PatternMappingNode,
    PatternSequenceNode,
    PatternValueNode,
    RaiseNode,
    ReturnNode,
    SetNode,
    SliceNode,
    StatementListNode,
    StringListNode,
    StringNode,
    SuiteNode,
    TernaryNode,
    TryNode,
    TupleNode,
    TypeAliasNode,
    TypeAnnotationNode,
    TypeParameterListNode,
    TypeParameterNode,
    UnaryOperationNode,
    UnpackNode,
    WhileNode,
    WithItemNode,
    WithNode,
    YieldFromNode,
    YieldNode,
} from '../parser/parseNodes';

// Get child nodes of the given node.
export function getChildNodes(node: ParseNode): (ParseNode | undefined)[] {
    switch (node.nodeType) {
        case ParseNodeType.Error:
            return [node.d.child, ...(node.d.decorators ?? [])];

        case ParseNodeType.Argument:
            return [node.d.name, node.d.valueExpr];

        case ParseNodeType.Assert:
            return [node.d.testExpr, node.d.exceptionExpr];

        case ParseNodeType.AssignmentExpression:
            return [node.d.name, node.d.rightExpr];

        case ParseNodeType.Assignment:
            return [node.d.leftExpr, node.d.rightExpr, node.d.annotationComment];

        case ParseNodeType.AugmentedAssignment:
            return [node.d.leftExpr, node.d.rightExpr];

        case ParseNodeType.Await:
            return [node.d.expr];

        case ParseNodeType.BinaryOperation:
            return [node.d.leftExpr, node.d.rightExpr];

        case ParseNodeType.Break:
            return [];

        case ParseNodeType.Call:
            return [node.d.leftExpr, ...node.d.args];

        case ParseNodeType.Case:
            return [node.d.pattern, node.d.guardExpr, node.d.suite];

        case ParseNodeType.Class:
            return [...node.d.decorators, node.d.name, node.d.typeParams, ...node.d.arguments, node.d.suite];

        case ParseNodeType.Comprehension:
            return [node.d.expr, ...node.d.forIfNodes];

        case ParseNodeType.ComprehensionFor:
            return [node.d.targetExpr, node.d.iterableExpr];

        case ParseNodeType.ComprehensionIf:
            return [node.d.testExpr];

        case ParseNodeType.Constant:
            return [];

        case ParseNodeType.Continue:
            return [];

        case ParseNodeType.Decorator:
            return [node.d.expr];

        case ParseNodeType.Del:
            return node.d.targets;

        case ParseNodeType.Dictionary:
            return node.d.items;

        case ParseNodeType.DictionaryExpandEntry:
            return [node.d.expr];

        case ParseNodeType.DictionaryKeyEntry:
            return [node.d.keyExpr, node.d.valueExpr];

        case ParseNodeType.Ellipsis:
            return [];

        case ParseNodeType.If:
            return [node.d.testExpr, node.d.ifSuite, node.d.elseSuite];

        case ParseNodeType.Import:
            return node.d.list;

        case ParseNodeType.ImportAs:
            return [node.d.module, node.d.alias];

        case ParseNodeType.ImportFrom:
            return [node.d.module, ...node.d.imports];

        case ParseNodeType.ImportFromAs:
            return [node.d.name, node.d.alias];

        case ParseNodeType.Index:
            return [node.d.leftExpr, ...node.d.items];

        case ParseNodeType.Except:
            return [node.d.typeExpr, node.d.name, node.d.exceptSuite];

        case ParseNodeType.For:
            return [node.d.targetExpr, node.d.iterableExpr, node.d.forSuite, node.d.elseSuite];

        case ParseNodeType.FormatString:
            return [...node.d.fieldExprs, ...(node.d.formatExprs ?? [])];

        case ParseNodeType.Function:
            return [
                ...node.d.decorators,
                node.d.name,
                node.d.typeParams,
                ...node.d.params,
                node.d.returnAnnotation,
                node.d.funcAnnotationComment,
                node.d.suite,
            ];

        case ParseNodeType.FunctionAnnotation:
            return [...node.d.paramAnnotations, node.d.returnAnnotation];

        case ParseNodeType.Global:
            return node.d.targets;

        case ParseNodeType.Lambda:
            return [...node.d.params, node.d.expr];

        case ParseNodeType.List:
            return node.d.items;

        case ParseNodeType.Match:
            return [node.d.expr, ...node.d.cases];

        case ParseNodeType.MemberAccess:
            return [node.d.leftExpr, node.d.member];

        case ParseNodeType.ModuleName:
            return node.d.nameParts;

        case ParseNodeType.Module:
            return [...node.d.statements];

        case ParseNodeType.Name:
            return [];

        case ParseNodeType.Nonlocal:
            return node.d.targets;

        case ParseNodeType.Number:
            return [];

        case ParseNodeType.Parameter:
            return [node.d.name, node.d.annotation, node.d.annotationComment, node.d.defaultValue];

        case ParseNodeType.Pass:
            return [];

        case ParseNodeType.PatternAs:
            return [...node.d.orPatterns, node.d.target];

        case ParseNodeType.PatternClass:
            return [node.d.className, ...node.d.args];

        case ParseNodeType.PatternClassArgument:
            return [node.d.name, node.d.pattern];

        case ParseNodeType.PatternCapture:
            return [node.d.target];

        case ParseNodeType.PatternLiteral:
            return [node.d.expr];

        case ParseNodeType.PatternMappingExpandEntry:
            return [node.d.target];

        case ParseNodeType.PatternMappingKeyEntry:
            return [node.d.keyPattern, node.d.valuePattern];

        case ParseNodeType.PatternMapping:
            return [...node.d.entries];

        case ParseNodeType.PatternSequence:
            return [...node.d.entries];

        case ParseNodeType.PatternValue:
            return [node.d.expr];

        case ParseNodeType.Raise:
            return [node.d.expr, node.d.fromExpr];

        case ParseNodeType.Return:
            return [node.d.expr];

        case ParseNodeType.Set:
            return node.d.items;

        case ParseNodeType.Slice:
            return [node.d.startValue, node.d.endValue, node.d.stepValue];

        case ParseNodeType.StatementList:
            return node.d.statements;

        case ParseNodeType.StringList:
            return [node.d.annotation, ...node.d.strings];

        case ParseNodeType.String:
            return [];

        case ParseNodeType.Suite:
            return [...node.d.statements];

        case ParseNodeType.Ternary:
            return [node.d.ifExpr, node.d.testExpr, node.d.elseExpr];

        case ParseNodeType.Tuple:
            return node.d.items;

        case ParseNodeType.Try:
            return [node.d.trySuite, ...node.d.exceptClauses, node.d.elseSuite, node.d.finallySuite];

        case ParseNodeType.TypeAlias:
            return [node.d.name, node.d.typeParams, node.d.expr];

        case ParseNodeType.TypeAnnotation:
            return [node.d.valueExpr, node.d.annotation];

        case ParseNodeType.TypeParameter:
            return [node.d.name, node.d.boundExpr, node.d.defaultExpr];

        case ParseNodeType.TypeParameterList:
            return [...node.d.params];

        case ParseNodeType.UnaryOperation:
            return [node.d.expr];

        case ParseNodeType.Unpack:
            return [node.d.expr];

        case ParseNodeType.While:
            return [node.d.testExpr, node.d.whileSuite, node.d.elseSuite];

        case ParseNodeType.With:
            return [...node.d.withItems, node.d.suite];

        case ParseNodeType.WithItem:
            return [node.d.expr, node.d.target];

        case ParseNodeType.Yield:
            return [node.d.expr];

        case ParseNodeType.YieldFrom:
            return [node.d.expr];

        default:
            debug.assertNever(node, `Unknown node type ${node}`);
    }
}

// To use this class, create a subclass and override the
// visitXXX methods that you want to handle.
export class ParseTreeVisitor<T> {
    constructor(private readonly _default: T) {
        // empty
    }

    visit(node: ParseNode): T {
        switch (node.nodeType) {
            case ParseNodeType.Error:
                return this.visitError(node);

            case ParseNodeType.Argument:
                return this.visitArgument(node);

            case ParseNodeType.Assert:
                return this.visitAssert(node);

            case ParseNodeType.AssignmentExpression:
                return this.visitAssignmentExpression(node);

            case ParseNodeType.Assignment:
                return this.visitAssignment(node);

            case ParseNodeType.AugmentedAssignment:
                return this.visitAugmentedAssignment(node);

            case ParseNodeType.Await:
                return this.visitAwait(node);

            case ParseNodeType.BinaryOperation:
                return this.visitBinaryOperation(node);

            case ParseNodeType.Break:
                return this.visitBreak(node);

            case ParseNodeType.Call:
                return this.visitCall(node);

            case ParseNodeType.Case:
                return this.visitCase(node);

            case ParseNodeType.Class:
                return this.visitClass(node);

            case ParseNodeType.Comprehension:
                return this.visitComprehension(node);

            case ParseNodeType.ComprehensionFor:
                return this.visitComprehensionFor(node);

            case ParseNodeType.ComprehensionIf:
                return this.visitComprehensionIf(node);

            case ParseNodeType.Constant:
                return this.visitConstant(node);

            case ParseNodeType.Continue:
                return this.visitContinue(node);

            case ParseNodeType.Decorator:
                return this.visitDecorator(node);

            case ParseNodeType.Del:
                return this.visitDel(node);

            case ParseNodeType.Dictionary:
                return this.visitDictionary(node);

            case ParseNodeType.DictionaryExpandEntry:
                return this.visitDictionaryExpandEntry(node);

            case ParseNodeType.DictionaryKeyEntry:
                return this.visitDictionaryKeyEntry(node);

            case ParseNodeType.Ellipsis:
                return this.visitEllipsis(node);

            case ParseNodeType.If:
                return this.visitIf(node);

            case ParseNodeType.Import:
                return this.visitImport(node);

            case ParseNodeType.ImportAs:
                return this.visitImportAs(node);

            case ParseNodeType.ImportFrom:
                return this.visitImportFrom(node);

            case ParseNodeType.ImportFromAs:
                return this.visitImportFromAs(node);

            case ParseNodeType.Index:
                return this.visitIndex(node);

            case ParseNodeType.Except:
                return this.visitExcept(node);

            case ParseNodeType.For:
                return this.visitFor(node);

            case ParseNodeType.FormatString:
                return this.visitFormatString(node);

            case ParseNodeType.Function:
                return this.visitFunction(node);

            case ParseNodeType.FunctionAnnotation:
                return this.visitFunctionAnnotation(node);

            case ParseNodeType.Global:
                return this.visitGlobal(node);

            case ParseNodeType.Lambda:
                return this.visitLambda(node);

            case ParseNodeType.List:
                return this.visitList(node);

            case ParseNodeType.Match:
                return this.visitMatch(node);

            case ParseNodeType.MemberAccess:
                return this.visitMemberAccess(node);

            case ParseNodeType.ModuleName:
                return this.visitModuleName(node);

            case ParseNodeType.Module:
                return this.visitModule(node);

            case ParseNodeType.Name:
                return this.visitName(node);

            case ParseNodeType.Nonlocal:
                return this.visitNonlocal(node);

            case ParseNodeType.Number:
                return this.visitNumber(node);

            case ParseNodeType.Parameter:
                return this.visitParameter(node);

            case ParseNodeType.Pass:
                return this.visitPass(node);

            case ParseNodeType.PatternAs:
                return this.visitPatternAs(node);

            case ParseNodeType.PatternClass:
                return this.visitPatternClass(node);

            case ParseNodeType.PatternClassArgument:
                return this.visitPatternClassArgument(node);

            case ParseNodeType.PatternCapture:
                return this.visitPatternCapture(node);

            case ParseNodeType.PatternLiteral:
                return this.visitPatternLiteral(node);

            case ParseNodeType.PatternMappingExpandEntry:
                return this.visitPatternMappingExpandEntry(node);

            case ParseNodeType.PatternMappingKeyEntry:
                return this.visitPatternMappingKeyEntry(node);

            case ParseNodeType.PatternMapping:
                return this.visitPatternMapping(node);

            case ParseNodeType.PatternSequence:
                return this.visitPatternSequence(node);

            case ParseNodeType.PatternValue:
                return this.visitPatternValue(node);

            case ParseNodeType.Raise:
                return this.visitRaise(node);

            case ParseNodeType.Return:
                return this.visitReturn(node);

            case ParseNodeType.Set:
                return this.visitSet(node);

            case ParseNodeType.Slice:
                return this.visitSlice(node);

            case ParseNodeType.StatementList:
                return this.visitStatementList(node);

            case ParseNodeType.StringList:
                return this.visitStringList(node);

            case ParseNodeType.String:
                return this.visitString(node);

            case ParseNodeType.Suite:
                return this.visitSuite(node);

            case ParseNodeType.Ternary:
                return this.visitTernary(node);

            case ParseNodeType.Tuple:
                return this.visitTuple(node);

            case ParseNodeType.Try:
                return this.visitTry(node);

            case ParseNodeType.TypeAlias:
                return this.visitTypeAlias(node);

            case ParseNodeType.TypeAnnotation:
                return this.visitTypeAnnotation(node);

            case ParseNodeType.TypeParameter:
                return this.visitTypeParameter(node);

            case ParseNodeType.TypeParameterList:
                return this.visitTypeParameterList(node);

            case ParseNodeType.UnaryOperation:
                return this.visitUnaryOperation(node);

            case ParseNodeType.Unpack:
                return this.visitUnpack(node);

            case ParseNodeType.While:
                return this.visitWhile(node);

            case ParseNodeType.With:
                return this.visitWith(node);

            case ParseNodeType.WithItem:
                return this.visitWithItem(node);

            case ParseNodeType.Yield:
                return this.visitYield(node);

            case ParseNodeType.YieldFrom:
                return this.visitYieldFrom(node);

            default:
                debug.assertNever(node, `Unknown node type ${node}`);
        }
    }

    // Override these methods as necessary.
    visitArgument(node: ArgumentNode) {
        return this._default;
    }

    visitAssert(node: AssertNode) {
        return this._default;
    }

    visitAssignment(node: AssignmentNode) {
        return this._default;
    }

    visitAssignmentExpression(node: AssignmentExpressionNode) {
        return this._default;
    }

    visitAugmentedAssignment(node: AugmentedAssignmentNode) {
        return this._default;
    }

    visitAwait(node: AwaitNode) {
        return this._default;
    }

    visitBinaryOperation(node: BinaryOperationNode) {
        return this._default;
    }

    visitBreak(node: BreakNode) {
        return this._default;
    }

    visitCall(node: CallNode) {
        return this._default;
    }

    visitCase(node: CaseNode) {
        return this._default;
    }

    visitClass(node: ClassNode) {
        return this._default;
    }

    visitComprehension(node: ComprehensionNode) {
        return this._default;
    }

    visitComprehensionFor(node: ComprehensionForNode) {
        return this._default;
    }

    visitComprehensionIf(node: ComprehensionIfNode) {
        return this._default;
    }

    visitContinue(node: ContinueNode) {
        return this._default;
    }

    visitConstant(node: ConstantNode) {
        return this._default;
    }

    visitDecorator(node: DecoratorNode) {
        return this._default;
    }

    visitDel(node: DelNode) {
        return this._default;
    }

    visitDictionary(node: DictionaryNode) {
        return this._default;
    }

    visitDictionaryKeyEntry(node: DictionaryKeyEntryNode) {
        return this._default;
    }

    visitDictionaryExpandEntry(node: DictionaryExpandEntryNode) {
        return this._default;
    }

    visitError(node: ErrorNode) {
        return this._default;
    }

    visitEllipsis(node: EllipsisNode) {
        return this._default;
    }

    visitIf(node: IfNode) {
        return this._default;
    }

    visitImport(node: ImportNode) {
        return this._default;
    }

    visitImportAs(node: ImportAsNode) {
        return this._default;
    }

    visitImportFrom(node: ImportFromNode) {
        return this._default;
    }

    visitImportFromAs(node: ImportFromAsNode) {
        return this._default;
    }

    visitIndex(node: IndexNode) {
        return this._default;
    }

    visitExcept(node: ExceptNode) {
        return this._default;
    }

    visitFor(node: ForNode) {
        return this._default;
    }

    visitFormatString(node: FormatStringNode) {
        return this._default;
    }

    visitFunction(node: FunctionNode) {
        return this._default;
    }

    visitFunctionAnnotation(node: FunctionAnnotationNode) {
        return this._default;
    }

    visitGlobal(node: GlobalNode) {
        return this._default;
    }

    visitLambda(node: LambdaNode) {
        return this._default;
    }

    visitList(node: ListNode) {
        return this._default;
    }

    visitMatch(node: MatchNode) {
        return this._default;
    }

    visitMemberAccess(node: MemberAccessNode) {
        return this._default;
    }

    visitModule(node: ModuleNode) {
        return this._default;
    }

    visitModuleName(node: ModuleNameNode) {
        return this._default;
    }

    visitName(node: NameNode) {
        return this._default;
    }

    visitNonlocal(node: NonlocalNode) {
        return this._default;
    }

    visitNumber(node: NumberNode) {
        return this._default;
    }

    visitParameter(node: ParameterNode) {
        return this._default;
    }

    visitPass(node: PassNode) {
        return this._default;
    }

    visitPatternCapture(node: PatternCaptureNode) {
        return this._default;
    }

    visitPatternClass(node: PatternClassNode) {
        return this._default;
    }

    visitPatternClassArgument(node: PatternClassArgumentNode) {
        return this._default;
    }

    visitPatternAs(node: PatternAsNode) {
        return this._default;
    }

    visitPatternLiteral(node: PatternLiteralNode) {
        return this._default;
    }

    visitPatternMapping(node: PatternMappingNode) {
        return this._default;
    }

    visitPatternMappingExpandEntry(node: PatternMappingExpandEntryNode) {
        return this._default;
    }

    visitPatternMappingKeyEntry(node: PatternMappingKeyEntryNode) {
        return this._default;
    }

    visitPatternSequence(node: PatternSequenceNode) {
        return this._default;
    }

    visitPatternValue(node: PatternValueNode) {
        return this._default;
    }

    visitRaise(node: RaiseNode) {
        return this._default;
    }

    visitReturn(node: ReturnNode) {
        return this._default;
    }

    visitSet(node: SetNode) {
        return this._default;
    }

    visitSlice(node: SliceNode) {
        return this._default;
    }

    visitStatementList(node: StatementListNode) {
        return this._default;
    }

    visitString(node: StringNode) {
        return this._default;
    }

    visitStringList(node: StringListNode) {
        return this._default;
    }

    visitSuite(node: SuiteNode) {
        return this._default;
    }

    visitTernary(node: TernaryNode) {
        return this._default;
    }

    visitTuple(node: TupleNode) {
        return this._default;
    }

    visitTry(node: TryNode) {
        return this._default;
    }

    visitTypeAlias(node: TypeAliasNode) {
        return this._default;
    }

    visitTypeAnnotation(node: TypeAnnotationNode) {
        return this._default;
    }

    visitTypeParameter(node: TypeParameterNode) {
        return this._default;
    }

    visitTypeParameterList(node: TypeParameterListNode) {
        return this._default;
    }

    visitUnaryOperation(node: UnaryOperationNode) {
        return this._default;
    }

    visitUnpack(node: UnpackNode) {
        return this._default;
    }

    visitWhile(node: WhileNode) {
        return this._default;
    }

    visitWith(node: WithNode) {
        return this._default;
    }

    visitWithItem(node: WithItemNode) {
        return this._default;
    }

    visitYield(node: YieldNode) {
        return this._default;
    }

    visitYieldFrom(node: YieldFromNode) {
        return this._default;
    }
}

// To use this class, create a subclass and override the
// visitXXX methods that you want to handle.
export class ParseTreeWalker extends ParseTreeVisitor<boolean> {
    constructor() {
        super(/* default */ true);
    }

    walk(node: ParseNode): void {
        const childrenToWalk = this.visitNode(node);
        if (childrenToWalk.length > 0) {
            this.walkMultiple(childrenToWalk);
        }
    }

    walkMultiple(nodes: ParseNodeArray) {
        nodes.forEach((node) => {
            if (node) {
                this.walk(node);
            }
        });
    }

    // If this.visit(node) returns true, all child nodes for the node are returned.
    // If the method returns false, we assume that the handler has already handled the
    // child nodes, so an empty list is returned.
    visitNode(node: ParseNode): ParseNodeArray {
        return this.visit(node) ? getChildNodes(node) : [];
    }
}
