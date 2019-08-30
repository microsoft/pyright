/*
* parseTreeWalker.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Class that traverses a parse tree.
*/

import * as assert from 'assert';

import { ArgumentNode, AssertNode, AssignmentNode, AugmentedAssignmentExpressionNode,
    AwaitExpressionNode, BinaryExpressionNode, BreakNode, CallExpressionNode, ClassNode,
    ConstantNode, ContinueNode, DecoratorNode, DelNode, DictionaryExpandEntryNode,
    DictionaryKeyEntryNode, DictionaryNode, EllipsisNode, ErrorExpressionNode,
    ExceptNode, FormatStringNode, ForNode, FunctionNode, GlobalNode, IfNode, ImportAsNode,
    ImportFromAsNode, ImportFromNode, ImportNode, IndexExpressionNode, IndexItemsNode,
    LambdaNode, ListComprehensionForNode, ListComprehensionIfNode, ListComprehensionNode,
    ListNode, MemberAccessExpressionNode, ModuleNameNode, ModuleNode, NameNode, NonlocalNode,
    NumberNode, ParameterNode, ParseNode, ParseNodeArray, ParseNodeType, PassNode, RaiseNode,
    ReturnNode, SetNode, SliceExpressionNode, StatementListNode, StringListNode, StringNode,
    SuiteNode, TernaryExpressionNode, TryNode, TupleExpressionNode,
    TypeAnnotationExpressionNode, UnaryExpressionNode, UnpackExpressionNode, WhileNode,
    WithItemNode, WithNode, YieldExpressionNode, YieldFromExpressionNode } from '../parser/parseNodes';

// To use this class, create a subclass and override the
// visitXXX methods that you want to handle.
export class ParseTreeWalker {
    walk(node: ParseNode): void {
        if (this.visitNode(node)) {
            this.walkChildren(node);
        }
    }

    walkMultiple(nodes: ParseNodeArray) {
        nodes.forEach(node => {
            if (node) {
                this.walk(node);
            }
        });
    }

    walkChildren(node: ParseNode) {
        node.getChildren().forEach(node => {
            if (node) {
                this.walk(node);
            }
        });
    }

