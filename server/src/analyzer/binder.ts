/*
* binder.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* A parse tree walker that performs basic name binding (creation of
* scopes and associated symbol tables).
* The binder walks the parse tree by scopes starting at the module
* level. When a new scope is detected, it is pushed onto a list and
* walked separately at a later time. (The exception is a class scope,
* which is immediately walked.) Walking the tree in this manner
* simulates the order in which execution normally occurs in a Python
* file. The binder attempts to statically detect runtime errors that
* would be reported by the python interpreter when executing the code.
* This binder doesn't perform any static type checking.
*/

import * as assert from 'assert';

import { CommandId } from '../commands/commands';
import { DiagnosticLevel } from '../common/configOptions';
import { CreateTypeStubFileAction, getEmptyRange } from '../common/diagnostic';
import { DiagnosticRule } from '../common/diagnosticRules';
import { convertOffsetsToRange } from '../common/positionUtils';
import { PythonVersion } from '../common/pythonVersion';
import { TextRange } from '../common/textRange';
import { ArgumentCategory, AssertNode, AssignmentExpressionNode, AssignmentNode,
    AugmentedAssignmentNode, AwaitNode, BinaryOperationNode, BreakNode,
    CallNode, ClassNode, ContinueNode, DelNode, ExceptNode, ExpressionNode, ForNode,
    FunctionNode, GlobalNode, IfNode, ImportAsNode, ImportFromNode, LambdaNode,
    ListComprehensionNode, MemberAccessNode, ModuleNameNode, ModuleNode, NameNode, NonlocalNode,
    ParseNode, ParseNodeType, RaiseNode, ReturnNode, StatementNode, StringListNode,
    SuiteNode, TernaryNode, TryNode, TypeAnnotationNode,
    UnaryOperationNode, WhileNode, WithNode, YieldFromNode, YieldNode } from '../parser/parseNodes';
import * as StringTokenUtils from '../parser/stringTokenUtils';
import { KeywordType, OperatorType } from '../parser/tokenizerTypes';
import { AnalyzerFileInfo, ImportLookupResult } from './analyzerFileInfo';
import * as AnalyzerNodeInfo from './analyzerNodeInfo';
import { createKeyForReference, FlowAssignment, FlowAssignmentAlias, FlowCall, FlowCondition,
    FlowFlags, FlowLabel, FlowNode, FlowPostFinally, FlowPreFinallyGate, FlowWildcardImport,
    getUniqueFlowNodeId, isCodeFlowSupportedForReference } from './codeFlow';
import { AliasDeclaration, ClassDeclaration, DeclarationType, FunctionDeclaration,
    IntrinsicType, ModuleLoaderActions, ParameterDeclaration, VariableDeclaration } from './declaration';
import { ImplicitImport, ImportResult, ImportType } from './importResult';
import * as ParseTreeUtils from './parseTreeUtils';
import { ParseTreeWalker } from './parseTreeWalker';
import { Scope, ScopeType } from './scope';
import * as StaticExpressions from './staticExpressions';
import { indeterminateSymbolId, Symbol, SymbolFlags } from './symbol';
import { isConstantName, isPrivateOrProtectedName } from './symbolNameUtils';

export const enum NameBindingType {
    // With "nonlocal" keyword
    Nonlocal,

    // With "global" keyword
    Global
}

interface MemberAccessInfo {
    classNode: ClassNode;
    methodNode: FunctionNode;
    classScope: Scope;
    isInstanceMember: boolean;
}

interface DeferredBindingTask {
    scope: Scope;
    nonLocalBindingsMap: Map<string, NameBindingType>;
    codeFlowExpressionMap: Map<string, string>;
    callback: () => void;
}

interface FinalInfo {
    isFinal: boolean;
    finalTypeNode?: ExpressionNode;
}

type NarrowingExpressionNode = NameNode | MemberAccessNode;

export interface BinderResults {
    moduleDocString?: string;
}

export class Binder extends ParseTreeWalker {
    private readonly _fileInfo: AnalyzerFileInfo;

    // A queue of deferred analysis operations.
    private _deferredBindingTasks: DeferredBindingTask[] = [];

    // The current scope in effect.
    private _currentScope: Scope;

    // Name bindings that are not local to the current scope.
    private _notLocalBindings = new Map<string, NameBindingType>();

    // Number of nested except statements at current point of analysis.
    // Used to determine if a naked "raise" statement is allowed.
    private _nestedExceptDepth = 0;

    // Current control-flow node.
    private _currentFlowNode: FlowNode;

    // Current target function declaration, if currently binding
    // a function. This allows return and yield statements to be
    // added to the function declaration.
    private _targetFunctionDeclaration: FunctionDeclaration | undefined;

    // Flow node label that is the target of a "break" statement.
    private _currentBreakTarget?: FlowLabel;

    // Flow node label that is the target of a "continue" statement.
    private _currentContinueTarget?: FlowLabel;

    // Flow nodes used for if/else and while/else statements.
    private _currentTrueTarget?: FlowLabel;
    private _currentFalseTarget?: FlowLabel;

    // Flow nodes used within try blocks.
    private _currentExceptTargets?: FlowLabel[];

    // Flow nodes used within try/finally flows.
    private _currentFinallyTarget?: FlowLabel;

    // Flow nodes used for return statements.
    private _currentReturnTarget?: FlowLabel;

    // Map of symbols within the current execution scope
    // and require code flow analysis to resolve.
    private _currentExecutionScopeReferenceMap: Map<string, string>;

    // Flow node that is used for unreachable code.
    private static _unreachableFlowNode: FlowNode = {
        flags: FlowFlags.Unreachable,
        id: getUniqueFlowNodeId()
    };

    constructor(fileInfo: AnalyzerFileInfo) {
        super();

        this._fileInfo = fileInfo;
    }

    bindModule(node: ModuleNode): BinderResults {
        // We'll assume that if there is no builtins scope provided, we must be
        // binding the builtins module itself.
        const isBuiltInModule = this._fileInfo.builtinsScope === undefined;

        this._createNewScope(isBuiltInModule ? ScopeType.Builtin : ScopeType.Module,
                this._fileInfo.builtinsScope, () => {

            AnalyzerNodeInfo.setScope(node, this._currentScope);

            // Bind implicit names.
            // List taken from https://docs.python.org/3/reference/import.html#__name__
            this._addBuiltInSymbolToCurrentScope('__doc__', node, 'str');
            this._addBuiltInSymbolToCurrentScope('__name__', node, 'str');
            this._addBuiltInSymbolToCurrentScope('__loader__', node, 'Any');
            this._addBuiltInSymbolToCurrentScope('__package__', node, 'str');
            this._addBuiltInSymbolToCurrentScope('__spec__', node, 'Any');
            this._addBuiltInSymbolToCurrentScope('__path__', node, 'Iterable[str]');
            this._addBuiltInSymbolToCurrentScope('__file__', node, 'str');
            this._addBuiltInSymbolToCurrentScope('__cached__', node, 'str');

            // Create a start node for the module.
            this._currentFlowNode = this._createStartFlowNode();

            this._walkStatementsAndReportUnreachable(node.statements);

            AnalyzerNodeInfo.setCodeFlowExpressions(node, this._currentExecutionScopeReferenceMap);
        });

        // Perform all analysis that was deferred during the first pass.
        this._bindDeferred();

        return {
            moduleDocString: ParseTreeUtils.getDocString(node.statements)
        };
    }

    visitModule(node: ModuleNode): boolean {
        // Tree walking should start with the children of
        // the node, so we should never get here.
        assert.fail('We should never get here');
        return false;
    }

    visitSuite(node: SuiteNode): boolean {
        this._walkStatementsAndReportUnreachable(node.statements);
        return false;
    }

    visitModuleName(node: ModuleNameNode): boolean {
        const importResult = AnalyzerNodeInfo.getImportInfo(node);
        assert(importResult !== undefined);

        if (importResult) {
            if (!importResult.isImportFound) {
                this._addDiagnostic(this._fileInfo.diagnosticSettings.reportMissingImports,
                    DiagnosticRule.reportMissingImports,
                    `Import '${ importResult.importName }' could not be resolved`, node);
            } else if (importResult.importType === ImportType.ThirdParty) {
                if (!importResult.isStubFile) {
                    const diagnostic = this._addDiagnostic(
                        this._fileInfo.diagnosticSettings.reportMissingTypeStubs,
                        DiagnosticRule.reportMissingTypeStubs,
                        `Stub file not found for '${ importResult.importName }'`, node);
                    if (diagnostic) {
                        // Add a diagnostic action for resolving this diagnostic.
                        const createTypeStubAction: CreateTypeStubFileAction = {
                            action: CommandId.createTypeStub,
                            moduleName: importResult.importName
                        };
                        diagnostic.addAction(createTypeStubAction);
                    }
                }
            }
        }

        return true;
    }

    visitClass(node: ClassNode): boolean {
        this.walkMultiple(node.decorators);

        const classDeclaration: ClassDeclaration = {
            type: DeclarationType.Class,
            node,
            path: this._fileInfo.filePath,
            range: convertOffsetsToRange(node.name.start,
                TextRange.getEnd(node.name), this._fileInfo.lines)
        };

        const symbol = this._bindNameToScope(this._currentScope, node.name.value);
        if (symbol) {
            symbol.addDeclaration(classDeclaration);
        }

         // Stash the declaration in the parse node for later access.
        AnalyzerNodeInfo.setDeclaration(node, classDeclaration);

        this.walkMultiple(node.arguments);

        this._createNewScope(ScopeType.Class, this._currentScope, () => {
            AnalyzerNodeInfo.setScope(node, this._currentScope);

            // Bind implicit names.
            // Note that __class__, __dict__ and __doc__ are skipped here
            // because the builtins.pyi type stub declares these in the
            // 'object' class.
            this._addBuiltInSymbolToCurrentScope('__name__', node, 'str');
            if (this._fileInfo.executionEnvironment.pythonVersion >= PythonVersion.V33) {
                this._addBuiltInSymbolToCurrentScope('__qualname__', node, 'str');
            }

            // Analyze the suite.
            this.walk(node.suite);
        });

        // Add the class symbol. We do this in the binder to speed
        // up overall analysis times. Without this, the type analyzer needs
        // to do more passes to resolve classes.
        this._addSymbolToCurrentScope(node.name.value, true);

        this._createAssignmentTargetFlowNodes(node.name);

        return false;
    }

