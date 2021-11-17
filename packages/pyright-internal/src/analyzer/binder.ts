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

import { Commands } from '../commands/commands';
import { DiagnosticLevel } from '../common/configOptions';
import { assert, assertNever, fail } from '../common/debug';
import { CreateTypeStubFileAction, Diagnostic } from '../common/diagnostic';
import { DiagnosticRule } from '../common/diagnosticRules';
import { getFileName, stripFileExtension } from '../common/pathUtils';
import { convertOffsetsToRange } from '../common/positionUtils';
import { getEmptyRange } from '../common/textRange';
import { TextRange } from '../common/textRange';
import { Localizer } from '../localization/localize';
import {
    ArgumentCategory,
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
    ContinueNode,
    DelNode,
    ExceptNode,
    ExpressionNode,
    ForNode,
    FunctionNode,
    GlobalNode,
    IfNode,
    ImportAsNode,
    ImportFromNode,
    IndexNode,
    LambdaNode,
    ListComprehensionNode,
    MatchNode,
    MemberAccessNode,
    ModuleNameNode,
    ModuleNode,
    NameNode,
    NonlocalNode,
    ParseNode,
    ParseNodeType,
    PatternAsNode,
    PatternCaptureNode,
    PatternMappingExpandEntryNode,
    RaiseNode,
    ReturnNode,
    StatementNode,
    StringListNode,
    StringNode,
    SuiteNode,
    TernaryNode,
    TryNode,
    TypeAnnotationNode,
    UnaryOperationNode,
    WhileNode,
    WithNode,
    YieldFromNode,
    YieldNode,
} from '../parser/parseNodes';
import { KeywordType, OperatorType } from '../parser/tokenizerTypes';
import { AnalyzerFileInfo, ImportLookupResult } from './analyzerFileInfo';
import * as AnalyzerNodeInfo from './analyzerNodeInfo';
import {
    CodeFlowReferenceExpressionNode,
    createKeyForReference,
    FlowAssignment,
    FlowAssignmentAlias,
    FlowBranchLabel,
    FlowCall,
    FlowCondition,
    FlowExhaustedMatch,
    FlowFlags,
    FlowLabel,
    FlowNarrowForPattern,
    FlowNode,
    FlowPostContextManagerLabel,
    FlowPostFinally,
    FlowPreFinallyGate,
    FlowVariableAnnotation,
    FlowWildcardImport,
    getUniqueFlowNodeId,
    isCodeFlowSupportedForReference,
} from './codeFlowTypes';
import {
    AliasDeclaration,
    ClassDeclaration,
    DeclarationType,
    FunctionDeclaration,
    IntrinsicType,
    ModuleLoaderActions,
    ParameterDeclaration,
    VariableDeclaration,
} from './declaration';
import { ImplicitImport, ImportResult, ImportType } from './importResult';
import * as ParseTreeUtils from './parseTreeUtils';
import { ParseTreeWalker } from './parseTreeWalker';
import { NameBindingType, Scope, ScopeType } from './scope';
import * as StaticExpressions from './staticExpressions';
import { indeterminateSymbolId, Symbol, SymbolFlags } from './symbol';
import { isConstantName, isPrivateName, isPrivateOrProtectedName } from './symbolNameUtils';

interface MemberAccessInfo {
    classNode: ClassNode;
    methodNode: FunctionNode;
    classScope: Scope;
    isInstanceMember: boolean;
}

interface DeferredBindingTask {
    scope: Scope;
    codeFlowExpressions: Set<string>;
    callback: () => void;
}

interface FinalInfo {
    isFinal: boolean;
    finalTypeNode: ExpressionNode | undefined;
}

interface ClassVarInfo {
    isClassVar: boolean;
    classVarTypeNode: ExpressionNode | undefined;
}

export class Binder extends ParseTreeWalker {
    private readonly _fileInfo: AnalyzerFileInfo;

    // A queue of deferred analysis operations.
    private _deferredBindingTasks: DeferredBindingTask[] = [];

    // The current scope in effect.
    private _currentScope!: Scope;

    // Current control-flow node.
    private _currentFlowNode: FlowNode | undefined;

    // Current target function declaration, if currently binding
    // a function. This allows return and yield statements to be
    // added to the function declaration.
    private _targetFunctionDeclaration: FunctionDeclaration | undefined;

    // Flow node label that is the target of a "break" statement.
    private _currentBreakTarget: FlowLabel | undefined;

    // Flow node label that is the target of a "continue" statement.
    private _currentContinueTarget: FlowLabel | undefined;

    // Flow nodes used for if/else and while/else statements.
    private _currentTrueTarget: FlowLabel | undefined;
    private _currentFalseTarget: FlowLabel | undefined;

    // Flow nodes used within try blocks.
    private _currentExceptTargets: FlowLabel[] = [];

    // Flow nodes used within try/finally flows.
    private _finallyTargets: FlowLabel[] = [];

    // Flow nodes used for return statements.
    private _currentReturnTarget: FlowLabel | undefined;

    // Set of expressions within the current execution scope
    // and require code flow analysis to resolve.
    private _currentScopeCodeFlowExpressions: Set<string> | undefined;

    // Aliases of "typing" and "typing_extensions".
    private _typingImportAliases: string[] = [];

    // Aliases of "sys".
    private _sysImportAliases: string[] = [];

    // Aliases of "dataclasses".
    private _dataclassesImportAliases: string[] = [];

    // Map of imports of specific symbols imported from "typing" and "typing_extensions"
    // and the names they alias to.
    private _typingSymbolAliases: Map<string, string> = new Map<string, string>();

    // Map of imports of specific symbols imported from "dataclasses"
    // and the names they alias to.
    private _dataclassesSymbolAliases: Map<string, string> = new Map<string, string>();

    // List of names statically assigned to __all__ symbol.
    private _dunderAllNames: string[] | undefined;

    // List of string nodes associated with the "__all__" symbol.
    private _dunderAllStringNodes: StringNode[] = [];

    // Flow node that is used for unreachable code.
    private static _unreachableFlowNode: FlowNode = {
        flags: FlowFlags.Unreachable,
        id: getUniqueFlowNodeId(),
    };

    // Map of symbols at the module level that may be externally
    // hidden depending on whether they are listed in the __all__ list.
    private _potentialHiddenSymbols = new Map<string, Symbol>();

    // Map of symbols at the module level that may be private depending
    // on whether they are listed in the __all__ list.
    private _potentialPrivateSymbols = new Map<string, Symbol>();

    // Estimates the overall complexity of the code flow graph for
    // the current function.
    private _functionCodeFlowComplexity = 0;

    constructor(fileInfo: AnalyzerFileInfo, private _moduleSymbolOnly = false) {
        super();

        this._fileInfo = fileInfo;
    }

    bindModule(node: ModuleNode): void {
        // We'll assume that if there is no builtins scope provided, we must be
        // binding the builtins module itself.
        const isBuiltInModule = this._fileInfo.builtinsScope === undefined;

        this._createNewScope(
            isBuiltInModule ? ScopeType.Builtin : ScopeType.Module,
            this._fileInfo.builtinsScope,
            () => {
                AnalyzerNodeInfo.setScope(node, this._currentScope);
                AnalyzerNodeInfo.setFlowNode(node, this._currentFlowNode!);

                // Bind implicit names.
                // List taken from https://docs.python.org/3/reference/import.html#__name__
                this._addBuiltInSymbolToCurrentScope('__doc__', node, 'str | None');
                this._addBuiltInSymbolToCurrentScope('__name__', node, 'str');
                this._addBuiltInSymbolToCurrentScope('__loader__', node, 'Any');
                this._addBuiltInSymbolToCurrentScope('__package__', node, 'str');
                this._addBuiltInSymbolToCurrentScope('__spec__', node, 'Any');
                this._addBuiltInSymbolToCurrentScope('__path__', node, 'Iterable[str]');
                this._addBuiltInSymbolToCurrentScope('__file__', node, 'str');
                this._addBuiltInSymbolToCurrentScope('__cached__', node, 'str');
                this._addBuiltInSymbolToCurrentScope('__dict__', node, 'Dict[str, Any]');
                this._addBuiltInSymbolToCurrentScope('__annotations__', node, 'Dict[str, Any]');
                this._addBuiltInSymbolToCurrentScope('__builtins__', node, 'Any');

                // Create a start node for the module.
                this._currentFlowNode = this._createStartFlowNode();

                this._walkStatementsAndReportUnreachable(node.statements);

                AnalyzerNodeInfo.setCodeFlowExpressions(node, this._currentScopeCodeFlowExpressions!);

                // Associate the code flow node at the end of the module with the module.
                AnalyzerNodeInfo.setAfterFlowNode(node, this._currentFlowNode);
            }
        );

        // Perform all analysis that was deferred during the first pass.
        this._bindDeferred();

        // Use the __all__ list to determine whether any potential private
        // symbols should be made externally hidden or private.
        this._potentialHiddenSymbols.forEach((symbol, name) => {
            if (!this._dunderAllNames?.some((sym) => sym === name)) {
                if (this._fileInfo.isStubFile) {
                    symbol.setIsExternallyHidden();
                } else {
                    symbol.setPrivatePyTypedImport();
                }
            }
        });

        this._potentialPrivateSymbols.forEach((symbol, name) => {
            if (!this._dunderAllNames?.some((sym) => sym === name)) {
                symbol.setIsPrivateMember();
            }
        });

        if (this._dunderAllNames) {
            AnalyzerNodeInfo.setDunderAllInfo(node, {
                names: this._dunderAllNames,
                stringNodes: this._dunderAllStringNodes,
            });
        } else {
            AnalyzerNodeInfo.setDunderAllInfo(node, undefined);
        }

        // Set __all__ flags on the module symbols.
        const scope = AnalyzerNodeInfo.getScope(node);
        if (scope && this._dunderAllNames) {
            for (const name of this._dunderAllNames) {
                scope.symbolTable.get(name)?.setIsInDunderAll();
            }
        }
    }

    override visitModule(node: ModuleNode): boolean {
        // Tree walking should start with the children of
        // the node, so we should never get here.
        fail('We should never get here');
        return false;
    }

    override visitSuite(node: SuiteNode): boolean {
        this._walkStatementsAndReportUnreachable(node.statements);
        return false;
    }

    override visitModuleName(node: ModuleNameNode): boolean {
        const importResult = AnalyzerNodeInfo.getImportInfo(node);
        assert(importResult !== undefined);

        if (!importResult || importResult.isNativeLib) {
            return true;
        }

        if (!importResult.isImportFound) {
            this._addDiagnostic(
                this._fileInfo.diagnosticRuleSet.reportMissingImports,
                DiagnosticRule.reportMissingImports,
                Localizer.Diagnostic.importResolveFailure().format({ importName: importResult.importName }),
                node
            );
            return true;
        }

        // Source found, but type stub is missing
        if (
            !importResult.isStubFile &&
            importResult.importType === ImportType.ThirdParty &&
            !importResult.pyTypedInfo
        ) {
            const diagnostic = this._addDiagnostic(
                this._fileInfo.diagnosticRuleSet.reportMissingTypeStubs,
                DiagnosticRule.reportMissingTypeStubs,
                Localizer.Diagnostic.stubFileMissing().format({ importName: importResult.importName }),
                node
            );
            if (diagnostic) {
                // Add a diagnostic action for resolving this diagnostic.
                const createTypeStubAction: CreateTypeStubFileAction = {
                    action: Commands.createTypeStub,
                    moduleName: importResult.importName,
                };
                diagnostic.addAction(createTypeStubAction);
            }
        }

        // Type stub found, but source is missing.
        if (
            importResult.isStubFile &&
            importResult.importType !== ImportType.BuiltIn &&
            importResult.nonStubImportResult &&
            !importResult.nonStubImportResult.isImportFound
        ) {
            // Don't report this for stub files.
            if (!this._fileInfo.isStubFile) {
                this._addDiagnostic(
                    this._fileInfo.diagnosticRuleSet.reportMissingModuleSource,
                    DiagnosticRule.reportMissingModuleSource,
                    Localizer.Diagnostic.importSourceResolveFailure().format({
                        importName: importResult.importName,
                    }),
                    node
                );
            }
        }

        return true;
    }

    override visitClass(node: ClassNode): boolean {
        this.walkMultiple(node.decorators);

        const classDeclaration: ClassDeclaration = {
            type: DeclarationType.Class,
            node,
            path: this._fileInfo.filePath,
            range: convertOffsetsToRange(node.name.start, TextRange.getEnd(node.name), this._fileInfo.lines),
            moduleName: this._fileInfo.moduleName,
        };

        const symbol = this._bindNameToScope(this._currentScope, node.name.value);
        if (symbol) {
            symbol.addDeclaration(classDeclaration);
        }

        // Stash the declaration in the parse node for later access.
        AnalyzerNodeInfo.setDeclaration(node, classDeclaration);

        this.walkMultiple(node.arguments);

        // For nested classes, use the scope that contains the outermost
        // class rather than the immediate parent.
        let parentScope = this._currentScope;
        while (parentScope.type === ScopeType.Class) {
            parentScope = parentScope.parent!;
        }

        this._createNewScope(ScopeType.Class, parentScope, () => {
            AnalyzerNodeInfo.setScope(node, this._currentScope);

            this._addBuiltInSymbolToCurrentScope('__doc__', node, 'str | None');
            this._addBuiltInSymbolToCurrentScope('__module__', node, 'str');

            if (!this._moduleSymbolOnly) {
                // Analyze the suite.
                this.walk(node.suite);
            }
        });

        this._createAssignmentTargetFlowNodes(node.name, /* walkTargets */ false, /* unbound */ false);

        return false;
    }

