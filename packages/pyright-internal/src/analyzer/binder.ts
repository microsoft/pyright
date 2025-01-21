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
import { appendArray } from '../common/collectionUtils';
import { DiagnosticLevel } from '../common/configOptions';
import { assert, assertNever, fail } from '../common/debug';
import { CreateTypeStubFileAction, Diagnostic } from '../common/diagnostic';
import { DiagnosticRule } from '../common/diagnosticRules';
import { stripFileExtension } from '../common/pathUtils';
import { convertTextRangeToRange } from '../common/positionUtils';
import { TextRange, getEmptyRange } from '../common/textRange';
import { Uri } from '../common/uri/uri';
import { LocMessage } from '../localization/localize';
import {
    ArgCategory,
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
    ComprehensionNode,
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
    TypeAliasNode,
    TypeAnnotationNode,
    TypeParameterListNode,
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
    FlowAssignment,
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
    createKeyForReference,
    getUniqueFlowNodeId,
    isCodeFlowSupportedForReference,
    wildcardImportReferenceKey,
} from './codeFlowTypes';
import {
    AliasDeclaration,
    ClassDeclaration,
    DeclarationType,
    FunctionDeclaration,
    IntrinsicType,
    ModuleLoaderActions,
    ParamDeclaration,
    SpecialBuiltInClassDeclaration,
    TypeAliasDeclaration,
    TypeParamDeclaration,
    UnresolvedModuleMarker,
    VariableDeclaration,
} from './declaration';
import { ImplicitImport, ImportResult, ImportType } from './importResult';
import * as ParseTreeUtils from './parseTreeUtils';
import { ParseTreeWalker } from './parseTreeWalker';
import { NameBindingType, Scope, ScopeType } from './scope';
import * as StaticExpressions from './staticExpressions';
import { Symbol, SymbolFlags, indeterminateSymbolId } from './symbol';
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

interface NarrowExprOptions {
    filterForNeverNarrowing?: boolean;
    isComplexExpression?: boolean;
    allowDiscriminatedNarrowing?: boolean;
}