    visitFunction(node: FunctionNode): boolean {
        const symbol = this._bindNameToScope(this._currentScope, node.name.value);
        const containingClassNode = ParseTreeUtils.getEnclosingClass(node, true);
        const functionDeclaration: FunctionDeclaration = {
            type: DeclarationType.Function,
            node,
            isMethod: !!containingClassNode,
            isGenerator: false,
            path: this._fileInfo.filePath,
            range: convertOffsetsToRange(node.name.start, TextRange.getEnd(node.name),
                this._fileInfo.lines)
        };

        if (symbol) {
            symbol.addDeclaration(functionDeclaration);
        }

        // Stash the declaration in the parse node for later access.
        AnalyzerNodeInfo.setDeclaration(node, functionDeclaration);

        this.walkMultiple(node.decorators);
        node.parameters.forEach(param => {
            if (param.defaultValue) {
                this.walk(param.defaultValue);
            }

            if (param.typeAnnotation) {
                this.walk(param.typeAnnotation);
            }
        });

        if (node.returnTypeAnnotation) {
            this.walk(node.returnTypeAnnotation);
        }

        // Find the function or module that contains this function and use its scope.
        // We can't simply use this._currentScope because functions within a class use
        // the scope of the containing function or module when they execute.
        let functionOrModuleNode: ParseNode | undefined = node.parent;
        while (functionOrModuleNode) {
            if (functionOrModuleNode.nodeType === ParseNodeType.Module ||
                    functionOrModuleNode.nodeType === ParseNodeType.Function) {
                break;
            }

            functionOrModuleNode = functionOrModuleNode.parent;
        }
        assert(functionOrModuleNode !== undefined);

        const functionOrModuleScope = AnalyzerNodeInfo.getScope(functionOrModuleNode!);
        assert(functionOrModuleScope !== undefined);

        // Don't walk the body of the function until we're done analyzing
        // the current scope.
        this._createNewScope(ScopeType.Function, functionOrModuleScope, () => {
            AnalyzerNodeInfo.setScope(node, this._currentScope);

            // Bind implicit names.
            // List taken from https://docs.python.org/3/reference/datamodel.html
            this._addBuiltInSymbolToCurrentScope('__doc__', node, 'str');
            this._addBuiltInSymbolToCurrentScope('__name__', node, 'str');
            if (this._fileInfo.executionEnvironment.pythonVersion >= PythonVersion.V33) {
                this._addBuiltInSymbolToCurrentScope('__qualname__', node, 'str');
            }
            this._addBuiltInSymbolToCurrentScope('__module__', node, 'str');
            this._addBuiltInSymbolToCurrentScope('__defaults__', node, 'Any');
            this._addBuiltInSymbolToCurrentScope('__code__', node, 'Any');
            this._addBuiltInSymbolToCurrentScope('__globals__', node, 'Any');
            this._addBuiltInSymbolToCurrentScope('__dict__', node, 'Any');
            this._addBuiltInSymbolToCurrentScope('__closure__', node, 'Any');
            this._addBuiltInSymbolToCurrentScope('__annotations__', node, 'Any');
            this._addBuiltInSymbolToCurrentScope('__kwdefaults__', node, 'Any');

            const enclosingClass = ParseTreeUtils.getEnclosingClass(node);
            if (enclosingClass) {
                this._addBuiltInSymbolToCurrentScope('__class__', node, 'class');
            }

            this._deferBinding(() => {
                // Create a start node for the function.
                this._currentFlowNode = this._createStartFlowNode();

                node.parameters.forEach(paramNode => {
                    if (paramNode.name) {
                        const symbol = this._bindNameToScope(this._currentScope, paramNode.name.value);
                        if (symbol) {
                            const paramDeclaration: ParameterDeclaration = {
                                type: DeclarationType.Parameter,
                                node: paramNode,
                                path: this._fileInfo.filePath,
                                range: convertOffsetsToRange(paramNode.start, TextRange.getEnd(paramNode),
                                    this._fileInfo.lines)
                            };

                            symbol.addDeclaration(paramDeclaration);
                            AnalyzerNodeInfo.setDeclaration(paramNode.name, paramDeclaration);
                        }

                        this._createFlowAssignment(paramNode.name);
                    }
                });

                this._targetFunctionDeclaration = functionDeclaration;
                this._currentReturnTarget = this._createBranchLabel();

                // Walk the statements that make up the function.
                this.walk(node.suite);

                // Associate the code flow node at the end of the suite with
                // the suite.
                AnalyzerNodeInfo.setAfterFlowNode(node.suite, this._currentFlowNode);

                // Compute the final return flow node and associate it with
                // the function's parse node. If this node is unreachable, then
                // the function never returns.
                this._addAntecedent(this._currentReturnTarget, this._currentFlowNode);
                const returnFlowNode = this._finishFlowLabel(this._currentReturnTarget);
                AnalyzerNodeInfo.setAfterFlowNode(node, returnFlowNode);
            });

            AnalyzerNodeInfo.setCodeFlowExpressions(node, this._currentExecutionScopeReferenceMap);
        });

        this._createAssignmentTargetFlowNodes(node.name);

        // We'll walk the child nodes in a deferred manner, so don't walk them now.
        return false;
    }

    visitLambda(node: LambdaNode): boolean {
        // Analyze the parameter defaults in the context of the parent's scope
        // before we add any names from the function's scope.
        node.parameters.forEach(param => {
            if (param.defaultValue) {
                this.walk(param.defaultValue);
            }
        });

        this._createNewScope(ScopeType.Function, this._currentScope, () => {
            AnalyzerNodeInfo.setScope(node, this._currentScope);

            this._deferBinding(() => {
                // Create a start node for the lambda.
                this._currentFlowNode = this._createStartFlowNode();

                node.parameters.forEach(paramNode => {
                    if (paramNode.name) {
                        const symbol = this._bindNameToScope(this._currentScope, paramNode.name.value);
                        if (symbol) {
                            const paramDeclaration: ParameterDeclaration = {
                                type: DeclarationType.Parameter,
                                node: paramNode,
                                path: this._fileInfo.filePath,
                                range: convertOffsetsToRange(paramNode.start, TextRange.getEnd(paramNode),
                                    this._fileInfo.lines)
                            };

                            symbol.addDeclaration(paramDeclaration);
                            AnalyzerNodeInfo.setDeclaration(paramNode.name, paramDeclaration);
                        }

                        this._createFlowAssignment(paramNode.name);
                        this.walk(paramNode.name);
                    }
                });

                // Walk the expression that make up the lambda body.
                this.walk(node.expression);

                AnalyzerNodeInfo.setCodeFlowExpressions(node, this._currentExecutionScopeReferenceMap);
            });
        });

        // We'll walk the child nodes in a deferred manner.
        return false;
    }

    visitCall(node: CallNode): boolean {
        this.walk(node.leftExpression);
        this.walkMultiple(node.arguments);
        this._createCallFlowNode(node);
        return false;
    }

    visitAssignment(node: AssignmentNode): boolean {
        if (this._handleTypingStubAssignmentOrAnnotation(node)) {
            return false;
        }

        this._bindPossibleTupleNamedTarget(node.leftExpression);

        if (node.typeAnnotationComment) {
            this.walk(node.typeAnnotationComment);
            this._addTypeDeclarationForVariable(node.leftExpression, node.typeAnnotationComment);
        }

        this.walk(node.rightExpression);
        this._addInferredTypeAssignmentForVariable(node.leftExpression, node.rightExpression);

        this._createAssignmentTargetFlowNodes(node.leftExpression);
        this.walk(node.leftExpression);

        return false;
    }

    visitAssignmentExpression(node: AssignmentExpressionNode) {
        this.walk(node.rightExpression);
        this._addInferredTypeAssignmentForVariable(node.name, node.rightExpression);

        const evaluationNode = ParseTreeUtils.getEvaluationNodeForAssignmentExpression(node);
        if (!evaluationNode) {
            this._addError(
                'Assignment expression must be within module, function or lambda',
                node);
        } else {
            // Bind the name to the containing scope. This special logic is required
            // because of the behavior defined in PEP 572. Targets of assignment
            // expressions don't bind to a list comprehension's scope but instead
            // bind to its containing scope.
            const containerScope = AnalyzerNodeInfo.getScope(evaluationNode)!;

            // If we're in a list comprehension (possibly nested), make sure that
            // local for targets don't collide with the target of the assignment
            // expression.
            let curScope: Scope | undefined = this._currentScope;
            while (curScope && curScope !== containerScope) {
                const localSymbol = curScope.lookUpSymbol(node.name.value);
                if (localSymbol) {
                    this._addError(
                        `Assignment expression target '${ node.name.value }' ` +
                            `cannot use same name as comprehension for target`,
                        node.name);
                    break;
                }

                curScope = curScope.parent;
            }

            this._bindNameToScope(containerScope, node.name.value);
        }

        this._createAssignmentTargetFlowNodes(node.name);
        this.walk(node.name);

        return false;
    }

    visitAugmentedAssignment(node: AugmentedAssignmentNode) {
        this.walk(node.leftExpression);
        this.walk(node.rightExpression);

        this._addInferredTypeAssignmentForVariable(node.destExpression, node.rightExpression);

        this._bindPossibleTupleNamedTarget(node.destExpression);
        this._createAssignmentTargetFlowNodes(node.destExpression);

        return false;
    }

    visitDel(node: DelNode) {
        node.expressions.forEach(expr => {
            this._bindPossibleTupleNamedTarget(expr);
            this.walk(expr);
            this._createAssignmentTargetFlowNodes(expr, true);
        });

        return false;
    }

    visitTypeAnnotation(node: TypeAnnotationNode): boolean {
        if (this._handleTypingStubAssignmentOrAnnotation(node)) {
            return false;
        }

        this._bindPossibleTupleNamedTarget(node.valueExpression);
        this._addTypeDeclarationForVariable(node.valueExpression, node.typeAnnotation);
        return true;
    }