    visitNode(node: ParseNode): boolean {
        switch (node.nodeType) {
            case ParseNodeType.Argument:
                return this.visitArgument(node as ArgumentNode);

            case ParseNodeType.Assert:
                return this.visitAssert(node as AssertNode);

            case ParseNodeType.Assignment:
                return this.visitAssignment(node as AssignmentNode);

            case ParseNodeType.AugmentedAssignment:
                return this.visitAugmentedAssignment(node as AugmentedAssignmentExpressionNode);

            case ParseNodeType.Await:
                return this.visitAwait(node as AwaitExpressionNode);

            case ParseNodeType.BinaryOperation:
                return this.visitBinaryOperation(node as BinaryExpressionNode);

            case ParseNodeType.Break:
                return this.visitBreak(node as BreakNode);

            case ParseNodeType.Call:
                return this.visitCall(node as CallExpressionNode);

            case ParseNodeType.Class:
                return this.visitClass(node as ClassNode);

            case ParseNodeType.Ternary:
                return this.visitTernary(node as TernaryExpressionNode);

            case ParseNodeType.Constant:
                return this.visitConstant(node as ConstantNode);

            case ParseNodeType.Continue:
                return this.visitContinue(node as ContinueNode);

            case ParseNodeType.Decorator:
                return this.visitDecorator(node as DecoratorNode);

            case ParseNodeType.Del:
                return this.visitDel(node as DelNode);

            case ParseNodeType.Dictionary:
                return this.visitDictionary(node as DictionaryNode);

            case ParseNodeType.DictionaryKeyEntry:
                return this.visitDictionaryKeyEntry(node as DictionaryKeyEntryNode);

            case ParseNodeType.DictionaryExpandEntry:
                return this.visitDictionaryExpandEntry(node as DictionaryExpandEntryNode);

            case ParseNodeType.Error:
                return this.visitError(node as ErrorExpressionNode);

            case ParseNodeType.If:
                return this.visitIf(node as IfNode);

            case ParseNodeType.Import:
                return this.visitImport(node as ImportNode);

            case ParseNodeType.ImportAs:
                return this.visitImportAs(node as ImportAsNode);

            case ParseNodeType.ImportFrom:
                return this.visitImportFrom(node as ImportFromNode);

            case ParseNodeType.ImportFromAs:
                return this.visitImportFromAs(node as ImportFromAsNode);

            case ParseNodeType.Index:
                return this.visitIndex(node as IndexExpressionNode);

            case ParseNodeType.IndexItems:
                return this.visitIndexItems(node as IndexItemsNode);

            case ParseNodeType.Ellipsis:
                return this.visitEllipsis(node as EllipsisNode);

            case ParseNodeType.Except:
                return this.visitExcept(node as ExceptNode);

            case ParseNodeType.For:
                return this.visitFor(node as ForNode);

            case ParseNodeType.FormatString:
                return this.visitFormatString(node as FormatStringNode);

            case ParseNodeType.Function:
                return this.visitFunction(node as FunctionNode);

            case ParseNodeType.Global:
                return this.visitGlobal(node as GlobalNode);

            case ParseNodeType.Lambda:
                return this.visitLambda(node as LambdaNode);

            case ParseNodeType.List:
                return this.visitList(node as ListNode);

            case ParseNodeType.ListComprehension:
                return this.visitListComprehension(node as ListComprehensionNode);

            case ParseNodeType.ListComprehensionFor:
                return this.visitListComprehensionFor(node as ListComprehensionForNode);

            case ParseNodeType.ListComprehensionIf:
                return this.visitListComprehensionIf(node as ListComprehensionIfNode);

            case ParseNodeType.MemberAccess:
                return this.visitMemberAccess(node as MemberAccessExpressionNode);

            case ParseNodeType.Module:
                return this.visitModule(node as ModuleNode);

            case ParseNodeType.ModuleName:
                return this.visitModuleName(node as ModuleNameNode);

            case ParseNodeType.Name:
                return this.visitName(node as NameNode);

            case ParseNodeType.Nonlocal:
                return this.visitNonlocal(node as NonlocalNode);

            case ParseNodeType.Number:
                return this.visitNumber(node as NumberNode);

            case ParseNodeType.Parameter:
                return this.visitParameter(node as ParameterNode);

            case ParseNodeType.Pass:
                return this.visitPass(node as PassNode);

            case ParseNodeType.Raise:
                return this.visitRaise(node as RaiseNode);

            case ParseNodeType.Return:
                return this.visitReturn(node as ReturnNode);

            case ParseNodeType.Set:
                return this.visitSet(node as SetNode);

            case ParseNodeType.Slice:
                return this.visitSlice(node as SliceExpressionNode);

            case ParseNodeType.StatementList:
                return this.visitStatementList(node as StatementListNode);

            case ParseNodeType.String:
                return this.visitString(node as StringNode);

            case ParseNodeType.StringList:
                return this.visitStringList(node as StringListNode);

            case ParseNodeType.Suite:
                return this.visitSuite(node as SuiteNode);

            case ParseNodeType.Tuple:
                return this.visitTuple(node as TupleExpressionNode);

            case ParseNodeType.Try:
                return this.visitTry(node as TryNode);

            case ParseNodeType.TypeAnnotation:
                return this.visitTypeAnnotation(node as TypeAnnotationExpressionNode);

            case ParseNodeType.UnaryOperation:
                return this.visitUnaryOperation(node as UnaryExpressionNode);

            case ParseNodeType.Unpack:
                return this.visitUnpack(node as UnpackExpressionNode);

            case ParseNodeType.While:
                return this.visitWhile(node as WhileNode);

            case ParseNodeType.With:
                return this.visitWith(node as WithNode);

            case ParseNodeType.WithItem:
                return this.visitWithItem(node as WithItemNode);

            case ParseNodeType.Yield:
                return this.visitYield(node as YieldExpressionNode);

            case ParseNodeType.YieldFrom:
                return this.visitYieldFrom(node as YieldFromExpressionNode);

            case ParseNodeType.None:
            default:
                assert.fail('Unexpected node type');
                return true;
        }
    }

    // Override these methods as necessary.
    visitArgument(node: ArgumentNode) {
        return true;
    }

    visitAssert(node: AssertNode) {
        return true;
    }

