/*
 * parseTreeWalker.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Class that traverses a parse tree.
 */

import { fail } from '../common/debug';
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
            case ParseNodeType.Argument:
                if (this.visitArgument(node)) {
                    return [node.name, node.valueExpression];
                }
                break;

            case ParseNodeType.Assert:
                if (this.visitAssert(node)) {
                    return [node.testExpression, node.exceptionExpression];
                }
                break;

            case ParseNodeType.Assignment:
                if (this.visitAssignment(node)) {
                    return [node.leftExpression, node.rightExpression, node.typeAnnotationComment];
                }
                break;

            case ParseNodeType.AssignmentExpression:
                if (this.visitAssignmentExpression(node)) {
                    return [node.name, node.rightExpression];
                }
                break;

            case ParseNodeType.AugmentedAssignment:
                if (this.visitAugmentedAssignment(node)) {
                    return [node.leftExpression, node.rightExpression];
                }
                break;

            case ParseNodeType.Await:
                if (this.visitAwait(node)) {
                    return [node.expression];
                }
                break;

            case ParseNodeType.BinaryOperation:
                if (this.visitBinaryOperation(node)) {
                    return [node.leftExpression, node.rightExpression];
                }
                break;

            case ParseNodeType.Break:
                if (this.visitBreak(node)) {
                    return [];
                }
                break;

            case ParseNodeType.Call:
                if (this.visitCall(node)) {
                    return [node.leftExpression, ...node.arguments];
                }
                break;

            case ParseNodeType.Case:
                if (this.visitCase(node)) {
                    return [node.pattern, node.guardExpression, node.suite];
                }
                break;

            case ParseNodeType.Class:
                if (this.visitClass(node)) {
                    return [...node.decorators, node.name, ...node.arguments, node.suite];
                }
                break;

            case ParseNodeType.Ternary:
                if (this.visitTernary(node)) {
                    return [node.ifExpression, node.testExpression, node.elseExpression];
                }
                break;

            case ParseNodeType.Constant:
                if (this.visitConstant(node)) {
                    return [];
                }
                break;

            case ParseNodeType.Continue:
                if (this.visitContinue(node)) {
                    return [];
                }
                break;

            case ParseNodeType.Decorator:
                if (this.visitDecorator(node)) {
                    return [node.expression];
                }
                break;

            case ParseNodeType.Del:
                if (this.visitDel(node)) {
                    return node.expressions;
                }
                break;

            case ParseNodeType.Dictionary:
                if (this.visitDictionary(node)) {
                    return node.entries;
                }
                break;

            case ParseNodeType.DictionaryKeyEntry:
                if (this.visitDictionaryKeyEntry(node)) {
                    return [node.keyExpression, node.valueExpression];
                }
                break;

            case ParseNodeType.DictionaryExpandEntry:
                if (this.visitDictionaryExpandEntry(node)) {
                    return [node.expandExpression];
                }
                break;

            case ParseNodeType.Error:
                if (this.visitError(node)) {
                    return [node.child, ...(node.decorators ?? [])];
                }
                break;

            case ParseNodeType.If:
                if (this.visitIf(node)) {
                    return [node.testExpression, node.ifSuite, node.elseSuite];
                }
                break;

            case ParseNodeType.Import:
                if (this.visitImport(node)) {
                    return node.list;
                }
                break;

            case ParseNodeType.ImportAs:
                if (this.visitImportAs(node)) {
                    return [node.module, node.alias];
                }
                break;

            case ParseNodeType.ImportFrom:
                if (this.visitImportFrom(node)) {
                    return [node.module, ...node.imports];
                }
                break;

            case ParseNodeType.ImportFromAs:
                if (this.visitImportFromAs(node)) {
                    return [node.name, node.alias];
                }
                break;

            case ParseNodeType.Index:
                if (this.visitIndex(node)) {
                    return [node.baseExpression, ...node.items];
                }
                break;

            case ParseNodeType.Ellipsis:
                if (this.visitEllipsis(node)) {
                    return [];
                }
                break;

            case ParseNodeType.Except:
                if (this.visitExcept(node)) {
                    return [node.typeExpression, node.name, node.exceptSuite];
                }
                break;

            case ParseNodeType.For:
                if (this.visitFor(node)) {
                    return [node.targetExpression, node.iterableExpression, node.forSuite, node.elseSuite];
                }
                break;

            case ParseNodeType.FormatString:
                if (this.visitFormatString(node)) {
                    return node.expressions;
                }
                break;

            case ParseNodeType.Function:
                if (this.visitFunction(node)) {
                    return [
                        ...node.decorators,
                        node.name,
                        ...node.parameters,
                        node.returnTypeAnnotation,
                        node.functionAnnotationComment,
                        node.suite,
                    ];
                }
                break;

            case ParseNodeType.FunctionAnnotation:
                if (this.visitFunctionAnnotation(node)) {
                    return [...node.paramTypeAnnotations, node.returnTypeAnnotation];
                }
                break;

            case ParseNodeType.Global:
                if (this.visitGlobal(node)) {
                    return node.nameList;
                }
                break;

            case ParseNodeType.Lambda:
                if (this.visitLambda(node)) {
                    return [...node.parameters, node.expression];
                }
                break;

            case ParseNodeType.List:
                if (this.visitList(node)) {
                    return node.entries;
                }
                break;

            case ParseNodeType.ListComprehension:
                if (this.visitListComprehension(node)) {
                    return [node.expression, ...node.comprehensions];
                }
                break;

            case ParseNodeType.ListComprehensionFor:
                if (this.visitListComprehensionFor(node)) {
                    return [node.targetExpression, node.iterableExpression];
                }
                break;

            case ParseNodeType.ListComprehensionIf:
                if (this.visitListComprehensionIf(node)) {
                    return [node.testExpression];
                }
                break;

            case ParseNodeType.Match:
                if (this.visitMatch(node)) {
                    return [node.subjectExpression, ...node.cases];
                }
                break;

            case ParseNodeType.MemberAccess:
                if (this.visitMemberAccess(node)) {
                    return [node.leftExpression, node.memberName];
                }
                break;

            case ParseNodeType.Module:
                if (this.visitModule(node)) {
                    return [...node.statements];
                }
                break;

            case ParseNodeType.ModuleName:
                if (this.visitModuleName(node)) {
                    return node.nameParts;
                }
                break;

            case ParseNodeType.Name:
                if (this.visitName(node)) {
                    return [];
                }
                break;

            case ParseNodeType.Nonlocal:
                if (this.visitNonlocal(node)) {
                    return node.nameList;
                }
                break;

            case ParseNodeType.Number:
                if (this.visitNumber(node)) {
                    return [];
                }
                break;

            case ParseNodeType.Parameter:
                if (this.visitParameter(node)) {
                    return [node.name, node.typeAnnotation, node.typeAnnotationComment, node.defaultValue];
                }
                break;

            case ParseNodeType.Pass:
                if (this.visitPass(node)) {
                    return [];
                }
                break;

            case ParseNodeType.PatternCapture:
                if (this.visitPatternCapture(node)) {
                    return [node.target];
                }
                break;

            case ParseNodeType.PatternClass:
                if (this.visitPatternClass(node)) {
                    return [node.className, ...node.arguments];
                }
                break;

            case ParseNodeType.PatternClassArgument:
                if (this.visitPatternClassArgument(node)) {
                    return [node.name, node.pattern];
                }
                break;

            case ParseNodeType.PatternAs:
                if (this.visitPatternAs(node)) {
                    return [...node.orPatterns, node.target];
                }
                break;

            case ParseNodeType.PatternLiteral:
                if (this.visitPatternLiteral(node)) {
                    return [node.expression];
                }
                break;

            case ParseNodeType.PatternMapping:
                if (this.visitPatternMapping(node)) {
                    return [...node.entries];
                }
                break;

            case ParseNodeType.PatternMappingKeyEntry:
                if (this.visitPatternMappingKeyEntry(node)) {
                    return [node.keyPattern, node.valuePattern];
                }
                break;

            case ParseNodeType.PatternMappingExpandEntry:
                if (this.visitPatternMappingExpandEntry(node)) {
                    return [node.target];
                }
                break;

            case ParseNodeType.PatternSequence:
                if (this.visitPatternSequence(node)) {
                    return [...node.entries];
                }
                break;

            case ParseNodeType.PatternValue:
                if (this.visitPatternValue(node)) {
                    return [node.expression];
                }
                break;

            case ParseNodeType.Raise:
                if (this.visitRaise(node)) {
                    return [node.typeExpression, node.valueExpression, node.tracebackExpression];
                }
                break;

            case ParseNodeType.Return:
                if (this.visitReturn(node)) {
                    return [node.returnExpression];
                }
                break;

            case ParseNodeType.Set:
                if (this.visitSet(node)) {
                    return node.entries;
                }
                break;

            case ParseNodeType.Slice:
                if (this.visitSlice(node)) {
                    return [node.startValue, node.endValue, node.stepValue];
                }
                break;

            case ParseNodeType.StatementList:
                if (this.visitStatementList(node)) {
                    return node.statements;
                }
                break;

            case ParseNodeType.String:
                if (this.visitString(node)) {
                    return [];
                }
                break;

            case ParseNodeType.StringList:
                if (this.visitStringList(node)) {
                    return [node.typeAnnotation, ...node.strings];
                }
                break;

            case ParseNodeType.Suite:
                if (this.visitSuite(node)) {
                    return [...node.statements];
                }
                break;

            case ParseNodeType.Tuple:
                if (this.visitTuple(node)) {
                    return node.expressions;
                }
                break;

            case ParseNodeType.Try:
                if (this.visitTry(node)) {
                    return [node.trySuite, ...node.exceptClauses, node.elseSuite, node.finallySuite];
                }
                break;

            case ParseNodeType.TypeAnnotation:
                if (this.visitTypeAnnotation(node)) {
                    return [node.valueExpression, node.typeAnnotation];
                }
                break;

            case ParseNodeType.UnaryOperation:
                if (this.visitUnaryOperation(node)) {
                    return [node.expression];
                }
                break;

            case ParseNodeType.Unpack:
                if (this.visitUnpack(node)) {
                    return [node.expression];
                }
                break;

            case ParseNodeType.While:
                if (this.visitWhile(node)) {
                    return [node.testExpression, node.whileSuite, node.elseSuite];
                }
                break;

            case ParseNodeType.With:
                if (this.visitWith(node)) {
                    return [...node.withItems, node.suite];
                }
                break;

            case ParseNodeType.WithItem:
                if (this.visitWithItem(node)) {
                    return [node.expression, node.target];
                }
                break;

            case ParseNodeType.Yield:
                if (this.visitYield(node)) {
                    return [node.expression];
                }
                break;

            case ParseNodeType.YieldFrom:
                if (this.visitYieldFrom(node)) {
                    return [node.expression];
                }
                break;

            default:
                fail('Unexpected node type');
                break;
        }

        return [];
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