    visitFor(node: ForNode) {
        this._bindPossibleTupleNamedTarget(node.targetExpression);
        this._addInferredTypeAssignmentForVariable(node.targetExpression, node);

        this.walk(node.iterableExpression);

        const preForLabel = this._createLoopLabel();
        const preElseLabel = this._createBranchLabel();
        const postForLabel = this._createBranchLabel();

        this._addAntecedent(preForLabel, this._currentFlowNode);
        this._currentFlowNode = preForLabel;
        this._addAntecedent(preElseLabel, this._currentFlowNode);
        this._createAssignmentTargetFlowNodes(node.targetExpression);
        this.walk(node.targetExpression);

        this._bindLoopStatement(preForLabel, postForLabel, () => {
            this.walk(node.forSuite);
            this._addAntecedent(preForLabel, this._currentFlowNode);
        });

        this._currentFlowNode = this._finishFlowLabel(preElseLabel);
        if (node.elseSuite) {
            this.walk(node.elseSuite);
        }
        this._addAntecedent(postForLabel, this._currentFlowNode);

        this._currentFlowNode = this._finishFlowLabel(postForLabel);

        return false;
    }

    visitContinue(node: ContinueNode): boolean {
        if (this._currentContinueTarget) {
            this._addAntecedent(this._currentContinueTarget, this._currentFlowNode);
        }
        this._currentFlowNode = Binder._unreachableFlowNode;

        // Continue nodes don't have any children.
        return false;
    }

    visitBreak(node: BreakNode): boolean {
        if (this._currentBreakTarget) {
            this._addAntecedent(this._currentBreakTarget, this._currentFlowNode);
        }
        this._currentFlowNode = Binder._unreachableFlowNode;

        // Break nodes don't have any children.
        return false;
    }

    visitReturn(node: ReturnNode): boolean {
        if (this._targetFunctionDeclaration) {
            if (!this._targetFunctionDeclaration.returnExpressions) {
                this._targetFunctionDeclaration.returnExpressions = [];
            }
            this._targetFunctionDeclaration.returnExpressions.push(node);
        }

        if (node.returnExpression) {
            this.walk(node.returnExpression);
        }

        AnalyzerNodeInfo.setFlowNode(node, this._currentFlowNode);
        if (this._currentReturnTarget) {
            this._addAntecedent(this._currentReturnTarget, this._currentFlowNode);
        }
        if (this._currentFinallyTarget) {
            this._addAntecedent(this._currentFinallyTarget, this._currentFlowNode);
        }
        this._currentFlowNode = Binder._unreachableFlowNode;
        return false;
    }

    visitYield(node: YieldNode): boolean {
        this._bindYield(node);
        return false;
    }

    visitYieldFrom(node: YieldFromNode): boolean {
        this._bindYield(node);
        return false;
    }

    visitMemberAccess(node: MemberAccessNode): boolean {
        AnalyzerNodeInfo.setFlowNode(node, this._currentFlowNode);
        return true;
    }

    visitName(node: NameNode): boolean {
        AnalyzerNodeInfo.setFlowNode(node, this._currentFlowNode);

        // Name nodes have no children.
        return false;
    }

    visitIf(node: IfNode): boolean {
        const thenLabel = this._createBranchLabel();
        const elseLabel = this._createBranchLabel();
        const postIfLabel = this._createBranchLabel();

        // Determine if the test condition is always true or always false. If so,
        // we can treat either the then or the else clause as unconditional.
        const constExprValue = StaticExpressions.evaluateStaticBoolLikeExpression(
            node.testExpression, this._fileInfo.executionEnvironment);

        this._bindConditional(node.testExpression, thenLabel, elseLabel);

        // Handle the if clause.
        this._currentFlowNode = constExprValue === false ?
            Binder._unreachableFlowNode : this._finishFlowLabel(thenLabel);
        this.walk(node.ifSuite);
        this._addAntecedent(postIfLabel, this._currentFlowNode);

        // Now handle the else clause if it's present. If there
        // are chained "else if" statements, they'll be handled
        // recursively here.
        this._currentFlowNode = constExprValue === true ?
            Binder._unreachableFlowNode : this._finishFlowLabel(elseLabel);
        if (node.elseSuite) {
            this.walk(node.elseSuite);
        }
        this._addAntecedent(postIfLabel, this._currentFlowNode);
        this._currentFlowNode = this._finishFlowLabel(postIfLabel);

        return false;
    }

    visitWhile(node: WhileNode): boolean {
        const thenLabel = this._createBranchLabel();
        const elseLabel = this._createBranchLabel();
        const postWhileLabel = this._createBranchLabel();

        // Determine if the test condition is always true or always false. If so,
        // we can treat either the while or the else clause as unconditional.
        const constExprValue = StaticExpressions.evaluateStaticBoolLikeExpression(
            node.testExpression, this._fileInfo.executionEnvironment);

        const preLoopLabel = this._createLoopLabel();
        this._addAntecedent(preLoopLabel, this._currentFlowNode);
        this._currentFlowNode = preLoopLabel;

        this._bindConditional(node.testExpression, thenLabel, elseLabel);

        // Handle the while clause.
        this._currentFlowNode = constExprValue === false ?
            Binder._unreachableFlowNode : this._finishFlowLabel(thenLabel);
        this._bindLoopStatement(preLoopLabel, postWhileLabel, () => {
            this.walk(node.whileSuite);
        });
        this._addAntecedent(preLoopLabel, this._currentFlowNode);

        this._currentFlowNode = constExprValue === true ?
            Binder._unreachableFlowNode : this._finishFlowLabel(elseLabel);
        if (node.elseSuite) {
            this.walk(node.elseSuite);
        }
        this._addAntecedent(postWhileLabel, this._currentFlowNode);
        this._currentFlowNode = this._finishFlowLabel(postWhileLabel);
        return false;
    }

    visitAssert(node: AssertNode): boolean {
        const assertTrueLabel = this._createBranchLabel();
        const assertFalseLabel = this._createBranchLabel();

        this._bindConditional(node.testExpression, assertTrueLabel, assertFalseLabel);

        if (node.exceptionExpression) {
            this._currentFlowNode = this._finishFlowLabel(assertFalseLabel);
            this.walk(node.exceptionExpression);
        }

        this._currentFlowNode = this._finishFlowLabel(assertTrueLabel);
        return false;
    }

    visitExcept(node: ExceptNode): boolean {
        if (node.typeExpression) {
            this.walk(node.typeExpression);
        }

        if (node.name) {
            const symbol = this._bindNameToScope(this._currentScope, node.name.value);
            this._createAssignmentTargetFlowNodes(node.name);
            this.walk(node.name);
            if (symbol) {
                const declaration: VariableDeclaration = {
                    type: DeclarationType.Variable,
                    node: node.name,
                    isConstant: isConstantName(node.name.value),
                    path: this._fileInfo.filePath,
                    range: convertOffsetsToRange(node.name.start, TextRange.getEnd(node.name),
                        this._fileInfo.lines)
                };
                symbol.addDeclaration(declaration);
            }
        }

        this.walk(node.exceptSuite);

        if (node.name) {
            // The exception name is implicitly unbound at the end of
            // the except block.
            this._createFlowAssignment(node.name, true);
        }

        return false;
    }

    visitRaise(node: RaiseNode): boolean {
        if (!node.typeExpression && this._nestedExceptDepth === 0) {
            this._addError(
                `Raise requires parameter(s) when used outside of except clause `,
                node);
        }

        if (node.typeExpression) {
            this.walk(node.typeExpression);
        }
        if (node.valueExpression) {
            this.walk(node.valueExpression);
        }
        if (node.tracebackExpression) {
            this.walk(node.tracebackExpression);
        }

        if (this._currentFinallyTarget) {
            this._addAntecedent(this._currentFinallyTarget, this._currentFlowNode);
        }

        this._currentFlowNode = Binder._unreachableFlowNode;
        return false;
    }

    visitTry(node: TryNode): boolean {
        // The try/except/else/finally statement is tricky to model using static code
        // flow rules because the finally clause is executed regardless of whether an
        // exception is raised or a return statement is executed. Code within the finally
        // clause needs to be reachable always, and we conservatively assume that any
        // statement within the try block can generate an exception, so we assume that its
        // antecedent is the pre-try flow. We implement this with a "gate" node in the
        // control flow graph. If analysis starts within the finally clause, the gate is
        // opened, and all raise/return statements within try/except/else blocks are
        // considered antecedents. If analysis starts outside (after) the finally clause,
        // the gate is closed, and only paths that don't hit a raise/return statement
        // in try/except/else blocks are considered.
        //
        //
        //                               1. PostElse
        //                                    ^
        //                                    |
        // 3. TryExceptElseReturnOrExcept     |
        //       ^                            |
        //       |                            |     2. PostExcept (for each except)
        //       |                            |            ^
        // 4. ReturnOrRaiseLabel              |            |
        //       ^                            |            |
        //       |                            |   |---------
        // 5. PreFinallyGate                  |   |
        //       ^                            |   |
        //       |------------------          |   |
        //                         |          |   |
        //                        6. PreFinallyLabel
        //                                ^
        //                         (finally block)
        //                                ^
        //                        7. PostFinally
        //                                ^    (only if isAfterElseAndExceptsReachable)
        //                         (after finally)

        // Create one flow label for every except clause.
        const curExceptTargets = node.exceptClauses.map(() => this._createBranchLabel());
        const preFinallyLabel = this._createBranchLabel();

        // Create a label for all of the return or raise labels that are
        // encountered within the try/except/else blocks. This conditionally
        // connects the return/raise statement to the finally clause.
        const preFinallyReturnOrRaiseLabel = this._createBranchLabel();
        let isAfterElseAndExceptsReachable = false;

        const preFinallyGate: FlowPreFinallyGate = {
            flags: FlowFlags.PreFinallyGate,
            id: getUniqueFlowNodeId(),
            antecedent: preFinallyReturnOrRaiseLabel,
            isGateClosed: false
        };
        if (node.finallySuite) {
            this._addAntecedent(preFinallyLabel, preFinallyGate);
        }

        // An exception may be generated before the first flow node
        // added by the try block, so all of the exception targets
        // must have the pre-try flow node as an antecedent.
        curExceptTargets.forEach(exceptLabel => {
            this._addAntecedent(exceptLabel, this._currentFlowNode);
        });

        // We don't properly handle nested finally clauses, which are not
        // feasible to model within a static analyzer, but we do handle
        // a single level of finally statements. Returns or raises within
        // the try/except/raise block will execute the finally target.
        const prevFinallyTarget = this._currentFinallyTarget;
        this._currentFinallyTarget = node.finallySuite ? preFinallyReturnOrRaiseLabel : undefined;

        // Handle the try block.
        const prevExceptTargets = this._currentExceptTargets;
        this._currentExceptTargets = curExceptTargets;
        this.walk(node.trySuite);
        this._currentExceptTargets = prevExceptTargets;

        // Handle the else block, which is executed only if
        // execution falls through the try block.
        if (node.elseSuite) {
            this.walk(node.elseSuite);
        }
        this._addAntecedent(preFinallyLabel, this._currentFlowNode);
        if (!this._isCodeUnreachable()) {
            isAfterElseAndExceptsReachable = true;
        }

        // Handle the except blocks.
        this._nestedExceptDepth++;
        node.exceptClauses.forEach((exceptNode, index) => {
            this._currentFlowNode = this._finishFlowLabel(curExceptTargets[index]);
            this.walk(exceptNode);
            this._addAntecedent(preFinallyLabel, this._currentFlowNode);
            if (!this._isCodeUnreachable()) {
                isAfterElseAndExceptsReachable = true;
            }
        });
        this._nestedExceptDepth--;

        this._currentFinallyTarget = prevFinallyTarget;

        // Handle the finally block.
        this._currentFlowNode = this._finishFlowLabel(preFinallyLabel);
        if (node.finallySuite) {
            this.walk(node.finallySuite);

            // Add a post-finally node at the end. If we traverse this node,
            // we'll set the "ignore" flag in the pre-finally node.
            const postFinallyNode: FlowPostFinally = {
                flags: FlowFlags.PostFinally,
                id: getUniqueFlowNodeId(),
                antecedent: this._currentFlowNode,
                preFinallyGate
            };
            this._currentFlowNode = isAfterElseAndExceptsReachable ?
                postFinallyNode : Binder._unreachableFlowNode;
        }

        return false;
    }