    visitAssignment(node: AssignmentNode) {
        return true;
    }

    visitAugmentedAssignment(node: AugmentedAssignmentExpressionNode) {
        return true;
    }

    visitAwait(node: AwaitExpressionNode) {
        return true;
    }

    visitBinaryOperation(node: BinaryExpressionNode) {
        return true;
    }

    visitBreak(node: BreakNode) {
        return true;
    }

    visitCall(node: CallExpressionNode) {
        return true;
    }

    visitClass(node: ClassNode) {
        return true;
    }

    visitTernary(node: TernaryExpressionNode) {
        return true;
    }

    visitContinue(node: ContinueNode) {
        return true;
    }

    visitConstant(node: ConstantNode) {
        return true;
    }

    visitDecorator(node: DecoratorNode) {
        return true;
    }

    visitDel(node: DelNode) {
        return true;
    }

    visitDictionary(node: DictionaryNode) {
        return true;
    }

    visitDictionaryKeyEntry(node: DictionaryKeyEntryNode) {
        return true;
    }

    visitDictionaryExpandEntry(node: DictionaryExpandEntryNode) {
        return true;
    }

    visitError(node: ErrorExpressionNode) {
        return true;
    }

    visitEllipsis(node: EllipsisNode) {
        return true;
    }

    visitIf(node: IfNode) {
        return true;
    }

    visitImport(node: ImportNode) {
        return true;
    }

    visitImportAs(node: ImportAsNode) {
        return true;
    }

    visitImportFrom(node: ImportFromNode) {
        return true;
    }

    visitImportFromAs(node: ImportFromAsNode) {
        return true;
    }

    visitIndex(node: IndexExpressionNode) {
        return true;
    }

    visitIndexItems(node: IndexItemsNode) {
        return true;
    }

    visitExcept(node: ExceptNode) {
        return true;
    }

    visitFor(node: ForNode) {
        return true;
    }

    visitFormatString(node: FormatStringNode) {
        return true;
    }

    visitFunction(node: FunctionNode) {
        return true;
    }

    visitGlobal(node: GlobalNode) {
        return true;
    }

    visitLambda(node: LambdaNode) {
        return true;
    }

    visitList(node: ListNode) {
        return true;
    }

    visitListComprehension(node: ListComprehensionNode) {
        return true;
    }

    visitListComprehensionFor(node: ListComprehensionForNode) {
        return true;
    }

    visitListComprehensionIf(node: ListComprehensionIfNode) {
        return true;
    }

    visitMemberAccess(node: MemberAccessExpressionNode) {
        return true;
    }

    visitModule(node: ModuleNode) {
        return true;
    }

    visitModuleName(node: ModuleNameNode) {
        return true;
    }

    visitName(node: NameNode) {
        return true;
    }

    visitNonlocal(node: NonlocalNode) {
        return true;
    }

    visitNumber(node: NumberNode) {
        return true;
    }

    visitParameter(node: ParameterNode) {
        return true;
    }

    visitPass(node: PassNode) {
        return true;
    }

    visitRaise(node: RaiseNode) {
        return true;
    }

    visitReturn(node: ReturnNode) {
        return true;
    }

    visitSet(node: SetNode) {
        return true;
    }

    visitSlice(node: SliceExpressionNode) {
        return true;
    }

    visitStatementList(node: StatementListNode) {
        return true;
    }

    visitString(node: StringNode) {
        return true;
    }

    visitStringList(node: StringListNode) {
        return true;
    }

    visitSuite(node: SuiteNode) {
        return true;
    }

    visitTuple(node: TupleExpressionNode) {
        return true;
    }

    visitTry(node: TryNode) {
        return true;
    }

    visitTypeAnnotation(node: TypeAnnotationExpressionNode) {
        return true;
    }

    visitUnaryOperation(node: UnaryExpressionNode) {
        return true;
    }

    visitUnpack(node: UnpackExpressionNode) {
        return true;
    }

    visitWhile(node: WhileNode) {
        return true;
    }

    visitWith(node: WithNode) {
        return true;
    }

    visitWithItem(node: WithItemNode) {
        return true;
    }

    visitYield(node: YieldExpressionNode) {
        return true;
    }

    visitYieldFrom(node: YieldFromExpressionNode) {
        return true;
    }
}
