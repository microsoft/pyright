/*
 * parseTreeWalker.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Class that traverses a parse tree.
 */

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
    FormatStringNode,
    ForNode,
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
    ListComprehensionForNode,
    ListComprehensionIfNode,
    ListComprehensionNode,
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
    TypeAnnotationNode,
    UnaryOperationNode,
    UnpackNode,
    WhileNode,
    WithItemNode,
    WithNode,
    YieldFromNode,
    YieldNode,
} from '../parser/parseNodes';

// To use this class, create a subclass and override the
// visitXXX methods that you want to handle.
export class ParseTreeWalker {
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

    // Calls the node-specific method (visitXXXX). If the method
    // returns true, all child nodes for the node are returned.
    // If the method returns false, we assume that the handler
    // has already handled the child nodes, so an empty list is
    // returned.
    visitNode(node: ParseNode): ParseNodeArray {
        switch (node.nodeType) {
            case ParseNodeType.Error:
                return this.visitError(node) ? [node.child, ...(node.decorators ?? [])] : [];

            case ParseNodeType.Argument:
                return this.visitArgument(node) ? [node.name, node.valueExpression] : [];

            case ParseNodeType.Assert:
                return this.visitAssert(node) ? [node.testExpression, node.exceptionExpression] : [];

            case ParseNodeType.AssignmentExpression:
                return this.visitAssignmentExpression(node) ? [node.name, node.rightExpression] : [];

            case ParseNodeType.Assignment:
                return this.visitAssignment(node)
                    ? [node.leftExpression, node.rightExpression, node.typeAnnotationComment]
                    : [];

            case ParseNodeType.AugmentedAssignment:
                return this.visitAugmentedAssignment(node) ? [node.leftExpression, node.rightExpression] : [];

            case ParseNodeType.Await:
                return this.visitAwait(node) ? [node.expression] : [];

            case ParseNodeType.BinaryOperation:
                return this.visitBinaryOperation(node) ? [node.leftExpression, node.rightExpression] : [];

            case ParseNodeType.Break:
                return this.visitBreak(node) ? [] : [];

            case ParseNodeType.Call:
                return this.visitCall(node) ? [node.leftExpression, ...node.arguments] : [];

            case ParseNodeType.Case:
                return this.visitCase(node) ? [node.pattern, node.guardExpression, node.suite] : [];

            case ParseNodeType.Class:
                return this.visitClass(node) ? [...node.decorators, node.name, ...node.arguments, node.suite] : [];

            case ParseNodeType.Constant:
                return this.visitConstant(node) ? [] : [];

            case ParseNodeType.Continue:
                return this.visitContinue(node) ? [] : [];

            case ParseNodeType.Decorator:
                return this.visitDecorator(node) ? [node.expression] : [];

            case ParseNodeType.Del:
                return this.visitDel(node) ? node.expressions : [];

            case ParseNodeType.Dictionary:
                return this.visitDictionary(node) ? node.entries : [];

            case ParseNodeType.DictionaryExpandEntry:
                return this.visitDictionaryExpandEntry(node) ? [node.expandExpression] : [];

            case ParseNodeType.DictionaryKeyEntry:
                return this.visitDictionaryKeyEntry(node) ? [node.keyExpression, node.valueExpression] : [];

            case ParseNodeType.Ellipsis:
                return this.visitEllipsis(node) ? [] : [];

            case ParseNodeType.If:
                return this.visitIf(node) ? [node.testExpression, node.ifSuite, node.elseSuite] : [];

            case ParseNodeType.Import:
                return this.visitImport(node) ? node.list : [];

            case ParseNodeType.ImportAs:
                return this.visitImportAs(node) ? [node.module, node.alias] : [];

            case ParseNodeType.ImportFrom:
                return this.visitImportFrom(node) ? [node.module, ...node.imports] : [];

            case ParseNodeType.ImportFromAs:
                return this.visitImportFromAs(node) ? [node.name, node.alias] : [];

            case ParseNodeType.Index:
                return this.visitIndex(node) ? [node.baseExpression, ...node.items] : [];

            case ParseNodeType.Except:
                return this.visitExcept(node) ? [node.typeExpression, node.name, node.exceptSuite] : [];

            case ParseNodeType.For:
                return this.visitFor(node)
                    ? [node.targetExpression, node.iterableExpression, node.forSuite, node.elseSuite]
                    : [];

            case ParseNodeType.FormatString:
                return this.visitFormatString(node) ? node.expressions : [];

            case ParseNodeType.Function:
                return this.visitFunction(node)
                    ? [
                          ...node.decorators,
                          node.name,
                          ...node.parameters,
                          node.returnTypeAnnotation,
                          node.functionAnnotationComment,
                          node.suite,
                      ]
                    : [];

            case ParseNodeType.FunctionAnnotation:
                return this.visitFunctionAnnotation(node)
                    ? [...node.paramTypeAnnotations, node.returnTypeAnnotation]
                    : [];

            case ParseNodeType.Global:
                return this.visitGlobal(node) ? node.nameList : [];

            case ParseNodeType.Lambda:
                return this.visitLambda(node) ? [...node.parameters, node.expression] : [];

            case ParseNodeType.List:
                return this.visitList(node) ? node.entries : [];

            case ParseNodeType.ListComprehension:
                return this.visitListComprehension(node) ? [node.expression, ...node.forIfNodes] : [];

            case ParseNodeType.ListComprehensionFor:
                return this.visitListComprehensionFor(node) ? [node.targetExpression, node.iterableExpression] : [];

            case ParseNodeType.ListComprehensionIf:
                return this.visitListComprehensionIf(node) ? [node.testExpression] : [];

            case ParseNodeType.Match:
                return this.visitMatch(node) ? [node.subjectExpression, ...node.cases] : [];

            case ParseNodeType.MemberAccess:
                return this.visitMemberAccess(node) ? [node.leftExpression, node.memberName] : [];

            case ParseNodeType.ModuleName:
                return this.visitModuleName(node) ? node.nameParts : [];

            case ParseNodeType.Module:
                return this.visitModule(node) ? [...node.statements] : [];

            case ParseNodeType.Name:
                return this.visitName(node) ? [] : [];

            case ParseNodeType.Nonlocal:
                return this.visitNonlocal(node) ? node.nameList : [];

            case ParseNodeType.Number:
                return this.visitNumber(node) ? [] : [];

            case ParseNodeType.Parameter:
                return this.visitParameter(node)
                    ? [node.name, node.typeAnnotation, node.typeAnnotationComment, node.defaultValue]
                    : [];

            case ParseNodeType.Pass:
                return this.visitPass(node) ? [] : [];

            case ParseNodeType.PatternAs:
                return this.visitPatternAs(node) ? [...node.orPatterns, node.target] : [];

            case ParseNodeType.PatternClass:
                return this.visitPatternClass(node) ? [node.className, ...node.arguments] : [];

            case ParseNodeType.PatternClassArgument:
                return this.visitPatternClassArgument(node) ? [node.name, node.pattern] : [];

            case ParseNodeType.PatternCapture:
                return this.visitPatternCapture(node) ? [node.target] : [];

            case ParseNodeType.PatternLiteral:
                return this.visitPatternLiteral(node) ? [node.expression] : [];

            case ParseNodeType.PatternMappingExpandEntry:
                return this.visitPatternMappingExpandEntry(node) ? [node.target] : [];

            case ParseNodeType.PatternMappingKeyEntry:
                return this.visitPatternMappingKeyEntry(node) ? [node.keyPattern, node.valuePattern] : [];

            case ParseNodeType.PatternMapping:
                return this.visitPatternMapping(node) ? [...node.entries] : [];

            case ParseNodeType.PatternSequence:
                return this.visitPatternSequence(node) ? [...node.entries] : [];

            case ParseNodeType.PatternValue:
                return this.visitPatternValue(node) ? [node.expression] : [];
            case ParseNodeType.Raise:
                return this.visitRaise(node)
                    ? [node.typeExpression, node.valueExpression, node.tracebackExpression]
                    : [];

            case ParseNodeType.Return:
                return this.visitReturn(node) ? [node.returnExpression] : [];

            case ParseNodeType.Set:
                return this.visitSet(node) ? node.entries : [];

            case ParseNodeType.Slice:
                return this.visitSlice(node) ? [node.startValue, node.endValue, node.stepValue] : [];

            case ParseNodeType.StatementList:
                return this.visitStatementList(node) ? node.statements : [];

            case ParseNodeType.StringList:
                return this.visitStringList(node) ? [node.typeAnnotation, ...node.strings] : [];

            case ParseNodeType.String:
                return this.visitString(node) ? [] : [];

            case ParseNodeType.Suite:
                return this.visitSuite(node) ? [...node.statements] : [];

            case ParseNodeType.Ternary:
                return this.visitTernary(node) ? [node.ifExpression, node.testExpression, node.elseExpression] : [];

            case ParseNodeType.Tuple:
                return this.visitTuple(node) ? node.expressions : [];

            case ParseNodeType.Try:
                return this.visitTry(node)
                    ? [node.trySuite, ...node.exceptClauses, node.elseSuite, node.finallySuite]
                    : [];

            case ParseNodeType.TypeAnnotation:
                return this.visitTypeAnnotation(node) ? [node.valueExpression, node.typeAnnotation] : [];

            case ParseNodeType.UnaryOperation:
                return this.visitUnaryOperation(node) ? [node.expression] : [];

            case ParseNodeType.Unpack:
                return this.visitUnpack(node) ? [node.expression] : [];

            case ParseNodeType.While:
                return this.visitWhile(node) ? [node.testExpression, node.whileSuite, node.elseSuite] : [];

            case ParseNodeType.With:
                return this.visitWith(node) ? [...node.withItems, node.suite] : [];

            case ParseNodeType.WithItem:
                return this.visitWithItem(node) ? [node.expression, node.target] : [];

            case ParseNodeType.Yield:
                return this.visitYield(node) ? [node.expression] : [];

            case ParseNodeType.YieldFrom:
                return this.visitYieldFrom(node) ? [node.expression] : [];
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

    visitAssignmentExpression(node: AssignmentExpressionNode) {
        return true;
    }

    visitAugmentedAssignment(node: AugmentedAssignmentNode) {
        return true;
    }

    visitAwait(node: AwaitNode) {
        return true;
    }

    visitBinaryOperation(node: BinaryOperationNode) {
        return true;
    }

    visitBreak(node: BreakNode) {
        return true;
    }

    visitCall(node: CallNode) {
        return true;
    }

    visitCase(node: CaseNode) {
        return true;
    }

    visitClass(node: ClassNode) {
        return true;
    }

    visitTernary(node: TernaryNode) {
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

    visitError(node: ErrorNode) {
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

    visitIndex(node: IndexNode) {
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

    visitFunctionAnnotation(node: FunctionAnnotationNode) {
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

    visitMatch(node: MatchNode) {
        return true;
    }

    visitMemberAccess(node: MemberAccessNode) {
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

    visitPatternCapture(node: PatternCaptureNode) {
        return true;
    }

    visitPatternClass(node: PatternClassNode) {
        return true;
    }

    visitPatternClassArgument(node: PatternClassArgumentNode) {
        return true;
    }

    visitPatternAs(node: PatternAsNode) {
        return true;
    }

    visitPatternLiteral(node: PatternLiteralNode) {
        return true;
    }

    visitPatternMappingExpandEntry(node: PatternMappingExpandEntryNode) {
        return true;
    }

    visitPatternSequence(node: PatternSequenceNode) {
        return true;
    }

    visitPatternValue(node: PatternValueNode) {
        return true;
    }

    visitPatternMappingKeyEntry(node: PatternMappingKeyEntryNode) {
        return true;
    }

    visitPatternMapping(node: PatternMappingNode) {
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

    visitSlice(node: SliceNode) {
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

    visitTuple(node: TupleNode) {
        return true;
    }

    visitTry(node: TryNode) {
        return true;
    }

    visitTypeAnnotation(node: TypeAnnotationNode) {
        return true;
    }

    visitUnaryOperation(node: UnaryOperationNode) {
        return true;
    }

    visitUnpack(node: UnpackNode) {
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

    visitYield(node: YieldNode) {
        return true;
    }

    visitYieldFrom(node: YieldFromNode) {
        return true;
    }
}