    visitAwait(node: AwaitNode) {
        // Make sure this is within an async lambda or function.
        const enclosingFunction = ParseTreeUtils.getEnclosingFunction(node);
        if (enclosingFunction === undefined || !enclosingFunction.isAsync) {
            this._addError(`'await' allowed only within async function`, node);
        }

        return true;
    }

    visitStringList(node: StringListNode): boolean {
        for (const stringNode of node.strings) {
            if (stringNode.hasUnescapeErrors) {
                const unescapedResult = StringTokenUtils.getUnescapedString(stringNode.token);

                unescapedResult.unescapeErrors.forEach((error: StringTokenUtils.UnescapeError) => {
                    const start = stringNode.token.start + stringNode.token.prefixLength +
                        stringNode.token.quoteMarkLength + error.offset;
                    const textRange = { start, length: error.length };

                    if (error.errorType === StringTokenUtils.UnescapeErrorType.InvalidEscapeSequence) {
                        this._addDiagnostic(
                            this._fileInfo.diagnosticSettings.reportInvalidStringEscapeSequence,
                            DiagnosticRule.reportInvalidStringEscapeSequence,
                            'Unsupported escape sequence in string literal', textRange);
                    } else if (error.errorType ===
                            StringTokenUtils.UnescapeErrorType.EscapeWithinFormatExpression) {

                        this._addError(
                            'Escape sequence (backslash) not allowed in expression portion of f-string',
                            textRange);
                    } else if (error.errorType ===
                            StringTokenUtils.UnescapeErrorType.SingleCloseBraceWithinFormatLiteral) {

                        this._addError(
                            'Single close brace not allowed within f-string literal; use double close brace',
                            textRange);
                    } else if (error.errorType ===
                            StringTokenUtils.UnescapeErrorType.UnterminatedFormatExpression) {

                        this._addError(
                            'Unterminated expression in f-string; missing close brace',
                            textRange);
                    }
                });
            }
        }

        return true;
    }

    visitGlobal(node: GlobalNode): boolean {
        const globalScope = this._currentScope.getGlobalScope();

        node.nameList.forEach(name => {
            const nameValue = name.value;

            // Is the binding inconsistent?
            if (this._notLocalBindings.get(nameValue) === NameBindingType.Nonlocal) {
                this._addError(`'${ nameValue }' was already declared nonlocal`, name);
            }

            const valueWithScope = this._currentScope.lookUpSymbolRecursive(nameValue);

            // Was the name already assigned within this scope before it was declared global?
            if (valueWithScope && valueWithScope.scope === this._currentScope) {
                this._addError(`'${ nameValue }' is assigned before global declaration`, name);
            }

            // Add it to the global scope if it's not already added.
            this._bindNameToScope(globalScope, nameValue);

            if (this._currentScope !== globalScope) {
                this._notLocalBindings.set(nameValue, NameBindingType.Global);
            }
        });

        return true;
    }

    visitNonlocal(node: NonlocalNode): boolean {
        const globalScope = this._currentScope.getGlobalScope();

        if (this._currentScope === globalScope) {
            this._addError('Nonlocal declaration not allowed at module level', node);
        } else {
            node.nameList.forEach(name => {
                const nameValue = name.value;

                // Is the binding inconsistent?
                if (this._notLocalBindings.get(nameValue) === NameBindingType.Global) {
                    this._addError(`'${ nameValue }' was already declared global`, name);
                }

                const valueWithScope = this._currentScope.lookUpSymbolRecursive(nameValue);

                // Was the name already assigned within this scope before it was declared nonlocal?
                if (valueWithScope && valueWithScope.scope === this._currentScope) {
                    this._addError(`'${ nameValue }' is assigned before nonlocal declaration`, name);
                } else if (!valueWithScope || valueWithScope.scope === globalScope) {
                    this._addError(`No binding for nonlocal '${ nameValue }' found`, name);
                }

                this._notLocalBindings.set(nameValue, NameBindingType.Nonlocal);
            });
        }

        return true;
    }

    visitImportAs(node: ImportAsNode): boolean {
        if (node.module.nameParts.length > 0) {
            const firstNamePartValue = node.module.nameParts[0].value;

            let symbolName: string | undefined;
            if (node.alias) {
                // The symbol name is defined by the alias.
                symbolName = node.alias.value;
            } else {
                // There was no alias, so we need to use the first element of
                // the name parts as the symbol.
                symbolName = firstNamePartValue;
            }

            const symbol = this._bindNameToScope(this._currentScope, symbolName);
            if (symbol && this._fileInfo.isStubFile && !node.alias) {
                // PEP 484 indicates that imported symbols should not be
                // considered "reexported" from a type stub file unless
                // they are imported using the "as" form.
                symbol.setIsExternallyHidden();
            }

            const importInfo = AnalyzerNodeInfo.getImportInfo(node.module);
            assert(importInfo !== undefined);

            if (importInfo && importInfo.isImportFound && importInfo.resolvedPaths.length > 0 && symbol) {
                // See if there's already a matching alias declaration for this import.
                // if so, we'll update it rather than creating a new one. This is required
                // to handle cases where multiple import statements target the same
                // starting symbol such as "import a.b.c" and "import a.d". In this case,
                // we'll build a single declaration that describes the combined actions
                // of both import statements, thus reflecting the behavior of the
                // python module loader.
                const existingDecl = symbol.getDeclarations().find(
                    decl => decl.type === DeclarationType.Alias &&
                    decl.firstNamePart === firstNamePartValue);

                const newDecl: AliasDeclaration = existingDecl as AliasDeclaration || {
                    type: DeclarationType.Alias,
                    node,
                    path: '',
                    range: getEmptyRange(),
                    firstNamePart: firstNamePartValue
                };

                // Add the implicit imports for this module if it's the last
                // name part we're resolving.
                if (node.alias || node.module.nameParts.length === 1) {
                    newDecl.path = importInfo.resolvedPaths[importInfo.resolvedPaths.length - 1];
                    this._addImplicitImportsToLoaderActions(importInfo, newDecl);
                } else {
                    // Fill in the remaining name parts.
                    let curLoaderActions: ModuleLoaderActions = newDecl;

                    for (let i = 1; i < node.module.nameParts.length; i++) {
                        if (i >= importInfo.resolvedPaths.length) {
                            break;
                        }

                        const namePartValue = node.module.nameParts[i].value;

                        // Is there an existing loader action for this name?
                        let loaderActions = curLoaderActions.implicitImports ?
                            curLoaderActions.implicitImports.get(namePartValue) :
                            undefined;
                        if (!loaderActions) {
                            // Allocate a new loader action.
                            loaderActions = {
                                path: '',
                                implicitImports: new Map<string, ModuleLoaderActions>()
                            };
                            if (!curLoaderActions.implicitImports) {
                                curLoaderActions.implicitImports = new Map<string, ModuleLoaderActions>();
                            }
                            curLoaderActions.implicitImports.set(namePartValue, loaderActions);
                        }

                        // If this is the last name part we're resolving, add in the
                        // implicit imports as well.
                        if (i === node.module.nameParts.length - 1) {
                            loaderActions.path = importInfo.resolvedPaths[i];
                            this._addImplicitImportsToLoaderActions(importInfo, loaderActions);
                        }

                        curLoaderActions = loaderActions;
                    }
                }

                if (!existingDecl) {
                    symbol.addDeclaration(newDecl);
                }
            }

            this._createFlowAssignment(node.alias ? node.alias : node.module.nameParts[0]);
        }

        return true;
    }

