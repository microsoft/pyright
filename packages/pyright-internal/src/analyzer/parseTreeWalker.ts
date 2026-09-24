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
    getParserStringAnnotation,
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
import { getChildNodes } from '../parser/parseTreeUtils';
import * as AnalyzerNodeInfo from './analyzerNodeInfo';

export { getChildNodes };

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
    // Bound once per walker so `visitNode` does not allocate a fresh closure for every visited
    // node (binder + checker walk every node of every file). `getChildNodes` invokes this only
    // for `StringListNode`s to decide tier-1/tier-2 annotation descent.
    private readonly _getStringAnnotation: (node: StringListNode) => ReturnType<ParseTreeWalker['getStringAnnotation']>;

    constructor(private readonly _annotationNodeInfo?: AnalyzerNodeInfo.AnalyzerNodeInfoReader) {
        super(/* default */ true);
        this._getStringAnnotation = (node) => this.getStringAnnotation(node);
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
        return this.visit(node) ? getChildNodes(node, this._getStringAnnotation) : [];
    }

    // Resolves the effective string annotation used to expand child nodes during traversal.
    //
    // When an `AnalyzerNodeInfoReader` was supplied (Program-aware walkers that must observe
    // evaluator-discovered annotations, such as the checker and the semantic-token/rename/
    // references walkers), the combined accessor is used so both tier-1 parser annotations and
    // tier-2 evaluator-discovered annotations (e.g. `cast("Data", v)`) are visited. When no reader
    // was supplied, the walker is deliberately syntax-only and sees tier-1 parser annotations
    // exclusively. The binder intentionally stays syntax-only: tier-2 annotations do not exist yet
    // at bind time, so tier-1 descent is both sufficient and correct there.
    //
    // Footgun: this default is safe (tier-1 only) but silent. A future Program-aware walker that
    // forgets to forward a reader would quietly miss tier-2 annotations rather than fail loudly.
    // Any walker that must observe evaluator-discovered annotations MUST pass the reader through
    // its constructor. See parseTreeBindingKey.test.ts for the cross-owner coverage that locks
    // in the reader-forwarding contract.
    protected getStringAnnotation(node: StringListNode) {
        return this._annotationNodeInfo
            ? AnalyzerNodeInfo.getStringAnnotation(node, this._annotationNodeInfo)
            : getParserStringAnnotation(node);
    }
}