    override visitFunction(node: FunctionNode): boolean {
        AnalyzerNodeInfo.setFlowNode(node, this._currentFlowNode!);

        const symbol = this._bindNameToScope(this._currentScope, node.name.value);
        const containingClassNode = ParseTreeUtils.getEnclosingClass(node, true);
        const functionDeclaration: FunctionDeclaration = {
            type: DeclarationType.Function,
            node,
            isMethod: !!containingClassNode,
            isGenerator: false,
            path: this._fileInfo.filePath,
            range: convertOffsetsToRange(node.name.start, TextRange.getEnd(node.name), this._fileInfo.lines),
            moduleName: this._fileInfo.moduleName,
        };

        if (symbol) {
            symbol.addDeclaration(functionDeclaration);
        }

        // Stash the declaration in the parse node for later access.
        AnalyzerNodeInfo.setDeclaration(node, functionDeclaration);

        this.walkMultiple(node.decorators);
        node.parameters.forEach((param) => {
            if (param.defaultValue) {
                this.walk(param.defaultValue);
            }

            if (param.typeAnnotation) {
                this.walk(param.typeAnnotation);
            }

            if (param.typeAnnotationComment) {
                this.walk(param.typeAnnotationComment);
            }
        });

        if (node.returnTypeAnnotation) {
            this.walk(node.returnTypeAnnotation);
        }

        if (node.functionAnnotationComment) {
            this.walk(node.functionAnnotationComment);
        }

        // Find the function or module that contains this function and use its scope.
        // We can't simply use this._currentScope because functions within a class use
        // the scope of the containing function or module when they execute.
        let functionOrModuleNode: ParseNode | undefined = node.parent;
        while (functionOrModuleNode) {
            if (
                functionOrModuleNode.nodeType === ParseNodeType.Module ||
                functionOrModuleNode.nodeType === ParseNodeType.Function
            ) {
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

            const enclosingClass = ParseTreeUtils.getEnclosingClass(node);
            if (enclosingClass) {
                // Add the implicit "__class__" symbol described in PEP 3135.
                this._addBuiltInSymbolToCurrentScope('__class__', node, 'class');
            }

            this._deferBinding(() => {
                // Create a start node for the function.
                this._currentFlowNode = this._createStartFlowNode();
                this._functionCodeFlowComplexity = 0;

                node.parameters.forEach((paramNode) => {
                    if (paramNode.name) {
                        const symbol = this._bindNameToScope(this._currentScope, paramNode.name.value);
                        if (symbol) {
                            const paramDeclaration: ParameterDeclaration = {
                                type: DeclarationType.Parameter,
                                node: paramNode,
                                path: this._fileInfo.filePath,
                                range: convertOffsetsToRange(
                                    paramNode.start,
                                    TextRange.getEnd(paramNode),
                                    this._fileInfo.lines
                                ),
                                moduleName: this._fileInfo.moduleName,
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

                AnalyzerNodeInfo.setCodeFlowExpressions(node, this._currentScopeCodeFlowExpressions!);
                AnalyzerNodeInfo.setCodeFlowComplexity(node, this._functionCodeFlowComplexity);
            });
        });

        this._createAssignmentTargetFlowNodes(node.name, /* walkTargets */ false, /* unbound */ false);

        // We'll walk the child nodes in a deferred manner, so don't walk them now.
        return false;
    }

    override visitLambda(node: LambdaNode): boolean {
        AnalyzerNodeInfo.setFlowNode(node, this._currentFlowNode!);

        // Analyze the parameter defaults in the context of the parent's scope
        // before we add any names from the function's scope.
        node.parameters.forEach((param) => {
            if (param.defaultValue) {
                this.walk(param.defaultValue);
            }
        });

        this._createNewScope(ScopeType.Function, this._currentScope, () => {
            AnalyzerNodeInfo.setScope(node, this._currentScope);

            this._deferBinding(() => {
                // Create a start node for the lambda.
                this._currentFlowNode = this._createStartFlowNode();

                node.parameters.forEach((paramNode) => {
                    if (paramNode.name) {
                        const symbol = this._bindNameToScope(this._currentScope, paramNode.name.value);
                        if (symbol) {
                            const paramDeclaration: ParameterDeclaration = {
                                type: DeclarationType.Parameter,
                                node: paramNode,
                                path: this._fileInfo.filePath,
                                range: convertOffsetsToRange(
                                    paramNode.start,
                                    TextRange.getEnd(paramNode),
                                    this._fileInfo.lines
                                ),
                                moduleName: this._fileInfo.moduleName,
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

                AnalyzerNodeInfo.setCodeFlowExpressions(node, this._currentScopeCodeFlowExpressions!);
            });
        });

        // We'll walk the child nodes in a deferred manner.
        return false;
    }

    override visitCall(node: CallNode): boolean {
        this._disableTrueFalseTargets(() => {
            this.walk(node.leftExpression);
            this.walkMultiple(node.arguments);
        });
        this._createCallFlowNode(node);

        // Is this an manipulation of dunder all?
        if (
            this._currentScope.type === ScopeType.Module &&
            node.leftExpression.nodeType === ParseNodeType.MemberAccess &&
            node.leftExpression.leftExpression.nodeType === ParseNodeType.Name &&
            node.leftExpression.leftExpression.value === '__all__'
        ) {
            let emitDunderAllWarning = true;

            // Is this a call to "__all__.extend()"?
            if (node.leftExpression.memberName.value === 'extend' && node.arguments.length === 1) {
                const argExpr = node.arguments[0].valueExpression;

                // Is this a call to "__all__.extend([<list>])"?
                if (argExpr.nodeType === ParseNodeType.List) {
                    argExpr.entries.forEach((listEntryNode) => {
                        if (
                            listEntryNode.nodeType === ParseNodeType.StringList &&
                            listEntryNode.strings.length === 1 &&
                            listEntryNode.strings[0].nodeType === ParseNodeType.String
                        ) {
                            this._dunderAllNames?.push(listEntryNode.strings[0].value);
                            this._dunderAllStringNodes?.push(listEntryNode.strings[0]);
                            emitDunderAllWarning = false;
                        }
                    });
                } else if (
                    argExpr.nodeType === ParseNodeType.MemberAccess &&
                    argExpr.leftExpression.nodeType === ParseNodeType.Name &&
                    argExpr.memberName.value === '__all__'
                ) {
                    // Is this a call to "__all__.extend(<mod>.__all__)"?
                    const namesToAdd = this._getDunderAllNamesFromImport(argExpr.leftExpression.value);
                    if (namesToAdd && namesToAdd.length > 0) {
                        namesToAdd.forEach((name) => {
                            this._dunderAllNames?.push(name);
                        });
                        emitDunderAllWarning = false;
                    }
                }
            } else if (node.leftExpression.memberName.value === 'remove' && node.arguments.length === 1) {
                // Is this a call to "__all__.remove()"?
                const argExpr = node.arguments[0].valueExpression;
                if (
                    argExpr.nodeType === ParseNodeType.StringList &&
                    argExpr.strings.length === 1 &&
                    argExpr.strings[0].nodeType === ParseNodeType.String &&
                    this._dunderAllNames
                ) {
                    this._dunderAllNames = this._dunderAllNames.filter((name) => name !== argExpr.strings[0].value);
                    this._dunderAllStringNodes = this._dunderAllStringNodes.filter(
                        (node) => node.value !== argExpr.strings[0].value
                    );
                    emitDunderAllWarning = false;
                }
            } else if (node.leftExpression.memberName.value === 'append' && node.arguments.length === 1) {
                // Is this a call to "__all__.append()"?
                const argExpr = node.arguments[0].valueExpression;
                if (
                    argExpr.nodeType === ParseNodeType.StringList &&
                    argExpr.strings.length === 1 &&
                    argExpr.strings[0].nodeType === ParseNodeType.String
                ) {
                    this._dunderAllNames?.push(argExpr.strings[0].value);
                    this._dunderAllStringNodes?.push(argExpr.strings[0]);
                    emitDunderAllWarning = false;
                }
            }

            if (emitDunderAllWarning) {
                this._addDiagnostic(
                    this._fileInfo.diagnosticRuleSet.reportUnsupportedDunderAll,
                    DiagnosticRule.reportUnsupportedDunderAll,
                    Localizer.Diagnostic.unsupportedDunderAllOperation(),
                    node
                );
            }
        }

        return false;
    }

    override visitAssignment(node: AssignmentNode): boolean {
        if (this._handleTypingStubAssignmentOrAnnotation(node)) {
            return false;
        }

        this._bindPossibleTupleNamedTarget(node.leftExpression);

        if (node.typeAnnotationComment) {
            this.walk(node.typeAnnotationComment);
            this._addTypeDeclarationForVariable(node.leftExpression, node.typeAnnotationComment);
        }

        this.walk(node.rightExpression);

        let isPossibleTypeAlias = true;
        if (ParseTreeUtils.getEnclosingFunction(node)) {
            // We will assume that type aliases are defined only at the module level
            // or as class variables, not as local variables within a function.
            isPossibleTypeAlias = false;
        } else if (node.rightExpression.nodeType === ParseNodeType.Call && this._fileInfo.isTypingStubFile) {
            // Some special built-in types defined in typing.pyi use
            // assignments of the form List = _Alias(). We don't want to
            // treat these as type aliases.
            isPossibleTypeAlias = false;
        } else if (ParseTreeUtils.isWithinLoop(node)) {
            // Assume that it's not a type alias if it's within a loop.
            isPossibleTypeAlias = false;
        }

        this._addInferredTypeAssignmentForVariable(node.leftExpression, node.rightExpression, isPossibleTypeAlias);

        this._createAssignmentTargetFlowNodes(node.leftExpression, /* walkTargets */ true, /* unbound */ false);

        // Is this an assignment to dunder all?
        if (this._currentScope.type === ScopeType.Module) {
            if (
                (node.leftExpression.nodeType === ParseNodeType.Name && node.leftExpression.value === '__all__') ||
                (node.leftExpression.nodeType === ParseNodeType.TypeAnnotation &&
                    node.leftExpression.valueExpression.nodeType === ParseNodeType.Name &&
                    node.leftExpression.valueExpression.value === '__all__')
            ) {
                const expr = node.rightExpression;
                this._dunderAllNames = [];
                let emitDunderAllWarning = false;

                if (expr.nodeType === ParseNodeType.List) {
                    expr.entries.forEach((listEntryNode) => {
                        if (
                            listEntryNode.nodeType === ParseNodeType.StringList &&
                            listEntryNode.strings.length === 1 &&
                            listEntryNode.strings[0].nodeType === ParseNodeType.String
                        ) {
                            this._dunderAllNames!.push(listEntryNode.strings[0].value);
                            this._dunderAllStringNodes.push(listEntryNode.strings[0]);
                        } else {
                            emitDunderAllWarning = true;
                        }
                    });
                } else if (expr.nodeType === ParseNodeType.Tuple) {
                    expr.expressions.forEach((tupleEntryNode) => {
                        if (
                            tupleEntryNode.nodeType === ParseNodeType.StringList &&
                            tupleEntryNode.strings.length === 1 &&
                            tupleEntryNode.strings[0].nodeType === ParseNodeType.String
                        ) {
                            this._dunderAllNames!.push(tupleEntryNode.strings[0].value);
                            this._dunderAllStringNodes.push(tupleEntryNode.strings[0]);
                        } else {
                            emitDunderAllWarning = true;
                        }
                    });
                } else {
                    emitDunderAllWarning = true;
                }

                if (emitDunderAllWarning) {
                    this._addDiagnostic(
                        this._fileInfo.diagnosticRuleSet.reportUnsupportedDunderAll,
                        DiagnosticRule.reportUnsupportedDunderAll,
                        Localizer.Diagnostic.unsupportedDunderAllOperation(),
                        node
                    );
                }
            }
        }

        // Is this an assignment to dunder slots?
        if (this._currentScope.type === ScopeType.Class) {
            if (
                (node.leftExpression.nodeType === ParseNodeType.Name && node.leftExpression.value === '__slots__') ||
                (node.leftExpression.nodeType === ParseNodeType.TypeAnnotation &&
                    node.leftExpression.valueExpression.nodeType === ParseNodeType.Name &&
                    node.leftExpression.valueExpression.value === '__slots__')
            ) {
                const expr = node.rightExpression;
                const dunderSlotsNames: StringListNode[] = [];
                let isExpressionUnderstood = true;

                if (expr.nodeType === ParseNodeType.StringList) {
                    dunderSlotsNames.push(expr);
                } else if (expr.nodeType === ParseNodeType.List) {
                    expr.entries.forEach((listEntryNode) => {
                        if (
                            listEntryNode.nodeType === ParseNodeType.StringList &&
                            listEntryNode.strings.length === 1 &&
                            listEntryNode.strings[0].nodeType === ParseNodeType.String
                        ) {
                            dunderSlotsNames.push(listEntryNode);
                        } else {
                            isExpressionUnderstood = false;
                        }
                    });
                } else if (expr.nodeType === ParseNodeType.Tuple) {
                    expr.expressions.forEach((tupleEntryNode) => {
                        if (
                            tupleEntryNode.nodeType === ParseNodeType.StringList &&
                            tupleEntryNode.strings.length === 1 &&
                            tupleEntryNode.strings[0].nodeType === ParseNodeType.String
                        ) {
                            dunderSlotsNames.push(tupleEntryNode);
                        } else {
                            isExpressionUnderstood = false;
                        }
                    });
                } else {
                    isExpressionUnderstood = false;
                }

                if (isExpressionUnderstood) {
                    this._addSlotsToCurrentScope(dunderSlotsNames);
                }
            }
        }

        return false;
    }

    override visitAssignmentExpression(node: AssignmentExpressionNode) {
        // Temporarily disable true/false targets in case this assignment
        // expression is located within an if/else conditional.
        this._disableTrueFalseTargets(() => {
            // Evaluate the operand expression.
            this.walk(node.rightExpression);
        });

        const evaluationNode = ParseTreeUtils.getEvaluationNodeForAssignmentExpression(node);
        if (!evaluationNode) {
            this._addError(Localizer.Diagnostic.assignmentExprContext(), node);
            this.walk(node.name);
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
                        Localizer.Diagnostic.assignmentExprComprehension().format({ name: node.name.value }),
                        node.name
                    );
                    break;
                }

                curScope = curScope.parent;
            }

            this._bindNameToScope(containerScope, node.name.value);
            this._addInferredTypeAssignmentForVariable(node.name, node.rightExpression);
            this._createAssignmentTargetFlowNodes(node.name, /* walkTargets */ true, /* unbound */ false);
        }

        return false;
    }

    override visitAugmentedAssignment(node: AugmentedAssignmentNode) {
        this.walk(node.leftExpression);
        this.walk(node.rightExpression);

        this._bindPossibleTupleNamedTarget(node.destExpression);
        this._createAssignmentTargetFlowNodes(node.destExpression, /* walkTargets */ false, /* unbound */ false);

        // Is this an assignment to dunder all of the form
        // __all__ += <expression>?
        if (
            node.operator === OperatorType.AddEqual &&
            this._currentScope.type === ScopeType.Module &&
            node.leftExpression.nodeType === ParseNodeType.Name &&
            node.leftExpression.value === '__all__'
        ) {
            const expr = node.rightExpression;
            let emitDunderAllWarning = true;

            if (expr.nodeType === ParseNodeType.List) {
                // Is this the form __all__ += ["a", "b"]?
                expr.entries.forEach((listEntryNode) => {
                    if (
                        listEntryNode.nodeType === ParseNodeType.StringList &&
                        listEntryNode.strings.length === 1 &&
                        listEntryNode.strings[0].nodeType === ParseNodeType.String
                    ) {
                        this._dunderAllNames?.push(listEntryNode.strings[0].value);
                        this._dunderAllStringNodes.push(listEntryNode.strings[0]);
                    }
                });
                emitDunderAllWarning = false;
            } else if (
                expr.nodeType === ParseNodeType.MemberAccess &&
                expr.leftExpression.nodeType === ParseNodeType.Name &&
                expr.memberName.value === '__all__'
            ) {
                // Is this using the form "__all__ += <mod>.__all__"?
                const namesToAdd = this._getDunderAllNamesFromImport(expr.leftExpression.value);
                if (namesToAdd) {
                    namesToAdd.forEach((name) => {
                        this._dunderAllNames?.push(name);
                    });

                    emitDunderAllWarning = false;
                }
            }

            if (emitDunderAllWarning) {
                this._addDiagnostic(
                    this._fileInfo.diagnosticRuleSet.reportUnsupportedDunderAll,
                    DiagnosticRule.reportUnsupportedDunderAll,
                    Localizer.Diagnostic.unsupportedDunderAllOperation(),
                    node
                );
            }
        }

        return false;
    }

    override visitDel(node: DelNode) {
        node.expressions.forEach((expr) => {
            this._bindPossibleTupleNamedTarget(expr);
            this.walk(expr);
            this._createAssignmentTargetFlowNodes(expr, /* walkTargets */ false, /* unbound */ true);
        });

        return false;
    }

    override visitTypeAnnotation(node: TypeAnnotationNode): boolean {
        if (this._handleTypingStubAssignmentOrAnnotation(node)) {
            return false;
        }

        // Walk the type annotation first so it is "before" the target
        // in the code flow graph.
        this.walk(node.typeAnnotation);
        this._createVariableAnnotationFlowNode();

        this._bindPossibleTupleNamedTarget(node.valueExpression);
        this._addTypeDeclarationForVariable(node.valueExpression, node.typeAnnotation);

        // For type annotations that are not part of assignments (e.g. simple variable
        // annotations), we need to populate the reference map. Otherwise the type
        // analyzer's code flow engine won't run and detect cases where the variable
        // is unbound.
        const expressionList: CodeFlowReferenceExpressionNode[] = [];
        if (this._isNarrowingExpression(node.valueExpression, expressionList)) {
            expressionList.forEach((expr) => {
                const referenceKey = createKeyForReference(expr);
                this._currentScopeCodeFlowExpressions!.add(referenceKey);
            });
        }

        this.walk(node.valueExpression);
        return false;
    }

    override visitFor(node: ForNode) {
        this._bindPossibleTupleNamedTarget(node.targetExpression);
        this._addInferredTypeAssignmentForVariable(node.targetExpression, node);

        this.walk(node.iterableExpression);

        const preForLabel = this._createLoopLabel();
        const preElseLabel = this._createBranchLabel();
        const postForLabel = this._createBranchLabel();

        this._addAntecedent(preForLabel, this._currentFlowNode!);
        this._currentFlowNode = preForLabel;
        this._addAntecedent(preElseLabel, this._currentFlowNode);
        this._createAssignmentTargetFlowNodes(node.targetExpression, /* walkTargets */ true, /* unbound */ false);

        this._bindLoopStatement(preForLabel, postForLabel, () => {
            this.walk(node.forSuite);
            this._addAntecedent(preForLabel, this._currentFlowNode!);
        });

        this._currentFlowNode = this._finishFlowLabel(preElseLabel);
        if (node.elseSuite) {
            this.walk(node.elseSuite);
        }
        this._addAntecedent(postForLabel, this._currentFlowNode);

        this._currentFlowNode = this._finishFlowLabel(postForLabel);

        if (node.asyncToken) {
            const enclosingFunction = ParseTreeUtils.getEnclosingFunction(node);
            if (!enclosingFunction || !enclosingFunction.isAsync) {
                this._addError(Localizer.Diagnostic.asyncNotInAsyncFunction(), node.asyncToken);
            }
        }

        return false;
    }

    override visitContinue(node: ContinueNode): boolean {
        if (this._currentContinueTarget) {
            this._addAntecedent(this._currentContinueTarget, this._currentFlowNode!);
        }
        this._currentFlowNode = Binder._unreachableFlowNode;

        // Continue nodes don't have any children.
        return false;
    }

    override visitBreak(node: BreakNode): boolean {
        if (this._currentBreakTarget) {
            this._addAntecedent(this._currentBreakTarget, this._currentFlowNode!);
        }
        this._currentFlowNode = Binder._unreachableFlowNode;

        // Break nodes don't have any children.
        return false;
    }

    override visitReturn(node: ReturnNode): boolean {
        if (this._targetFunctionDeclaration) {
            if (!this._targetFunctionDeclaration.returnStatements) {
                this._targetFunctionDeclaration.returnStatements = [];
            }
            this._targetFunctionDeclaration.returnStatements.push(node);
        }

        if (node.returnExpression) {
            this.walk(node.returnExpression);
        }

        AnalyzerNodeInfo.setFlowNode(node, this._currentFlowNode!);
        if (this._currentReturnTarget) {
            this._addAntecedent(this._currentReturnTarget, this._currentFlowNode!);
        }
        this._finallyTargets.forEach((target) => {
            this._addAntecedent(target, this._currentFlowNode!);
        });
        this._currentFlowNode = Binder._unreachableFlowNode;
        return false;
    }

    override visitYield(node: YieldNode): boolean {
        if (this._isInListComprehension(node)) {
            this._addError(Localizer.Diagnostic.yieldWithinListCompr(), node);
        }

        this._bindYield(node);
        return false;
    }

    override visitYieldFrom(node: YieldFromNode): boolean {
        if (this._isInListComprehension(node)) {
            this._addError(Localizer.Diagnostic.yieldWithinListCompr(), node);
        }

        this._bindYield(node);
        return false;
    }

    override visitMemberAccess(node: MemberAccessNode): boolean {
        AnalyzerNodeInfo.setFlowNode(node, this._currentFlowNode!);
        return true;
    }

    override visitName(node: NameNode): boolean {
        AnalyzerNodeInfo.setFlowNode(node, this._currentFlowNode!);

        // Name nodes have no children.
        return false;
    }

    override visitIndex(node: IndexNode): boolean {
        AnalyzerNodeInfo.setFlowNode(node, this._currentFlowNode!);
        return true;
    }

    override visitIf(node: IfNode): boolean {
        const preIfFlowNode = this._currentFlowNode!;
        const thenLabel = this._createBranchLabel();
        const elseLabel = this._createBranchLabel();
        const postIfLabel = this._createBranchLabel(preIfFlowNode);

        postIfLabel.affectedExpressions = this._trackCodeFlowExpressions(() => {
            // Determine if the test condition is always true or always false. If so,
            // we can treat either the then or the else clause as unconditional.
            const constExprValue = StaticExpressions.evaluateStaticBoolLikeExpression(
                node.testExpression,
                this._fileInfo.executionEnvironment,
                this._typingImportAliases,
                this._sysImportAliases
            );

            this._bindConditional(node.testExpression, thenLabel, elseLabel);

            // Handle the if clause.
            this._currentFlowNode =
                constExprValue === false ? Binder._unreachableFlowNode : this._finishFlowLabel(thenLabel);
            this.walk(node.ifSuite);
            this._addAntecedent(postIfLabel, this._currentFlowNode);

            // Now handle the else clause if it's present. If there
            // are chained "else if" statements, they'll be handled
            // recursively here.
            this._currentFlowNode =
                constExprValue === true ? Binder._unreachableFlowNode : this._finishFlowLabel(elseLabel);
            if (node.elseSuite) {
                this.walk(node.elseSuite);
            } else {
                this._bindNeverCondition(node.testExpression, postIfLabel, /* isPositiveTest */ false);
            }
            this._addAntecedent(postIfLabel, this._currentFlowNode);
            this._currentFlowNode = this._finishFlowLabel(postIfLabel);
        });

        return false;
    }

    override visitWhile(node: WhileNode): boolean {
        const thenLabel = this._createBranchLabel();
        const elseLabel = this._createBranchLabel();
        const postWhileLabel = this._createBranchLabel();

        // Determine if the test condition is always true or always false. If so,
        // we can treat either the while or the else clause as unconditional.
        const constExprValue = StaticExpressions.evaluateStaticBoolLikeExpression(
            node.testExpression,
            this._fileInfo.executionEnvironment,
            this._typingImportAliases,
            this._sysImportAliases
        );

        const preLoopLabel = this._createLoopLabel();
        this._addAntecedent(preLoopLabel, this._currentFlowNode!);
        this._currentFlowNode = preLoopLabel;

        this._bindConditional(node.testExpression, thenLabel, elseLabel);

        // Handle the while clause.
        this._currentFlowNode =
            constExprValue === false ? Binder._unreachableFlowNode : this._finishFlowLabel(thenLabel);
        this._bindLoopStatement(preLoopLabel, postWhileLabel, () => {
            this.walk(node.whileSuite);
        });
        this._addAntecedent(preLoopLabel, this._currentFlowNode);

        this._currentFlowNode =
            constExprValue === true ? Binder._unreachableFlowNode : this._finishFlowLabel(elseLabel);
        if (node.elseSuite) {
            this.walk(node.elseSuite);
        }
        this._addAntecedent(postWhileLabel, this._currentFlowNode);
        this._currentFlowNode = this._finishFlowLabel(postWhileLabel);
        return false;
    }

    override visitAssert(node: AssertNode): boolean {
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

    override visitExcept(node: ExceptNode): boolean {
        if (node.typeExpression) {
            this.walk(node.typeExpression);
        }

        if (node.name) {
            this.walk(node.name);
            const symbol = this._bindNameToScope(this._currentScope, node.name.value);
            this._createAssignmentTargetFlowNodes(node.name, /* walkTargets */ true, /* unbound */ false);

            if (symbol) {
                const declaration: VariableDeclaration = {
                    type: DeclarationType.Variable,
                    node: node.name,
                    isConstant: isConstantName(node.name.value),
                    inferredTypeSource: node,
                    path: this._fileInfo.filePath,
                    range: convertOffsetsToRange(node.name.start, TextRange.getEnd(node.name), this._fileInfo.lines),
                    moduleName: this._fileInfo.moduleName,
                };
                symbol.addDeclaration(declaration);
            }
        }

        this.walk(node.exceptSuite);

        if (node.name) {
            // The exception name is implicitly unbound at the end of
            // the except block.
            this._createFlowAssignment(node.name, /* unbound */ true);
        }

        return false;
    }

    override visitRaise(node: RaiseNode): boolean {
        if (this._targetFunctionDeclaration) {
            if (!this._targetFunctionDeclaration.raiseStatements) {
                this._targetFunctionDeclaration.raiseStatements = [];
            }
            this._targetFunctionDeclaration.raiseStatements.push(node);
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

        this._finallyTargets.forEach((target) => {
            this._addAntecedent(target, this._currentFlowNode!);
        });

        this._currentFlowNode = Binder._unreachableFlowNode;
        return false;
    }

    override visitTry(node: TryNode): boolean {
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
        const preTryFlowNode = this._currentFlowNode!;
        const curExceptTargets = node.exceptClauses.map(() => this._createBranchLabel());
        const preFinallyLabel = this._createBranchLabel(preTryFlowNode);
        let isAfterElseAndExceptsReachable = false;

        // Create a label for all of the return or raise labels that are
        // encountered within the try/except/else blocks. This conditionally
        // connects the return/raise statement to the finally clause.
        const preFinallyReturnOrRaiseLabel = this._createBranchLabel(preTryFlowNode);

        const preFinallyGate: FlowPreFinallyGate = {
            flags: FlowFlags.PreFinallyGate,
            id: getUniqueFlowNodeId(),
            antecedent: preFinallyReturnOrRaiseLabel,
            isGateClosed: false,
        };

        preFinallyLabel.affectedExpressions = this._trackCodeFlowExpressions(() => {
            if (node.finallySuite) {
                this._addAntecedent(preFinallyLabel, preFinallyGate);
            }

            // Add the finally target as an exception target unless there is
            // a "bare" except clause that accepts all exception types.
            const hasBareExceptClause = node.exceptClauses.some((except) => !except.typeExpression);
            if (!hasBareExceptClause) {
                curExceptTargets.push(preFinallyReturnOrRaiseLabel);
            }

            // An exception may be generated before the first flow node
            // added by the try block, so all of the exception targets
            // must have the pre-try flow node as an antecedent.
            curExceptTargets.forEach((exceptLabel) => {
                this._addAntecedent(exceptLabel, this._currentFlowNode!);
            });

            // We don't perfectly handle nested finally clauses, which are not
            // possible to model fully within a static analyzer, but we do handle
            // a single level of finally statements, and we handle most cases
            // involving nesting. Returns or raises within the try/except/raise
            // block will execute the finally target(s).
            if (node.finallySuite) {
                this._finallyTargets.push(preFinallyReturnOrRaiseLabel);
            }

            // Handle the try block.
            this._useExceptTargets(curExceptTargets, () => {
                this.walk(node.trySuite);
            });

            // Handle the else block, which is executed only if
            // execution falls through the try block.
            if (node.elseSuite) {
                this.walk(node.elseSuite);
            }
            this._addAntecedent(preFinallyLabel, this._currentFlowNode!);
            if (!this._isCodeUnreachable()) {
                isAfterElseAndExceptsReachable = true;
            }

            // Handle the except blocks.
            node.exceptClauses.forEach((exceptNode, index) => {
                this._currentFlowNode = this._finishFlowLabel(curExceptTargets[index]);
                this.walk(exceptNode);
                this._addAntecedent(preFinallyLabel, this._currentFlowNode);
                if (!this._isCodeUnreachable()) {
                    isAfterElseAndExceptsReachable = true;
                }
            });

            if (node.finallySuite) {
                this._finallyTargets.pop();
            }

            // Handle the finally block.
            this._currentFlowNode = this._finishFlowLabel(preFinallyLabel);
        });

        if (node.finallySuite) {
            this.walk(node.finallySuite);

            // Add a post-finally node at the end. If we traverse this node,
            // we'll set the "ignore" flag in the pre-finally node.
            const postFinallyNode: FlowPostFinally = {
                flags: FlowFlags.PostFinally,
                id: getUniqueFlowNodeId(),
                finallyNode: node.finallySuite,
                antecedent: this._currentFlowNode!,
                preFinallyGate,
            };
            this._currentFlowNode = isAfterElseAndExceptsReachable ? postFinallyNode : Binder._unreachableFlowNode;
        }

        // Try blocks are expensive to analyze, so add to the complexity metric.
        this._functionCodeFlowComplexity += 4;

        return false;
    }

    override visitAwait(node: AwaitNode) {
        // Make sure this is within an async lambda or function.
        const enclosingFunction = ParseTreeUtils.getEnclosingFunction(node);
        if (enclosingFunction === undefined || !enclosingFunction.isAsync) {
            // Allow if it's within a generator expression. Execution of
            // generator expressions is deferred and therefore can be
            // run within the context of an async function later.
            if (node.parent?.nodeType !== ParseNodeType.ListComprehension) {
                this._addError(Localizer.Diagnostic.awaitNotInAsync(), node);
            }
        }

        return true;
    }

    override visitGlobal(node: GlobalNode): boolean {
        const globalScope = this._currentScope.getGlobalScope();

        node.nameList.forEach((name) => {
            const nameValue = name.value;

            // Is the binding inconsistent?
            if (this._currentScope.getBindingType(nameValue) === NameBindingType.Nonlocal) {
                this._addError(Localizer.Diagnostic.nonLocalRedefinition().format({ name: nameValue }), name);
            }

            const valueWithScope = this._currentScope.lookUpSymbolRecursive(nameValue);

            // Was the name already assigned within this scope before it was declared global?
            if (valueWithScope && valueWithScope.scope === this._currentScope) {
                this._addError(Localizer.Diagnostic.globalReassignment().format({ name: nameValue }), name);
            }

            // Add it to the global scope if it's not already added.
            this._bindNameToScope(globalScope, nameValue);

            if (this._currentScope !== globalScope) {
                this._currentScope.setBindingType(nameValue, NameBindingType.Global);
            }
        });

        return true;
    }

    override visitNonlocal(node: NonlocalNode): boolean {
        const globalScope = this._currentScope.getGlobalScope();

        if (this._currentScope === globalScope) {
            this._addError(Localizer.Diagnostic.nonLocalInModule(), node);
        } else {
            node.nameList.forEach((name) => {
                const nameValue = name.value;

                // Is the binding inconsistent?
                if (this._currentScope.getBindingType(nameValue) === NameBindingType.Global) {
                    this._addError(Localizer.Diagnostic.globalRedefinition().format({ name: nameValue }), name);
                }

                const valueWithScope = this._currentScope.lookUpSymbolRecursive(nameValue);

                // Was the name already assigned within this scope before it was declared nonlocal?
                if (valueWithScope && valueWithScope.scope === this._currentScope) {
                    this._addError(Localizer.Diagnostic.nonLocalReassignment().format({ name: nameValue }), name);
                } else if (!valueWithScope || valueWithScope.scope === globalScope) {
                    this._addError(Localizer.Diagnostic.nonLocalNoBinding().format({ name: nameValue }), name);
                }

                if (valueWithScope) {
                    this._currentScope.setBindingType(nameValue, NameBindingType.Nonlocal);
                }
            });
        }

        return true;
    }

    override visitImportAs(node: ImportAsNode): boolean {
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
            if (
                symbol &&
                (this._currentScope.type === ScopeType.Module || this._currentScope.type === ScopeType.Builtin) &&
                (!node.alias ||
                    node.module.nameParts.length !== 1 ||
                    node.module.nameParts[0].value !== node.alias.value)
            ) {
                if (this._fileInfo.isStubFile || this._fileInfo.isInPyTypedPackage) {
                    // PEP 484 indicates that imported symbols should not be
                    // considered "reexported" from a type stub file unless
                    // they are imported using the "as" form and the aliased
                    // name is entirely redundant.
                    this._potentialHiddenSymbols.set(symbolName, symbol);
                }
            }

            const importInfo = AnalyzerNodeInfo.getImportInfo(node.module);
            assert(importInfo !== undefined);

            if (symbol) {
                this._createAliasDeclarationForMultipartImportName(node, node.alias, importInfo, symbol);
            }

            this._createFlowAssignment(node.alias ? node.alias : node.module.nameParts[0]);

            if (node.module.nameParts.length === 1) {
                if (firstNamePartValue === 'typing' || firstNamePartValue === 'typing_extensions') {
                    this._typingImportAliases.push(node.alias?.value ?? firstNamePartValue);
                } else if (firstNamePartValue === 'sys') {
                    this._sysImportAliases.push(node.alias?.value ?? firstNamePartValue);
                } else if (firstNamePartValue === 'dataclasses') {
                    this._dataclassesImportAliases.push(node.alias?.value ?? firstNamePartValue);
                }
            }
        }

        return true;
    }

    override visitImportFrom(node: ImportFromNode): boolean {
        const typingSymbolsOfInterest = ['Final', 'TypeAlias', 'ClassVar', 'Required', 'NotRequired'];
        const dataclassesSymbolsOfInterest = ['InitVar'];
        const importInfo = AnalyzerNodeInfo.getImportInfo(node.module);

        let resolvedPath = '';
        if (importInfo && importInfo.isImportFound && !importInfo.isNativeLib) {
            resolvedPath = importInfo.resolvedPaths[importInfo.resolvedPaths.length - 1];
        }

        // If this file is a module __init__.py(i), relative imports of submodules
        // using the syntax "from .x import y" introduce a symbol x into the
        // module namespace. We do this first (before adding the individual imported
        // symbols below) in case one of the imported symbols is the same name as the
        // submodule. In that case, we want to the symbol to appear later in the
        // declaration list because it should "win" when resolving the alias.
        const fileName = stripFileExtension(getFileName(this._fileInfo.filePath));
        const isModuleInitFile =
            fileName === '__init__' && node.module.leadingDots === 1 && node.module.nameParts.length === 1;

        let isTypingImport = false;
        let isDataclassesImport = false;

        if (node.module.nameParts.length === 1) {
            const firstNamePartValue = node.module.nameParts[0].value;
            if (firstNamePartValue === 'typing' || firstNamePartValue === 'typing_extensions') {
                isTypingImport = true;
            }

            if (firstNamePartValue === 'dataclasses') {
                isDataclassesImport = true;
            }
        }

        if (node.isWildcardImport) {
            if (ParseTreeUtils.getEnclosingClass(node) || ParseTreeUtils.getEnclosingFunction(node)) {
                this._addError(Localizer.Diagnostic.wildcardInFunction(), node);
            }

            if (importInfo) {
                const names: string[] = [];

                const lookupInfo = this._fileInfo.importLookup(resolvedPath);
                if (lookupInfo) {
                    const wildcardNames = this._getWildcardImportNames(lookupInfo);

                    if (isModuleInitFile) {
                        // If the symbol is going to be immediately replaced with a same-named
                        // imported symbol, skip this.
                        const isImmediatelyReplaced = wildcardNames.some((name) => {
                            return name === node.module.nameParts[0].value;
                        });

                        if (!isImmediatelyReplaced) {
                            this._addImplicitFromImport(node, importInfo);
                        }
                    }

                    wildcardNames.forEach((name) => {
                        const localSymbol = this._bindNameToScope(this._currentScope, name);

                        if (localSymbol) {
                            const importedSymbol = lookupInfo.symbolTable.get(name)!;

                            // Is the symbol in the target module's symbol table? If so,
                            // alias it.
                            if (importedSymbol) {
                                const aliasDecl: AliasDeclaration = {
                                    type: DeclarationType.Alias,
                                    node,
                                    path: resolvedPath,
                                    loadSymbolsFromPath: true,
                                    range: getEmptyRange(),
                                    usesLocalName: false,
                                    symbolName: name,
                                    moduleName: this._fileInfo.moduleName,
                                };
                                localSymbol.addDeclaration(aliasDecl);
                                names.push(name);
                            } else {
                                // The symbol wasn't in the target module's symbol table. It's probably
                                // an implicitly-imported submodule referenced by __all__.
                                if (importInfo && importInfo.filteredImplicitImports) {
                                    const implicitImport = importInfo.filteredImplicitImports.find(
                                        (imp) => imp.name === name
                                    );

                                    if (implicitImport) {
                                        const submoduleFallback: AliasDeclaration = {
                                            type: DeclarationType.Alias,
                                            node,
                                            path: implicitImport.path,
                                            loadSymbolsFromPath: true,
                                            range: getEmptyRange(),
                                            usesLocalName: false,
                                            moduleName: this._fileInfo.moduleName,
                                        };

                                        const aliasDecl: AliasDeclaration = {
                                            type: DeclarationType.Alias,
                                            node,
                                            path: resolvedPath,
                                            loadSymbolsFromPath: true,
                                            usesLocalName: false,
                                            symbolName: name,
                                            submoduleFallback,
                                            range: getEmptyRange(),
                                            moduleName: this._fileInfo.moduleName,
                                        };

                                        localSymbol.addDeclaration(aliasDecl);
                                    }
                                }
                            }
                        }
                    });
                }

                this._createFlowWildcardImport(node, names);

                if (isTypingImport) {
                    typingSymbolsOfInterest.forEach((s) => {
                        this._typingSymbolAliases.set(s, s);
                    });
                }

                if (isDataclassesImport) {
                    dataclassesSymbolsOfInterest.forEach((s) => {
                        this._dataclassesSymbolAliases.set(s, s);
                    });
                }
            }
        } else {
            if (isModuleInitFile) {
                this._addImplicitFromImport(node, importInfo);
            }

            node.imports.forEach((importSymbolNode) => {
                const importedName = importSymbolNode.name.value;
                const nameNode = importSymbolNode.alias || importSymbolNode.name;
                const symbol = this._bindNameToScope(this._currentScope, nameNode.value);

                if (symbol) {
                    // All import statements of the form `from . import x` treat x
                    // as an externally-visible (not hidden) symbol.
                    if (node.module.nameParts.length > 0) {
                        if (
                            this._currentScope.type === ScopeType.Module ||
                            this._currentScope.type === ScopeType.Builtin
                        ) {
                            if (
                                !importSymbolNode.alias ||
                                importSymbolNode.alias.value !== importSymbolNode.name.value
                            ) {
                                if (this._fileInfo.isStubFile || this._fileInfo.isInPyTypedPackage) {
                                    // PEP 484 indicates that imported symbols should not be
                                    // considered "reexported" from a type stub file unless
                                    // they are imported using the "as" form using a redundant form.
                                    // Py.typed packages follow the same rule as PEP 484.
                                    this._potentialHiddenSymbols.set(nameNode.value, symbol);
                                }
                            }
                        }
                    }

                    // Is the import referring to an implicitly-imported module?
                    let implicitImport: ImplicitImport | undefined;
                    if (importInfo && importInfo.filteredImplicitImports) {
                        implicitImport = importInfo.filteredImplicitImports.find((imp) => imp.name === importedName);
                    }

                    let submoduleFallback: AliasDeclaration | undefined;
                    let loadSymbolsFromPath = true;
                    if (implicitImport) {
                        submoduleFallback = {
                            type: DeclarationType.Alias,
                            node: importSymbolNode,
                            path: implicitImport.path,
                            loadSymbolsFromPath: true,
                            range: getEmptyRange(),
                            usesLocalName: false,
                            moduleName: this._fileInfo.moduleName,
                        };

                        // Handle the case of "from . import X" within an __init__ file.
                        // In this case, we want to always resolve to the submodule rather
                        // than the resolved path.
                        if (
                            fileName === '__init__' &&
                            node.module.leadingDots === 1 &&
                            node.module.nameParts.length === 0
                        ) {
                            loadSymbolsFromPath = false;
                        }
                    }

                    const aliasDecl: AliasDeclaration = {
                        type: DeclarationType.Alias,
                        node: importSymbolNode,
                        path: resolvedPath,
                        loadSymbolsFromPath,
                        usesLocalName: !!importSymbolNode.alias,
                        symbolName: importedName,
                        submoduleFallback,
                        range: getEmptyRange(),
                        moduleName: this._fileInfo.moduleName,
                        isNativeLib: importInfo?.isNativeLib,
                    };

                    symbol.addDeclaration(aliasDecl);
                    this._createFlowAssignment(importSymbolNode.alias || importSymbolNode.name);

                    if (isTypingImport) {
                        if (typingSymbolsOfInterest.some((s) => s === importSymbolNode.name.value)) {
                            this._typingSymbolAliases.set(nameNode.value, importSymbolNode.name.value);
                        }
                    }

                    if (isDataclassesImport) {
                        if (dataclassesSymbolsOfInterest.some((s) => s === importSymbolNode.name.value)) {
                            this._dataclassesSymbolAliases.set(nameNode.value, importSymbolNode.name.value);
                        }
                    }
                }
            });
        }

        return true;
    }

    override visitWith(node: WithNode): boolean {
        node.withItems.forEach((item) => {
            this.walk(item.expression);
            if (item.target) {
                this._bindPossibleTupleNamedTarget(item.target);
                this._addInferredTypeAssignmentForVariable(item.target, item);
                this._createAssignmentTargetFlowNodes(item.target, /* walkTargets */ true, /* unbound */ false);
            }
        });

        // We need to treat the "with" body as though it is wrapped in a try/except
        // block because some context managers catch and suppress exceptions.
        // We'll make use of a special "context manager label" which acts like
        // a regular branch label in most respects except that it is disabled
        // if none of the context managers support exception suppression. We won't
        // be able to determine whether any context managers support exception
        // processing until the type evaluation phase.
        //
        //  (pre with suite)
        //         ^
        //         |<--------------------|
        //    (with suite)<--------------|
        //         ^                     |
        //         |        ContextManagerExceptionTarget
        //         |                     ^
        //         |           PostContextManagerLabel
        //         |                     ^
        //         |---------------------|
        //         |
        //   (after with)
        //

        const contextManagerExceptionTarget = this._createContextManagerLabel(
            node.withItems.map((item) => item.expression),
            !!node.isAsync
        );
        this._addAntecedent(contextManagerExceptionTarget, this._currentFlowNode!);

        const preWithSuiteNode = this._currentFlowNode!;
        const postContextManagerLabel = this._createBranchLabel(preWithSuiteNode);
        this._addAntecedent(postContextManagerLabel, contextManagerExceptionTarget!);

        postContextManagerLabel.affectedExpressions = this._trackCodeFlowExpressions(() => {
            this._useExceptTargets([contextManagerExceptionTarget], () => {
                this.walk(node.suite);
            });

            this._addAntecedent(postContextManagerLabel, this._currentFlowNode!);
            this._currentFlowNode = postContextManagerLabel;

            if (node.asyncToken) {
                const enclosingFunction = ParseTreeUtils.getEnclosingFunction(node);
                if (!enclosingFunction || !enclosingFunction.isAsync) {
                    this._addError(Localizer.Diagnostic.asyncNotInAsyncFunction(), node.asyncToken);
                }
            }
        });

        return false;
    }

    override visitTernary(node: TernaryNode): boolean {
        const preTernaryFlowNode = this._currentFlowNode!;
        const trueLabel = this._createBranchLabel();
        const falseLabel = this._createBranchLabel();
        const postExpressionLabel = this._createBranchLabel(preTernaryFlowNode);

        postExpressionLabel.affectedExpressions = this._trackCodeFlowExpressions(() => {
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
        });

        return false;
    }

    override visitUnaryOperation(node: UnaryOperationNode): boolean {
        if (node.operator === OperatorType.Not && this._currentFalseTarget && this._currentTrueTarget) {
            // Swap the existing true/false targets.
            this._bindConditional(node.expression, this._currentFalseTarget, this._currentTrueTarget);
        } else {
            // Temporarily set the true/false targets to undefined because
            // this unary operation is not part of a chain of logical expressions
            // (AND/OR/NOT subexpressions).
            this._disableTrueFalseTargets(() => {
                // Evaluate the operand expression.
                this.walk(node.expression);
            });
        }

        return false;
    }

    override visitBinaryOperation(node: BinaryOperationNode): boolean {
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
            // Temporarily set the true/false targets to undefined because
            // this binary operation is not part of a chain of logical expressions
            // (AND/OR/NOT subexpressions).
            this._disableTrueFalseTargets(() => {
                this.walk(node.leftExpression);
                this.walk(node.rightExpression);
            });
        }

        return false;
    }

    override visitListComprehension(node: ListComprehensionNode): boolean {
        const enclosingFunction = ParseTreeUtils.getEnclosingFunction(node);

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
                    this._addInferredTypeAssignmentForVariable(compr.targetExpression, compr);

                    // Async for is not allowed outside of an async function.
                    if (compr.asyncToken) {
                        if (!enclosingFunction || !enclosingFunction.isAsync) {
                            // Allow if it's within a generator expression. Execution of
                            // generator expressions is deferred and therefore can be
                            // run within the context of an async function later.
                            if (node.parent?.nodeType === ParseNodeType.List) {
                                this._addError(Localizer.Diagnostic.asyncNotInAsyncFunction(), compr.asyncToken);
                            }
                        }
                    }
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
                        const aliasSymbol = this._currentScope.parent!.lookUpSymbol(addedSymbol[0]);
                        if (aliasSymbol) {
                            this._createAssignmentAliasFlowNode(addedSymbol[1].id, aliasSymbol.id);
                        }
                    }

                    this.walk(compr.iterableExpression);

                    this._createAssignmentTargetFlowNodes(
                        compr.targetExpression,
                        /* walkTargets */ true,
                        /* unbound */ false
                    );
                } else {
                    const trueLabel = this._createBranchLabel();
                    this._bindConditional(compr.testExpression, trueLabel, falseLabel);
                    this._currentFlowNode = this._finishFlowLabel(trueLabel);
                }
            }

            this.walk(node.expression);
            this._addAntecedent(falseLabel, this._currentFlowNode!);
            this._currentFlowNode = this._finishFlowLabel(falseLabel);
        });

        return false;
    }

    override visitMatch(node: MatchNode) {
        // Evaluate the subject expression.
        this.walk(node.subjectExpression);

        const expressionList: CodeFlowReferenceExpressionNode[] = [];
        const isSubjectNarrowable = this._isNarrowingExpression(node.subjectExpression, expressionList);
        if (isSubjectNarrowable) {
            expressionList.forEach((expr) => {
                const referenceKey = createKeyForReference(expr);
                this._currentScopeCodeFlowExpressions!.add(referenceKey);
            });
        }

        const postMatchLabel = this._createBranchLabel();
        let foundIrrefutableCase = false;

        // Model the match statement as a series of if/elif clauses
        // each of which tests for the specified pattern (and optionally
        // for the guard condition).
        node.cases.forEach((caseStatement) => {
            const postCaseLabel = this._createBranchLabel();
            const preGuardLabel = this._createBranchLabel();
            const preSuiteLabel = this._createBranchLabel();

            // Evaluate the pattern.
            this._addAntecedent(preGuardLabel, this._currentFlowNode!);

            if (!caseStatement.isIrrefutable) {
                this._addAntecedent(postCaseLabel, this._currentFlowNode!);
            } else if (!caseStatement.guardExpression) {
                foundIrrefutableCase = true;
            }

            this._currentFlowNode = this._finishFlowLabel(preGuardLabel);

            // Bind the pattern.
            this.walk(caseStatement.pattern);

            if (isSubjectNarrowable) {
                this._createFlowNarrowForPattern(node.subjectExpression, caseStatement);
            }

            // Apply the guard expression.
            if (caseStatement.guardExpression) {
                this._bindConditional(caseStatement.guardExpression, preSuiteLabel, postCaseLabel);
            } else {
                this._addAntecedent(preSuiteLabel, this._currentFlowNode);
            }

            this._currentFlowNode = this._finishFlowLabel(preSuiteLabel);

            // Bind the body of the case statement.
            this.walk(caseStatement.suite);
            this._addAntecedent(postMatchLabel, this._currentFlowNode);

            this._currentFlowNode = this._finishFlowLabel(postCaseLabel);
        });

        // Add a final narrowing step for the subject expression for the entire
        // match statement. This will compute the narrowed type if no case
        // statements are matched.
        if (isSubjectNarrowable) {
            this._createFlowNarrowForPattern(node.subjectExpression, node);

            // Create an "implied else" to conditionally gate code flow based on
            // whether the narrowed type of the subject expression is Never at this point.
            if (!foundIrrefutableCase) {
                this._createFlowExhaustedMatch(node);
            }
        }

        this._addAntecedent(postMatchLabel, this._currentFlowNode!);
        this._currentFlowNode = this._finishFlowLabel(postMatchLabel);

        return false;
    }

    override visitPatternAs(node: PatternAsNode) {
        const postOrLabel = this._createBranchLabel();

        node.orPatterns.forEach((orPattern) => {
            this.walk(orPattern);
            this._addAntecedent(postOrLabel, this._currentFlowNode!);
        });

        this._currentFlowNode = this._finishFlowLabel(postOrLabel);

        if (node.target) {
            this.walk(node.target);
            const symbol = this._bindNameToScope(this._currentScope, node.target.value);
            this._createAssignmentTargetFlowNodes(node.target, /* walkTargets */ false, /* unbound */ false);

            if (symbol) {
                const declaration: VariableDeclaration = {
                    type: DeclarationType.Variable,
                    node: node.target,
                    isConstant: isConstantName(node.target.value),
                    inferredTypeSource: node,
                    path: this._fileInfo.filePath,
                    range: convertOffsetsToRange(
                        node.target.start,
                        TextRange.getEnd(node.target),
                        this._fileInfo.lines
                    ),
                    moduleName: this._fileInfo.moduleName,
                };
                symbol.addDeclaration(declaration);
            }
        }

        return false;
    }

    override visitPatternCapture(node: PatternCaptureNode) {
        if (!node.isWildcard) {
            this._addPatternCaptureTarget(node.target);
        }

        return true;
    }

    override visitPatternMappingExpandEntry(node: PatternMappingExpandEntryNode) {
        if (node.target.value !== '_') {
            this._addPatternCaptureTarget(node.target);
        }

        return true;
    }

    private _addSlotsToCurrentScope(slotNameNodes: StringListNode[]) {
        assert(this._currentScope.type === ScopeType.Class);

        let slotsContainsDict = false;

        for (const slotNameNode of slotNameNodes) {
            const slotName = slotNameNode.strings[0].value;

            if (slotName === '__dict__') {
                slotsContainsDict = true;
                continue;
            }

            let symbol = this._currentScope.lookUpSymbol(slotName);
            if (!symbol) {
                symbol = this._currentScope.addSymbol(
                    slotName,
                    SymbolFlags.InitiallyUnbound | SymbolFlags.ClassMember | SymbolFlags.InstanceMember
                );
                const honorPrivateNaming = this._fileInfo.diagnosticRuleSet.reportPrivateUsage !== 'none';
                if (isPrivateOrProtectedName(slotName) && honorPrivateNaming) {
                    symbol.setIsPrivateMember();
                }
            }

            const declaration: VariableDeclaration = {
                type: DeclarationType.Variable,
                node: slotNameNode,
                isConstant: isConstantName(slotName),
                isDefinedBySlots: true,
                path: this._fileInfo.filePath,
                range: convertOffsetsToRange(
                    slotNameNode.start,
                    slotNameNode.start + slotNameNode.length,
                    this._fileInfo.lines
                ),
                moduleName: this._fileInfo.moduleName,
            };
            symbol.addDeclaration(declaration);
        }

        if (!slotsContainsDict) {
            this._currentScope.setSlotsNames(slotNameNodes.map((node) => node.strings[0].value));
        }
    }

    private _isInListComprehension(node: ParseNode) {
        let curNode: ParseNode | undefined = node;
        while (curNode) {
            if (curNode.nodeType === ParseNodeType.ListComprehension) {
                return true;
            }
            curNode = curNode.parent;
        }
        return false;
    }

    private _addPatternCaptureTarget(target: NameNode) {
        const symbol = this._bindNameToScope(this._currentScope, target.value);
        this._createAssignmentTargetFlowNodes(target, /* walkTargets */ false, /* unbound */ false);

        if (symbol) {
            const declaration: VariableDeclaration = {
                type: DeclarationType.Variable,
                node: target,
                isConstant: isConstantName(target.value),
                inferredTypeSource: target.parent,
                path: this._fileInfo.filePath,
                range: convertOffsetsToRange(target.start, TextRange.getEnd(target), this._fileInfo.lines),
                moduleName: this._fileInfo.moduleName,
            };
            symbol.addDeclaration(declaration);
        }
    }

    private _useExceptTargets(targets: FlowLabel[], callback: () => void) {
        const prevExceptTargets = this._currentExceptTargets;
        this._currentExceptTargets = targets;
        callback();
        this._currentExceptTargets = prevExceptTargets;
    }

    // Attempts to resolve the module name, import it, and return
    // its __all__ symbols.
    private _getDunderAllNamesFromImport(varName: string): string[] | undefined {
        const varSymbol = this._currentScope.lookUpSymbol(varName);
        if (!varSymbol) {
            return undefined;
        }

        // There should be only one declaration for the variable.
        const aliasDecl = varSymbol.getDeclarations().find((decl) => decl.type === DeclarationType.Alias) as
            | AliasDeclaration
            | undefined;
        const resolvedPath =
            aliasDecl?.path && aliasDecl.loadSymbolsFromPath
                ? aliasDecl.path
                : aliasDecl?.submoduleFallback?.path && aliasDecl.submoduleFallback.loadSymbolsFromPath
                ? aliasDecl.submoduleFallback.path
                : undefined;
        if (!resolvedPath) {
            return undefined;
        }

        const lookupInfo = this._fileInfo.importLookup(resolvedPath);
        if (!lookupInfo) {
            return undefined;
        }

        return lookupInfo.dunderAllNames;
    }

    private _addImplicitFromImport(node: ImportFromNode, importInfo?: ImportResult) {
        const symbolName = node.module.nameParts[0].value;
        const symbol = this._bindNameToScope(this._currentScope, symbolName);
        if (symbol) {
            this._createAliasDeclarationForMultipartImportName(node, undefined, importInfo, symbol);
        }

        this._createFlowAssignment(node.module.nameParts[0]);
    }

    private _createAliasDeclarationForMultipartImportName(
        node: ImportAsNode | ImportFromNode,
        importAlias: NameNode | undefined,
        importInfo: ImportResult | undefined,
        symbol: Symbol
    ) {
        const firstNamePartValue = node.module.nameParts[0].value;

        if (importInfo && importInfo.isImportFound && !importInfo.isNativeLib && importInfo.resolvedPaths.length > 0) {
            // See if there's already a matching alias declaration for this import.
            // if so, we'll update it rather than creating a new one. This is required
            // to handle cases where multiple import statements target the same
            // starting symbol such as "import a.b.c" and "import a.d". In this case,
            // we'll build a single declaration that describes the combined actions
            // of both import statements, thus reflecting the behavior of the
            // python module loader.
            const existingDecl = symbol
                .getDeclarations()
                .find((decl) => decl.type === DeclarationType.Alias && decl.firstNamePart === firstNamePartValue);

            let newDecl: AliasDeclaration;
            if (existingDecl) {
                newDecl = existingDecl as AliasDeclaration;
            } else {
                newDecl = {
                    type: DeclarationType.Alias,
                    node,
                    path: importInfo.resolvedPaths[importInfo.resolvedPaths.length - 1],
                    loadSymbolsFromPath: false,
                    moduleName: importInfo.importName,
                    range: getEmptyRange(),
                    firstNamePart: firstNamePartValue,
                    usesLocalName: !!importAlias,
                };
            }

            // Add the implicit imports for this module if it's the last
            // name part we're resolving.
            if (importAlias || node.module.nameParts.length === 1) {
                newDecl.path = importInfo.resolvedPaths[importInfo.resolvedPaths.length - 1];
                newDecl.loadSymbolsFromPath = true;
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
                    let loaderActions = curLoaderActions.implicitImports
                        ? curLoaderActions.implicitImports.get(namePartValue)
                        : undefined;
                    if (!loaderActions) {
                        // Allocate a new loader action.
                        loaderActions = {
                            path: importInfo.resolvedPaths[i],
                            loadSymbolsFromPath: false,
                            implicitImports: new Map<string, ModuleLoaderActions>(),
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
                        loaderActions.loadSymbolsFromPath = true;
                        this._addImplicitImportsToLoaderActions(importInfo, loaderActions);
                    }

                    curLoaderActions = loaderActions;
                }
            }

            if (!existingDecl) {
                symbol.addDeclaration(newDecl);
            }
        } else {
            // If we couldn't resolve the import, create a dummy declaration with a
            // bogus path so it gets an unknown type (rather than an unbound type) at
            // analysis time.
            const newDecl: AliasDeclaration = {
                type: DeclarationType.Alias,
                node,
                path: '*** unresolved ***',
                loadSymbolsFromPath: true,
                range: getEmptyRange(),
                usesLocalName: !!importAlias,
                moduleName: '',
                isUnresolved: true,
            };
            symbol.addDeclaration(newDecl);
        }
    }

    private _getWildcardImportNames(lookupInfo: ImportLookupResult): string[] {
        // If a dunder all symbol is defined, it takes precedence.
        if (lookupInfo.dunderAllNames) {
            return lookupInfo.dunderAllNames;
        }

        // Import all names that don't begin with an underscore.
        const namesToImport: string[] = [];
        lookupInfo.symbolTable.forEach((symbol, name) => {
            if (!symbol.isExternallyHidden()) {
                namesToImport!.push(name);
            }
        });

        return namesToImport;
    }

    private _walkStatementsAndReportUnreachable(statements: StatementNode[]) {
        let foundUnreachableStatement = false;

        for (const statement of statements) {
            AnalyzerNodeInfo.setFlowNode(statement, this._currentFlowNode!);

            if (!foundUnreachableStatement) {
                foundUnreachableStatement = this._isCodeUnreachable();
            }

            if (!foundUnreachableStatement) {
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
            id: getUniqueFlowNodeId(),
        };
        return flowNode;
    }

    private _createBranchLabel(preBranchAntecedent?: FlowNode) {
        const flowNode: FlowBranchLabel = {
            flags: FlowFlags.BranchLabel,
            id: getUniqueFlowNodeId(),
            antecedents: [],
            preBranchAntecedent,
            affectedExpressions: undefined,
        };
        return flowNode;
    }

    // Create a flow node that narrows the type of the subject expression for
    // a specified case statement or the entire match statement (if the flow
    // falls through the bottom of all cases).
    private _createFlowNarrowForPattern(subjectExpression: ExpressionNode, statement: CaseNode | MatchNode) {
        const flowNode: FlowNarrowForPattern = {
            flags: FlowFlags.NarrowForPattern,
            id: getUniqueFlowNodeId(),
            subjectExpression,
            statement,
            antecedent: this._currentFlowNode!,
        };

        this._currentFlowNode! = flowNode;
    }

    private _createContextManagerLabel(expressions: ExpressionNode[], isAsync: boolean) {
        const flowNode: FlowPostContextManagerLabel = {
            flags: FlowFlags.PostContextManager | FlowFlags.BranchLabel,
            id: getUniqueFlowNodeId(),
            antecedents: [],
            expressions,
            affectedExpressions: undefined,
            isAsync,
        };
        return flowNode;
    }

    private _createLoopLabel() {
        const flowNode: FlowLabel = {
            flags: FlowFlags.LoopLabel,
            id: getUniqueFlowNodeId(),
            antecedents: [],
            affectedExpressions: undefined,
        };

        return flowNode;
    }

    private _finishFlowLabel(node: FlowLabel) {
        // If there were no antecedents, this is unreachable.
        if (node.antecedents.length === 0) {
            return Binder._unreachableFlowNode;
        }

        // If there was only one antecedent and this is a simple
        // branch label, there's no need for a label to exist.
        if (node.antecedents.length === 1 && node.flags === FlowFlags.BranchLabel) {
            return node.antecedents[0];
        }

        // Add one to the code flow complexity for each antecedent.
        this._functionCodeFlowComplexity += node.antecedents.length;

        return node;
    }

    // Creates a node that creates a "gate" that is closed (doesn't allow for code
    // flow) if the specified expression is never once it is narrowed (in either the
    // positive or negative case).
    private _bindNeverCondition(node: ExpressionNode, target: FlowLabel, isPositiveTest: boolean) {
        const expressionList: CodeFlowReferenceExpressionNode[] = [];

        if (node.nodeType === ParseNodeType.UnaryOperation && node.operator === OperatorType.Not) {
            this._bindNeverCondition(node.expression, target, !isPositiveTest);
        } else if (
            node.nodeType === ParseNodeType.BinaryOperation &&
            (node.operator === OperatorType.And || node.operator === OperatorType.Or)
        ) {
            if (node.operator === OperatorType.And) {
                // In the And case, we need to gate the synthesized else clause if both
                // of the operands evaluate to never once they are narrowed.
                const savedCurrentFlowNode = this._currentFlowNode;
                this._bindNeverCondition(node.leftExpression, target, isPositiveTest);
                this._currentFlowNode = savedCurrentFlowNode;
                this._bindNeverCondition(node.rightExpression, target, isPositiveTest);
            } else {
                const initialCurrentFlowNode = this._currentFlowNode;

                // In the Or case, we need to gate the synthesized else clause if either
                // of the operands evaluate to never.
                const afterLabel = this._createBranchLabel();
                this._bindNeverCondition(node.leftExpression, afterLabel, isPositiveTest);

                // If the condition didn't result in any new flow nodes, we can skip
                // checking the other condition.
                if (initialCurrentFlowNode !== this._currentFlowNode) {
                    this._currentFlowNode = this._finishFlowLabel(afterLabel);

                    const prevCurrentNode = this._currentFlowNode;
                    this._bindNeverCondition(node.rightExpression, target, isPositiveTest);

                    // If the second condition resulted in no new control flow node, we can
                    // eliminate this entire subgraph.
                    if (prevCurrentNode === this._currentFlowNode) {
                        this._currentFlowNode = initialCurrentFlowNode;
                    }
                }
            }
        } else {
            // Limit only to expressions that contain a narrowable subexpression
            // that is a name. This avoids complexities with composite expressions like
            // member access or index expressions.
            if (this._isNarrowingExpression(node, expressionList, /* neverNarrowingExpressions */ true)) {
                const filteredExprList = expressionList.filter((expr) => expr.nodeType === ParseNodeType.Name);
                if (filteredExprList.length > 0) {
                    this._currentFlowNode = this._createFlowConditional(
                        isPositiveTest ? FlowFlags.TrueNeverCondition : FlowFlags.FalseNeverCondition,
                        this._currentFlowNode!,
                        node
                    );
                }
            }

            this._addAntecedent(target, this._currentFlowNode!);
        }
    }

    private _bindConditional(node: ExpressionNode, trueTarget: FlowLabel, falseTarget: FlowLabel) {
        this._setTrueFalseTargets(trueTarget, falseTarget, () => {
            this.walk(node);
        });

        if (!this._isLogicalExpression(node)) {
            this._addAntecedent(
                trueTarget,
                this._createFlowConditional(FlowFlags.TrueCondition, this._currentFlowNode!, node)
            );
            this._addAntecedent(
                falseTarget,
                this._createFlowConditional(FlowFlags.FalseCondition, this._currentFlowNode!, node)
            );
        }
    }

    private _disableTrueFalseTargets(callback: () => void): void {
        this._setTrueFalseTargets(undefined, undefined, callback);
    }

    private _setTrueFalseTargets(
        trueTarget: FlowLabel | undefined,
        falseTarget: FlowLabel | undefined,
        callback: () => void
    ) {
        const savedTrueTarget = this._currentTrueTarget;
        const savedFalseTarget = this._currentFalseTarget;
        this._currentTrueTarget = trueTarget;
        this._currentFalseTarget = falseTarget;

        callback();

        this._currentTrueTarget = savedTrueTarget;
        this._currentFalseTarget = savedFalseTarget;
    }

    private _createFlowConditional(flags: FlowFlags, antecedent: FlowNode, expression: ExpressionNode): FlowNode {
        if (antecedent.flags & FlowFlags.Unreachable) {
            return antecedent;
        }
        const staticValue = StaticExpressions.evaluateStaticBoolLikeExpression(
            expression,
            this._fileInfo.executionEnvironment,
            this._typingImportAliases,
            this._sysImportAliases
        );
        if (
            (staticValue === true && flags & FlowFlags.FalseCondition) ||
            (staticValue === false && flags & FlowFlags.TrueCondition)
        ) {
            return Binder._unreachableFlowNode;
        }

        const expressionList: CodeFlowReferenceExpressionNode[] = [];
        if (!this._isNarrowingExpression(expression, expressionList)) {
            return antecedent;
        }

        expressionList.forEach((expr) => {
            const referenceKey = createKeyForReference(expr);
            this._currentScopeCodeFlowExpressions!.add(referenceKey);
        });

        // Select the first name expression.
        const filteredExprList = expressionList.filter((expr) => expr.nodeType === ParseNodeType.Name);

        const conditionalFlowNode: FlowCondition = {
            flags,
            id: getUniqueFlowNodeId(),
            reference: filteredExprList.length > 0 ? (filteredExprList[0] as NameNode) : undefined,
            expression,
            antecedent,
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
                return expression.operator === OperatorType.And || expression.operator === OperatorType.Or;
            }
        }

        return false;
    }

    // Determines whether the specified expression can be used for conditional
    // type narrowing. The expression atoms (names, member accesses and index)
    // are provided as an output in the expressionList.
    // If filterForNeverNarrowing is true, we limit some types of narrowing
    // expressions for performance reasons.
    // The isComplexExpression parameter is used internally to determine whether
    // the call is an atom (name, member access, index - plus a "not" form of
    // these) or something more complex (binary operator, call, etc.).
    private _isNarrowingExpression(
        expression: ExpressionNode,
        expressionList: CodeFlowReferenceExpressionNode[],
        filterForNeverNarrowing = false,
        isComplexExpression = false
    ): boolean {
        switch (expression.nodeType) {
            case ParseNodeType.Name:
            case ParseNodeType.MemberAccess:
            case ParseNodeType.Index: {
                if (filterForNeverNarrowing) {
                    // Never narrowing doesn't support member access or index
                    // expressions.
                    if (expression.nodeType !== ParseNodeType.Name) {
                        return false;
                    }

                    // Never narrowing doesn't support simple names (falsy
                    // or truthy narrowing) because it's too expensive and
                    // provides relatively little utility.
                    if (!isComplexExpression) {
                        return false;
                    }
                }

                if (isCodeFlowSupportedForReference(expression)) {
                    expressionList.push(expression);
                    return true;
                }

                return false;
            }

            case ParseNodeType.AssignmentExpression: {
                expressionList.push(expression.name);
                return true;
            }

            case ParseNodeType.BinaryOperation: {
                const isOrIsNotOperator =
                    expression.operator === OperatorType.Is || expression.operator === OperatorType.IsNot;
                const equalsOrNotEqualsOperator =
                    expression.operator === OperatorType.Equals || expression.operator === OperatorType.NotEquals;

                if (isOrIsNotOperator || equalsOrNotEqualsOperator) {
                    // Look for "X is None", "X is not None", "X == None", "X != None".
                    // These are commonly-used patterns used in control flow.
                    if (
                        expression.rightExpression.nodeType === ParseNodeType.Constant &&
                        expression.rightExpression.constType === KeywordType.None
                    ) {
                        return this._isNarrowingExpression(
                            expression.leftExpression,
                            expressionList,
                            filterForNeverNarrowing,
                            /* isComplexExpression */ true
                        );
                    }

                    // Look for "type(X) is Y" or "type(X) is not Y".
                    if (
                        isOrIsNotOperator &&
                        expression.leftExpression.nodeType === ParseNodeType.Call &&
                        expression.leftExpression.leftExpression.nodeType === ParseNodeType.Name &&
                        expression.leftExpression.leftExpression.value === 'type' &&
                        expression.leftExpression.arguments.length === 1 &&
                        expression.leftExpression.arguments[0].argumentCategory === ArgumentCategory.Simple
                    ) {
                        return this._isNarrowingExpression(
                            expression.leftExpression.arguments[0].valueExpression,
                            expressionList,
                            filterForNeverNarrowing,
                            /* isComplexExpression */ true
                        );
                    }

                    const isLeftNarrowing = this._isNarrowingExpression(
                        expression.leftExpression,
                        expressionList,
                        filterForNeverNarrowing,
                        /* isComplexExpression */ true
                    );

                    // Look for "X is Y" or "X is not Y".
                    if (isOrIsNotOperator) {
                        return isLeftNarrowing;
                    }

                    // Look for X == <literal>, X != <literal> or <literal> == X, <literal> != X
                    if (equalsOrNotEqualsOperator) {
                        const isRightNarrowing = this._isNarrowingExpression(
                            expression.rightExpression,
                            expressionList,
                            filterForNeverNarrowing,
                            /* isComplexExpression */ true
                        );
                        return isLeftNarrowing || isRightNarrowing;
                    }
                }

                // Look for "<string> in Y" or "<string> not in Y".
                if (expression.operator === OperatorType.In || expression.operator === OperatorType.NotIn) {
                    if (
                        this._isNarrowingExpression(
                            expression.rightExpression,
                            expressionList,
                            filterForNeverNarrowing,
                            /* isComplexExpression */ true
                        )
                    ) {
                        return true;
                    }
                }

                // Look for "X in Y".
                if (expression.operator === OperatorType.In) {
                    return this._isNarrowingExpression(
                        expression.leftExpression,
                        expressionList,
                        filterForNeverNarrowing,
                        /* isComplexExpression */ true
                    );
                }

                return false;
            }

            case ParseNodeType.UnaryOperation: {
                return (
                    expression.operator === OperatorType.Not &&
                    this._isNarrowingExpression(
                        expression.expression,
                        expressionList,
                        filterForNeverNarrowing,
                        /* isComplexExpression */ false
                    )
                );
            }

            case ParseNodeType.AugmentedAssignment: {
                return this._isNarrowingExpression(
                    expression.rightExpression,
                    expressionList,
                    filterForNeverNarrowing,
                    /* isComplexExpression */ true
                );
            }

            case ParseNodeType.Call: {
                if (
                    expression.leftExpression.nodeType === ParseNodeType.Name &&
                    (expression.leftExpression.value === 'isinstance' ||
                        expression.leftExpression.value === 'issubclass') &&
                    expression.arguments.length === 2
                ) {
                    return this._isNarrowingExpression(
                        expression.arguments[0].valueExpression,
                        expressionList,
                        filterForNeverNarrowing,
                        /* isComplexExpression */ true
                    );
                }

                if (
                    expression.leftExpression.nodeType === ParseNodeType.Name &&
                    expression.leftExpression.value === 'callable' &&
                    expression.arguments.length === 1
                ) {
                    return this._isNarrowingExpression(
                        expression.arguments[0].valueExpression,
                        expressionList,
                        filterForNeverNarrowing,
                        /* isComplexExpression */ true
                    );
                }

                // Is this potentially a call to a user-defined type guard function?
                if (expression.arguments.length >= 1) {
                    // Never narrowing doesn't support type guards because they do not
                    // offer negative narrowing.
                    if (filterForNeverNarrowing) {
                        return false;
                    }

                    return this._isNarrowingExpression(
                        expression.arguments[0].valueExpression,
                        expressionList,
                        filterForNeverNarrowing,
                        /* isComplexExpression */ true
                    );
                }
            }
        }

        return false;
    }

    private _createAssignmentTargetFlowNodes(target: ExpressionNode, walkTargets: boolean, unbound: boolean) {
        switch (target.nodeType) {
            case ParseNodeType.Name:
            case ParseNodeType.MemberAccess: {
                this._createFlowAssignment(target, unbound);
                if (walkTargets) {
                    this.walk(target);
                }
                break;
            }

            case ParseNodeType.Index: {
                this._createFlowAssignment(target, unbound);
                if (walkTargets) {
                    this.walk(target);
                }
                break;
            }

            case ParseNodeType.Tuple: {
                target.expressions.forEach((expr) => {
                    this._createAssignmentTargetFlowNodes(expr, walkTargets, unbound);
                });
                break;
            }

            case ParseNodeType.TypeAnnotation: {
                this._createAssignmentTargetFlowNodes(target.valueExpression, /* walkTargets */ false, unbound);
                if (walkTargets) {
                    this.walk(target);
                }
                break;
            }

            case ParseNodeType.Unpack: {
                this._createAssignmentTargetFlowNodes(target.expression, /* walkTargets */ false, unbound);
                if (walkTargets) {
                    this.walk(target);
                }
                break;
            }

            case ParseNodeType.List: {
                target.entries.forEach((entry) => {
                    this._createAssignmentTargetFlowNodes(entry, walkTargets, unbound);
                });
                break;
            }

            default: {
                if (walkTargets) {
                    this.walk(target);
                }
            }
        }
    }

    private _createCallFlowNode(node: CallNode) {
        if (!this._isCodeUnreachable()) {
            const flowNode: FlowCall = {
                flags: FlowFlags.Call,
                id: getUniqueFlowNodeId(),
                node,
                antecedent: this._currentFlowNode!,
            };

            this._currentFlowNode = flowNode;
        }

        AnalyzerNodeInfo.setFlowNode(node, this._currentFlowNode!);

        if (!this._isCodeUnreachable()) {
            this._addExceptTargets(this._currentFlowNode!);
        }
    }

    private _createAssignmentAliasFlowNode(targetSymbolId: number, aliasSymbolId: number) {
        if (!this._isCodeUnreachable()) {
            const flowNode: FlowAssignmentAlias = {
                flags: FlowFlags.AssignmentAlias,
                id: getUniqueFlowNodeId(),
                antecedent: this._currentFlowNode!,
                targetSymbolId,
                aliasSymbolId,
            };

            this._currentFlowNode = flowNode;
        }
    }

    private _createVariableAnnotationFlowNode() {
        if (!this._isCodeUnreachable()) {
            const flowNode: FlowVariableAnnotation = {
                flags: FlowFlags.VariableAnnotation,
                id: getUniqueFlowNodeId(),
                antecedent: this._currentFlowNode!,
            };

            this._currentFlowNode = flowNode;
        }
    }

    private _createFlowAssignment(node: CodeFlowReferenceExpressionNode, unbound = false) {
        let targetSymbolId = indeterminateSymbolId;
        if (node.nodeType === ParseNodeType.Name) {
            const symbolWithScope = this._currentScope.lookUpSymbolRecursive(node.value);
            assert(symbolWithScope !== undefined);
            targetSymbolId = symbolWithScope!.symbol.id;
        }

        const prevFlowNode = this._currentFlowNode!;
        if (!this._isCodeUnreachable() && isCodeFlowSupportedForReference(node)) {
            const flowNode: FlowAssignment = {
                flags: FlowFlags.Assignment,
                id: getUniqueFlowNodeId(),
                node,
                antecedent: this._currentFlowNode!,
                targetSymbolId,
            };

            const referenceKey = createKeyForReference(node);
            this._currentScopeCodeFlowExpressions!.add(referenceKey);

            if (unbound) {
                flowNode.flags |= FlowFlags.Unbind;
            }

            // Assume that an assignment to a member access expression
            // can potentially generate an exception.
            if (node.nodeType === ParseNodeType.MemberAccess) {
                this._addExceptTargets(flowNode);
            }
            this._currentFlowNode = flowNode;
        }

        // If we're marking the node as unbound and there is already a flow node
        // associated with the node, don't replace it. This case applies for symbols
        // introduced in except clauses. If there is no use the previous flow node
        // associated, use the previous flow node (applies in the del case).
        // Otherwise, the node will be evaluated as unbound at this point in the flow.
        if (!unbound || AnalyzerNodeInfo.getFlowNode(node) === undefined) {
            AnalyzerNodeInfo.setFlowNode(node, unbound ? prevFlowNode : this._currentFlowNode!);
        }
    }

    private _createFlowWildcardImport(node: ImportFromNode, names: string[]) {
        if (!this._isCodeUnreachable()) {
            const flowNode: FlowWildcardImport = {
                flags: FlowFlags.WildcardImport,
                id: getUniqueFlowNodeId(),
                node,
                names,
                antecedent: this._currentFlowNode!,
            };

            this._addExceptTargets(flowNode);
            this._currentFlowNode = flowNode;
        }

        AnalyzerNodeInfo.setFlowNode(node, this._currentFlowNode!);
    }

    private _createFlowExhaustedMatch(node: MatchNode) {
        if (!this._isCodeUnreachable()) {
            const flowNode: FlowExhaustedMatch = {
                flags: FlowFlags.ExhaustedMatch,
                id: getUniqueFlowNodeId(),
                node,
                antecedent: this._currentFlowNode!,
            };

            this._currentFlowNode = flowNode;
        }

        AnalyzerNodeInfo.setFlowNode(node, this._currentFlowNode!);
    }

    private _isCodeUnreachable() {
        return !!(this._currentFlowNode!.flags & FlowFlags.Unreachable);
    }

    private _addExceptTargets(flowNode: FlowNode) {
        // If there are any except targets, then we're in a try block, and we
        // have to assume that an exception can be raised after every assignment.
        if (this._currentExceptTargets) {
            this._currentExceptTargets.forEach((label) => {
                this._addAntecedent(label, flowNode);
            });
        }
    }

    private _trackCodeFlowExpressions(callback: () => void): Set<string> {
        const savedExpressions = this._currentScopeCodeFlowExpressions;
        this._currentScopeCodeFlowExpressions = new Set<string>();
        callback();

        const scopedExpressions = this._currentScopeCodeFlowExpressions;

        if (savedExpressions) {
            this._currentScopeCodeFlowExpressions.forEach((value) => {
                savedExpressions.add(value);
            });
        }

        this._currentScopeCodeFlowExpressions = savedExpressions;

        return scopedExpressions;
    }

    private _bindLoopStatement(preLoopLabel: FlowLabel, postLoopLabel: FlowLabel, callback: () => void) {
        const savedContinueTarget = this._currentContinueTarget;
        const savedBreakTarget = this._currentBreakTarget;
        const savedCodeFlowComplexity = this._functionCodeFlowComplexity;

        this._currentContinueTarget = preLoopLabel;
        this._currentBreakTarget = postLoopLabel;
        this._functionCodeFlowComplexity = 1;

        preLoopLabel.affectedExpressions = this._trackCodeFlowExpressions(callback);

        this._currentContinueTarget = savedContinueTarget;
        this._currentBreakTarget = savedBreakTarget;

        // For each loop, double the complexity of the complexity of the
        // contained code flow. This reflects the fact that nested loops
        // are very expensive to analyze.
        this._functionCodeFlowComplexity = this._functionCodeFlowComplexity * 2 + savedCodeFlowComplexity;
    }

    private _addAntecedent(label: FlowLabel, antecedent: FlowNode) {
        if (!(this._currentFlowNode!.flags & FlowFlags.Unreachable)) {
            // Don't add the same antecedent twice.
            if (!label.antecedents.some((existing) => existing.id === antecedent.id)) {
                label.antecedents.push(antecedent);
            }
        }
    }

    private _bindNameToScope(scope: Scope, name: string, addedSymbols?: Map<string, Symbol>) {
        // Is this name already bound to a scope other than the local one?
        const bindingType = this._currentScope.getBindingType(name);

        if (bindingType !== undefined) {
            const scopeToUse =
                bindingType === NameBindingType.Nonlocal
                    ? this._currentScope.parent!
                    : this._currentScope.getGlobalScope();
            const symbolWithScope = scopeToUse.lookUpSymbolRecursive(name);
            if (symbolWithScope) {
                return symbolWithScope.symbol;
            }
        } else {
            // Don't overwrite an existing symbol.
            let symbol = scope.lookUpSymbol(name);
            if (!symbol) {
                symbol = scope.addSymbol(name, SymbolFlags.InitiallyUnbound | SymbolFlags.ClassMember);

                // Handle the case where a new symbol is being added to a class
                // but the expression assigned to it uses a symbol of the same
                // name that is declared in an outer scope.
                if (scope.type === ScopeType.Class) {
                    const aliasSymbol = scope.parent!.lookUpSymbol(name);
                    if (aliasSymbol) {
                        this._createAssignmentAliasFlowNode(symbol.id, aliasSymbol.id);
                    }
                }

                if (this._currentScope.type === ScopeType.Module || this._currentScope.type === ScopeType.Builtin) {
                    if (isPrivateOrProtectedName(name)) {
                        if (isPrivateName(name)) {
                            // Private names are obscured, so they are always externally hidden.
                            symbol.setIsExternallyHidden();
                        } else if (this._fileInfo.isStubFile || this._fileInfo.isInPyTypedPackage) {
                            if (this._currentScope.type === ScopeType.Builtin) {
                                // Don't include private-named symbols in the builtin scope.
                                symbol.setIsExternallyHidden();
                            } else {
                                this._potentialPrivateSymbols.set(name, symbol);
                            }
                        } else {
                            symbol.setIsPrivateMember();
                        }
                    }
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
                target.expressions.forEach((expr) => {
                    this._bindPossibleTupleNamedTarget(expr, addedSymbols);
                });
                break;
            }

            case ParseNodeType.List: {
                target.entries.forEach((expr) => {
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

    private _addBuiltInSymbolToCurrentScope(
        nameValue: string,
        node: ModuleNode | ClassNode | FunctionNode,
        type: IntrinsicType
    ) {
        const symbol = this._addSymbolToCurrentScope(nameValue, /* isInitiallyUnbound */ false);
        if (symbol) {
            symbol.addDeclaration({
                type: DeclarationType.Intrinsic,
                node,
                intrinsicType: type,
                path: this._fileInfo.filePath,
                range: getEmptyRange(),
                moduleName: this._fileInfo.moduleName,
            });
            symbol.setIsIgnoredForProtocolMatch();
        }
    }

    // Adds a new symbol with the specified name if it doesn't already exist.
    private _addSymbolToCurrentScope(nameValue: string, isInitiallyUnbound: boolean) {
        let symbol = this._currentScope.lookUpSymbol(nameValue);

        if (!symbol) {
            let symbolFlags = SymbolFlags.None;

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

    private _createNewScope(scopeType: ScopeType, parentScope: Scope | undefined, callback: () => void) {
        const prevScope = this._currentScope;
        const newScope = new Scope(scopeType, parentScope);
        this._currentScope = newScope;

        // If this scope is an execution scope, allocate a new reference map.
        const isExecutionScope =
            scopeType === ScopeType.Builtin || scopeType === ScopeType.Module || scopeType === ScopeType.Function;
        const prevExpressions = this._currentScopeCodeFlowExpressions;

        if (isExecutionScope) {
            this._currentScopeCodeFlowExpressions = new Set<string>();
        }

        callback();

        this._currentScopeCodeFlowExpressions = prevExpressions;
        this._currentScope = prevScope;

        return newScope;
    }

    private _addInferredTypeAssignmentForVariable(
        target: ExpressionNode,
        source: ParseNode,
        isPossibleTypeAlias = false
    ) {
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
                        typeAliasName: isPossibleTypeAlias ? target : undefined,
                        path: this._fileInfo.filePath,
                        range: convertOffsetsToRange(name.start, TextRange.getEnd(name), this._fileInfo.lines),
                        moduleName: this._fileInfo.moduleName,
                        docString: this._getVariableDocString(target),
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
                        symbol = memberAccessInfo.classScope.addSymbol(name.value, SymbolFlags.InitiallyUnbound);
                        const honorPrivateNaming = this._fileInfo.diagnosticRuleSet.reportPrivateUsage !== 'none';
                        if (isPrivateOrProtectedName(name.value) && honorPrivateNaming) {
                            symbol.setIsPrivateMember();
                        }
                    }

                    if (memberAccessInfo.isInstanceMember) {
                        // If a method (which has a declared type) is being overwritten
                        // by an expression with no declared type, don't mark it as
                        // an instance member because the type evaluator will think
                        // that it doesn't need to perform object binding.
                        if (
                            !symbol.isClassMember() ||
                            !symbol
                                .getDeclarations()
                                .some((decl) => decl.type === DeclarationType.Function && decl.isMethod)
                        ) {
                            symbol.setIsInstanceMember();
                        }
                    } else {
                        symbol.setIsClassMember();
                    }

                    const declaration: VariableDeclaration = {
                        type: DeclarationType.Variable,
                        node: target.memberName,
                        isConstant: isConstantName(name.value),
                        inferredTypeSource: source,
                        isDefinedByMemberAccess: true,
                        path: this._fileInfo.filePath,
                        range: convertOffsetsToRange(
                            target.memberName.start,
                            target.memberName.start + target.memberName.length,
                            this._fileInfo.lines
                        ),
                        moduleName: this._fileInfo.moduleName,
                        docString: this._getVariableDocString(target),
                    };
                    symbol.addDeclaration(declaration);
                }
                break;
            }

            case ParseNodeType.Tuple: {
                target.expressions.forEach((expr) => {
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
                target.entries.forEach((entry) => {
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
                    const isExplicitTypeAlias = this._isAnnotationTypeAlias(typeAnnotation);

                    let typeAnnotationNode: ExpressionNode | undefined = typeAnnotation;
                    if (isExplicitTypeAlias) {
                        typeAnnotationNode = undefined;

                        // Type aliases are allowed only in the global or class scope.
                        if (
                            this._currentScope.type !== ScopeType.Class &&
                            this._currentScope.type !== ScopeType.Module &&
                            this._currentScope.type !== ScopeType.Builtin
                        ) {
                            this._addError(Localizer.Diagnostic.typeAliasNotInModuleOrClass(), typeAnnotation);
                        }
                    } else if (finalInfo.isFinal) {
                        typeAnnotationNode = finalInfo.finalTypeNode;
                    }

                    // Is this annotation indicating that the variable is a "ClassVar"?
                    let classVarInfo = this._isAnnotationClassVar(typeAnnotation);

                    if (classVarInfo.isClassVar) {
                        typeAnnotationNode = classVarInfo.classVarTypeNode;
                    }

                    // PEP 591 indicates that a Final variable initialized within a class
                    // body should also be considered a ClassVar.
                    if (finalInfo.isFinal) {
                        const containingClass = ParseTreeUtils.getEnclosingClassOrFunction(target);
                        if (containingClass && containingClass.nodeType === ParseNodeType.Class) {
                            // Make sure it's part of an assignment.
                            if (
                                target.parent?.nodeType === ParseNodeType.Assignment ||
                                target.parent?.parent?.nodeType === ParseNodeType.Assignment
                            ) {
                                classVarInfo = {
                                    isClassVar: true,
                                    classVarTypeNode: undefined,
                                };
                            }
                        }
                    }

                    const declaration: VariableDeclaration = {
                        type: DeclarationType.Variable,
                        node: target,
                        isConstant: isConstantName(name.value),
                        isFinal: finalInfo.isFinal,
                        isRequired: this._isRequiredAnnotation(typeAnnotationNode),
                        isNotRequired: this._isNotRequiredAnnotation(typeAnnotationNode),
                        typeAliasAnnotation: isExplicitTypeAlias ? typeAnnotation : undefined,
                        typeAliasName: isExplicitTypeAlias ? target : undefined,
                        path: this._fileInfo.filePath,
                        typeAnnotationNode,
                        range: convertOffsetsToRange(name.start, TextRange.getEnd(name), this._fileInfo.lines),
                        moduleName: this._fileInfo.moduleName,
                        docString: this._getVariableDocString(target),
                    };
                    symbolWithScope.symbol.addDeclaration(declaration);

                    if (classVarInfo.isClassVar) {
                        symbolWithScope.symbol.setIsClassVar();
                    } else {
                        symbolWithScope.symbol.setIsInstanceMember();
                    }

                    if (
                        typeAnnotation.nodeType === ParseNodeType.Index &&
                        this._isDataclassesAnnotation(typeAnnotation.baseExpression, 'InitVar')
                    ) {
                        symbolWithScope.symbol.setIsInitVar();
                    }
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
                        symbol = memberAccessInfo.classScope.addSymbol(name.value, SymbolFlags.InitiallyUnbound);
                        const honorPrivateNaming = this._fileInfo.diagnosticRuleSet.reportPrivateUsage !== 'none';
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
                        isDefinedByMemberAccess: true,
                        isFinal: finalInfo.isFinal,
                        path: this._fileInfo.filePath,
                        typeAnnotationNode: finalInfo.isFinal ? finalInfo.finalTypeNode : typeAnnotation,
                        range: convertOffsetsToRange(
                            target.memberName.start,
                            target.memberName.start + target.memberName.length,
                            this._fileInfo.lines
                        ),
                        moduleName: this._fileInfo.moduleName,
                        docString: this._getVariableDocString(target),
                    };
                    symbol.addDeclaration(declaration);

                    declarationHandled = true;
                }
                break;
            }
        }

        if (!declarationHandled) {
            this._addError(Localizer.Diagnostic.annotationNotSupported(), typeAnnotation);
        }
    }

    // Determines whether the expression refers to a type exported by the typing
    // or typing_extensions modules. We can directly evaluate the types at binding
    // time. We assume here that the code isn't making use of some custom type alias
    // to refer to the typing types.
    private _isTypingAnnotation(typeAnnotation: ExpressionNode, name: string): boolean {
        return this._isKnownAnnotation(typeAnnotation, name, this._typingImportAliases, this._typingSymbolAliases);
    }

    private _isDataclassesAnnotation(typeAnnotation: ExpressionNode, name: string): boolean {
        return this._isKnownAnnotation(
            typeAnnotation,
            name,
            this._dataclassesImportAliases,
            this._dataclassesSymbolAliases
        );
    }

    private _isKnownAnnotation(
        typeAnnotation: ExpressionNode,
        name: string,
        importAliases: string[],
        symbolAliases: Map<string, string>
    ) {
        if (typeAnnotation.nodeType === ParseNodeType.Name) {
            const alias = symbolAliases.get(typeAnnotation.value);
            if (alias === name) {
                return true;
            }
        } else if (typeAnnotation.nodeType === ParseNodeType.MemberAccess) {
            if (
                typeAnnotation.leftExpression.nodeType === ParseNodeType.Name &&
                typeAnnotation.memberName.value === name
            ) {
                const baseName = typeAnnotation.leftExpression.value;
                return importAliases.some((alias) => alias === baseName);
            }
        }

        return false;
    }

    private _getVariableDocString(node: ExpressionNode): string | undefined {
        // Walk up the parse tree to find an assignment expression.
        let curNode: ParseNode | undefined = node;
        let annotationNode: TypeAnnotationNode | undefined;

        while (curNode) {
            if (curNode.nodeType === ParseNodeType.Assignment) {
                break;
            }

            if (curNode.nodeType === ParseNodeType.TypeAnnotation && !annotationNode) {
                annotationNode = curNode;
            }

            curNode = curNode.parent;
        }

        if (curNode?.nodeType !== ParseNodeType.Assignment) {
            // Allow a simple annotation statement to have a docstring even
            // though PEP 258 doesn't mention this case. This PEP pre-dated
            // PEP 526, so it didn't contemplate this situation.
            if (annotationNode) {
                curNode = annotationNode;
            } else {
                return undefined;
            }
        }

        const parentNode = curNode.parent;
        if (parentNode?.nodeType !== ParseNodeType.StatementList) {
            return undefined;
        }

        const suiteOrModule = parentNode.parent;
        if (
            !suiteOrModule ||
            (suiteOrModule.nodeType !== ParseNodeType.Module && suiteOrModule.nodeType !== ParseNodeType.Suite)
        ) {
            return undefined;
        }

        const assignmentIndex = suiteOrModule.statements.findIndex((node) => node === parentNode);
        if (assignmentIndex < 0 || assignmentIndex === suiteOrModule.statements.length - 1) {
            return undefined;
        }

        const nextStatement = suiteOrModule.statements[assignmentIndex + 1];

        if (nextStatement.nodeType !== ParseNodeType.StatementList || !ParseTreeUtils.isDocString(nextStatement)) {
            return undefined;
        }

        // See if the assignment is within one of the contexts specified in PEP 258.
        let isValidContext = false;
        if (parentNode?.parent?.nodeType === ParseNodeType.Module) {
            // If we're at the top level of a module, the attribute docstring is valid.
            isValidContext = true;
        } else if (
            parentNode?.parent?.nodeType === ParseNodeType.Suite &&
            parentNode?.parent?.parent?.nodeType === ParseNodeType.Class
        ) {
            // If we're at the top level of a class, the attribute docstring is valid.
            isValidContext = true;
        } else {
            const func = ParseTreeUtils.getEnclosingFunction(parentNode);

            // If we're within an __init__ method, the attribute docstring is valid.
            if (
                func &&
                func.name.value === '__init__' &&
                ParseTreeUtils.getEnclosingClass(func, /* stopAtFunction */ true)
            ) {
                isValidContext = true;
            }
        }

        if (!isValidContext) {
            return undefined;
        }

        // A docstring can consist of multiple joined strings in a single expression.
        const strings = (nextStatement.statements[0] as StringListNode).strings;
        if (strings.length === 1) {
            // Common case.
            return strings[0].value;
        }

        return strings.map((s) => s.value).join('');
    }

    // Determines if the specified type annotation expression is a "Final".
    // It returns a value indicating whether the expression is a "Final"
    // expression and whether it's a "raw" Final with no type arguments.
    private _isAnnotationFinal(typeAnnotation: ExpressionNode | undefined): FinalInfo {
        let isFinal = false;
        let finalTypeNode: ExpressionNode | undefined;

        if (typeAnnotation) {
            if (this._isTypingAnnotation(typeAnnotation, 'Final')) {
                isFinal = true;
            } else if (typeAnnotation.nodeType === ParseNodeType.Index && typeAnnotation.items.length === 1) {
                // Recursively call to see if the base expression is "Final".
                const finalInfo = this._isAnnotationFinal(typeAnnotation.baseExpression);
                if (
                    finalInfo.isFinal &&
                    typeAnnotation.items[0].argumentCategory === ArgumentCategory.Simple &&
                    !typeAnnotation.items[0].name &&
                    !typeAnnotation.trailingComma
                ) {
                    isFinal = true;
                    finalTypeNode = typeAnnotation.items[0].valueExpression;
                }
            }
        }

        return { isFinal, finalTypeNode };
    }

    // Determines if the specified type annotation expression is a "ClassVar".
    // It returns a value indicating whether the expression is a "ClassVar"
    // expression and whether it's a "raw" ClassVar with no type arguments.
    private _isAnnotationClassVar(typeAnnotation: ExpressionNode | undefined): ClassVarInfo {
        let isClassVar = false;
        let classVarTypeNode: ExpressionNode | undefined;

        if (typeAnnotation) {
            if (this._isTypingAnnotation(typeAnnotation, 'ClassVar')) {
                isClassVar = true;
            } else if (typeAnnotation.nodeType === ParseNodeType.Index && typeAnnotation.items.length === 1) {
                // Recursively call to see if the base expression is "ClassVar".
                const finalInfo = this._isAnnotationClassVar(typeAnnotation.baseExpression);
                if (
                    finalInfo.isClassVar &&
                    typeAnnotation.items[0].argumentCategory === ArgumentCategory.Simple &&
                    !typeAnnotation.items[0].name &&
                    !typeAnnotation.trailingComma
                ) {
                    isClassVar = true;
                    classVarTypeNode = typeAnnotation.items[0].valueExpression;
                }
            }
        }

        return { isClassVar, classVarTypeNode };
    }

    // Determines if the specified type annotation is wrapped in a "Required".
    private _isRequiredAnnotation(typeAnnotation: ExpressionNode | undefined): boolean {
        if (typeAnnotation && typeAnnotation.nodeType === ParseNodeType.Index && typeAnnotation.items.length === 1) {
            if (this._isTypingAnnotation(typeAnnotation.baseExpression, 'Required')) {
                return true;
            }
        }

        return false;
    }

    // Determines if the specified type annotation is wrapped in a "NotRequired".
    private _isNotRequiredAnnotation(typeAnnotation: ExpressionNode | undefined): boolean {
        if (typeAnnotation && typeAnnotation.nodeType === ParseNodeType.Index && typeAnnotation.items.length === 1) {
            if (this._isTypingAnnotation(typeAnnotation.baseExpression, 'NotRequired')) {
                return true;
            }
        }

        return false;
    }

    private _isAnnotationTypeAlias(typeAnnotation: ExpressionNode | undefined) {
        if (!typeAnnotation) {
            return false;
        }

        return this._isTypingAnnotation(typeAnnotation, 'TypeAlias');
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
                    if (decorator.expression.nodeType === ParseNodeType.Name) {
                        const decoratorName = decorator.expression.value;

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
            isInstanceMember,
        };
    }

    private _addImplicitImportsToLoaderActions(importResult: ImportResult, loaderActions: ModuleLoaderActions) {
        importResult.filteredImplicitImports.forEach((implicitImport) => {
            const existingLoaderAction = loaderActions.implicitImports
                ? loaderActions.implicitImports.get(implicitImport.name)
                : undefined;
            if (existingLoaderAction) {
                existingLoaderAction.path = implicitImport.path;
                existingLoaderAction.loadSymbolsFromPath = true;
            } else {
                if (!loaderActions.implicitImports) {
                    loaderActions.implicitImports = new Map<string, ModuleLoaderActions>();
                }
                loaderActions.implicitImports.set(implicitImport.name, {
                    path: implicitImport.path,
                    loadSymbolsFromPath: true,
                    implicitImports: new Map<string, ModuleLoaderActions>(),
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
        const specialTypes: Map<string, boolean> = new Map([
            ['Tuple', true],
            ['Generic', true],
            ['Protocol', true],
            ['Callable', true],
            ['Type', true],
            ['ClassVar', true],
            ['Final', true],
            ['Literal', true],
            ['TypedDict', true],
            ['Union', true],
            ['Optional', true],
            ['Annotated', true],
            ['TypeAlias', true],
            ['OrderedDict', true],
            ['Concatenate', true],
            ['TypeGuard', true],
            ['Unpack', true],
            ['Self', true],
            ['NoReturn', true],
        ]);

        const assignedName = assignedNameNode.value;

        if (!specialTypes.has(assignedName)) {
            return false;
        }
        const symbol = this._bindNameToScope(this._currentScope, assignedName);

        if (symbol) {
            symbol.addDeclaration({
                type: DeclarationType.SpecialBuiltInClass,
                node: annotationNode,
                path: this._fileInfo.filePath,
                range: convertOffsetsToRange(
                    annotationNode.start,
                    TextRange.getEnd(annotationNode),
                    this._fileInfo.lines
                ),
                moduleName: this._fileInfo.moduleName,
            });
        }
        return true;
    }

    private _deferBinding(callback: () => void) {
        if (this._moduleSymbolOnly) {
            return;
        }

        this._deferredBindingTasks.push({
            scope: this._currentScope,
            codeFlowExpressions: this._currentScopeCodeFlowExpressions!,
            callback,
        });
    }

    private _bindDeferred() {
        while (this._deferredBindingTasks.length > 0) {
            const nextItem = this._deferredBindingTasks.shift()!;

            // Reset the state
            this._currentScope = nextItem.scope;
            this._currentScopeCodeFlowExpressions = nextItem.codeFlowExpressions;

            nextItem.callback();
        }
    }

    private _bindYield(node: YieldNode | YieldFromNode) {
        const functionNode = ParseTreeUtils.getEnclosingFunction(node);

        if (!functionNode) {
            if (!ParseTreeUtils.getEnclosingLambda(node)) {
                this._addError(Localizer.Diagnostic.yieldOutsideFunction(), node);
            }
        } else if (functionNode.isAsync && node.nodeType === ParseNodeType.YieldFrom) {
            // PEP 525 indicates that 'yield from' is not allowed in an
            // async function.
            this._addError(Localizer.Diagnostic.yieldFromOutsideAsync(), node);
        }

        if (this._targetFunctionDeclaration) {
            if (!this._targetFunctionDeclaration.yieldStatements) {
                this._targetFunctionDeclaration.yieldStatements = [];
            }
            this._targetFunctionDeclaration.yieldStatements.push(node);
            this._targetFunctionDeclaration.isGenerator = true;
        }

        if (node.expression) {
            this.walk(node.expression);
        }

        AnalyzerNodeInfo.setFlowNode(node, this._currentFlowNode!);
    }

    private _addDiagnostic(diagLevel: DiagnosticLevel, rule: string, message: string, textRange: TextRange) {
        let diagnostic: Diagnostic | undefined;
        switch (diagLevel) {
            case 'error':
                diagnostic = this._addError(message, textRange);
                break;

            case 'warning':
                diagnostic = this._addWarning(message, textRange);
                break;

            case 'information':
                diagnostic = this._addInformation(message, textRange);
                break;

            case 'none':
                break;

            default:
                return assertNever(diagLevel, `${diagLevel} is not expected`);
        }

        if (diagnostic) {
            diagnostic.setRule(rule);
        }

        return diagnostic;
    }

    private _addError(message: string, textRange: TextRange) {
        return this._fileInfo.diagnosticSink.addDiagnosticWithTextRange('error', message, textRange);
    }

    private _addWarning(message: string, textRange: TextRange) {
        return this._fileInfo.diagnosticSink.addDiagnosticWithTextRange('warning', message, textRange);
    }

    private _addInformation(message: string, textRange: TextRange) {
        return this._fileInfo.diagnosticSink.addDiagnosticWithTextRange('information', message, textRange);
    }
}

export class YieldFinder extends ParseTreeWalker {
    private _containsYield = false;

    checkContainsYield(node: ParseNode) {
        this.walk(node);
        return this._containsYield;
    }

    override visitYield(node: YieldNode): boolean {
        this._containsYield = true;
        return false;
    }

    override visitYieldFrom(node: YieldFromNode): boolean {
        this._containsYield = true;
        return false;
    }
}

export class ReturnFinder extends ParseTreeWalker {
    private _containsReturn = false;

    checkContainsReturn(node: ParseNode) {
        this.walk(node);
        return this._containsReturn;
    }

    override visitReturn(node: ReturnNode): boolean {
        this._containsReturn = true;
        return false;
    }
}