    visitImportFrom(node: ImportFromNode): boolean {
        const importInfo = AnalyzerNodeInfo.getImportInfo(node.module);

        let resolvedPath = '';
        if (importInfo && importInfo.isImportFound) {
            resolvedPath = importInfo.resolvedPaths[importInfo.resolvedPaths.length - 1];
        }

        if (node.isWildcardImport) {
            if (ParseTreeUtils.getEnclosingClass(node) || ParseTreeUtils.getEnclosingFunction(node)) {
                this._addError('Wildcard import is not allowed within a class or function', node);
            }

            if (importInfo) {
                const names: string[] = [];

                const lookupInfo = this._fileInfo.importLookup(resolvedPath);
                if (lookupInfo) {
                    const wildcardNames = this._getWildcardImportNames(lookupInfo);
                    wildcardNames.forEach(name => {
                        const symbol = lookupInfo.symbolTable.get(name)!;

                        // Don't include the ignored names in the symbol table.
                        if (!symbol.isIgnoredForProtocolMatch()) {
                            const symbol = this._bindNameToScope(this._currentScope, name);
                            if (symbol) {
                                const aliasDecl: AliasDeclaration = {
                                    type: DeclarationType.Alias,
                                    node,
                                    path: resolvedPath,
                                    range: getEmptyRange(),
                                    symbolName: name
                                };
                                symbol.addDeclaration(aliasDecl);
                                names.push(name);
                            }
                        }
                    });
                }

                // Also add all of the implicitly-imported modules for
                // the import module.
                importInfo.implicitImports.forEach(implicitImport => {
                    // Don't overwrite a symbol that was imported from the module.
                    if (!names.some(name => name === implicitImport.name)) {
                        const symbol = this._bindNameToScope(this._currentScope, implicitImport.name);
                        if (symbol) {
                            const submoduleFallback: AliasDeclaration = {
                                type: DeclarationType.Alias,
                                node,
                                path: implicitImport.path,
                                range: getEmptyRange()
                            };

                            const aliasDecl: AliasDeclaration = {
                                type: DeclarationType.Alias,
                                node,
                                path: resolvedPath,
                                symbolName: implicitImport.name,
                                submoduleFallback,
                                range: getEmptyRange()
                            };

                            symbol.addDeclaration(aliasDecl);
                            names.push(implicitImport.name);
                        }
                    }
                });

                this._createFlowWildcardImport(node, names);
            }
        } else {
            node.imports.forEach(importSymbolNode => {
                const importedName = importSymbolNode.name.value;
                const nameNode = importSymbolNode.alias || importSymbolNode.name;
                const symbol = this._bindNameToScope(this._currentScope, nameNode.value);

                if (symbol) {
                    if (this._fileInfo.isStubFile && !importSymbolNode.alias) {
                        // PEP 484 indicates that imported symbols should not be
                        // considered "reexported" from a type stub file unless
                        // they are imported using the "as" form.
                        symbol.setIsExternallyHidden();
                    }

                    // Is the import referring to an implicitly-imported module?
                    let implicitImport: ImplicitImport | undefined;
                    if (importInfo && importInfo.implicitImports) {
                        implicitImport = importInfo.implicitImports.find(imp => imp.name === importedName);
                    }

                    let submoduleFallback: AliasDeclaration | undefined;
                    if (implicitImport) {
                        submoduleFallback = {
                            type: DeclarationType.Alias,
                            node: importSymbolNode,
                            path: implicitImport.path,
                            range: getEmptyRange()
                        };

                        // Handle the case of "from . import X". In this case,
                        // we want to always resolve to the submodule rather than
                        // the resolved path.
                        if (node.module.nameParts.length === 0) {
                            resolvedPath = '';
                        }
                    }

                    const aliasDecl: AliasDeclaration = {
                        type: DeclarationType.Alias,
                        node: importSymbolNode,
                        path: resolvedPath,
                        symbolName: importedName,
                        submoduleFallback,
                        range: getEmptyRange()
                    };

                    symbol.addDeclaration(aliasDecl);
                    this._createFlowAssignment(importSymbolNode.alias || importSymbolNode.name);
                }
            });
        }

        return true;
    }

    visitWith(node: WithNode): boolean {
        node.withItems.forEach(item => {
            this.walk(item.expression);
            if (item.target) {
                this._bindPossibleTupleNamedTarget(item.target);
                this._addInferredTypeAssignmentForVariable(item.target, item);
                this._createAssignmentTargetFlowNodes(item.target);
                this.walk(item.target);
            }
        });

        this.walk(node.suite);

        return false;
    }

    visitTernary(node: TernaryNode): boolean {
        const trueLabel = this._createBranchLabel();
        const falseLabel = this._createBranchLabel();
        const postExpressionLabel = this._createBranchLabel();

        // Handle the test expression.
        this._bindConditional(node.testExpression, trueLabel, falseLabel);

        // Handle the "true" portion (the "if" expression).
        this._currentFlowNode = this._finishFlowLabel(trueLabel);
        this.walk(node.ifExpression);
        this._addAntecedent(postExpressionLabel, this._currentFlowNode);

        // Handle the "false" portion (the "else" expression).
        this._currentFlowNode = this._finishFlowLabel(falseLabel);
        this.walk(node.elseExpression);
        this._addAntecedent(postExpressionLabel, this._currentFlowNode);

        this._currentFlowNode = this._finishFlowLabel(postExpressionLabel);

        return false;
    }

    visitUnaryOperation(node: UnaryOperationNode): boolean {
        if (node.operator === OperatorType.Not && this._currentFalseTarget && this._currentTrueTarget) {
            // Swap the existing true/false targets.
            this._bindConditional(node.expression, this._currentFalseTarget, this._currentTrueTarget);
        } else {
            const savedTrueTarget = this._currentTrueTarget;
            const savedFalseTarget = this._currentFalseTarget;

            // Temporarily set the true/false targets to undefined because
            // this unary operation is not part of a chain of logical expressions
            // (AND/OR/NOT subexpressions).
            this._currentTrueTarget = undefined;
            this._currentFalseTarget = undefined;

            // Evaluate the operand expression.
            this.walk(node.expression);

            this._currentFalseTarget = savedFalseTarget;
            this._currentTrueTarget = savedTrueTarget;
        }

        return false;
    }

    visitBinaryOperation(node: BinaryOperationNode): boolean {
        if (node.operator === OperatorType.And || node.operator === OperatorType.Or) {
            let trueTarget = this._currentTrueTarget;
            let falseTarget = this._currentFalseTarget;
            let postRightLabel: FlowLabel | undefined;

            if (!trueTarget || !falseTarget) {
                postRightLabel = this._createBranchLabel();
                trueTarget = falseTarget = postRightLabel;
            }

            const preRightLabel = this._createBranchLabel();
            if (node.operator === OperatorType.And) {
                this._bindConditional(node.leftExpression, preRightLabel, falseTarget);
            } else {
                this._bindConditional(node.leftExpression, trueTarget, preRightLabel);
            }
            this._currentFlowNode = this._finishFlowLabel(preRightLabel);
            this._bindConditional(node.rightExpression, trueTarget, falseTarget);
            if (postRightLabel) {
                this._currentFlowNode = this._finishFlowLabel(postRightLabel);
            }
        } else {
            const savedTrueTarget = this._currentTrueTarget;
            const savedFalseTarget = this._currentFalseTarget;

            // Temporarily set the true/false targets to undefined because
            // this binary operation is not part of a chain of logical expressions
            // (AND/OR/NOT subexpressions).
            this._currentTrueTarget = undefined;
            this._currentFalseTarget = undefined;

            this.walk(node.leftExpression);
            this.walk(node.rightExpression);

            this._currentFalseTarget = savedFalseTarget;
            this._currentTrueTarget = savedTrueTarget;
        }

        return false;
    }

    visitListComprehension(node: ListComprehensionNode): boolean {
        this._createNewScope(ScopeType.ListComprehension, this._currentScope, () => {
            AnalyzerNodeInfo.setScope(node, this._currentScope);

            const falseLabel = this._createBranchLabel();

            // We'll walk the comprehensions list twice. The first time we'll
            // bind targets of for statements. The second time we'll walk
            // expressions and create the control flow graph.
            const boundSymbols: Map<string, Symbol>[] = [];
            for (let i = 0; i < node.comprehensions.length; i++) {
                const compr = node.comprehensions[i];
                const addedSymbols = new Map<string, Symbol>();
                if (compr.nodeType === ParseNodeType.ListComprehensionFor) {
                    this._bindPossibleTupleNamedTarget(compr.targetExpression, addedSymbols);
                }
                boundSymbols.push(addedSymbols);
            }

            for (let i = 0; i < node.comprehensions.length; i++) {
                const compr = node.comprehensions[i];
                if (compr.nodeType === ParseNodeType.ListComprehensionFor) {
                    const addedSymbols = boundSymbols[i];

                    // Determine if we added a new symbol to this scope. If so, see
                    // if it's the same name as a symbol in an outer scope. If so, we'll
                    // create an alias node in the control flow graph.
                    for (const addedSymbol of addedSymbols) {
                        const aliasSymbol = this._currentScope.parent!.
                            lookUpSymbol(addedSymbol[0]);
                        if (aliasSymbol) {
                            this._createAssignmentAliasFlowNode(addedSymbol[1].id, aliasSymbol.id);
                        }
                    }

                    this.walk(compr.iterableExpression);

                    this._createAssignmentTargetFlowNodes(compr.targetExpression);
                    this.walk(compr.targetExpression);
                } else {
                    const trueLabel = this._createBranchLabel();
                    this._bindConditional(compr.testExpression, trueLabel, falseLabel);
                    this._currentFlowNode = this._finishFlowLabel(trueLabel);
                }
            }

            this.walk(node.expression);
            this._addAntecedent(falseLabel, this._currentFlowNode);
            this._currentFlowNode = this._finishFlowLabel(falseLabel);
        });

        return false;
    }

    private _getWildcardImportNames(lookupInfo: ImportLookupResult): string[] {
        const namesToImport: string[] = [];

        // Is there an __all__ statement? If so, it overrides the normal
        // wildcard logic.
        const allSymbol = lookupInfo.symbolTable.get('__all__');
        if (allSymbol) {
            const decls = allSymbol.getDeclarations();

            // For now, we handle only the case where __all__ is defined
            // through a simple assignment. Some libraries use more complex
            // logic like __all__.extend(X) or __all__ += X. We'll punt on
            // those for now.
            if (decls.length === 1 && decls[0].type === DeclarationType.Variable) {
                const firstDecl = decls[0];
                if (firstDecl.node.parent && firstDecl.node.parent.nodeType === ParseNodeType.Assignment) {
                    const expr = firstDecl.node.parent.rightExpression;
                    if (expr.nodeType === ParseNodeType.List) {
                        expr.entries.forEach(listEntryNode => {
                            if (listEntryNode.nodeType === ParseNodeType.StringList &&
                                    listEntryNode.strings.length === 1 &&
                                    listEntryNode.strings[0].nodeType === ParseNodeType.String) {

                                const entryName = listEntryNode.strings[0].value;
                                if (lookupInfo.symbolTable.get(entryName)) {
                                    namesToImport.push(entryName);
                                }
                            }
                        });

                        return namesToImport;
                    }
                }
            }
        }

        // Import all names that don't begin with an underscore.
        lookupInfo.symbolTable.forEach((_, name) => {
            if (!name.startsWith('_')) {
                namesToImport.push(name);
            }
        });

        return namesToImport;
    }