// For each flow node within an execution context, we'll add a small
// amount to the complexity factor. Without this, the complexity
// calculation fails to take into account large numbers of non-cyclical
// flow nodes. This number is somewhat arbitrary and is tuned empirically.
const flowNodeComplexityContribution = 0.05;

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

    // If we're actively binding a match statement, this is the current
    // match expression.
    private _currentMatchSubjExpr: ExpressionNode | undefined;

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

    // One or more statements are manipulating __all__ in a manner that a
    // static analyzer doesn't understand.
    private _usesUnsupportedDunderAllForm = false;

    // Are we currently binding code located within an except block?
    private _isInExceptSuite = false;

    // Are we currently walking the type arguments to an Annotated type annotation?
    private _isInAnnotatedAnnotation = false;

    // A list of names assigned to __slots__ within a class.
    private _dunderSlotsEntries: StringListNode[] | undefined;

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
    private _codeFlowComplexity = 0;

    constructor(fileInfo: AnalyzerFileInfo, private _moduleSymbolOnly = false) {
        super();

        this._fileInfo = fileInfo;
    }

    bindModule(node: ModuleNode): void {
        // We'll assume that if there is no builtins scope provided, we must be
        // binding the builtins module itself.
        const isBuiltInModule = this._fileInfo.builtinsScope === undefined;

        this._addTypingImportAliasesFromBuiltinsScope();

        this._createNewScope(
            isBuiltInModule ? ScopeType.Builtin : ScopeType.Module,
            this._fileInfo.builtinsScope,
            /* proxyScope */ undefined,
            () => {
                AnalyzerNodeInfo.setScope(node, this._currentScope);
                AnalyzerNodeInfo.setFlowNode(node, this._currentFlowNode!);

                // Bind implicit names.
                // List taken from https://docs.python.org/3/reference/import.html#__name__
                this._addImplicitSymbolToCurrentScope('__name__', node, 'str');
                this._addImplicitSymbolToCurrentScope('__loader__', node, 'Any');
                this._addImplicitSymbolToCurrentScope('__package__', node, 'str | None');
                this._addImplicitSymbolToCurrentScope('__spec__', node, 'Any');
                this._addImplicitSymbolToCurrentScope('__path__', node, 'Iterable[str]');
                this._addImplicitSymbolToCurrentScope('__file__', node, 'str');
                this._addImplicitSymbolToCurrentScope('__cached__', node, 'str');
                this._addImplicitSymbolToCurrentScope('__dict__', node, 'Dict[str, Any]');
                this._addImplicitSymbolToCurrentScope('__annotations__', node, 'Dict[str, Any]');
                this._addImplicitSymbolToCurrentScope('__builtins__', node, 'Any');
                this._addImplicitSymbolToCurrentScope('__doc__', node, 'str | None');

                // Create a start node for the module.
                this._currentFlowNode = this._createStartFlowNode();

                this._walkStatementsAndReportUnreachable(node.d.statements);

                // Associate the code flow node at the end of the module with the module.
                AnalyzerNodeInfo.setAfterFlowNode(node, this._currentFlowNode);

                AnalyzerNodeInfo.setCodeFlowExpressions(node, this._currentScopeCodeFlowExpressions!);
                AnalyzerNodeInfo.setCodeFlowComplexity(node, this._codeFlowComplexity);
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
                usesUnsupportedDunderAllForm: this._usesUnsupportedDunderAllForm,
            });
        } else {
            AnalyzerNodeInfo.setDunderAllInfo(node, /* names */ undefined);
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
        this._walkStatementsAndReportUnreachable(node.d.statements);
        return false;
    }

    override visitModuleName(node: ModuleNameNode): boolean {
        const importResult = AnalyzerNodeInfo.getImportInfo(node);
        assert(importResult !== undefined);

        if (importResult.isNativeLib) {
            return true;
        }

        if (!importResult.isImportFound) {
            this._addDiagnostic(
                DiagnosticRule.reportMissingImports,
                LocMessage.importResolveFailure().format({
                    importName: importResult.importName,
                    venv: this._fileInfo.executionEnvironment.name,
                }),
                node
            );
            return true;
        }

        // A source file was found, but the type stub was missing.
        if (
            !importResult.isStubFile &&
            importResult.importType === ImportType.ThirdParty &&
            !importResult.pyTypedInfo
        ) {
            const diagnostic = this._addDiagnostic(
                DiagnosticRule.reportMissingTypeStubs,
                LocMessage.stubFileMissing().format({ importName: importResult.importName }),
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

        return true;
    }

    override visitClass(node: ClassNode): boolean {
        this.walkMultiple(node.d.decorators);

        const classDeclaration: ClassDeclaration = {
            type: DeclarationType.Class,
            node,
            uri: this._fileInfo.fileUri,
            range: convertTextRangeToRange(node.d.name, this._fileInfo.lines),
            moduleName: this._fileInfo.moduleName,
            isInExceptSuite: this._isInExceptSuite,
        };

        const symbol = this._bindNameToScope(this._currentScope, node.d.name);
        if (symbol) {
            symbol.addDeclaration(classDeclaration);
        }

        // Stash the declaration in the parse node for later access.
        AnalyzerNodeInfo.setDeclaration(node, classDeclaration);

        let typeParamScope: Scope | undefined;
        if (node.d.typeParams) {
            this.walk(node.d.typeParams);
            typeParamScope = AnalyzerNodeInfo.getScope(node.d.typeParams);
        }

        this.walkMultiple(node.d.arguments);

        this._createNewScope(
            ScopeType.Class,
            typeParamScope ?? this._getNonClassParentScope(),
            /* proxyScope */ undefined,
            () => {
                AnalyzerNodeInfo.setScope(node, this._currentScope);

                this._addImplicitSymbolToCurrentScope('__doc__', node, 'str | None');
                this._addImplicitSymbolToCurrentScope('__module__', node, 'str');
                this._addImplicitSymbolToCurrentScope('__qualname__', node, 'str');

                this._dunderSlotsEntries = undefined;
                if (!this._moduleSymbolOnly) {
                    // Analyze the suite.
                    this.walk(node.d.suite);
                }

                if (this._dunderSlotsEntries) {
                    this._addSlotsToCurrentScope(this._dunderSlotsEntries);
                }
                this._dunderSlotsEntries = undefined;
            }
        );

        this._createAssignmentTargetFlowNodes(node.d.name, /* walkTargets */ false, /* unbound */ false);

        return false;
    }

    override visitFunction(node: FunctionNode): boolean {
        this._createVariableAnnotationFlowNode();
        AnalyzerNodeInfo.setFlowNode(node, this._currentFlowNode!);

        const symbol = this._bindNameToScope(this._currentScope, node.d.name);
        const containingClassNode = ParseTreeUtils.getEnclosingClass(node, /* stopAtFunction */ true);
        const functionDeclaration: FunctionDeclaration = {
            type: DeclarationType.Function,
            node,
            isMethod: !!containingClassNode,
            isGenerator: false,
            uri: this._fileInfo.fileUri,
            range: convertTextRangeToRange(node.d.name, this._fileInfo.lines),
            moduleName: this._fileInfo.moduleName,
            isInExceptSuite: this._isInExceptSuite,
        };

        if (symbol) {
            symbol.addDeclaration(functionDeclaration);
        }

        // Stash the declaration in the parse node for later access.
        AnalyzerNodeInfo.setDeclaration(node, functionDeclaration);

        // Walk the default values prior to the type parameters.
        node.d.params.forEach((param) => {
            if (param.d.defaultValue) {
                this.walk(param.d.defaultValue);
            }
        });

        let typeParamScope: Scope | undefined;
        if (node.d.typeParams) {
            this.walk(node.d.typeParams);
            typeParamScope = AnalyzerNodeInfo.getScope(node.d.typeParams);
        }

        this.walkMultiple(node.d.decorators);

        node.d.params.forEach((param) => {
            if (param.d.annotation) {
                this.walk(param.d.annotation);
            }

            if (param.d.annotationComment) {
                this.walk(param.d.annotationComment);
            }
        });

        if (node.d.returnAnnotation) {
            this.walk(node.d.returnAnnotation);
        }

        if (node.d.funcAnnotationComment) {
            this.walk(node.d.funcAnnotationComment);
        }

        // Don't walk the body of the function until we're done analyzing
        // the current scope.
        this._createNewScope(
            ScopeType.Function,
            typeParamScope ?? this._getNonClassParentScope(),
            /* proxyScope */ undefined,
            () => {
                AnalyzerNodeInfo.setScope(node, this._currentScope);

                const enclosingClass = ParseTreeUtils.getEnclosingClass(node);
                if (enclosingClass) {
                    // Add the implicit "__class__" symbol described in PEP 3135.
                    this._addImplicitSymbolToCurrentScope('__class__', node, 'type[self]');
                }

                this._deferBinding(() => {
                    // Create a start node for the function.
                    this._currentFlowNode = this._createStartFlowNode();
                    this._codeFlowComplexity = 0;

                    node.d.params.forEach((paramNode) => {
                        if (paramNode.d.name) {
                            const symbol = this._bindNameToScope(this._currentScope, paramNode.d.name);

                            if (symbol) {
                                const paramDeclaration: ParamDeclaration = {
                                    type: DeclarationType.Param,
                                    node: paramNode,
                                    uri: this._fileInfo.fileUri,
                                    range: convertTextRangeToRange(paramNode, this._fileInfo.lines),
                                    moduleName: this._fileInfo.moduleName,
                                    isInExceptSuite: this._isInExceptSuite,
                                };

                                symbol.addDeclaration(paramDeclaration);
                                AnalyzerNodeInfo.setDeclaration(paramNode.d.name, paramDeclaration);
                            }

                            this._createFlowAssignment(paramNode.d.name);
                        }
                    });

                    this._targetFunctionDeclaration = functionDeclaration;
                    this._currentReturnTarget = this._createBranchLabel();

                    // Walk the statements that make up the function.
                    this.walk(node.d.suite);

                    this._targetFunctionDeclaration = undefined;

                    // Associate the code flow node at the end of the suite with
                    // the suite.
                    AnalyzerNodeInfo.setAfterFlowNode(node.d.suite, this._currentFlowNode);

                    // Compute the final return flow node and associate it with
                    // the function's parse node. If this node is unreachable, then
                    // the function never returns.
                    this._addAntecedent(this._currentReturnTarget, this._currentFlowNode);
                    const returnFlowNode = this._finishFlowLabel(this._currentReturnTarget);

                    AnalyzerNodeInfo.setAfterFlowNode(node, returnFlowNode);

                    AnalyzerNodeInfo.setCodeFlowExpressions(node, this._currentScopeCodeFlowExpressions!);
                    AnalyzerNodeInfo.setCodeFlowComplexity(node, this._codeFlowComplexity);
                });
            }
        );

        this._createAssignmentTargetFlowNodes(node.d.name, /* walkTargets */ false, /* unbound */ false);

        // We'll walk the child nodes in a deferred manner, so don't walk them now.
        return false;
    }

    override visitLambda(node: LambdaNode): boolean {
        this._createVariableAnnotationFlowNode();
        AnalyzerNodeInfo.setFlowNode(node, this._currentFlowNode!);

        // Analyze the parameter defaults in the context of the parent's scope
        // before we add any names from the function's scope.
        node.d.params.forEach((param) => {
            if (param.d.defaultValue) {
                this.walk(param.d.defaultValue);
            }
        });

        this._createNewScope(ScopeType.Function, this._getNonClassParentScope(), /* proxyScope */ undefined, () => {
            AnalyzerNodeInfo.setScope(node, this._currentScope);

            this._deferBinding(() => {
                // Create a start node for the lambda.
                this._currentFlowNode = this._createStartFlowNode();

                node.d.params.forEach((paramNode) => {
                    if (paramNode.d.name) {
                        const symbol = this._bindNameToScope(this._currentScope, paramNode.d.name);
                        if (symbol) {
                            const paramDeclaration: ParamDeclaration = {
                                type: DeclarationType.Param,
                                node: paramNode,
                                uri: this._fileInfo.fileUri,
                                range: convertTextRangeToRange(paramNode, this._fileInfo.lines),
                                moduleName: this._fileInfo.moduleName,
                                isInExceptSuite: this._isInExceptSuite,
                            };

                            symbol.addDeclaration(paramDeclaration);
                            AnalyzerNodeInfo.setDeclaration(paramNode.d.name, paramDeclaration);
                        }

                        this._createFlowAssignment(paramNode.d.name);
                        this.walk(paramNode.d.name);
                        AnalyzerNodeInfo.setFlowNode(paramNode, this._currentFlowNode!);
                    }
                });

                // Walk the expression that make up the lambda body.
                this.walk(node.d.expr);

                AnalyzerNodeInfo.setCodeFlowExpressions(node, this._currentScopeCodeFlowExpressions!);
            });
        });

        // We'll walk the child nodes in a deferred manner.
        return false;
    }

    override visitCall(node: CallNode): boolean {
        this._disableTrueFalseTargets(() => {
            this.walk(node.d.leftExpr);

            const sortedArgs = ParseTreeUtils.getArgsByRuntimeOrder(node);

            sortedArgs.forEach((argNode) => {
                if (this._currentFlowNode) {
                    AnalyzerNodeInfo.setFlowNode(argNode, this._currentFlowNode);
                }
                this.walk(argNode);
            });
        });

        // Create a call flow node. We'll skip this if the call is part of
        // a decorator. We assume that decorators are not NoReturn functions.
        // There are libraries that make extensive use of unannotated decorators,
        // and this can lead to a performance issue when walking the control
        // flow graph if we need to evaluate every decorator.
        if (!ParseTreeUtils.isNodeContainedWithinNodeType(node, ParseNodeType.Decorator)) {
            // Skip if we're in an 'Annotated' annotation because this creates
            // problems for "No Return" return type analysis when annotation
            // evaluation is deferred.
            if (!this._isInAnnotatedAnnotation) {
                this._createCallFlowNode(node);
            }
        }

        // Is this an manipulation of dunder all?
        if (
            this._currentScope.type === ScopeType.Module &&
            node.d.leftExpr.nodeType === ParseNodeType.MemberAccess &&
            node.d.leftExpr.d.leftExpr.nodeType === ParseNodeType.Name &&
            node.d.leftExpr.d.leftExpr.d.value === '__all__'
        ) {
            let emitDunderAllWarning = true;

            // Is this a call to "__all__.extend()"?
            if (node.d.leftExpr.d.member.d.value === 'extend' && node.d.args.length === 1) {
                const argExpr = node.d.args[0].d.valueExpr;

                // Is this a call to "__all__.extend([<list>])"?
                if (argExpr.nodeType === ParseNodeType.List) {
                    if (
                        argExpr.d.items.every((listEntryNode) => {
                            if (
                                listEntryNode.nodeType === ParseNodeType.StringList &&
                                listEntryNode.d.strings.length === 1 &&
                                listEntryNode.d.strings[0].nodeType === ParseNodeType.String
                            ) {
                                this._dunderAllNames?.push(listEntryNode.d.strings[0].d.value);
                                this._dunderAllStringNodes?.push(listEntryNode.d.strings[0]);
                                return true;
                            }

                            return false;
                        })
                    ) {
                        emitDunderAllWarning = false;
                    }
                } else if (
                    argExpr.nodeType === ParseNodeType.MemberAccess &&
                    argExpr.d.leftExpr.nodeType === ParseNodeType.Name &&
                    argExpr.d.member.d.value === '__all__'
                ) {
                    // Is this a call to "__all__.extend(<mod>.__all__)"?
                    const namesToAdd = this._getDunderAllNamesFromImport(argExpr.d.leftExpr.d.value);
                    if (namesToAdd && namesToAdd.length > 0) {
                        namesToAdd.forEach((name) => {
                            this._dunderAllNames?.push(name);
                        });
                    }
                    emitDunderAllWarning = false;
                }
            } else if (node.d.leftExpr.d.member.d.value === 'remove' && node.d.args.length === 1) {
                // Is this a call to "__all__.remove()"?
                const argExpr = node.d.args[0].d.valueExpr;
                if (
                    argExpr.nodeType === ParseNodeType.StringList &&
                    argExpr.d.strings.length === 1 &&
                    argExpr.d.strings[0].nodeType === ParseNodeType.String &&
                    this._dunderAllNames
                ) {
                    this._dunderAllNames = this._dunderAllNames.filter((name) => name !== argExpr.d.strings[0].d.value);
                    this._dunderAllStringNodes = this._dunderAllStringNodes.filter(
                        (node) => node.d.value !== argExpr.d.strings[0].d.value
                    );
                    emitDunderAllWarning = false;
                }
            } else if (node.d.leftExpr.d.member.d.value === 'append' && node.d.args.length === 1) {
                // Is this a call to "__all__.append()"?
                const argExpr = node.d.args[0].d.valueExpr;
                if (
                    argExpr.nodeType === ParseNodeType.StringList &&
                    argExpr.d.strings.length === 1 &&
                    argExpr.d.strings[0].nodeType === ParseNodeType.String
                ) {
                    this._dunderAllNames?.push(argExpr.d.strings[0].d.value);
                    this._dunderAllStringNodes?.push(argExpr.d.strings[0]);
                    emitDunderAllWarning = false;
                }
            }

            if (emitDunderAllWarning) {
                this._usesUnsupportedDunderAllForm = true;

                this._addDiagnostic(
                    DiagnosticRule.reportUnsupportedDunderAll,
                    LocMessage.unsupportedDunderAllOperation(),
                    node
                );
            }
        }

        return false;
    }

    override visitTypeParameterList(node: TypeParameterListNode): boolean {
        const typeParamScope = new Scope(ScopeType.TypeParameter, this._getNonClassParentScope(), this._currentScope);

        node.d.params.forEach((param) => {
            if (param.d.boundExpr) {
                this.walk(param.d.boundExpr);
            }
        });

        const typeParamsSeen = new Set<string>();

        node.d.params.forEach((param) => {
            const name = param.d.name;
            const symbol = typeParamScope.addSymbol(name.d.value, SymbolFlags.None);
            const paramDeclaration: TypeParamDeclaration = {
                type: DeclarationType.TypeParam,
                node: param,
                uri: this._fileInfo.fileUri,
                range: convertTextRangeToRange(node, this._fileInfo.lines),
                moduleName: this._fileInfo.moduleName,
                isInExceptSuite: this._isInExceptSuite,
            };

            symbol.addDeclaration(paramDeclaration);
            AnalyzerNodeInfo.setDeclaration(name, paramDeclaration);

            if (typeParamsSeen.has(name.d.value)) {
                this._addSyntaxError(
                    LocMessage.typeParameterExistingTypeParameter().format({ name: name.d.value }),
                    name
                );
            } else {
                typeParamsSeen.add(name.d.value);
            }
        });

        node.d.params.forEach((param) => {
            if (param.d.defaultExpr) {
                this.walk(param.d.defaultExpr);
            }
        });

        AnalyzerNodeInfo.setScope(node, typeParamScope);

        return false;
    }

    override visitTypeAlias(node: TypeAliasNode): boolean {
        this._bindNameToScope(this._currentScope, node.d.name);

        this.walk(node.d.name);

        let typeParamScope: Scope | undefined;
        if (node.d.typeParams) {
            this.walk(node.d.typeParams);
            typeParamScope = AnalyzerNodeInfo.getScope(node.d.typeParams);
        }

        const typeAliasDeclaration: TypeAliasDeclaration = {
            type: DeclarationType.TypeAlias,
            node,
            uri: this._fileInfo.fileUri,
            range: convertTextRangeToRange(node.d.name, this._fileInfo.lines),
            moduleName: this._fileInfo.moduleName,
            isInExceptSuite: this._isInExceptSuite,
            docString: this._getVariableDocString(node.d.expr),
        };

        const symbol = this._bindNameToScope(this._currentScope, node.d.name);
        if (symbol) {
            symbol.addDeclaration(typeAliasDeclaration);
        }

        // Stash the declaration in the parse node for later access.
        AnalyzerNodeInfo.setDeclaration(node, typeAliasDeclaration);

        this._createAssignmentTargetFlowNodes(node.d.name, /* walkTargets */ true, /* unbound */ false);

        const prevScope = this._currentScope;
        this._currentScope = typeParamScope ?? this._currentScope;
        this.walk(node.d.expr);
        this._currentScope = prevScope;

        return false;
    }

    override visitAssignment(node: AssignmentNode): boolean {
        if (this._handleTypingStubAssignmentOrAnnotation(node)) {
            return false;
        }

        this._bindPossibleTupleNamedTarget(node.d.leftExpr);

        if (node.d.annotationComment) {
            this.walk(node.d.annotationComment);
            this._addTypeDeclarationForVariable(node.d.leftExpr, node.d.annotationComment);
        }

        if (node.d.chainedAnnotationComment) {
            this._addDiagnostic(
                DiagnosticRule.reportInvalidTypeForm,
                LocMessage.annotationNotSupported(),
                node.d.chainedAnnotationComment
            );
        }

        // If the assignment target base expression is potentially a
        // TypedDict, add the base expression to the flow expressions set
        // to accommodate TypedDict type narrowing.
        if (node.d.leftExpr.nodeType === ParseNodeType.Index) {
            const target = node.d.leftExpr;

            if (
                target.d.items.length === 1 &&
                !target.d.trailingComma &&
                target.d.items[0].d.valueExpr.nodeType === ParseNodeType.StringList
            ) {
                if (isCodeFlowSupportedForReference(target.d.leftExpr)) {
                    const baseExprReferenceKey = createKeyForReference(target.d.leftExpr);
                    this._currentScopeCodeFlowExpressions!.add(baseExprReferenceKey);
                }
            }
        }

        this.walk(node.d.rightExpr);

        let isPossibleTypeAlias = true;
        if (ParseTreeUtils.getEnclosingFunction(node)) {
            // We will assume that type aliases are defined only at the module level
            // or as class variables, not as local variables within a function.
            isPossibleTypeAlias = false;
        } else if (node.d.rightExpr.nodeType === ParseNodeType.Call && this._fileInfo.isTypingStubFile) {
            // Some special built-in types defined in typing.pyi use
            // assignments of the form List = _Alias(). We don't want to
            // treat these as type aliases.
            isPossibleTypeAlias = false;
        } else if (ParseTreeUtils.isWithinLoop(node)) {
            // Assume that it's not a type alias if it's within a loop.
            isPossibleTypeAlias = false;
        }

        this._addInferredTypeAssignmentForVariable(node.d.leftExpr, node.d.rightExpr, isPossibleTypeAlias);

        // If we didn't create assignment target flow nodes above, do so now.
        this._createAssignmentTargetFlowNodes(node.d.leftExpr, /* walkTargets */ true, /* unbound */ false);

        // Is this an assignment to dunder all?
        if (this._currentScope.type === ScopeType.Module) {
            if (
                (node.d.leftExpr.nodeType === ParseNodeType.Name && node.d.leftExpr.d.value === '__all__') ||
                (node.d.leftExpr.nodeType === ParseNodeType.TypeAnnotation &&
                    node.d.leftExpr.d.valueExpr.nodeType === ParseNodeType.Name &&
                    node.d.leftExpr.d.valueExpr.d.value === '__all__')
            ) {
                const expr = node.d.rightExpr;
                this._dunderAllNames = [];
                let emitDunderAllWarning = false;

                if (expr.nodeType === ParseNodeType.List) {
                    expr.d.items.forEach((listEntryNode) => {
                        if (
                            listEntryNode.nodeType === ParseNodeType.StringList &&
                            listEntryNode.d.strings.length === 1 &&
                            listEntryNode.d.strings[0].nodeType === ParseNodeType.String
                        ) {
                            this._dunderAllNames!.push(listEntryNode.d.strings[0].d.value);
                            this._dunderAllStringNodes.push(listEntryNode.d.strings[0]);
                        } else {
                            emitDunderAllWarning = true;
                        }
                    });
                } else if (expr.nodeType === ParseNodeType.Tuple) {
                    expr.d.items.forEach((tupleEntryNode) => {
                        if (
                            tupleEntryNode.nodeType === ParseNodeType.StringList &&
                            tupleEntryNode.d.strings.length === 1 &&
                            tupleEntryNode.d.strings[0].nodeType === ParseNodeType.String
                        ) {
                            this._dunderAllNames!.push(tupleEntryNode.d.strings[0].d.value);
                            this._dunderAllStringNodes.push(tupleEntryNode.d.strings[0]);
                        } else {
                            emitDunderAllWarning = true;
                        }
                    });
                } else {
                    emitDunderAllWarning = true;
                }

                if (emitDunderAllWarning) {
                    this._usesUnsupportedDunderAllForm = true;

                    this._addDiagnostic(
                        DiagnosticRule.reportUnsupportedDunderAll,
                        LocMessage.unsupportedDunderAllOperation(),
                        node
                    );
                }
            }
        }

        // Is this an assignment to dunder slots?
        if (this._currentScope.type === ScopeType.Class) {
            if (
                (node.d.leftExpr.nodeType === ParseNodeType.Name && node.d.leftExpr.d.value === '__slots__') ||
                (node.d.leftExpr.nodeType === ParseNodeType.TypeAnnotation &&
                    node.d.leftExpr.d.valueExpr.nodeType === ParseNodeType.Name &&
                    node.d.leftExpr.d.valueExpr.d.value === '__slots__')
            ) {
                const expr = node.d.rightExpr;
                this._dunderSlotsEntries = [];
                let isExpressionUnderstood = true;

                if (expr.nodeType === ParseNodeType.StringList) {
                    this._dunderSlotsEntries.push(expr);
                } else if (expr.nodeType === ParseNodeType.List) {
                    expr.d.items.forEach((listEntryNode) => {
                        if (
                            listEntryNode.nodeType === ParseNodeType.StringList &&
                            listEntryNode.d.strings.length === 1 &&
                            listEntryNode.d.strings[0].nodeType === ParseNodeType.String
                        ) {
                            this._dunderSlotsEntries!.push(listEntryNode);
                        } else {
                            isExpressionUnderstood = false;
                        }
                    });
                } else if (expr.nodeType === ParseNodeType.Tuple) {
                    expr.d.items.forEach((tupleEntryNode) => {
                        if (
                            tupleEntryNode.nodeType === ParseNodeType.StringList &&
                            tupleEntryNode.d.strings.length === 1 &&
                            tupleEntryNode.d.strings[0].nodeType === ParseNodeType.String
                        ) {
                            this._dunderSlotsEntries!.push(tupleEntryNode);
                        } else {
                            isExpressionUnderstood = false;
                        }
                    });
                } else {
                    isExpressionUnderstood = false;
                }

                if (!isExpressionUnderstood) {
                    this._dunderSlotsEntries = undefined;
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
            this.walk(node.d.rightExpr);
        });

        const evaluationNode = ParseTreeUtils.getEvaluationNodeForAssignmentExpression(node);
        if (!evaluationNode) {
            this._addSyntaxError(LocMessage.assignmentExprContext(), node);
            this.walk(node.d.name);
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
                const localSymbol = curScope.lookUpSymbol(node.d.name.d.value);
                if (localSymbol) {
                    this._addSyntaxError(
                        LocMessage.assignmentExprComprehension().format({ name: node.d.name.d.value }),
                        node.d.name
                    );
                    break;
                }

                curScope = curScope.parent;
            }

            this._bindNameToScope(containerScope, node.d.name);
            this._addInferredTypeAssignmentForVariable(node.d.name, node.d.rightExpr);
            this._createAssignmentTargetFlowNodes(node.d.name, /* walkTargets */ true, /* unbound */ false);
        }

        return false;
    }

    override visitAugmentedAssignment(node: AugmentedAssignmentNode) {
        this.walk(node.d.leftExpr);
        this.walk(node.d.rightExpr);

        this._bindPossibleTupleNamedTarget(node.d.destExpr);
        this._createAssignmentTargetFlowNodes(node.d.destExpr, /* walkTargets */ false, /* unbound */ false);

        // Is this an assignment to dunder all of the form
        // __all__ += <expression>?
        if (
            node.d.operator === OperatorType.AddEqual &&
            this._currentScope.type === ScopeType.Module &&
            node.d.leftExpr.nodeType === ParseNodeType.Name &&
            node.d.leftExpr.d.value === '__all__'
        ) {
            const expr = node.d.rightExpr;
            let emitDunderAllWarning = true;

            if (expr.nodeType === ParseNodeType.List) {
                // Is this the form __all__ += ["a", "b"]?
                expr.d.items.forEach((listEntryNode) => {
                    if (
                        listEntryNode.nodeType === ParseNodeType.StringList &&
                        listEntryNode.d.strings.length === 1 &&
                        listEntryNode.d.strings[0].nodeType === ParseNodeType.String
                    ) {
                        this._dunderAllNames?.push(listEntryNode.d.strings[0].d.value);
                        this._dunderAllStringNodes.push(listEntryNode.d.strings[0]);
                    }
                });
                emitDunderAllWarning = false;
            } else if (
                expr.nodeType === ParseNodeType.MemberAccess &&
                expr.d.leftExpr.nodeType === ParseNodeType.Name &&
                expr.d.member.d.value === '__all__'
            ) {
                // Is this using the form "__all__ += <mod>.__all__"?
                const namesToAdd = this._getDunderAllNamesFromImport(expr.d.leftExpr.d.value);
                if (namesToAdd) {
                    namesToAdd.forEach((name) => {
                        this._dunderAllNames?.push(name);
                    });

                    emitDunderAllWarning = false;
                }
            }

            if (emitDunderAllWarning) {
                this._usesUnsupportedDunderAllForm = true;

                this._addDiagnostic(
                    DiagnosticRule.reportUnsupportedDunderAll,
                    LocMessage.unsupportedDunderAllOperation(),
                    node
                );
            }
        }

        return false;
    }

    override visitDel(node: DelNode) {
        node.d.targets.forEach((expr) => {
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

        // If this is an annotated variable assignment within a class body,
        // we need to evaluate the type annotation first.
        const bindVariableBeforeAnnotationEvaluation =
            node.parent?.nodeType === ParseNodeType.Assignment &&
            ParseTreeUtils.getEnclosingClass(node, /* stopAtFunction */ true) !== undefined;

        if (!bindVariableBeforeAnnotationEvaluation) {
            this.walk(node.d.annotation);
        }

        this._createVariableAnnotationFlowNode();

        this._bindPossibleTupleNamedTarget(node.d.valueExpr);
        this._addTypeDeclarationForVariable(node.d.valueExpr, node.d.annotation);

        if (bindVariableBeforeAnnotationEvaluation) {
            this.walk(node.d.annotation);
        }

        // For type annotations that are not part of assignments (e.g. simple variable
        // annotations), we need to populate the reference map. Otherwise the type
        // analyzer's code flow engine won't run and detect cases where the variable
        // is unbound.
        const expressionList: CodeFlowReferenceExpressionNode[] = [];
        if (this._isNarrowingExpression(node.d.valueExpr, expressionList)) {
            expressionList.forEach((expr) => {
                const referenceKey = createKeyForReference(expr);
                this._currentScopeCodeFlowExpressions!.add(referenceKey);
            });
        }

        this.walk(node.d.valueExpr);

        return false;
    }

    override visitFor(node: ForNode) {
        this._bindPossibleTupleNamedTarget(node.d.targetExpr);
        this._addInferredTypeAssignmentForVariable(node.d.targetExpr, node);

        this.walk(node.d.iterableExpr);

        const preForLabel = this._createLoopLabel();
        const preElseLabel = this._createBranchLabel();
        const postForLabel = this._createBranchLabel();

        this._addAntecedent(preForLabel, this._currentFlowNode!);
        this._currentFlowNode = preForLabel;
        this._addAntecedent(preElseLabel, this._currentFlowNode);
        const targetExpressions = this._trackCodeFlowExpressions(() => {
            this._createAssignmentTargetFlowNodes(node.d.targetExpr, /* walkTargets */ true, /* unbound */ false);
        });

        this._bindLoopStatement(preForLabel, postForLabel, () => {
            this.walk(node.d.forSuite);
            this._addAntecedent(preForLabel, this._currentFlowNode!);

            // Add any target expressions since they are modified in the loop.
            targetExpressions.forEach((value) => {
                this._currentScopeCodeFlowExpressions?.add(value);
            });
        });

        this._currentFlowNode = this._finishFlowLabel(preElseLabel);
        if (node.d.elseSuite) {
            this.walk(node.d.elseSuite);
        }
        this._addAntecedent(postForLabel, this._currentFlowNode);

        this._currentFlowNode = this._finishFlowLabel(postForLabel);

        // Async for is not allowed outside of an async function
        // unless we're in ipython mode.
        if (node.d.asyncToken && !this._fileInfo.ipythonMode) {
            const enclosingFunction = ParseTreeUtils.getEnclosingFunction(node);
            if (!enclosingFunction || !enclosingFunction.d.isAsync) {
                this._addSyntaxError(LocMessage.asyncNotInAsyncFunction(), node.d.asyncToken);
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

        if (node.d.expr) {
            this.walk(node.d.expr);
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
        if (this._isInComprehension(node, /* ignoreOutermostIterable */ true)) {
            this._addSyntaxError(LocMessage.yieldWithinComprehension(), node);
        }

        this._bindYield(node);
        return false;
    }

    override visitYieldFrom(node: YieldFromNode): boolean {
        if (this._isInComprehension(node, /* ignoreOutermostIterable */ true)) {
            this._addSyntaxError(LocMessage.yieldWithinComprehension(), node);
        }

        this._bindYield(node);
        return false;
    }

    override visitMemberAccess(node: MemberAccessNode): boolean {
        this.walk(node.d.leftExpr);
        AnalyzerNodeInfo.setFlowNode(node, this._currentFlowNode!);
        return false;
    }

    override visitName(node: NameNode): boolean {
        AnalyzerNodeInfo.setFlowNode(node, this._currentFlowNode!);
        return false;
    }

    override visitIndex(node: IndexNode): boolean {
        AnalyzerNodeInfo.setFlowNode(node, this._currentFlowNode!);

        this.walk(node.d.leftExpr);

        // If we're within an 'Annotated' type annotation, set the flag.
        const wasInAnnotatedAnnotation = this._isInAnnotatedAnnotation;
        if (this._isTypingAnnotation(node.d.leftExpr, 'Annotated')) {
            this._isInAnnotatedAnnotation = true;
        }

        node.d.items.forEach((argNode) => {
            this.walk(argNode);
        });

        this._isInAnnotatedAnnotation = wasInAnnotatedAnnotation;

        return false;
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
                node.d.testExpr,
                this._fileInfo.executionEnvironment,
                this._fileInfo.definedConstants,
                this._typingImportAliases,
                this._sysImportAliases
            );

            this._bindConditional(node.d.testExpr, thenLabel, elseLabel);

            // Handle the if clause.
            this._currentFlowNode =
                constExprValue === false ? Binder._unreachableFlowNode : this._finishFlowLabel(thenLabel);
            this.walk(node.d.ifSuite);
            this._addAntecedent(postIfLabel, this._currentFlowNode);

            // Now handle the else clause if it's present. If there
            // are chained "else if" statements, they'll be handled
            // recursively here.
            this._currentFlowNode =
                constExprValue === true ? Binder._unreachableFlowNode : this._finishFlowLabel(elseLabel);
            if (node.d.elseSuite) {
                this.walk(node.d.elseSuite);
            } else {
                this._bindNeverCondition(node.d.testExpr, postIfLabel, /* isPositiveTest */ false);
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
            node.d.testExpr,
            this._fileInfo.executionEnvironment,
            this._fileInfo.definedConstants,
            this._typingImportAliases,
            this._sysImportAliases
        );

        const preLoopLabel = this._createLoopLabel();
        this._addAntecedent(preLoopLabel, this._currentFlowNode!);
        this._currentFlowNode = preLoopLabel;

        this._bindConditional(node.d.testExpr, thenLabel, elseLabel);

        // Handle the while clause.
        this._currentFlowNode =
            constExprValue === false ? Binder._unreachableFlowNode : this._finishFlowLabel(thenLabel);
        this._bindLoopStatement(preLoopLabel, postWhileLabel, () => {
            this.walk(node.d.whileSuite);
        });
        this._addAntecedent(preLoopLabel, this._currentFlowNode);

        this._currentFlowNode =
            constExprValue === true ? Binder._unreachableFlowNode : this._finishFlowLabel(elseLabel);
        if (node.d.elseSuite) {
            this.walk(node.d.elseSuite);
        }
        this._addAntecedent(postWhileLabel, this._currentFlowNode);
        this._currentFlowNode = this._finishFlowLabel(postWhileLabel);
        return false;
    }

    override visitAssert(node: AssertNode): boolean {
        const assertTrueLabel = this._createBranchLabel();
        const assertFalseLabel = this._createBranchLabel();

        this._bindConditional(node.d.testExpr, assertTrueLabel, assertFalseLabel);

        if (node.d.exceptionExpr) {
            this._currentFlowNode = this._finishFlowLabel(assertFalseLabel);
            this.walk(node.d.exceptionExpr);
        }

        this._currentFlowNode = this._finishFlowLabel(assertTrueLabel);
        return false;
    }

    override visitExcept(node: ExceptNode): boolean {
        if (node.d.typeExpr) {
            this.walk(node.d.typeExpr);
        }

        if (node.d.name) {
            this.walk(node.d.name);
            const symbol = this._bindNameToScope(this._currentScope, node.d.name);
            this._createAssignmentTargetFlowNodes(node.d.name, /* walkTargets */ true, /* unbound */ false);

            if (symbol) {
                const declaration: VariableDeclaration = {
                    type: DeclarationType.Variable,
                    node: node.d.name,
                    isConstant: isConstantName(node.d.name.d.value),
                    inferredTypeSource: node,
                    uri: this._fileInfo.fileUri,
                    range: convertTextRangeToRange(node.d.name, this._fileInfo.lines),
                    moduleName: this._fileInfo.moduleName,
                    isInExceptSuite: this._isInExceptSuite,
                    isExplicitBinding: this._currentScope.getBindingType(node.d.name.d.value) !== undefined,
                };
                symbol.addDeclaration(declaration);
            }
        }

        const wasInExceptSuite = this._isInExceptSuite;
        this._isInExceptSuite = true;
        this.walk(node.d.exceptSuite);
        this._isInExceptSuite = wasInExceptSuite;

        if (node.d.name) {
            // The exception name is implicitly unbound at the end of
            // the except block.
            this._createFlowAssignment(node.d.name, /* unbound */ true);
        }

        return false;
    }

    override visitRaise(node: RaiseNode): boolean {
        if (this._currentFlowNode) {
            this._addExceptTargets(this._currentFlowNode);
        }

        if (this._targetFunctionDeclaration) {
            if (!this._targetFunctionDeclaration.raiseStatements) {
                this._targetFunctionDeclaration.raiseStatements = [];
            }
            this._targetFunctionDeclaration.raiseStatements.push(node);
        }

        if (node.d.expr) {
            this.walk(node.d.expr);
        }
        if (node.d.fromExpr) {
            this.walk(node.d.fromExpr);
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
        const curExceptTargets = node.d.exceptClauses.map(() => this._createBranchLabel());
        const preFinallyLabel = this._createBranchLabel(preTryFlowNode);
        let isAfterElseAndExceptsReachable = false;

        // Create a label for all of the return or raise labels that are
        // encountered within the try/except/else blocks. This conditionally
        // connects the return/raise statement to the finally clause.
        const preFinallyReturnOrRaiseLabel = this._createBranchLabel(preTryFlowNode);

        const preFinallyGate: FlowPreFinallyGate = {
            flags: FlowFlags.PreFinallyGate,
            id: this._getUniqueFlowNodeId(),
            antecedent: preFinallyReturnOrRaiseLabel,
        };

        preFinallyLabel.affectedExpressions = this._trackCodeFlowExpressions(() => {
            if (node.d.finallySuite) {
                this._addAntecedent(preFinallyLabel, preFinallyGate);
            }

            // Add the finally target as an exception target unless there is
            // a "bare" except clause that accepts all exception types.
            const hasBareExceptClause = node.d.exceptClauses.some((except) => !except.d.typeExpr);
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
            if (node.d.finallySuite) {
                this._finallyTargets.push(preFinallyReturnOrRaiseLabel);
            }

            // Handle the try block.
            this._useExceptTargets(curExceptTargets, () => {
                this.walk(node.d.trySuite);
            });

            // Handle the else block, which is executed only if
            // execution falls through the try block.
            if (node.d.elseSuite) {
                this.walk(node.d.elseSuite);
            }
            this._addAntecedent(preFinallyLabel, this._currentFlowNode!);
            if (!this._isCodeUnreachable()) {
                isAfterElseAndExceptsReachable = true;
            }

            // Handle the except blocks.
            node.d.exceptClauses.forEach((exceptNode, index) => {
                this._currentFlowNode = this._finishFlowLabel(curExceptTargets[index]);
                this.walk(exceptNode);
                this._addAntecedent(preFinallyLabel, this._currentFlowNode);
                if (!this._isCodeUnreachable()) {
                    isAfterElseAndExceptsReachable = true;
                }
            });

            if (node.d.finallySuite) {
                this._finallyTargets.pop();
            }

            // Handle the finally block.
            this._currentFlowNode = this._finishFlowLabel(preFinallyLabel);
        });

        if (node.d.finallySuite) {
            this.walk(node.d.finallySuite);

            // Add a post-finally node at the end. If we traverse this node,
            // we'll set the "ignore" flag in the pre-finally node.
            const postFinallyNode: FlowPostFinally = {
                flags: FlowFlags.PostFinally,
                id: this._getUniqueFlowNodeId(),
                finallyNode: node.d.finallySuite,
                antecedent: this._currentFlowNode!,
                preFinallyGate,
            };
            this._currentFlowNode = isAfterElseAndExceptsReachable ? postFinallyNode : Binder._unreachableFlowNode;
        }

        return false;
    }

    override visitAwait(node: AwaitNode) {
        // Make sure this is within an async lambda or function.
        const execScopeNode = ParseTreeUtils.getExecutionScopeNode(node);
        if (execScopeNode?.nodeType !== ParseNodeType.Function || !execScopeNode.d.isAsync) {
            if (this._fileInfo.ipythonMode && execScopeNode?.nodeType === ParseNodeType.Module) {
                // Top level await is allowed in ipython mode.
                return true;
            }

            const isInGenerator =
                node.parent?.nodeType === ParseNodeType.Comprehension &&
                node.parent?.parent?.nodeType !== ParseNodeType.List &&
                node.parent?.parent?.nodeType !== ParseNodeType.Set &&
                node.parent?.parent?.nodeType !== ParseNodeType.Dictionary;

            // Allow if it's within a generator expression. Execution of
            // generator expressions is deferred and therefore can be
            // run within the context of an async function later.
            if (!isInGenerator) {
                this._addSyntaxError(LocMessage.awaitNotInAsync(), node.d.awaitToken);
            }
        }

        return true;
    }

    override visitGlobal(node: GlobalNode): boolean {
        const globalScope = this._currentScope.getGlobalScope().scope;

        node.d.targets.forEach((name) => {
            const nameValue = name.d.value;

            // Is the binding inconsistent?
            if (this._currentScope.getBindingType(nameValue) === NameBindingType.Nonlocal) {
                this._addSyntaxError(LocMessage.nonLocalRedefinition().format({ name: nameValue }), name);
            }

            const valueWithScope = this._currentScope.lookUpSymbolRecursive(nameValue);

            // Was the name already assigned within this scope before it was declared global?
            if (valueWithScope && valueWithScope.scope === this._currentScope) {
                this._addSyntaxError(LocMessage.globalReassignment().format({ name: nameValue }), name);
            }

            // Add it to the global scope if it's not already added.
            this._bindNameToScope(globalScope, name);

            if (this._currentScope !== globalScope) {
                this._currentScope.setBindingType(nameValue, NameBindingType.Global);
            }
        });

        return true;
    }

    override visitNonlocal(node: NonlocalNode): boolean {
        const globalScope = this._currentScope.getGlobalScope().scope;

        if (this._currentScope === globalScope) {
            this._addSyntaxError(LocMessage.nonLocalInModule(), node);
        } else {
            node.d.targets.forEach((name) => {
                const nameValue = name.d.value;

                // Is the binding inconsistent?
                if (this._currentScope.getBindingType(nameValue) === NameBindingType.Global) {
                    this._addSyntaxError(LocMessage.globalRedefinition().format({ name: nameValue }), name);
                }

                const valueWithScope = this._currentScope.lookUpSymbolRecursive(nameValue);

                // Was the name already assigned within this scope before it was declared nonlocal?
                if (valueWithScope && valueWithScope.scope === this._currentScope) {
                    this._addSyntaxError(LocMessage.nonLocalReassignment().format({ name: nameValue }), name);
                } else if (!valueWithScope || valueWithScope.scope === globalScope) {
                    this._addSyntaxError(LocMessage.nonLocalNoBinding().format({ name: nameValue }), name);
                }

                if (valueWithScope) {
                    this._currentScope.setBindingType(nameValue, NameBindingType.Nonlocal);
                }
            });
        }

        return true;
    }

    override visitImportAs(node: ImportAsNode): boolean {
        if (node.d.module.d.nameParts.length > 0) {
            const firstNamePartValue = node.d.module.d.nameParts[0].d.value;

            let symbolName: string | undefined;
            let symbolNameNode: NameNode;
            if (node.d.alias) {
                // The symbol name is defined by the alias.
                symbolName = node.d.alias.d.value;
                symbolNameNode = node.d.alias;
            } else {
                // There was no alias, so we need to use the first element of
                // the name parts as the symbol.
                symbolName = firstNamePartValue;
                symbolNameNode = node.d.module.d.nameParts[0];
            }

            const symbol = this._bindNameToScope(this._currentScope, symbolNameNode);
            if (
                symbol &&
                (this._currentScope.type === ScopeType.Module || this._currentScope.type === ScopeType.Builtin) &&
                (!node.d.alias ||
                    node.d.module.d.nameParts.length !== 1 ||
                    node.d.module.d.nameParts[0].d.value !== node.d.alias.d.value)
            ) {
                if (this._fileInfo.isStubFile || this._fileInfo.isInPyTypedPackage) {
                    // PEP 484 indicates that imported symbols should not be
                    // considered "reexported" from a type stub file unless
                    // they are imported using the "as" form and the aliased
                    // name is entirely redundant.
                    this._potentialHiddenSymbols.set(symbolName, symbol);
                }
            }

            const importInfo = AnalyzerNodeInfo.getImportInfo(node.d.module);
            assert(importInfo !== undefined);

            if (symbol) {
                this._createAliasDeclarationForMultipartImportName(node, node.d.alias, importInfo, symbol);
            }

            this._createFlowAssignment(node.d.alias ? node.d.alias : node.d.module.d.nameParts[0]);

            if (node.d.module.d.nameParts.length === 1) {
                if (firstNamePartValue === 'typing' || firstNamePartValue === 'typing_extensions') {
                    this._typingImportAliases.push(node.d.alias?.d.value ?? firstNamePartValue);
                } else if (firstNamePartValue === 'sys') {
                    this._sysImportAliases.push(node.d.alias?.d.value ?? firstNamePartValue);
                } else if (firstNamePartValue === 'dataclasses') {
                    this._dataclassesImportAliases.push(node.d.alias?.d.value ?? firstNamePartValue);
                }
            }
        }

        return true;
    }

    override visitImportFrom(node: ImportFromNode): boolean {
        const typingSymbolsOfInterest = ['Final', 'ClassVar', 'Annotated'];
        const dataclassesSymbolsOfInterest = ['InitVar'];
        const importInfo = AnalyzerNodeInfo.getImportInfo(node.d.module);

        AnalyzerNodeInfo.setFlowNode(node, this._currentFlowNode!);

        let resolvedPath = Uri.empty();
        if (importInfo && importInfo.isImportFound && !importInfo.isNativeLib) {
            resolvedPath = importInfo.resolvedUris[importInfo.resolvedUris.length - 1];
        }

        // If this file is a module __init__.py(i), relative imports of submodules
        // using the syntax "from .x import y" introduce a symbol x into the
        // module namespace. We do this first (before adding the individual imported
        // symbols below) in case one of the imported symbols is the same name as the
        // submodule. In that case, we want to the symbol to appear later in the
        // declaration list because it should "win" when resolving the alias.
        const fileName = stripFileExtension(this._fileInfo.fileUri.fileName);
        const isModuleInitFile =
            fileName === '__init__' && node.d.module.d.leadingDots === 1 && node.d.module.d.nameParts.length === 1;

        let isTypingImport = false;
        let isDataclassesImport = false;

        if (node.d.module.d.nameParts.length === 1) {
            const firstNamePartValue = node.d.module.d.nameParts[0].d.value;
            if (firstNamePartValue === 'typing' || firstNamePartValue === 'typing_extensions') {
                isTypingImport = true;
            }

            if (firstNamePartValue === 'dataclasses') {
                isDataclassesImport = true;
            }
        }

        if (node.d.isWildcardImport) {
            if (ParseTreeUtils.getEnclosingClass(node) || ParseTreeUtils.getEnclosingFunction(node)) {
                this._addSyntaxError(LocMessage.wildcardInFunction(), node);
            }

            if (importInfo) {
                const names: string[] = [];

                // Note that this scope uses a wildcard import, so we cannot shortcut
                // any code flow checks. All expressions are potentially in play.
                this._currentScopeCodeFlowExpressions?.add(wildcardImportReferenceKey);

                const lookupInfo = this._fileInfo.importLookup(resolvedPath);
                if (lookupInfo) {
                    const wildcardNames = this._getWildcardImportNames(lookupInfo);

                    if (isModuleInitFile) {
                        // If the symbol is going to be immediately replaced with a same-named
                        // imported symbol, skip this.
                        const isImmediatelyReplaced = wildcardNames.some((name) => {
                            return name === node.d.module.d.nameParts[0].d.value;
                        });

                        if (!isImmediatelyReplaced) {
                            this._addImplicitFromImport(node, importInfo);
                        }
                    }

                    wildcardNames.forEach((name) => {
                        const localSymbol = this._bindNameValueToScope(this._currentScope, name);

                        if (localSymbol) {
                            const importedSymbol = lookupInfo.symbolTable.get(name)!;

                            // Is the symbol in the target module's symbol table? If so,
                            // alias it.
                            if (importedSymbol) {
                                const aliasDecl: AliasDeclaration = {
                                    type: DeclarationType.Alias,
                                    node,
                                    uri: resolvedPath,
                                    loadSymbolsFromPath: true,
                                    range: getEmptyRange(), // Range is unknown for wildcard name import.
                                    usesLocalName: false,
                                    symbolName: name,
                                    moduleName: this._fileInfo.moduleName,
                                    isInExceptSuite: this._isInExceptSuite,
                                };
                                localSymbol.addDeclaration(aliasDecl);
                                names.push(name);
                            } else {
                                // The symbol wasn't in the target module's symbol table. It's probably
                                // an implicitly-imported submodule referenced by __all__.
                                if (importInfo && importInfo.filteredImplicitImports) {
                                    const implicitImport = importInfo.filteredImplicitImports.get(name);

                                    if (implicitImport) {
                                        const submoduleFallback: AliasDeclaration = {
                                            type: DeclarationType.Alias,
                                            node,
                                            uri: implicitImport.uri,
                                            loadSymbolsFromPath: true,
                                            range: getEmptyRange(),
                                            usesLocalName: false,
                                            moduleName: this._fileInfo.moduleName,
                                            isInExceptSuite: this._isInExceptSuite,
                                        };

                                        const aliasDecl: AliasDeclaration = {
                                            type: DeclarationType.Alias,
                                            node,
                                            uri: resolvedPath,
                                            loadSymbolsFromPath: true,
                                            usesLocalName: false,
                                            symbolName: name,
                                            submoduleFallback,
                                            range: getEmptyRange(),
                                            moduleName: this._fileInfo.moduleName,
                                            isInExceptSuite: this._isInExceptSuite,
                                        };

                                        localSymbol.addDeclaration(aliasDecl);
                                        names.push(name);
                                    }
                                }
                            }

                            if (isTypingImport) {
                                localSymbol.setTypingSymbolAlias(name);
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

            node.d.imports.forEach((importSymbolNode) => {
                const importedName = importSymbolNode.d.name.d.value;
                const nameNode = importSymbolNode.d.alias || importSymbolNode.d.name;

                AnalyzerNodeInfo.setFlowNode(importSymbolNode, this._currentFlowNode!);

                const symbol = this._bindNameToScope(this._currentScope, nameNode);

                if (symbol) {
                    // All import statements of the form `from . import x` treat x
                    // as an externally-visible (not hidden) symbol.
                    if (node.d.module.d.nameParts.length > 0) {
                        if (
                            this._currentScope.type === ScopeType.Module ||
                            this._currentScope.type === ScopeType.Builtin
                        ) {
                            if (
                                !importSymbolNode.d.alias ||
                                importSymbolNode.d.alias.d.value !== importSymbolNode.d.name.d.value
                            ) {
                                if (this._fileInfo.isStubFile || this._fileInfo.isInPyTypedPackage) {
                                    // PEP 484 indicates that imported symbols should not be
                                    // considered "reexported" from a type stub file unless
                                    // they are imported using the "as" form using a redundant form.
                                    // Py.typed packages follow the same rule as PEP 484.
                                    this._potentialHiddenSymbols.set(nameNode.d.value, symbol);
                                }
                            }
                        }
                    }

                    // Is the import referring to an implicitly-imported module?
                    let implicitImport: ImplicitImport | undefined;
                    if (importInfo && importInfo.filteredImplicitImports) {
                        implicitImport = importInfo.filteredImplicitImports.get(importedName);
                    }

                    let submoduleFallback: AliasDeclaration | undefined;
                    let loadSymbolsFromPath = true;
                    if (implicitImport) {
                        submoduleFallback = {
                            type: DeclarationType.Alias,
                            node: importSymbolNode,
                            uri: implicitImport.uri,
                            loadSymbolsFromPath: true,
                            range: getEmptyRange(),
                            usesLocalName: false,
                            moduleName: this._formatModuleName(node.d.module),
                            isInExceptSuite: this._isInExceptSuite,
                        };

                        // Handle the case where this is an __init__.py file and the imported
                        // module name refers to itself. The most common situation where this occurs
                        // is with a "from . import X" form, but it can also occur with
                        // an absolute import (e.g. "from A.B.C import X"). In this case, we want to
                        // always resolve to the submodule rather than the resolved path.
                        if (fileName === '__init__') {
                            if (node.d.module.d.leadingDots === 1 && node.d.module.d.nameParts.length === 0) {
                                loadSymbolsFromPath = false;
                            } else if (resolvedPath.equals(this._fileInfo.fileUri)) {
                                loadSymbolsFromPath = false;
                            }
                        }
                    }

                    const aliasDecl: AliasDeclaration = {
                        type: DeclarationType.Alias,
                        node: importSymbolNode,
                        uri: resolvedPath,
                        loadSymbolsFromPath,
                        usesLocalName: !!importSymbolNode.d.alias,
                        symbolName: importedName,
                        submoduleFallback,
                        range: convertTextRangeToRange(nameNode, this._fileInfo.lines),
                        moduleName: this._formatModuleName(node.d.module),
                        isInExceptSuite: this._isInExceptSuite,
                        isNativeLib: importInfo?.isNativeLib,
                    };

                    symbol.addDeclaration(aliasDecl);
                    this._createFlowAssignment(importSymbolNode.d.alias || importSymbolNode.d.name);

                    if (isTypingImport) {
                        if (typingSymbolsOfInterest.some((s) => s === importSymbolNode.d.name.d.value)) {
                            this._typingSymbolAliases.set(nameNode.d.value, importSymbolNode.d.name.d.value);

                            if (isTypingImport) {
                                symbol.setTypingSymbolAlias(nameNode.d.value);
                            }
                        }
                    }

                    if (isDataclassesImport) {
                        if (dataclassesSymbolsOfInterest.some((s) => s === importSymbolNode.d.name.d.value)) {
                            this._dataclassesSymbolAliases.set(nameNode.d.value, importSymbolNode.d.name.d.value);
                        }
                    }
                }
            });
        }

        return true;
    }

    override visitWith(node: WithNode): boolean {
        node.d.withItems.forEach((item) => {
            this.walk(item.d.expr);
            if (item.d.target) {
                this._bindPossibleTupleNamedTarget(item.d.target);
                this._addInferredTypeAssignmentForVariable(item.d.target, item);
                this._createAssignmentTargetFlowNodes(item.d.target, /* walkTargets */ true, /* unbound */ false);
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
        //         |    ContextManagerSwallowExceptionTarget
        //         |                     ^
        //         |          PostContextManagerLabel
        //         |                     ^
        //         |---------------------|
        //         |
        //   (after with)
        //
        // In addition to the ContextManagerSwallowExceptionTarget, we'll create
        // a second target called ContextManagerForwardExceptionTarget that forwards
        // exceptions to existing exception targets if they exist.

        const contextManagerSwallowExceptionTarget = this._createContextManagerLabel(
            node.d.withItems.map((item) => item.d.expr),
            !!node.d.isAsync,
            /* blockIfSwallowsExceptions */ false
        );
        this._addAntecedent(contextManagerSwallowExceptionTarget, this._currentFlowNode!);

        const contextManagerForwardExceptionTarget = this._createContextManagerLabel(
            node.d.withItems.map((item) => item.d.expr),
            !!node.d.isAsync,
            /* blockIfSwallowsExceptions */ true
        );
        this._currentExceptTargets.forEach((exceptionTarget) => {
            this._addAntecedent(exceptionTarget, contextManagerForwardExceptionTarget);
        });

        const preWithSuiteNode = this._currentFlowNode!;
        const postContextManagerLabel = this._createBranchLabel(preWithSuiteNode);
        this._addAntecedent(postContextManagerLabel, contextManagerSwallowExceptionTarget!);

        postContextManagerLabel.affectedExpressions = this._trackCodeFlowExpressions(() => {
            this._useExceptTargets([contextManagerSwallowExceptionTarget, contextManagerForwardExceptionTarget], () => {
                this.walk(node.d.suite);
            });

            this._addAntecedent(postContextManagerLabel, this._currentFlowNode!);
            this._currentFlowNode = postContextManagerLabel;

            // Model the call to `__exit__` as a potential exception generator.
            if (!this._isCodeUnreachable()) {
                this._addExceptTargets(this._currentFlowNode!);
            }

            if (node.d.asyncToken && !this._fileInfo.ipythonMode) {
                // Top level async with is allowed in ipython mode.
                const enclosingFunction = ParseTreeUtils.getEnclosingFunction(node);
                if (!enclosingFunction || !enclosingFunction.d.isAsync) {
                    this._addSyntaxError(LocMessage.asyncNotInAsyncFunction(), node.d.asyncToken);
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
            this._bindConditional(node.d.testExpr, trueLabel, falseLabel);

            // Handle the "true" portion (the "if" expression).
            this._currentFlowNode = this._finishFlowLabel(trueLabel);
            this.walk(node.d.ifExpr);
            this._addAntecedent(postExpressionLabel, this._currentFlowNode);

            // Handle the "false" portion (the "else" expression).
            this._currentFlowNode = this._finishFlowLabel(falseLabel);
            this.walk(node.d.elseExpr);
            this._addAntecedent(postExpressionLabel, this._currentFlowNode);

            this._currentFlowNode = this._finishFlowLabel(postExpressionLabel);
        });

        return false;
    }

    override visitUnaryOperation(node: UnaryOperationNode): boolean {
        if (node.d.operator === OperatorType.Not && this._currentFalseTarget && this._currentTrueTarget) {
            // Swap the existing true/false targets.
            this._bindConditional(node.d.expr, this._currentFalseTarget, this._currentTrueTarget);
        } else {
            // Temporarily set the true/false targets to undefined because
            // this unary operation is not part of a chain of logical expressions
            // (AND/OR/NOT subexpressions).
            this._disableTrueFalseTargets(() => {
                // Evaluate the operand expression.
                this.walk(node.d.expr);
            });
        }

        return false;
    }

    override visitBinaryOperation(node: BinaryOperationNode): boolean {
        if (node.d.operator === OperatorType.And || node.d.operator === OperatorType.Or) {
            let trueTarget = this._currentTrueTarget;
            let falseTarget = this._currentFalseTarget;
            let postRightLabel: FlowLabel | undefined;

            if (!trueTarget || !falseTarget) {
                postRightLabel = this._createBranchLabel();
                trueTarget = falseTarget = postRightLabel;
            }

            const preRightLabel = this._createBranchLabel();
            if (node.d.operator === OperatorType.And) {
                this._bindConditional(node.d.leftExpr, preRightLabel, falseTarget);
            } else {
                this._bindConditional(node.d.leftExpr, trueTarget, preRightLabel);
            }
            this._currentFlowNode = this._finishFlowLabel(preRightLabel);
            this._bindConditional(node.d.rightExpr, trueTarget, falseTarget);
            if (postRightLabel) {
                this._currentFlowNode = this._finishFlowLabel(postRightLabel);
            }
        } else {
            // Temporarily set the true/false targets to undefined because
            // this binary operation is not part of a chain of logical expressions
            // (AND/OR/NOT subexpressions).
            this._disableTrueFalseTargets(() => {
                this.walk(node.d.leftExpr);
                this.walk(node.d.rightExpr);
            });
        }

        return false;
    }

    override visitComprehension(node: ComprehensionNode): boolean {
        const enclosingFunction = ParseTreeUtils.getEnclosingFunction(node);

        // The first iterable is executed outside of the comprehension scope.
        if (node.d.forIfNodes.length > 0 && node.d.forIfNodes[0].nodeType === ParseNodeType.ComprehensionFor) {
            this.walk(node.d.forIfNodes[0].d.iterableExpr);
        }

        this._createNewScope(
            ScopeType.Comprehension,
            this._getNonClassParentScope(),
            /* proxyScope */ undefined,
            () => {
                AnalyzerNodeInfo.setScope(node, this._currentScope);

                const falseLabel = this._createBranchLabel();

                // We'll walk the forIfNodes list twice. The first time we'll
                // bind targets of for statements. The second time we'll walk
                // expressions and create the control flow graph.
                for (let i = 0; i < node.d.forIfNodes.length; i++) {
                    const compr = node.d.forIfNodes[i];
                    const addedSymbols = new Map<string, Symbol>();
                    if (compr.nodeType === ParseNodeType.ComprehensionFor) {
                        this._bindPossibleTupleNamedTarget(compr.d.targetExpr, addedSymbols);
                        this._addInferredTypeAssignmentForVariable(compr.d.targetExpr, compr);

                        // Async for is not allowed outside of an async function
                        // unless we're in ipython mode.
                        if (compr.d.asyncToken && !this._fileInfo.ipythonMode) {
                            if (!enclosingFunction || !enclosingFunction.d.isAsync) {
                                // Allow if it's within a generator expression. Execution of
                                // generator expressions is deferred and therefore can be
                                // run within the context of an async function later.
                                if (
                                    node.parent?.nodeType === ParseNodeType.List ||
                                    node.parent?.nodeType === ParseNodeType.Set ||
                                    node.parent?.nodeType === ParseNodeType.Dictionary
                                ) {
                                    this._addSyntaxError(LocMessage.asyncNotInAsyncFunction(), compr.d.asyncToken);
                                }
                            }
                        }
                    }
                }

                for (let i = 0; i < node.d.forIfNodes.length; i++) {
                    const compr = node.d.forIfNodes[i];
                    if (compr.nodeType === ParseNodeType.ComprehensionFor) {
                        // We already walked the first iterable expression above,
                        // so skip it here.
                        if (i !== 0) {
                            this.walk(compr.d.iterableExpr);
                        }

                        this._createAssignmentTargetFlowNodes(
                            compr.d.targetExpr,
                            /* walkTargets */ true,
                            /* unbound */ false
                        );
                    } else {
                        const trueLabel = this._createBranchLabel();
                        this._bindConditional(compr.d.testExpr, trueLabel, falseLabel);
                        this._currentFlowNode = this._finishFlowLabel(trueLabel);
                    }
                }

                this.walk(node.d.expr);
                this._addAntecedent(falseLabel, this._currentFlowNode!);
                this._currentFlowNode = this._finishFlowLabel(falseLabel);
            }
        );

        return false;
    }

    override visitMatch(node: MatchNode) {
        // Evaluate the subject expression.
        this.walk(node.d.expr);

        const expressionList: CodeFlowReferenceExpressionNode[] = [];
        let isSubjectNarrowable = this._isNarrowingExpression(node.d.expr, expressionList);

        // We also support narrowing of individual tuple entries found within a
        // match subject expression, so add those here as well.
        if (node.d.expr.nodeType === ParseNodeType.Tuple) {
            node.d.expr.d.items.forEach((itemExpr) => {
                if (this._isNarrowingExpression(itemExpr, expressionList)) {
                    isSubjectNarrowable = true;
                }
            });
        }

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
        node.d.cases.forEach((caseStatement) => {
            const postCaseLabel = this._createBranchLabel();
            const preGuardLabel = this._createBranchLabel();
            const preSuiteLabel = this._createBranchLabel();

            // Evaluate the pattern.
            this._addAntecedent(preGuardLabel, this._currentFlowNode!);

            if (!caseStatement.d.isIrrefutable) {
                this._addAntecedent(postCaseLabel, this._currentFlowNode!);
            } else if (!caseStatement.d.guardExpr) {
                foundIrrefutableCase = true;
            }

            this._currentFlowNode = this._finishFlowLabel(preGuardLabel);

            // Note the active match subject expression prior to binding
            // the pattern. If the pattern involves any targets that overwrite
            // the subject expression, this will be set to undefined.
            this._currentMatchSubjExpr = node.d.expr;

            // Bind the pattern.
            this.walk(caseStatement.d.pattern);

            // If the pattern involves targets that overwrite the subject
            // expression, skip creating a flow node for narrowing the subject.
            if (this._currentMatchSubjExpr) {
                this._createFlowNarrowForPattern(node.d.expr, caseStatement);
                this._currentMatchSubjExpr = undefined;
            }

            // Apply the guard expression.
            if (caseStatement.d.guardExpr) {
                this._bindConditional(caseStatement.d.guardExpr, preSuiteLabel, postCaseLabel);
            } else {
                this._addAntecedent(preSuiteLabel, this._currentFlowNode);
            }

            this._currentFlowNode = this._finishFlowLabel(preSuiteLabel);

            // Bind the body of the case statement.
            this.walk(caseStatement.d.suite);
            this._addAntecedent(postMatchLabel, this._currentFlowNode);

            this._currentFlowNode = this._finishFlowLabel(postCaseLabel);
        });

        // Add a final narrowing step for the subject expression for the entire
        // match statement. This will compute the narrowed type if no case
        // statements are matched.
        if (isSubjectNarrowable) {
            this._createFlowNarrowForPattern(node.d.expr, node);
        }

        // Create an "implied else" to conditionally gate code flow based on
        // whether the narrowed type of the subject expression is Never at this point.
        if (!foundIrrefutableCase) {
            this._createFlowExhaustedMatch(node);
        }

        this._addAntecedent(postMatchLabel, this._currentFlowNode!);
        this._currentFlowNode = this._finishFlowLabel(postMatchLabel);

        return false;
    }

    override visitPatternAs(node: PatternAsNode) {
        const postOrLabel = this._createBranchLabel();

        node.d.orPatterns.forEach((orPattern) => {
            this.walk(orPattern);
            this._addAntecedent(postOrLabel, this._currentFlowNode!);
        });

        this._currentFlowNode = this._finishFlowLabel(postOrLabel);

        if (node.d.target) {
            this.walk(node.d.target);
            const symbol = this._bindNameToScope(this._currentScope, node.d.target);
            this._createAssignmentTargetFlowNodes(node.d.target, /* walkTargets */ false, /* unbound */ false);

            if (symbol) {
                const declaration: VariableDeclaration = {
                    type: DeclarationType.Variable,
                    node: node.d.target,
                    isConstant: isConstantName(node.d.target.d.value),
                    inferredTypeSource: node,
                    uri: this._fileInfo.fileUri,
                    range: convertTextRangeToRange(node.d.target, this._fileInfo.lines),
                    moduleName: this._fileInfo.moduleName,
                    isInExceptSuite: this._isInExceptSuite,
                    isExplicitBinding: this._currentScope.getBindingType(node.d.target.d.value) !== undefined,
                };
                symbol.addDeclaration(declaration);
            }
        }

        return false;
    }

    override visitPatternCapture(node: PatternCaptureNode) {
        if (!node.d.isWildcard) {
            this._addPatternCaptureTarget(node.d.target);
        }

        return true;
    }

    override visitPatternMappingExpandEntry(node: PatternMappingExpandEntryNode) {
        if (node.d.target.d.value !== '_') {
            this._addPatternCaptureTarget(node.d.target);
        }

        return true;
    }

    private _addTypingImportAliasesFromBuiltinsScope() {
        if (!this._fileInfo.builtinsScope) {
            return;
        }

        const symbolTable = this._fileInfo.builtinsScope.symbolTable;
        symbolTable.forEach((symbol, name) => {
            const typingImportAlias = symbol.getTypingSymbolAlias();
            if (typingImportAlias && !symbol.isExternallyHidden()) {
                this._typingSymbolAliases.set(name, typingImportAlias);
            }
        });
    }

    private _formatModuleName(node: ModuleNameNode): string {
        return '.'.repeat(node.d.leadingDots) + node.d.nameParts.map((part) => part.d.value).join('.');
    }

    private _getNonClassParentScope() {
        // We may not be able to use the current scope if it's a class scope.
        // Walk up until we find a non-class scope instead.
        let parentScope = this._currentScope;
        while (parentScope.type === ScopeType.Class) {
            parentScope = parentScope.parent!;
        }

        return parentScope;
    }

    private _addSlotsToCurrentScope(slotNameNodes: StringListNode[]) {
        assert(this._currentScope.type === ScopeType.Class);

        let slotsContainsDict = false;

        for (const slotNameNode of slotNameNodes) {
            const slotName = slotNameNode.d.strings[0].d.value;

            if (slotName === '__dict__') {
                slotsContainsDict = true;
                continue;
            }

            let symbol = this._currentScope.lookUpSymbol(slotName);
            if (!symbol) {
                symbol = this._currentScope.addSymbol(slotName, SymbolFlags.InitiallyUnbound | SymbolFlags.ClassMember);
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
                uri: this._fileInfo.fileUri,
                range: convertTextRangeToRange(slotNameNode, this._fileInfo.lines),
                moduleName: this._fileInfo.moduleName,
                isInExceptSuite: this._isInExceptSuite,
                isExplicitBinding: this._currentScope.getBindingType(slotName) !== undefined,
            };
            symbol.addDeclaration(declaration);
        }

        if (!slotsContainsDict) {
            this._currentScope.setSlotsNames(slotNameNodes.map((node) => node.d.strings[0].d.value));
        }
    }

    private _isInComprehension(node: ParseNode, ignoreOutermostIterable = false) {
        let curNode: ParseNode | undefined = node;
        let prevNode: ParseNode | undefined;
        let prevPrevNode: ParseNode | undefined;

        while (curNode) {
            if (curNode.nodeType === ParseNodeType.Comprehension) {
                if (ignoreOutermostIterable && curNode.d.forIfNodes.length > 0) {
                    const outermostCompr = curNode.d.forIfNodes[0];
                    if (prevNode === outermostCompr && outermostCompr.nodeType === ParseNodeType.ComprehensionFor) {
                        if (prevPrevNode === outermostCompr.d.iterableExpr) {
                            return false;
                        }
                    }
                }

                return true;
            }

            prevPrevNode = prevNode;
            prevNode = curNode;
            curNode = curNode.parent;
        }
        return false;
    }

    private _addPatternCaptureTarget(target: NameNode) {
        const symbol = this._bindNameToScope(this._currentScope, target);
        this._createAssignmentTargetFlowNodes(target, /* walkTargets */ false, /* unbound */ false);

        // See if the target overwrites all or a portion of the subject expression.
        if (this._currentMatchSubjExpr) {
            if (
                ParseTreeUtils.isMatchingExpression(target, this._currentMatchSubjExpr) ||
                ParseTreeUtils.isPartialMatchingExpression(target, this._currentMatchSubjExpr)
            ) {
                this._currentMatchSubjExpr = undefined;
            }
        }

        if (symbol) {
            const declaration: VariableDeclaration = {
                type: DeclarationType.Variable,
                node: target,
                isConstant: isConstantName(target.d.value),
                inferredTypeSource: target.parent,
                uri: this._fileInfo.fileUri,
                range: convertTextRangeToRange(target, this._fileInfo.lines),
                moduleName: this._fileInfo.moduleName,
                isInExceptSuite: this._isInExceptSuite,
                isExplicitBinding: this._currentScope.getBindingType(target.d.value) !== undefined,
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
        const resolvedUri =
            aliasDecl?.uri && !aliasDecl.uri.isEmpty() && aliasDecl.loadSymbolsFromPath
                ? aliasDecl.uri
                : aliasDecl?.submoduleFallback?.uri &&
                  !aliasDecl.submoduleFallback.uri.isEmpty() &&
                  aliasDecl.submoduleFallback.loadSymbolsFromPath
                ? aliasDecl.submoduleFallback.uri
                : undefined;
        if (!resolvedUri) {
            return undefined;
        }

        let lookupInfo = this._fileInfo.importLookup(resolvedUri);
        if (lookupInfo?.dunderAllNames) {
            return lookupInfo.dunderAllNames;
        }

        if (aliasDecl?.submoduleFallback?.uri && !aliasDecl.submoduleFallback.uri.isEmpty()) {
            lookupInfo = this._fileInfo.importLookup(aliasDecl.submoduleFallback.uri);
            return lookupInfo?.dunderAllNames;
        }

        return undefined;
    }

    private _addImplicitFromImport(node: ImportFromNode, importInfo?: ImportResult) {
        const symbolName = node.d.module.d.nameParts[0].d.value;
        const symbol = this._bindNameValueToScope(this._currentScope, symbolName);
        if (symbol) {
            this._createAliasDeclarationForMultipartImportName(node, /* importAlias */ undefined, importInfo, symbol);
        }

        this._createFlowAssignment(node.d.module.d.nameParts[0]);
    }

    private _createAliasDeclarationForMultipartImportName(
        node: ImportAsNode | ImportFromNode,
        importAlias: NameNode | undefined,
        importInfo: ImportResult | undefined,
        symbol: Symbol
    ) {
        const firstNamePartValue = node.d.module.d.nameParts[0].d.value;

        AnalyzerNodeInfo.setFlowNode(node, this._currentFlowNode!);

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
        let uriOfLastSubmodule: Uri;
        if (importInfo && importInfo.isImportFound && !importInfo.isNativeLib && importInfo.resolvedUris.length > 0) {
            uriOfLastSubmodule = importInfo.resolvedUris[importInfo.resolvedUris.length - 1];
        } else {
            uriOfLastSubmodule = UnresolvedModuleMarker;
        }

        const isResolved =
            importInfo && importInfo.isImportFound && !importInfo.isNativeLib && importInfo.resolvedUris.length > 0;

        if (existingDecl) {
            newDecl = existingDecl as AliasDeclaration;
        } else if (isResolved) {
            newDecl = {
                type: DeclarationType.Alias,
                node,
                uri: uriOfLastSubmodule,
                loadSymbolsFromPath: false,
                range: getEmptyRange(),
                usesLocalName: !!importAlias,
                moduleName: importAlias
                    ? this._formatModuleName(node.d.module)
                    : '.'.repeat(node.d.module.d.leadingDots) + firstNamePartValue,
                firstNamePart: firstNamePartValue,
                isInExceptSuite: this._isInExceptSuite,
            };
        } else {
            // If we couldn't resolve the import, create a dummy declaration with a
            // bogus path so it gets an unknown type (rather than an unbound type) at
            // analysis time.
            newDecl = {
                type: DeclarationType.Alias,
                node,
                uri: uriOfLastSubmodule,
                loadSymbolsFromPath: true,
                range: getEmptyRange(),
                usesLocalName: !!importAlias,
                moduleName: importInfo?.importName ?? '',
                firstNamePart: importAlias
                    ? this._formatModuleName(node.d.module)
                    : '.'.repeat(node.d.module.d.leadingDots) + firstNamePartValue,
                isUnresolved: true,
                isInExceptSuite: this._isInExceptSuite,
            };
        }

        // See if there is import info for this part of the path. This allows us
        // to implicitly import all of the modules in a multi-part module name.
        const implicitImportInfo = AnalyzerNodeInfo.getImportInfo(node.d.module.d.nameParts[0]);
        if (implicitImportInfo && implicitImportInfo.resolvedUris.length) {
            newDecl.uri = implicitImportInfo.resolvedUris[0];
            newDecl.loadSymbolsFromPath = true;
            this._addImplicitImportsToLoaderActions(implicitImportInfo, newDecl);
        }

        // Add the implicit imports for this module if it's the last
        // name part we're resolving.
        if (importAlias || node.d.module.d.nameParts.length === 1) {
            newDecl.uri = uriOfLastSubmodule;
            newDecl.loadSymbolsFromPath = true;
            newDecl.isUnresolved = false;

            if (importInfo) {
                this._addImplicitImportsToLoaderActions(importInfo, newDecl);
            }
        } else {
            // Fill in the remaining name parts.
            let curLoaderActions: ModuleLoaderActions = newDecl;

            for (let i = 1; i < node.d.module.d.nameParts.length; i++) {
                const namePartValue = node.d.module.d.nameParts[i].d.value;

                // Is there an existing loader action for this name?
                let loaderActions = curLoaderActions.implicitImports
                    ? curLoaderActions.implicitImports.get(namePartValue)
                    : undefined;
                if (!loaderActions) {
                    const loaderActionPath =
                        importInfo && i < importInfo.resolvedUris.length
                            ? importInfo.resolvedUris[i]
                            : UnresolvedModuleMarker;

                    // Allocate a new loader action.
                    loaderActions = {
                        uri: loaderActionPath,
                        loadSymbolsFromPath: false,
                        implicitImports: new Map<string, ModuleLoaderActions>(),
                        isUnresolved: !isResolved,
                    };
                    if (!curLoaderActions.implicitImports) {
                        curLoaderActions.implicitImports = new Map<string, ModuleLoaderActions>();
                    }
                    curLoaderActions.implicitImports.set(namePartValue, loaderActions);
                }

                if (i === node.d.module.d.nameParts.length - 1) {
                    // If this is the last name part we're resolving, add in the
                    // implicit imports as well.
                    if (importInfo && i < importInfo.resolvedUris.length) {
                        loaderActions.uri = importInfo.resolvedUris[i];
                        loaderActions.loadSymbolsFromPath = true;
                        this._addImplicitImportsToLoaderActions(importInfo, loaderActions);
                    }
                } else {
                    // If this isn't the last name part we're resolving, see if there
                    // is import info for this part of the path. This allows us to implicitly
                    // import all of the modules in a multi-part module name (e.g. "import a.b.c"
                    // imports "a" and "a.b" and "a.b.c").
                    const implicitImportInfo = AnalyzerNodeInfo.getImportInfo(node.d.module.d.nameParts[i]);
                    if (implicitImportInfo && implicitImportInfo.resolvedUris.length) {
                        loaderActions.uri = implicitImportInfo.resolvedUris[i];
                        loaderActions.loadSymbolsFromPath = true;
                        this._addImplicitImportsToLoaderActions(implicitImportInfo, loaderActions);
                    }
                }

                curLoaderActions = loaderActions;
            }
        }

        if (!existingDecl) {
            symbol.addDeclaration(newDecl);
        }
    }

    private _getWildcardImportNames(lookupInfo: ImportLookupResult): string[] {
        const namesToImport: string[] = [];

        // If a dunder all symbol is defined, it takes precedence.
        if (lookupInfo.dunderAllNames) {
            if (!lookupInfo.usesUnsupportedDunderAllForm) {
                return lookupInfo.dunderAllNames;
            }

            appendArray(namesToImport, lookupInfo.dunderAllNames);
        }

        lookupInfo.symbolTable.forEach((symbol, name) => {
            if (!symbol.isExternallyHidden() && !name.startsWith('_')) {
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

                // In case there are any class or function statements within this
                // subtree, we need to create dummy scopes for them. The type analyzer
                // depends on scopes being present.
                if (!this._moduleSymbolOnly) {
                    const dummyScopeGenerator = new DummyScopeGenerator(this._currentScope);
                    dummyScopeGenerator.walk(statement);
                }
            }
        }

        return false;
    }

    private _createStartFlowNode() {
        const flowNode: FlowNode = {
            flags: FlowFlags.Start,
            id: this._getUniqueFlowNodeId(),
        };
        return flowNode;
    }

    private _createBranchLabel(preBranchAntecedent?: FlowNode) {
        const flowNode: FlowBranchLabel = {
            flags: FlowFlags.BranchLabel,
            id: this._getUniqueFlowNodeId(),
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
            id: this._getUniqueFlowNodeId(),
            subjectExpression,
            statement,
            antecedent: this._currentFlowNode!,
        };

        this._currentFlowNode! = flowNode;
    }

    private _createContextManagerLabel(
        expressions: ExpressionNode[],
        isAsync: boolean,
        blockIfSwallowsExceptions: boolean
    ) {
        const flowNode: FlowPostContextManagerLabel = {
            flags: FlowFlags.PostContextManager | FlowFlags.BranchLabel,
            id: this._getUniqueFlowNodeId(),
            antecedents: [],
            expressions,
            affectedExpressions: undefined,
            isAsync,
            blockIfSwallowsExceptions,
        };
        return flowNode;
    }

    private _createLoopLabel() {
        const flowNode: FlowLabel = {
            flags: FlowFlags.LoopLabel,
            id: this._getUniqueFlowNodeId(),
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

        // The cyclomatic complexity is the number of edges minus the
        // number of nodes in the graph. Add n-1 where n is the number
        // of antecedents (edges) and 1 represents the label node.
        this._codeFlowComplexity += node.antecedents.length - 1;

        return node;
    }

    // Creates a node that creates a "gate" that is closed (doesn't allow for code
    // flow) if the specified expression is never once it is narrowed (in either the
    // positive or negative case).
    private _bindNeverCondition(node: ExpressionNode, target: FlowLabel, isPositiveTest: boolean) {
        const expressionList: CodeFlowReferenceExpressionNode[] = [];

        if (node.nodeType === ParseNodeType.UnaryOperation && node.d.operator === OperatorType.Not) {
            this._bindNeverCondition(node.d.expr, target, !isPositiveTest);
        } else if (
            node.nodeType === ParseNodeType.BinaryOperation &&
            (node.d.operator === OperatorType.And || node.d.operator === OperatorType.Or)
        ) {
            let isAnd = node.d.operator === OperatorType.And;
            if (isPositiveTest) {
                isAnd = !isAnd;
            }

            if (isAnd) {
                // In the And case, we need to gate the synthesized else clause if both
                // of the operands evaluate to never once they are narrowed.
                const savedCurrentFlowNode = this._currentFlowNode;
                this._bindNeverCondition(node.d.leftExpr, target, isPositiveTest);
                this._currentFlowNode = savedCurrentFlowNode;
                this._bindNeverCondition(node.d.rightExpr, target, isPositiveTest);
            } else {
                const initialCurrentFlowNode = this._currentFlowNode;

                // In the Or case, we need to gate the synthesized else clause if either
                // of the operands evaluate to never.
                const afterLabel = this._createBranchLabel();
                this._bindNeverCondition(node.d.leftExpr, afterLabel, isPositiveTest);

                // If the condition didn't result in any new flow nodes, we can skip
                // checking the other condition.
                if (initialCurrentFlowNode !== this._currentFlowNode) {
                    this._currentFlowNode = this._finishFlowLabel(afterLabel);

                    const prevCurrentNode = this._currentFlowNode;
                    this._bindNeverCondition(node.d.rightExpr, target, isPositiveTest);

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
            if (this._isNarrowingExpression(node, expressionList, { filterForNeverNarrowing: true })) {
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
        this._setTrueFalseTargets(/* trueTarget */ undefined, /* falseTarget */ undefined, callback);
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
            this._fileInfo.definedConstants,
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
        if (
            !this._isNarrowingExpression(expression, expressionList, {
                filterForNeverNarrowing: (flags & (FlowFlags.TrueNeverCondition | FlowFlags.FalseNeverCondition)) !== 0,
            })
        ) {
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
            id: this._getUniqueFlowNodeId(),
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
                return expression.d.operator === OperatorType.Not;
            }

            case ParseNodeType.BinaryOperation: {
                return expression.d.operator === OperatorType.And || expression.d.operator === OperatorType.Or;
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
        options: NarrowExprOptions = {}
    ): boolean {
        switch (expression.nodeType) {
            case ParseNodeType.Name:
            case ParseNodeType.MemberAccess:
            case ParseNodeType.Index: {
                if (options.filterForNeverNarrowing) {
                    // Never narrowing doesn't support member access or index
                    // expressions.
                    if (expression.nodeType !== ParseNodeType.Name) {
                        return false;
                    }

                    // Never narrowing doesn't support simple names (falsy
                    // or truthy narrowing) because it's too expensive and
                    // provides relatively little utility.
                    if (!options.isComplexExpression) {
                        return false;
                    }
                }

                if (isCodeFlowSupportedForReference(expression)) {
                    expressionList.push(expression);

                    if (!options.filterForNeverNarrowing) {
                        // If the expression is a member access expression, add its
                        // leftExpression to the expression list because that expression
                        // can be narrowed based on the attribute type.
                        if (expression.nodeType === ParseNodeType.MemberAccess && options.allowDiscriminatedNarrowing) {
                            if (isCodeFlowSupportedForReference(expression.d.leftExpr)) {
                                expressionList.push(expression.d.leftExpr);
                            }
                        }

                        // If the expression is an index expression with a supported
                        // subscript, add its baseExpression to the expression list because
                        // that expression can be narrowed.
                        if (
                            expression.nodeType === ParseNodeType.Index &&
                            expression.d.items.length === 1 &&
                            !expression.d.trailingComma &&
                            expression.d.items[0].d.argCategory === ArgCategory.Simple
                        ) {
                            if (isCodeFlowSupportedForReference(expression.d.leftExpr)) {
                                expressionList.push(expression.d.leftExpr);
                            }
                        }
                    }
                    return true;
                }

                return false;
            }

            case ParseNodeType.AssignmentExpression: {
                expressionList.push(expression.d.name);
                this._isNarrowingExpression(expression.d.rightExpr, expressionList, {
                    ...options,
                    isComplexExpression: true,
                });
                return true;
            }

            case ParseNodeType.BinaryOperation: {
                const isOrIsNotOperator =
                    expression.d.operator === OperatorType.Is || expression.d.operator === OperatorType.IsNot;
                const equalsOrNotEqualsOperator =
                    expression.d.operator === OperatorType.Equals || expression.d.operator === OperatorType.NotEquals;

                if (isOrIsNotOperator || equalsOrNotEqualsOperator) {
                    // Look for "X is None", "X is not None", "X == None", "X != None".
                    // These are commonly-used patterns used in control flow.
                    if (
                        expression.d.rightExpr.nodeType === ParseNodeType.Constant &&
                        expression.d.rightExpr.d.constType === KeywordType.None
                    ) {
                        return this._isNarrowingExpression(expression.d.leftExpr, expressionList, {
                            ...options,
                            isComplexExpression: true,
                            allowDiscriminatedNarrowing: true,
                        });
                    }

                    // Look for "type(X) is Y" or "type(X) is not Y".
                    if (
                        isOrIsNotOperator &&
                        expression.d.leftExpr.nodeType === ParseNodeType.Call &&
                        expression.d.leftExpr.d.leftExpr.nodeType === ParseNodeType.Name &&
                        expression.d.leftExpr.d.leftExpr.d.value === 'type' &&
                        expression.d.leftExpr.d.args.length === 1 &&
                        expression.d.leftExpr.d.args[0].d.argCategory === ArgCategory.Simple
                    ) {
                        return this._isNarrowingExpression(
                            expression.d.leftExpr.d.args[0].d.valueExpr,
                            expressionList,
                            { ...options, isComplexExpression: true }
                        );
                    }

                    const isLeftNarrowing = this._isNarrowingExpression(expression.d.leftExpr, expressionList, {
                        ...options,
                        isComplexExpression: true,
                        allowDiscriminatedNarrowing: true,
                    });

                    // Look for "X is Y" or "X is not Y".
                    // Look for X == <literal> or X != <literal>
                    // Look for len(X) == <literal> or len(X) != <literal>
                    return isLeftNarrowing;
                }

                // Look for len(X) < <literal>, len(X) <= <literal>, len(X) > <literal>, len(X) >= <literal>.
                if (expression.d.rightExpr.nodeType === ParseNodeType.Number && expression.d.rightExpr.d.isInteger) {
                    if (
                        expression.d.operator === OperatorType.LessThan ||
                        expression.d.operator === OperatorType.LessThanOrEqual ||
                        expression.d.operator === OperatorType.GreaterThan ||
                        expression.d.operator === OperatorType.GreaterThanOrEqual
                    ) {
                        const isLeftNarrowing = this._isNarrowingExpression(expression.d.leftExpr, expressionList, {
                            ...options,
                            isComplexExpression: true,
                        });

                        return isLeftNarrowing;
                    }
                }

                // Look for "<string> in Y" or "<string> not in Y".
                if (expression.d.operator === OperatorType.In || expression.d.operator === OperatorType.NotIn) {
                    if (
                        expression.d.leftExpr.nodeType === ParseNodeType.StringList &&
                        this._isNarrowingExpression(expression.d.rightExpr, expressionList, {
                            ...options,
                            isComplexExpression: true,
                        })
                    ) {
                        return true;
                    }
                }

                // Look for "X in Y" or "X not in Y".
                if (expression.d.operator === OperatorType.In || expression.d.operator === OperatorType.NotIn) {
                    const isLeftNarrowable = this._isNarrowingExpression(expression.d.leftExpr, expressionList, {
                        ...options,
                        isComplexExpression: true,
                    });

                    const isRightNarrowable = this._isNarrowingExpression(expression.d.rightExpr, expressionList, {
                        ...options,
                        isComplexExpression: true,
                    });

                    return isLeftNarrowable || isRightNarrowable;
                }

                return false;
            }

            case ParseNodeType.UnaryOperation: {
                return (
                    expression.d.operator === OperatorType.Not &&
                    this._isNarrowingExpression(expression.d.expr, expressionList, {
                        ...options,
                        isComplexExpression: false,
                    })
                );
            }

            case ParseNodeType.AugmentedAssignment: {
                return this._isNarrowingExpression(expression.d.rightExpr, expressionList, {
                    ...options,
                    isComplexExpression: true,
                });
            }

            case ParseNodeType.Call: {
                if (
                    expression.d.leftExpr.nodeType === ParseNodeType.Name &&
                    (expression.d.leftExpr.d.value === 'isinstance' ||
                        expression.d.leftExpr.d.value === 'issubclass') &&
                    expression.d.args.length === 2
                ) {
                    return this._isNarrowingExpression(expression.d.args[0].d.valueExpr, expressionList, {
                        ...options,
                        isComplexExpression: true,
                    });
                }

                if (
                    expression.d.leftExpr.nodeType === ParseNodeType.Name &&
                    expression.d.leftExpr.d.value === 'callable' &&
                    expression.d.args.length === 1
                ) {
                    return this._isNarrowingExpression(expression.d.args[0].d.valueExpr, expressionList, {
                        ...options,
                        isComplexExpression: true,
                    });
                }

                // Is this potentially a call to a user-defined type guard function?
                if (expression.d.args.length >= 1) {
                    // Never narrowing doesn't support type guards because they do not
                    // offer negative narrowing.
                    if (options.filterForNeverNarrowing) {
                        return false;
                    }

                    return this._isNarrowingExpression(expression.d.args[0].d.valueExpr, expressionList, {
                        ...options,
                        isComplexExpression: true,
                    });
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
                target.d.items.forEach((expr) => {
                    this._createAssignmentTargetFlowNodes(expr, walkTargets, unbound);
                });
                break;
            }

            case ParseNodeType.TypeAnnotation: {
                this._createAssignmentTargetFlowNodes(target.d.valueExpr, /* walkTargets */ false, unbound);
                if (walkTargets) {
                    this.walk(target);
                }
                break;
            }

            case ParseNodeType.Unpack: {
                this._createAssignmentTargetFlowNodes(target.d.expr, /* walkTargets */ false, unbound);
                if (walkTargets) {
                    this.walk(target);
                }
                break;
            }

            case ParseNodeType.List: {
                target.d.items.forEach((entry) => {
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
            this._addExceptTargets(this._currentFlowNode!);

            const flowNode: FlowCall = {
                flags: FlowFlags.Call,
                id: this._getUniqueFlowNodeId(),
                node,
                antecedent: this._currentFlowNode!,
            };

            this._currentFlowNode = flowNode;
        }
    }

    private _createVariableAnnotationFlowNode() {
        if (!this._isCodeUnreachable()) {
            const flowNode: FlowVariableAnnotation = {
                flags: FlowFlags.VariableAnnotation,
                id: this._getUniqueFlowNodeId(),
                antecedent: this._currentFlowNode!,
            };

            this._currentFlowNode = flowNode;
        }
    }

    private _createFlowAssignment(node: CodeFlowReferenceExpressionNode, unbound = false) {
        let targetSymbolId = indeterminateSymbolId;
        if (node.nodeType === ParseNodeType.Name) {
            const symbolWithScope = this._currentScope.lookUpSymbolRecursive(node.d.value);
            assert(symbolWithScope !== undefined);
            targetSymbolId = symbolWithScope!.symbol.id;
        }

        const prevFlowNode = this._currentFlowNode!;
        if (!this._isCodeUnreachable() && isCodeFlowSupportedForReference(node)) {
            const flowNode: FlowAssignment = {
                flags: FlowFlags.Assignment,
                id: this._getUniqueFlowNodeId(),
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
                id: this._getUniqueFlowNodeId(),
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
                id: this._getUniqueFlowNodeId(),
                node,
                antecedent: this._currentFlowNode!,
                subjectExpression: node.d.expr,
            };

            this._currentFlowNode = flowNode;
        }

        AnalyzerNodeInfo.setAfterFlowNode(node, this._currentFlowNode!);
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

        this._currentContinueTarget = preLoopLabel;
        this._currentBreakTarget = postLoopLabel;

        preLoopLabel.affectedExpressions = this._trackCodeFlowExpressions(callback);

        this._currentContinueTarget = savedContinueTarget;
        this._currentBreakTarget = savedBreakTarget;
    }

    private _addAntecedent(label: FlowLabel, antecedent: FlowNode) {
        if (!(this._currentFlowNode!.flags & FlowFlags.Unreachable)) {
            // Don't add the same antecedent twice.
            if (!label.antecedents.some((existing) => existing.id === antecedent.id)) {
                label.antecedents.push(antecedent);
            }
        }
    }

    private _bindNameToScope(scope: Scope, node: NameNode, addedSymbols?: Map<string, Symbol>) {
        return this._bindNameValueToScope(scope, node.d.value, addedSymbols);
    }

    private _bindNameValueToScope(scope: Scope, name: string, addedSymbols?: Map<string, Symbol>) {
        // Is this name already bound to a scope other than the local one?
        const bindingType = this._currentScope.getBindingType(name);

        if (bindingType !== undefined) {
            const scopeToUse =
                bindingType === NameBindingType.Nonlocal
                    ? this._currentScope.parent!
                    : this._currentScope.getGlobalScope().scope;
            const symbolWithScope = scopeToUse.lookUpSymbolRecursive(name);
            if (symbolWithScope) {
                return symbolWithScope.symbol;
            }
        } else {
            // Don't overwrite an existing symbol.
            let symbol = scope.lookUpSymbol(name);
            if (!symbol) {
                symbol = scope.addSymbol(name, SymbolFlags.InitiallyUnbound | SymbolFlags.ClassMember);

                if (this._currentScope.type === ScopeType.Module || this._currentScope.type === ScopeType.Builtin) {
                    if (isPrivateOrProtectedName(name)) {
                        if (isPrivateName(name)) {
                            // Private names within classes are mangled, so they are always externally hidden.
                            if (scope.type === ScopeType.Class) {
                                symbol.setIsExternallyHidden();
                            } else {
                                this._potentialPrivateSymbols.set(name, symbol);
                            }
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
                this._bindNameToScope(this._currentScope, target, addedSymbols);
                break;
            }

            case ParseNodeType.Tuple: {
                target.d.items.forEach((expr) => {
                    this._bindPossibleTupleNamedTarget(expr, addedSymbols);
                });
                break;
            }

            case ParseNodeType.List: {
                target.d.items.forEach((expr) => {
                    this._bindPossibleTupleNamedTarget(expr, addedSymbols);
                });
                break;
            }

            case ParseNodeType.TypeAnnotation: {
                this._bindPossibleTupleNamedTarget(target.d.valueExpr, addedSymbols);
                break;
            }

            case ParseNodeType.Unpack: {
                this._bindPossibleTupleNamedTarget(target.d.expr, addedSymbols);
                break;
            }
        }
    }

    private _addImplicitSymbolToCurrentScope(
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
                uri: this._fileInfo.fileUri,
                range: getEmptyRange(),
                moduleName: this._fileInfo.moduleName,
                isInExceptSuite: this._isInExceptSuite,
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

    private _createNewScope(
        scopeType: ScopeType,
        parentScope: Scope | undefined,
        proxyScope: Scope | undefined,
        callback: () => void
    ) {
        const prevScope = this._currentScope;
        const newScope = new Scope(scopeType, parentScope, proxyScope);
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
                const symbolWithScope = this._currentScope.lookUpSymbolRecursive(name.d.value);
                if (symbolWithScope && symbolWithScope.symbol) {
                    const declaration: VariableDeclaration = {
                        type: DeclarationType.Variable,
                        node: target,
                        isConstant: isConstantName(target.d.value),
                        inferredTypeSource: source,
                        isInferenceAllowedInPyTyped: this._isInferenceAllowedInPyTyped(name.d.value),
                        typeAliasName: isPossibleTypeAlias ? target : undefined,
                        uri: this._fileInfo.fileUri,
                        range: convertTextRangeToRange(name, this._fileInfo.lines),
                        moduleName: this._fileInfo.moduleName,
                        isInExceptSuite: this._isInExceptSuite,
                        docString: this._getVariableDocString(target),
                        isExplicitBinding: this._currentScope.getBindingType(name.d.value) !== undefined,
                    };
                    symbolWithScope.symbol.addDeclaration(declaration);
                }
                break;
            }

            case ParseNodeType.MemberAccess: {
                const memberAccessInfo = this._getMemberAccessInfo(target);
                if (memberAccessInfo) {
                    const name = target.d.member;

                    let symbol = memberAccessInfo.classScope.lookUpSymbol(name.d.value);
                    if (!symbol) {
                        symbol = memberAccessInfo.classScope.addSymbol(name.d.value, SymbolFlags.InitiallyUnbound);
                        const honorPrivateNaming = this._fileInfo.diagnosticRuleSet.reportPrivateUsage !== 'none';
                        if (isPrivateOrProtectedName(name.d.value) && honorPrivateNaming) {
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
                        node: target.d.member,
                        isConstant: isConstantName(name.d.value),
                        inferredTypeSource: source,
                        isDefinedByMemberAccess: true,
                        uri: this._fileInfo.fileUri,
                        range: convertTextRangeToRange(target.d.member, this._fileInfo.lines),
                        moduleName: this._fileInfo.moduleName,
                        isInExceptSuite: this._isInExceptSuite,
                        docString: this._getVariableDocString(target),
                    };
                    symbol.addDeclaration(declaration);
                }
                break;
            }

            case ParseNodeType.Tuple: {
                target.d.items.forEach((expr) => {
                    this._addInferredTypeAssignmentForVariable(expr, source);
                });
                break;
            }

            case ParseNodeType.TypeAnnotation: {
                this._addInferredTypeAssignmentForVariable(target.d.valueExpr, source);
                break;
            }

            case ParseNodeType.Unpack: {
                this._addInferredTypeAssignmentForVariable(target.d.expr, source);
                break;
            }

            case ParseNodeType.List: {
                target.d.items.forEach((entry) => {
                    this._addInferredTypeAssignmentForVariable(entry, source);
                });
                break;
            }
        }
    }

    private _isInferenceAllowedInPyTyped(symbolName: string): boolean {
        const exemptSymbols = ['__match_args__', '__slots__', '__all__'];
        return exemptSymbols.some((name) => name === symbolName);
    }

    private _addTypeDeclarationForVariable(target: ExpressionNode, typeAnnotation: ExpressionNode) {
        let declarationHandled = false;

        switch (target.nodeType) {
            case ParseNodeType.Name: {
                const name = target;
                const symbolWithScope = this._currentScope.lookUpSymbolRecursive(name.d.value);
                if (symbolWithScope && symbolWithScope.symbol) {
                    const finalInfo = this._isAnnotationFinal(typeAnnotation);

                    let typeAnnotationNode: ExpressionNode | undefined = typeAnnotation;
                    if (finalInfo.isFinal) {
                        if (!finalInfo.finalTypeNode) {
                            typeAnnotationNode = undefined;
                        }
                    }

                    // Is this annotation indicating that the variable is a "ClassVar"?
                    const classVarInfo = this._isAnnotationClassVar(typeAnnotation);

                    if (classVarInfo.isClassVar) {
                        if (!classVarInfo.classVarTypeNode) {
                            typeAnnotationNode = undefined;
                        }
                    }

                    // PEP 591 indicates that a Final variable initialized within a class
                    // body should also be considered a ClassVar unless it's in a dataclass.
                    // We can't tell at this stage whether it's a dataclass, so we'll simply
                    // record whether it's a Final assigned in a class body.
                    let isFinalAssignedInClassBody = false;
                    if (finalInfo.isFinal) {
                        const containingClass = ParseTreeUtils.getEnclosingClassOrFunction(target);
                        if (containingClass && containingClass.nodeType === ParseNodeType.Class) {
                            // Make sure it's part of an assignment.
                            if (
                                target.parent?.nodeType === ParseNodeType.Assignment ||
                                target.parent?.parent?.nodeType === ParseNodeType.Assignment
                            ) {
                                isFinalAssignedInClassBody = true;
                            }
                        }
                    }

                    const declaration: VariableDeclaration = {
                        type: DeclarationType.Variable,
                        node: target,
                        isConstant: isConstantName(name.d.value),
                        isFinal: finalInfo.isFinal,
                        typeAliasName: target,
                        uri: this._fileInfo.fileUri,
                        typeAnnotationNode,
                        range: convertTextRangeToRange(name, this._fileInfo.lines),
                        moduleName: this._fileInfo.moduleName,
                        isInExceptSuite: this._isInExceptSuite,
                        docString: this._getVariableDocString(target),
                        isExplicitBinding: this._currentScope.getBindingType(name.d.value) !== undefined,
                    };
                    symbolWithScope.symbol.addDeclaration(declaration);

                    if (isFinalAssignedInClassBody) {
                        symbolWithScope.symbol.setIsFinalVarInClassBody();
                    }

                    if (classVarInfo.isClassVar) {
                        symbolWithScope.symbol.setIsClassVar();
                    } else if (!isFinalAssignedInClassBody) {
                        symbolWithScope.symbol.setIsInstanceMember();
                    }

                    // Look for an 'InitVar' either by itself or wrapped in an 'Annotated'.
                    if (typeAnnotation.nodeType === ParseNodeType.Index) {
                        if (this._isDataclassesAnnotation(typeAnnotation.d.leftExpr, 'InitVar')) {
                            symbolWithScope.symbol.setIsInitVar();
                        } else if (
                            this._isTypingAnnotation(typeAnnotation.d.leftExpr, 'Annotated') &&
                            typeAnnotation.d.items.length > 0
                        ) {
                            const item0Expr = typeAnnotation.d.items[0].d.valueExpr;
                            if (
                                item0Expr.nodeType === ParseNodeType.Index &&
                                this._isDataclassesAnnotation(item0Expr.d.leftExpr, 'InitVar')
                            ) {
                                symbolWithScope.symbol.setIsInitVar();
                            }
                        }
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
                    const name = target.d.member;

                    let symbol = memberAccessInfo.classScope.lookUpSymbol(name.d.value);
                    if (!symbol) {
                        symbol = memberAccessInfo.classScope.addSymbol(name.d.value, SymbolFlags.InitiallyUnbound);
                        const honorPrivateNaming = this._fileInfo.diagnosticRuleSet.reportPrivateUsage !== 'none';
                        if (isPrivateOrProtectedName(name.d.value) && honorPrivateNaming) {
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
                        node: target.d.member,
                        isConstant: isConstantName(name.d.value),
                        isDefinedByMemberAccess: true,
                        isFinal: finalInfo.isFinal,
                        uri: this._fileInfo.fileUri,
                        typeAnnotationNode: finalInfo.isFinal && !finalInfo.finalTypeNode ? undefined : typeAnnotation,
                        range: convertTextRangeToRange(target.d.member, this._fileInfo.lines),
                        moduleName: this._fileInfo.moduleName,
                        isInExceptSuite: this._isInExceptSuite,
                        docString: this._getVariableDocString(target),
                    };
                    symbol.addDeclaration(declaration);

                    declarationHandled = true;
                }
                break;
            }
        }

        if (!declarationHandled) {
            this._addDiagnostic(
                DiagnosticRule.reportInvalidTypeForm,
                LocMessage.annotationNotSupported(),
                typeAnnotation
            );
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
        let annotationNode = typeAnnotation;

        // Is this a quoted annotation?
        if (annotationNode.nodeType === ParseNodeType.StringList && annotationNode.d.annotation) {
            annotationNode = annotationNode.d.annotation;
        }

        if (annotationNode.nodeType === ParseNodeType.Name) {
            const alias = symbolAliases.get(annotationNode.d.value);
            if (alias === name) {
                return true;
            }
        } else if (annotationNode.nodeType === ParseNodeType.MemberAccess) {
            if (annotationNode.d.leftExpr.nodeType === ParseNodeType.Name && annotationNode.d.member.d.value === name) {
                const baseName = annotationNode.d.leftExpr.d.value;
                return importAliases.some((alias) => alias === baseName);
            }
        }

        return false;
    }

    private _getVariableDocString(node: ExpressionNode): string | undefined {
        const docNode = ParseTreeUtils.getVariableDocStringNode(node);
        if (!docNode) {
            return undefined;
        }

        // A docstring can consist of multiple joined strings in a single expression.
        const strings = docNode.d.strings;
        if (strings.length === 1) {
            // Common case.
            return strings[0].d.value;
        }

        return strings.map((s) => s.d.value).join('');
    }

    // Determines if the specified type annotation expression is a "Final".
    // It returns a value indicating whether the expression is a "Final"
    // expression and whether it's a "raw" Final with no type arguments.
    private _isAnnotationFinal(typeAnnotation: ExpressionNode | undefined): FinalInfo {
        let isFinal = false;
        let finalTypeNode: ExpressionNode | undefined;

        if (typeAnnotation) {
            // Allow Final to be enclosed in ClassVar. Normally, Final implies
            // ClassVar, but this combination is required in the case of dataclasses.
            const classVarInfo = this._isAnnotationClassVar(typeAnnotation);
            if (classVarInfo?.classVarTypeNode) {
                typeAnnotation = classVarInfo.classVarTypeNode;
            }

            if (this._isTypingAnnotation(typeAnnotation, 'Final')) {
                isFinal = true;
            } else if (
                typeAnnotation.nodeType === ParseNodeType.Index &&
                typeAnnotation.d.items.length > 0 &&
                this._isTypingAnnotation(typeAnnotation.d.leftExpr, 'Annotated')
            ) {
                return this._isAnnotationFinal(typeAnnotation.d.items[0].d.valueExpr);
            } else if (typeAnnotation.nodeType === ParseNodeType.Index && typeAnnotation.d.items.length === 1) {
                // Recursively call to see if the base expression is "Final".
                const finalInfo = this._isAnnotationFinal(typeAnnotation.d.leftExpr);
                if (
                    finalInfo.isFinal &&
                    typeAnnotation.d.items[0].d.argCategory === ArgCategory.Simple &&
                    !typeAnnotation.d.items[0].d.name &&
                    !typeAnnotation.d.trailingComma
                ) {
                    isFinal = true;
                    finalTypeNode = typeAnnotation.d.items[0].d.valueExpr;
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

        while (typeAnnotation) {
            // Is this a quoted annotation?
            if (typeAnnotation.nodeType === ParseNodeType.StringList && typeAnnotation.d.annotation) {
                typeAnnotation = typeAnnotation.d.annotation;
            }

            if (
                typeAnnotation.nodeType === ParseNodeType.Index &&
                typeAnnotation.d.items.length > 0 &&
                this._isTypingAnnotation(typeAnnotation.d.leftExpr, 'Annotated')
            ) {
                typeAnnotation = typeAnnotation.d.items[0].d.valueExpr;
            } else if (this._isTypingAnnotation(typeAnnotation, 'ClassVar')) {
                isClassVar = true;
                break;
            } else if (typeAnnotation.nodeType === ParseNodeType.Index && typeAnnotation.d.items.length === 1) {
                // Recursively call to see if the base expression is "ClassVar".
                const finalInfo = this._isAnnotationClassVar(typeAnnotation.d.leftExpr);
                if (
                    finalInfo.isClassVar &&
                    typeAnnotation.d.items[0].d.argCategory === ArgCategory.Simple &&
                    !typeAnnotation.d.items[0].d.name &&
                    !typeAnnotation.d.trailingComma
                ) {
                    isClassVar = true;
                    classVarTypeNode = typeAnnotation.d.items[0].d.valueExpr;
                }
                break;
            } else {
                break;
            }
        }

        return { isClassVar, classVarTypeNode };
    }

    // Determines whether a member access expression is referring to a
    // member of a class (either a class or instance member). This will
    // typically take the form "self.x" or "cls.x".
    private _getMemberAccessInfo(node: MemberAccessNode): MemberAccessInfo | undefined {
        // We handle only simple names on the left-hand side of the expression,
        // not calls, nested member accesses, index expressions, etc.
        if (node.d.leftExpr.nodeType !== ParseNodeType.Name) {
            return undefined;
        }

        const leftSymbolName = node.d.leftExpr.d.value;

        // Make sure the expression is within a function (i.e. a method) that's
        // within a class definition.
        const methodNode = ParseTreeUtils.getEnclosingFunction(node);
        if (!methodNode) {
            return undefined;
        }

        const classNode = ParseTreeUtils.getEnclosingClass(methodNode, /* stopAtFunction */ true);
        if (!classNode) {
            return undefined;
        }

        // Determine whether the left-hand side indicates a class or
        // instance member.
        let isInstanceMember = false;

        if (methodNode.d.params.length < 1 || !methodNode.d.params[0].d.name) {
            return undefined;
        }

        const className = classNode.d.name.d.value;
        const firstParamName = methodNode.d.params[0].d.name.d.value;

        if (leftSymbolName === className) {
            isInstanceMember = false;
        } else {
            if (leftSymbolName !== firstParamName) {
                return undefined;
            }

            // To determine whether the first parameter of the method
            // refers to the class or the instance, we need to apply
            // some heuristics.
            const implicitClassMethods = ['__new__', '__init_subclass__', '__class_getitem__'];
            if (implicitClassMethods.includes(methodNode.d.name.d.value)) {
                // Several methods are special. They act as class methods even
                // though they don't have a @classmethod decorator.
                isInstanceMember = false;
            } else {
                // Assume that it's an instance member unless we find
                // a decorator that tells us otherwise.
                isInstanceMember = true;
                for (const decorator of methodNode.d.decorators) {
                    if (decorator.d.expr.nodeType === ParseNodeType.Name) {
                        const decoratorName = decorator.d.expr.d.value;

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
                existingLoaderAction.uri = implicitImport.uri;
                existingLoaderAction.loadSymbolsFromPath = true;
            } else {
                if (!loaderActions.implicitImports) {
                    loaderActions.implicitImports = new Map<string, ModuleLoaderActions>();
                }
                loaderActions.implicitImports.set(implicitImport.name, {
                    uri: implicitImport.uri,
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
            if (node.d.leftExpr.nodeType !== ParseNodeType.TypeAnnotation) {
                return false;
            }

            annotationNode = node.d.leftExpr;
        }

        if (annotationNode.d.valueExpr.nodeType !== ParseNodeType.Name) {
            return false;
        }

        const assignedNameNode = annotationNode.d.valueExpr;
        const specialTypes: Set<string> = new Set([
            'Tuple',
            'Generic',
            'Protocol',
            'Callable',
            'Type',
            'ClassVar',
            'Final',
            'Literal',
            'TypedDict',
            'Union',
            'Optional',
            'Annotated',
            'TypeAlias',
            'Concatenate',
            'TypeGuard',
            'Unpack',
            'Self',
            'NoReturn',
            'Never',
            'LiteralString',
            'OrderedDict',
            'TypeIs',
        ]);

        const assignedName = assignedNameNode.d.value;

        if (!specialTypes.has(assignedName)) {
            return false;
        }

        const specialBuiltInClassDeclaration: SpecialBuiltInClassDeclaration = {
            type: DeclarationType.SpecialBuiltInClass,
            node: annotationNode,
            uri: this._fileInfo.fileUri,
            range: convertTextRangeToRange(annotationNode, this._fileInfo.lines),
            moduleName: this._fileInfo.moduleName,
            isInExceptSuite: this._isInExceptSuite,
        };

        const symbol = this._bindNameToScope(this._currentScope, annotationNode.d.valueExpr);
        if (symbol) {
            symbol.addDeclaration(specialBuiltInClassDeclaration);
        }

        AnalyzerNodeInfo.setDeclaration(node, specialBuiltInClassDeclaration);
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
                this._addSyntaxError(LocMessage.yieldOutsideFunction(), node);
            }
        } else if (functionNode.d.isAsync && node.nodeType === ParseNodeType.YieldFrom) {
            // PEP 525 indicates that 'yield from' is not allowed in an
            // async function.
            this._addSyntaxError(LocMessage.yieldFromOutsideAsync(), node);
        }

        if (this._targetFunctionDeclaration) {
            if (!this._targetFunctionDeclaration.yieldStatements) {
                this._targetFunctionDeclaration.yieldStatements = [];
            }
            this._targetFunctionDeclaration.yieldStatements.push(node);
            this._targetFunctionDeclaration.isGenerator = true;
        }

        if (node.d.expr) {
            this.walk(node.d.expr);
        }

        AnalyzerNodeInfo.setFlowNode(node, this._currentFlowNode!);
    }

    private _getUniqueFlowNodeId() {
        this._codeFlowComplexity += flowNodeComplexityContribution;
        return getUniqueFlowNodeId();
    }

    private _addDiagnostic(rule: DiagnosticRule, message: string, textRange: TextRange) {
        const diagLevel = this._fileInfo.diagnosticRuleSet[rule] as DiagnosticLevel;

        let diagnostic: Diagnostic | undefined;
        switch (diagLevel) {
            case 'error':
            case 'warning':
            case 'information':
                diagnostic = this._fileInfo.diagnosticSink.addDiagnosticWithTextRange(diagLevel, message, textRange);
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

    private _addSyntaxError(message: string, textRange: TextRange) {
        return this._fileInfo.diagnosticSink.addDiagnosticWithTextRange('error', message, textRange);
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

// Creates dummy scopes for classes or functions within a parse tree.
// This is needed in cases where the parse tree has been determined
// to be unreachable. There are code paths where the type evaluator
// will still evaluate these types, and it depends on the presence
// of a scope.
export class DummyScopeGenerator extends ParseTreeWalker {
    private _currentScope: Scope | undefined;

    constructor(currentScope: Scope | undefined) {
        super();
        this._currentScope = currentScope;
    }

    override visitClass(node: ClassNode): boolean {
        const newScope = this._createNewScope(ScopeType.Class, () => {
            this.walk(node.d.suite);
        });

        if (!AnalyzerNodeInfo.getScope(node)) {
            AnalyzerNodeInfo.setScope(node, newScope);
        }

        return false;
    }

    override visitFunction(node: FunctionNode): boolean {
        const newScope = this._createNewScope(ScopeType.Function, () => {
            this.walk(node.d.suite);
        });

        if (!AnalyzerNodeInfo.getScope(node)) {
            AnalyzerNodeInfo.setScope(node, newScope);
        }

        return false;
    }

    private _createNewScope(scopeType: ScopeType, callback: () => void) {
        const prevScope = this._currentScope;
        const newScope = new Scope(scopeType, this._currentScope);
        this._currentScope = newScope;

        callback();

        this._currentScope = prevScope;
        return newScope;
    }
}