    private _walkStatementsAndReportUnreachable(statements: StatementNode[]) {
        let reportedUnreachable = false;

        for (const statement of statements) {
            AnalyzerNodeInfo.setFlowNode(statement, this._currentFlowNode);

            if (this._isCodeUnreachable() && !reportedUnreachable) {
                // Create a text range that covers the next statement through
                // the end of the suite.
                const start = statement.start;
                const lastStatement = statements[statements.length - 1];
                const end = TextRange.getEnd(lastStatement);
                this._addUnusedCode({ start, length: end - start });

                // Don't report it multiple times.
                reportedUnreachable = true;
            }

            if (!reportedUnreachable) {
                this.walk(statement);
            } else {
                // If we're within a function, we need to look for unreachable yield
                // statements because they affect the behavior of the function (making
                // it a generator) even if they're never executed.
                if (this._targetFunctionDeclaration && !this._targetFunctionDeclaration.isGenerator) {
                    const yieldFinder = new YieldFinder();
                    if (yieldFinder.checkContainsYield(statement)) {
                        this._targetFunctionDeclaration.isGenerator = true;
                    }
                }
            }
        }

        return false;
    }

    private _createStartFlowNode() {
        const flowNode: FlowNode = {
            flags: FlowFlags.Start,
            id: getUniqueFlowNodeId()
        };
        return flowNode;
    }

    private _createBranchLabel() {
        const flowNode: FlowLabel = {
            flags: FlowFlags.BranchLabel,
            id: getUniqueFlowNodeId(),
            antecedents: []
        };
        return flowNode;
    }

    private _createLoopLabel() {
        const flowNode: FlowLabel = {
            flags: FlowFlags.LoopLabel,
            id: getUniqueFlowNodeId(),
            antecedents: []
        };
        return flowNode;
    }

    private _finishFlowLabel(node: FlowLabel) {
        // If there were no antecedents, this is unreachable.
        if (node.antecedents.length === 0) {
            return Binder._unreachableFlowNode;
        }

        // If there was only one antecedent, there's no need
        // for a label to exist.
        if (node.antecedents.length === 1) {
            return node.antecedents[0];
        }

        return node;
    }

    private _bindConditional(node: ExpressionNode, trueTarget: FlowLabel, falseTarget: FlowLabel) {
        const savedTrueTarget = this._currentTrueTarget;
        const savedFalseTarget = this._currentFalseTarget;
        this._currentTrueTarget = trueTarget;
        this._currentFalseTarget = falseTarget;

        this.walk(node);

        this._currentTrueTarget = savedTrueTarget;
        this._currentFalseTarget = savedFalseTarget;

        if (!this._isLogicalExpression(node)) {
            this._addAntecedent(trueTarget,
                this._createFlowConditional(FlowFlags.TrueCondition,
                this._currentFlowNode, node));
            this._addAntecedent(falseTarget,
                this._createFlowConditional(FlowFlags.FalseCondition,
                this._currentFlowNode, node));
        }
    }

    private _createFlowConditional(flags: FlowFlags, antecedent: FlowNode,
            expression: ExpressionNode): FlowNode {

        if (antecedent.flags & FlowFlags.Unreachable) {
            return antecedent;
        }
        const staticValue = StaticExpressions.evaluateStaticBoolLikeExpression(
            expression, this._fileInfo.executionEnvironment);
        if (staticValue === true && (flags & FlowFlags.FalseCondition) ||
                staticValue === false && (flags & FlowFlags.TrueCondition)) {

            return Binder._unreachableFlowNode;
        }

        const expressionList: NarrowingExpressionNode[] = [];
        if (!this._isNarrowingExpression(expression, expressionList)) {
            return antecedent;
        }

        expressionList.forEach(expr => {
            const referenceKey = createKeyForReference(expr);
            this._currentExecutionScopeReferenceMap.set(referenceKey, referenceKey);
        });

        const conditionalFlowNode: FlowCondition = {
            flags,
            id: getUniqueFlowNodeId(),
            expression,
            antecedent
        };

        this._addExceptTargets(conditionalFlowNode);

        return conditionalFlowNode;
    }

    // Indicates whether the expression is a NOT, AND or OR expression.
    private _isLogicalExpression(expression: ExpressionNode): boolean {
        switch (expression.nodeType) {
            case ParseNodeType.UnaryOperation: {
                return expression.operator === OperatorType.Not;
            }

            case ParseNodeType.BinaryOperation: {
                return expression.operator === OperatorType.And ||
                    expression.operator === OperatorType.Or;
            }
        }

        return false;
    }

    private _isNarrowingExpression(expression: ExpressionNode,
            expressionList: NarrowingExpressionNode[]): boolean {

        switch (expression.nodeType) {
            case ParseNodeType.Name:
            case ParseNodeType.MemberAccess: {
                if (isCodeFlowSupportedForReference(expression)) {
                    expressionList.push(expression);
                    return true;
                }

                return false;
            }

            case ParseNodeType.AssignmentExpression: {
                if (this._isNarrowingExpression(expression.rightExpression, expressionList)) {
                    expressionList.push(expression.name);
                    return true;
                }

                return false;
            }

            case ParseNodeType.BinaryOperation: {
                const isOrIsNotOperator = expression.operator === OperatorType.Is ||
                    expression.operator === OperatorType.IsNot;
                const equalsOrNotEqualsOperator = expression.operator === OperatorType.Equals ||
                    expression.operator === OperatorType.NotEquals;

                if (isOrIsNotOperator || equalsOrNotEqualsOperator) {
                    // Look for "X is None", "X is not None", "X == None", "X != None".
                    // These are commonly-used patterns used in control flow.
                    if (expression.rightExpression.nodeType === ParseNodeType.Constant &&
                            expression.rightExpression.constType === KeywordType.None) {

                        return this._isNarrowingExpression(expression.leftExpression, expressionList);
                    }

                    // Look for "type(X) is Y" or "type(X) is not Y".
                    if (isOrIsNotOperator &&
                        expression.leftExpression.nodeType === ParseNodeType.Call &&
                        expression.leftExpression.leftExpression.nodeType === ParseNodeType.Name &&
                        expression.leftExpression.leftExpression.value === 'type' &&
                        expression.leftExpression.arguments.length === 1 &&
                            expression.leftExpression.arguments[0].argumentCategory === ArgumentCategory.Simple) {

                        return this._isNarrowingExpression(
                            expression.leftExpression.arguments[0].valueExpression, expressionList);
                    }
                }

                return false;
            }

            case ParseNodeType.UnaryOperation: {
                return expression.operator === OperatorType.Not &&
                    this._isNarrowingExpression(expression.expression, expressionList);
            }

            case ParseNodeType.AugmentedAssignment: {
                return this._isNarrowingExpression(expression.rightExpression, expressionList);
            }

            case ParseNodeType.Call: {
                if (expression.leftExpression.nodeType === ParseNodeType.Name &&
                        (expression.leftExpression.value === 'isinstance' ||
                            expression.leftExpression.value === 'issubclass') &&
                        expression.arguments.length === 2) {

                    return this._isNarrowingExpression(expression.arguments[0].valueExpression,
                        expressionList);
                }
            }
        }

        return false;
    }

    private _createAssignmentTargetFlowNodes(target: ExpressionNode, unbound = false) {
        switch (target.nodeType) {
            case ParseNodeType.Name:
            case ParseNodeType.MemberAccess: {
                this._createFlowAssignment(target, unbound);
                break;
            }

            case ParseNodeType.Tuple: {
                target.expressions.forEach(expr => {
                    this._createAssignmentTargetFlowNodes(expr, unbound);
                });
                break;
            }

            case ParseNodeType.TypeAnnotation: {
                this._createAssignmentTargetFlowNodes(target.valueExpression, unbound);
                break;
            }

            case ParseNodeType.Unpack: {
                this._createAssignmentTargetFlowNodes(target.expression, unbound);
                break;
            }

            case ParseNodeType.List: {
                target.entries.forEach(entry => {
                    this._createAssignmentTargetFlowNodes(entry, unbound);
                });
                break;
            }
        }
    }

    private _createCallFlowNode(node: CallNode) {
        if (!this._isCodeUnreachable()) {
            const flowNode: FlowCall = {
                flags: FlowFlags.Call,
                id: getUniqueFlowNodeId(),
                node,
                antecedent: this._currentFlowNode
            };

            this._currentFlowNode = flowNode;
        }
    }

    private _createAssignmentAliasFlowNode(targetSymbolId: number, aliasSymbolId: number) {
        if (!this._isCodeUnreachable()) {
            const flowNode: FlowAssignmentAlias = {
                flags: FlowFlags.AssignmentAlias,
                id: getUniqueFlowNodeId(),
                antecedent: this._currentFlowNode,
                targetSymbolId,
                aliasSymbolId
            };

            this._currentFlowNode = flowNode;
        }
    }

    private _createFlowAssignment(node: NameNode | MemberAccessNode, unbound = false) {
        let targetSymbolId = indeterminateSymbolId;
        if (node.nodeType === ParseNodeType.Name) {
            const symbolWithScope = this._currentScope.lookUpSymbolRecursive(node.value);
            assert(symbolWithScope !== undefined);
            targetSymbolId = symbolWithScope!.symbol.id;
        }

        const prevFlowNode = this._currentFlowNode;
        if (!this._isCodeUnreachable() && isCodeFlowSupportedForReference(node)) {
            const flowNode: FlowAssignment = {
                flags: FlowFlags.Assignment,
                id: getUniqueFlowNodeId(),
                node,
                antecedent: this._currentFlowNode,
                targetSymbolId
            };

            const referenceKey = createKeyForReference(node);
            this._currentExecutionScopeReferenceMap.set(referenceKey, referenceKey);

            if (unbound) {
                flowNode.flags |= FlowFlags.Unbind;
            }

            this._addExceptTargets(flowNode);
            this._currentFlowNode = flowNode;
        }

        // If we're marking the node as unbound, use the previous
        // flow node. Otherwise, the node will be evaluated as
        // unbound at this point in the flow.
        AnalyzerNodeInfo.setFlowNode(node, unbound ? prevFlowNode : this._currentFlowNode);
    }

    private _createFlowWildcardImport(node: ImportFromNode, names: string[]) {
        if (!this._isCodeUnreachable()) {
            const flowNode: FlowWildcardImport = {
                flags: FlowFlags.WildcardImport,
                id: getUniqueFlowNodeId(),
                node,
                names,
                antecedent: this._currentFlowNode
            };

            this._addExceptTargets(flowNode);
            this._currentFlowNode = flowNode;
        }

        AnalyzerNodeInfo.setFlowNode(node, this._currentFlowNode);
    }

    private _isCodeUnreachable() {
        return !!(this._currentFlowNode.flags & FlowFlags.Unreachable);
    }

    private _addExceptTargets(flowNode: FlowNode) {
            // If there are any except targets, then we're in a try block, and we
            // have to assume that an exception can be raised after every assignment.
            if (this._currentExceptTargets) {
                this._currentExceptTargets.forEach(label => {
                    this._addAntecedent(label, flowNode);
                });
            }
    }

    private _bindLoopStatement(preLoopLabel: FlowLabel, postLoopLabel: FlowLabel, callback: () => void) {
        const savedContinueTarget = this._currentContinueTarget;
        const savedBreakTarget = this._currentBreakTarget;
        this._currentContinueTarget = preLoopLabel;
        this._currentBreakTarget = postLoopLabel;

        callback();

        this._currentContinueTarget = savedContinueTarget;
        this._currentBreakTarget = savedBreakTarget;
    }

    private _addAntecedent(label: FlowLabel, antecedent: FlowNode) {
        if (!(this._currentFlowNode.flags & FlowFlags.Unreachable)) {
            // Don't add the same antecedent twice.
            if (!label.antecedents.some(existing => existing.id === antecedent.id)) {
                label.antecedents.push(antecedent);
            }
        }
    }

    private _bindNameToScope(scope: Scope, name: string, addedSymbols?: Map<string, Symbol>) {
        if (this._notLocalBindings.get(name) === undefined) {
            // Don't overwrite an existing symbol.
            let symbol = scope.lookUpSymbol(name);
            if (!symbol) {
                symbol = scope.addSymbol(name,
                    SymbolFlags.InitiallyUnbound | SymbolFlags.ClassMember);

                if (this._fileInfo.isStubFile && isPrivateOrProtectedName(name)) {
                    symbol.setIsExternallyHidden();
                }

                if (addedSymbols) {
                    addedSymbols.set(name, symbol);
                }
            }

            return symbol;
        }

        return undefined;
    }

    private _bindPossibleTupleNamedTarget(target: ExpressionNode, addedSymbols?: Map<string, Symbol>) {
        switch (target.nodeType) {
            case ParseNodeType.Name: {
                this._bindNameToScope(this._currentScope, target.value, addedSymbols);
                break;
            }

            case ParseNodeType.Tuple: {
                target.expressions.forEach(expr => {
                    this._bindPossibleTupleNamedTarget(expr, addedSymbols);
                });
                break;
            }

            case ParseNodeType.List: {
                target.entries.forEach(expr => {
                    this._bindPossibleTupleNamedTarget(expr, addedSymbols);
                });
                break;
            }

            case ParseNodeType.TypeAnnotation: {
                this._bindPossibleTupleNamedTarget(target.valueExpression, addedSymbols);
                break;
            }

            case ParseNodeType.Unpack: {
                this._bindPossibleTupleNamedTarget(target.expression, addedSymbols);
                break;
            }
        }
    }

    private _addBuiltInSymbolToCurrentScope(nameValue: string,
            node: ModuleNode | ClassNode | FunctionNode, type: IntrinsicType) {

        const symbol = this._addSymbolToCurrentScope(nameValue, false);
        if (symbol) {
            symbol.addDeclaration({
                type: DeclarationType.Intrinsic,
                node,
                intrinsicType: type,
                path: this._fileInfo.filePath,
                range: getEmptyRange()
            });
            symbol.setIsIgnoredForProtocolMatch();
        }
    }

    // Adds a new symbol with the specified name if it doesn't already exist.
    private _addSymbolToCurrentScope(nameValue: string, isInitiallyUnbound: boolean) {
        let symbol = this._currentScope.lookUpSymbol(nameValue);

        if (!symbol) {
            let symbolFlags = SymbolFlags.None;

            // If the caller specified a default type source ID, it's a
            // symbol that's populated by the module loader, so it's
            // bound at the time the module starts executing.
            if (isInitiallyUnbound) {
                symbolFlags |= SymbolFlags.InitiallyUnbound;
            }

            if (this._currentScope.type === ScopeType.Class) {
                symbolFlags |= SymbolFlags.ClassMember;
            }

            if (this._fileInfo.isStubFile && isPrivateOrProtectedName(nameValue)) {
                symbolFlags |= SymbolFlags.ExternallyHidden;
            }

            // Add the symbol. Assume that symbols with a default type source ID
            // are "implicit" symbols added to the scope. These are not initially unbound.
            symbol = this._currentScope.addSymbol(nameValue, symbolFlags);
        }

        return symbol;
    }

    private _createNewScope(scopeType: ScopeType, parentScope: Scope | undefined,
            callback: () => void) {

        const prevScope = this._currentScope;
        this._currentScope = new Scope(scopeType, parentScope);

        // If this scope is an execution scope, allocate a new reference map.
        const isExecutionScope = scopeType === ScopeType.Builtin || scopeType === ScopeType.Module ||
            scopeType === ScopeType.Function;
        const prevReferenceMap = this._currentExecutionScopeReferenceMap;

        if (isExecutionScope) {
            this._currentExecutionScopeReferenceMap = new Map<string, string>();
        }

        const prevNonLocalBindings = this._notLocalBindings;
        this._notLocalBindings = new Map<string, NameBindingType>();

        callback();

        this._currentExecutionScopeReferenceMap = prevReferenceMap;
        this._currentScope = prevScope;
        this._notLocalBindings = prevNonLocalBindings;
    }

    private _addInferredTypeAssignmentForVariable(target: ExpressionNode, source: ParseNode) {
        switch (target.nodeType) {
            case ParseNodeType.Name: {
                const name = target;
                const symbolWithScope = this._currentScope.lookUpSymbolRecursive(name.value);
                if (symbolWithScope && symbolWithScope.symbol) {
                    const declaration: VariableDeclaration = {
                        type: DeclarationType.Variable,
                        node: target,
                        isConstant: isConstantName(target.value),
                        inferredTypeSource: source,
                        path: this._fileInfo.filePath,
                        range: convertOffsetsToRange(name.start, TextRange.getEnd(name), this._fileInfo.lines)
                    };
                    symbolWithScope.symbol.addDeclaration(declaration);
                }
                break;
            }

            case ParseNodeType.MemberAccess: {
                const memberAccessInfo = this._getMemberAccessInfo(target);
                if (memberAccessInfo) {
                    const name = target.memberName;

                    let symbol = memberAccessInfo.classScope.lookUpSymbol(name.value);
                    if (!symbol) {
                        symbol = memberAccessInfo.classScope.addSymbol(name.value,
                            SymbolFlags.InitiallyUnbound);
                        const honorPrivateNaming =
                            this._fileInfo.diagnosticSettings.reportPrivateUsage !== 'none';
                        if (isPrivateOrProtectedName(name.value) && honorPrivateNaming) {
                            symbol.setIsPrivateMember();
                        }
                    }

                    if (memberAccessInfo.isInstanceMember) {
                        symbol.setIsInstanceMember();
                    } else {
                        symbol.setIsClassMember();
                    }

                    const declaration: VariableDeclaration = {
                        type: DeclarationType.Variable,
                        node: target.memberName,
                        isConstant: isConstantName(name.value),
                        inferredTypeSource: source,
                        path: this._fileInfo.filePath,
                        range: convertOffsetsToRange(target.memberName.start,
                            target.memberName.start + target.memberName.length,
                            this._fileInfo.lines)
                    };
                    symbol.addDeclaration(declaration);
                }
                break;
            }

            case ParseNodeType.Tuple: {
                target.expressions.forEach(expr => {
                    this._addInferredTypeAssignmentForVariable(expr, source);
                });
                break;
            }

            case ParseNodeType.TypeAnnotation: {
                this._addInferredTypeAssignmentForVariable(target.valueExpression, source);
                break;
            }

            case ParseNodeType.Unpack: {
                this._addInferredTypeAssignmentForVariable(target.expression, source);
                break;
            }

            case ParseNodeType.List: {
                target.entries.forEach(entry => {
                    this._addInferredTypeAssignmentForVariable(entry, source);
                });
                break;
            }
        }
    }

    private _addTypeDeclarationForVariable(target: ExpressionNode, typeAnnotation: ExpressionNode) {
        let declarationHandled = false;

        switch (target.nodeType) {
            case ParseNodeType.Name: {
                const name = target;
                const symbolWithScope = this._currentScope.lookUpSymbolRecursive(name.value);
                if (symbolWithScope && symbolWithScope.symbol) {
                    const finalInfo = this._isAnnotationFinal(typeAnnotation);
                    const declaration: VariableDeclaration = {
                        type: DeclarationType.Variable,
                        node: target,
                        isConstant: isConstantName(name.value),
                        isFinal: finalInfo.isFinal,
                        path: this._fileInfo.filePath,
                        typeAnnotationNode: finalInfo.isFinal ?
                            finalInfo.finalTypeNode : typeAnnotation,
                        range: convertOffsetsToRange(name.start, TextRange.getEnd(name), this._fileInfo.lines)
                    };
                    symbolWithScope.symbol.addDeclaration(declaration);
                }

                declarationHandled = true;
                break;
            }

            case ParseNodeType.MemberAccess: {
                // We need to determine whether this expression is declaring a class or
                // instance variable. This is difficult because python doesn't provide
                // a keyword for accessing "this". Instead, it uses naming conventions
                // of "cls" and "self", but we don't want to rely on these naming
                // conventions here. Instead, we'll apply some heuristics to determine
                // whether the symbol on the LHS is a reference to the current class
                // or an instance of the current class.

                const memberAccessInfo = this._getMemberAccessInfo(target);
                if (memberAccessInfo) {
                    const name = target.memberName;

                    let symbol = memberAccessInfo.classScope.lookUpSymbol(name.value);
                    if (!symbol) {
                        symbol = memberAccessInfo.classScope.addSymbol(name.value,
                            SymbolFlags.InitiallyUnbound);
                        const honorPrivateNaming =
                            this._fileInfo.diagnosticSettings.reportPrivateUsage !== 'none';
                        if (isPrivateOrProtectedName(name.value) && honorPrivateNaming) {
                            symbol.setIsPrivateMember();
                        }
                    }

                    if (memberAccessInfo.isInstanceMember) {
                        symbol.setIsInstanceMember();
                    } else {
                        symbol.setIsClassMember();
                    }

                    const finalInfo = this._isAnnotationFinal(typeAnnotation);
                    const declaration: VariableDeclaration = {
                        type: DeclarationType.Variable,
                        node: target.memberName,
                        isConstant: isConstantName(name.value),
                        isFinal: finalInfo.isFinal,
                        path: this._fileInfo.filePath,
                        typeAnnotationNode: finalInfo.isFinal ?
                            finalInfo.finalTypeNode : typeAnnotation,
                        range: convertOffsetsToRange(target.memberName.start,
                            target.memberName.start + target.memberName.length,
                            this._fileInfo.lines)
                    };
                    symbol.addDeclaration(declaration);

                    declarationHandled = true;
                }
                break;
            }
        }

        if (!declarationHandled) {
            this._addError(
                `Type annotation not supported for this type of expression`,
                typeAnnotation);
        }
    }

    // Determines if the specified type annotation expression is a "Final".
    // It returns two boolean values indicating if the expression is a "Final"
    // expression and whether it's a "raw" Final with no type arguments.
    private _isAnnotationFinal(typeAnnotation: ExpressionNode | undefined): FinalInfo {
        let isFinal = false;
        let finalTypeNode: ExpressionNode | undefined;

        if (typeAnnotation) {
            if (typeAnnotation.nodeType === ParseNodeType.Name) {
                // We need to make an assumption in this code that the symbol "Final"
                // will resolve to typing.Final. This is because of the poor way
                // the "Final" support was specified. We need to evaluate it
                // in the binder before we have a way to resolve symbol names.
                if (typeAnnotation.value === 'Final') {
                    isFinal = true;
                }
            } else if (typeAnnotation.nodeType === ParseNodeType.MemberAccess) {
                if (typeAnnotation.leftExpression.nodeType === ParseNodeType.Name &&
                    typeAnnotation.leftExpression.value === 'typing' &&
                    typeAnnotation.memberName.value === 'Final') {

                    isFinal = true;
                }
            } else if (typeAnnotation.nodeType === ParseNodeType.Index &&
                    typeAnnotation.items.items.length === 1) {

                // Recursively call to see if the base expression is "Final".
                const finalInfo = this._isAnnotationFinal(typeAnnotation.baseExpression);
                if (finalInfo.isFinal) {
                    isFinal = true;
                    finalTypeNode = typeAnnotation.items.items[0];
                }
            }
        }

        return { isFinal, finalTypeNode };
    }

    // Determines whether a member access expression is referring to a
    // member of a class (either a class or instance member). This will
    // typically take the form "self.x" or "cls.x".
    private _getMemberAccessInfo(node: MemberAccessNode): MemberAccessInfo | undefined {
        // We handle only simple names on the left-hand side of the expression,
        // not calls, nested member accesses, index expressions, etc.
        if (node.leftExpression.nodeType !== ParseNodeType.Name) {
            return undefined;
        }

        const leftSymbolName = node.leftExpression.value;

        // Make sure the expression is within a function (i.e. a method) that's
        // within a class definition.
        const methodNode = ParseTreeUtils.getEnclosingFunction(node);
        if (!methodNode) {
            return undefined;
        }

        const classNode = ParseTreeUtils.getEnclosingClass(methodNode);
        if (!classNode) {
            return undefined;
        }

        // Determine whether the left-hand side indicates a class or
        // instance member.
        let isInstanceMember = false;

        if (methodNode.parameters.length < 1 || !methodNode.parameters[0].name) {
            return undefined;
        }

        const className = classNode.name.value;
        const firstParamName = methodNode.parameters[0].name.value;

        if (leftSymbolName === className) {
            isInstanceMember = false;
        } else {
            if (leftSymbolName !== firstParamName) {
                return undefined;
            }

            // To determine whether the first parameter of the method
            // refers to the class or the instance, we need to apply
            // some heuristics.
            if (methodNode.name.value === '__new__') {
                // The __new__ method is special. It acts as a classmethod even
                // though it doesn't have a @classmethod decorator.
                isInstanceMember = false;
            } else {
                // Assume that it's an instance member unless we find
                // a decorator that tells us otherwise.
                isInstanceMember = true;
                for (const decorator of methodNode.decorators) {
                    if (decorator.leftExpression.nodeType === ParseNodeType.Name) {
                        const decoratorName = decorator.leftExpression.value;

                        if (decoratorName === 'staticmethod') {
                            // A static method doesn't have a "self" or "cls" parameter.
                            return undefined;
                        } else if (decoratorName === 'classmethod') {
                            // A classmethod implies that the first parameter is "cls".
                            isInstanceMember = false;
                            break;
                        }
                    }
                }
            }
        }

        const classScope = AnalyzerNodeInfo.getScope(classNode)!;
        assert(classScope !== undefined);

        return {
            classNode,
            methodNode,
            classScope,
            isInstanceMember
        };
    }

    private _addImplicitImportsToLoaderActions(importResult: ImportResult, loaderActions: ModuleLoaderActions) {
        importResult.implicitImports.forEach(implicitImport => {
            const existingLoaderAction = loaderActions.implicitImports ?
                loaderActions.implicitImports.get(implicitImport.name) :
                undefined;
            if (existingLoaderAction) {
                existingLoaderAction.path = implicitImport.path;
            } else {
                if (!loaderActions.implicitImports) {
                    loaderActions.implicitImports = new Map<string, ModuleLoaderActions>();
                }
                loaderActions.implicitImports.set(implicitImport.name, {
                    path: implicitImport.path,
                    implicitImports: new Map<string, ModuleLoaderActions>()
                });
            }
        });
    }

    // Handles some special-case assignment statements that are found
    // within the typings.pyi file.
    private _handleTypingStubAssignmentOrAnnotation(node: AssignmentNode | TypeAnnotationNode) {
        if (!this._fileInfo.isTypingStubFile) {
            return false;
        }

        let annotationNode: TypeAnnotationNode;

        if (node.nodeType === ParseNodeType.TypeAnnotation) {
            annotationNode = node;
        } else {
            if (node.leftExpression.nodeType !== ParseNodeType.TypeAnnotation) {
                return false;
            }

            annotationNode = node.leftExpression;
        }

        if (annotationNode.valueExpression.nodeType !== ParseNodeType.Name) {
            return false;
        }

        const assignedNameNode = annotationNode.valueExpression;
        const specialTypes: { [name: string]: boolean } = {
            'Tuple': true,
            'Generic': true,
            'Protocol': true,
            'Callable': true,
            'Type': true,
            'ClassVar': true,
            'Final': true,
            'Literal': true,
            'TypedDict': true
        };

        const assignedName = assignedNameNode.value;

        if (!specialTypes[assignedName]) {
            return false;
        }
        const symbol = this._bindNameToScope(this._currentScope, assignedName);

        if (symbol) {
            symbol.addDeclaration({
                type: DeclarationType.SpecialBuiltInClass,
                node: annotationNode,
                path: this._fileInfo.filePath,
                range: convertOffsetsToRange(annotationNode.start,
                    TextRange.getEnd(annotationNode), this._fileInfo.lines)
            });
        }
        return true;
    }

    private _deferBinding(callback: () => void) {
        this._deferredBindingTasks.push({
            scope: this._currentScope,
            nonLocalBindingsMap: this._notLocalBindings,
            codeFlowExpressionMap: this._currentExecutionScopeReferenceMap,
            callback
        });
    }

    private _bindDeferred() {
        while (this._deferredBindingTasks.length > 0) {
            const nextItem = this._deferredBindingTasks.shift()!;

            // Reset the state
            this._currentScope = nextItem.scope;
            this._notLocalBindings = nextItem.nonLocalBindingsMap;
            this._nestedExceptDepth = 0;
            this._currentExecutionScopeReferenceMap = nextItem.codeFlowExpressionMap;

            nextItem.callback();
        }
    }

    private _bindYield(node: YieldNode | YieldFromNode) {
        const functionNode = ParseTreeUtils.getEnclosingFunction(node);

        if (!functionNode) {
            this._addError(
                `'yield' not allowed outside of a function`, node);
        } else if (functionNode.isAsync && node.nodeType === ParseNodeType.YieldFrom) {
            // PEP 525 indicates that 'yield from' is not allowed in an
            // async function.
            this._addError(
                `'yield from' not allowed in an async function`, node);
        }

        if (this._targetFunctionDeclaration) {
            if (!this._targetFunctionDeclaration.yieldExpressions) {
                this._targetFunctionDeclaration.yieldExpressions = [];
            }
            this._targetFunctionDeclaration.yieldExpressions.push(node);
            this._targetFunctionDeclaration.isGenerator = true;
        }

        if (node.expression) {
            this.walk(node.expression);
        }

        AnalyzerNodeInfo.setFlowNode(node, this._currentFlowNode);
    }

    private _addDiagnostic(diagLevel: DiagnosticLevel, rule: string,
            message: string, textRange: TextRange) {

        if (diagLevel === 'error') {
            const diagnostic = this._addError(message, textRange);
            diagnostic.setRule(rule);
            return diagnostic;
        } else if (diagLevel === 'warning') {
            const diagnostic = this._addWarning(message, textRange);
            diagnostic.setRule(rule);
            return diagnostic;
        }
        return undefined;
    }

    private _addUnusedCode(textRange: TextRange) {
        return this._fileInfo.diagnosticSink.addUnusedCodeWithTextRange(
            'Code is unreachable', textRange);
    }

    private _addError(message: string, textRange: TextRange) {
        return this._fileInfo.diagnosticSink.addErrorWithTextRange(message, textRange);
    }

    private _addWarning(message: string, textRange: TextRange) {
        return this._fileInfo.diagnosticSink.addWarningWithTextRange(message, textRange);
    }
}

export class YieldFinder extends ParseTreeWalker {
    private _containsYield = false;

    checkContainsYield(node: ParseNode) {
        this.walk(node);
        return this._containsYield;
    }

    visitYield(node: YieldNode): boolean {
        this._containsYield = true;
        return false;
    }

    visitYieldFrom(node: YieldFromNode): boolean {
        this._containsYield = true;
        return false;
    }
}
