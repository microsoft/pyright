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

import { DiagnosticLevel } from '../common/configOptions';
import { CreateTypeStubFileAction, getEmptyRange } from '../common/diagnostic';
import { DiagnosticRule } from '../common/diagnosticRules';
import { convertOffsetsToRange } from '../common/positionUtils';
import { PythonVersion } from '../common/pythonVersion';
import StringMap from '../common/stringMap';
import { TextRange } from '../common/textRange';
import { ArgumentCategory, AssertNode, AssignmentExpressionNode, AssignmentNode,
    AugmentedAssignmentExpressionNode, AwaitExpressionNode, BinaryExpressionNode, BreakNode,
    ClassNode, ContinueNode, DelNode, ExceptNode, ExpressionNode, ForNode, FunctionNode,
    GlobalNode, IfNode, ImportAsNode, ImportFromNode, LambdaNode, ListComprehensionNode,
    MemberAccessExpressionNode, ModuleNameNode, ModuleNode, NameNode, NonlocalNode, ParseNode,
    ParseNodeType, RaiseNode, ReturnNode, StatementNode, StringListNode, SuiteNode,
    TernaryExpressionNode, TryNode, TypeAnnotationExpressionNode, UnaryExpressionNode,
    WhileNode, WithNode, YieldExpressionNode, YieldFromExpressionNode } from '../parser/parseNodes';
import * as StringTokenUtils from '../parser/stringTokenUtils';
import { KeywordType, OperatorType, StringTokenFlags } from '../parser/tokenizerTypes';
import { AnalyzerFileInfo } from './analyzerFileInfo';
import * as AnalyzerNodeInfo from './analyzerNodeInfo';
import { FlowAssignment, FlowCondition, FlowFlags, FlowLabel, FlowNode, FlowStart,
    FlowWildcardImport } from './codeFlow';
import { AliasDeclaration, DeclarationType, FunctionDeclaration, ModuleLoaderActions,
    VariableDeclaration } from './declaration';
import * as DocStringUtils from './docStringUtils';
import { ImplicitImport, ImportResult, ImportType } from './importResult';
import { defaultTypeSourceId, TypeSourceId } from './inferredType';
import * as ParseTreeUtils from './parseTreeUtils';
import { ParseTreeWalker } from './parseTreeWalker';
import { Scope, ScopeType } from './scope';
import * as ScopeUtils from './scopeUtils';
import * as StaticExpressions from './staticExpressions';
import { SymbolFlags } from './symbol';
import { isConstantName } from './symbolNameUtils';
import { AnyType, ClassType, ClassTypeFlags, FunctionParameter, FunctionType,
    FunctionTypeFlags, ObjectType, Type, TypeCategory, UnknownType } from './types';

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
    nonLocalBindingsMap: StringMap<NameBindingType>;
    callback: () => void;
}

export class Binder extends ParseTreeWalker {
    private readonly _fileInfo: AnalyzerFileInfo;

    // A queue of deferred analysis operations.
    private _deferredBindingTasks: DeferredBindingTask[] = [];

    // The current scope in effect. This is either the base scope or a
    // "temporary scope", used for analyzing conditional code blocks. Their
    // contents are eventually merged in to the base scope.
    private _currentScope: Scope;

    // Name bindings that are not local to the current scope.
    private _notLocalBindings = new StringMap<NameBindingType>();

    // Number of nested except statements at current point of analysis.
    // Used to determine if a naked "raise" statement is allowed.
    private _nestedExceptDepth = 0;

    // Indicates that any name that's encountered should be ignored
    // because it's in an unexecuted section of code.
    private _isUnexecutedCode = false;

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

    // Flow node that is used for unreachable code.
    private static _unreachableFlowNode: FlowNode = { flags: FlowFlags.Unreachable };

    constructor(fileInfo: AnalyzerFileInfo) {
        super();

        this._fileInfo = fileInfo;
    }

    bindModule(node: ModuleNode) {
        // We'll assume that if there is no builtins scope provided, we must be
        // binding the builtins module itself.
        const isBuiltInModule = this._fileInfo.builtinsScope === undefined;

        this._createNewScope(isBuiltInModule ? ScopeType.Builtin : ScopeType.Module,
                this._fileInfo.builtinsScope, () => {

            AnalyzerNodeInfo.setScope(node, this._currentScope);

            // If this is the built-in scope, we need to hide symbols
            // that are in the stub file but are not officially part of
            // the built-in list of symbols in Python.
            if (isBuiltInModule) {
                const builtinsToExport = [
                    'ArithmeticError', 'AssertionError', 'AttributeError', 'BaseException',
                    'BlockingIOError', 'BrokenPipeError', 'BufferError', 'BytesWarning',
                    'ChildProcessError', 'ConnectionAbortedError', 'ConnectionError',
                    'ConnectionRefusedError', 'ConnectionResetError', 'DeprecationWarning',
                    'EOFError', 'Ellipsis', 'EnvironmentError', 'Exception',
                    'FileExistsError', 'FileNotFoundError', 'FloatingPointError',
                    'FutureWarning', 'GeneratorExit', 'IOError', 'ImportError',
                    'ImportWarning', 'IndentationError', 'IndexError', 'InterruptedError',
                    'IsADirectoryError', 'KeyError', 'KeyboardInterrupt', 'LookupError',
                    'MemoryError', 'NameError', 'NotADirectoryError', 'NotImplemented',
                    'NotImplementedError', 'OSError', 'OverflowError', 'PendingDeprecationWarning',
                    'PermissionError', 'ProcessLookupError', 'RecursionError', 'ReferenceError',
                    'ResourceWarning', 'RuntimeError', 'RuntimeWarning', 'StopAsyncIteration',
                    'StopIteration', 'SyntaxError', 'SyntaxWarning', 'SystemError', 'SystemExit',
                    'TabError', 'TimeoutError', 'TypeError', 'UnboundLocalError',
                    'UnicodeDecodeError', 'UnicodeEncodeError', 'UnicodeError', 'UnicodeTranslateError',
                    'UnicodeWarning', 'UserWarning', 'ValueError', 'Warning', 'WindowsError',
                    'ZeroDivisionError',
                    '__import__', '__loader__', '__name__',
                    '__package__', '__spec__', 'abs', 'all', 'any', 'ascii', 'bin', 'bool', 'breakpoint',
                    'bytearray', 'bytes', 'callable', 'chr', 'classmethod', 'compile', 'complex',
                    'copyright', 'credits', 'delattr', 'dict', 'dir', 'divmod', 'enumerate', 'eval',
                    'exec', 'exit', 'filter', 'float', 'format', 'frozenset', 'getattr', 'globals',
                    'hasattr', 'hash', 'help', 'hex', 'id', 'input', 'int', 'isinstance',
                    'issubclass', 'iter', 'len', 'license', 'list', 'locals', 'map', 'max',
                    'memoryview', 'min', 'next', 'object', 'oct', 'open', 'ord', 'pow', 'print',
                    'property', 'quit', 'range', 'repr', 'reversed', 'round', 'set', 'setattr',
                    'slice', 'sorted', 'staticmethod', 'str', 'sum', 'super', 'tuple', 'type',
                    'vars', 'zip'];

                this._currentScope.setExportFilter(builtinsToExport);
            }

            // Bind implicit names.
            // List taken from https://docs.python.org/3/reference/import.html#__name__
            const builtinIterableClass = ScopeUtils.getBuiltInType(this._currentScope, 'Iterable');
            const builtinStrObj = ScopeUtils.getBuiltInObject(this._currentScope, 'str');
            const strList = builtinIterableClass.category === TypeCategory.Class ?
                ObjectType.create(ClassType.cloneForSpecialization(builtinIterableClass, [builtinStrObj])) :
                AnyType.create();
            this._addBuiltInSymbolToCurrentScope('__doc__', builtinStrObj);
            this._addBuiltInSymbolToCurrentScope('__name__', builtinStrObj);
            this._addBuiltInSymbolToCurrentScope('__loader__', AnyType.create());
            this._addBuiltInSymbolToCurrentScope('__package__', builtinStrObj);
            this._addBuiltInSymbolToCurrentScope('__spec__', AnyType.create());
            this._addBuiltInSymbolToCurrentScope('__path__', strList);
            this._addBuiltInSymbolToCurrentScope('__file__', builtinStrObj);
            this._addBuiltInSymbolToCurrentScope('__cached__', builtinStrObj);

            // Create a start node for the module.
            this._currentFlowNode = this._createStartFlowNode();

            this.walkMultiple(node.statements);
        });

        // Perform all analysis that was deferred during the first pass.
        this._bindDeferred();

        return this._getDocString((node).statements);
    }

    visitModule(node: ModuleNode): boolean {
        // Tree walking should start with the children of
        // the node, so we should never get here.
        assert.fail('We should never get here');
        return false;
    }

    visitModuleName(node: ModuleNameNode): boolean {
        const importResult = AnalyzerNodeInfo.getImportInfo(node);
        assert(importResult !== undefined);

        if (importResult && !this._isUnexecutedCode) {
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
                            action: 'pyright.createtypestub',
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

        let classFlags = ClassTypeFlags.None;
        if (this._currentScope.getType() === ScopeType.Builtin ||
                this._fileInfo.isTypingStubFile ||
                this._fileInfo.isBuiltInStubFile) {

            classFlags |= ClassTypeFlags.BuiltInClass;
        }

        const classType = ClassType.create(node.name.nameToken.value, classFlags,
            node.id, this._getDocString(node.suite.statements));

        const symbol = this._bindNameToScope(this._currentScope, node.name.nameToken.value);
        if (symbol) {
            if (!this._isUnexecutedCode) {
                symbol.addDeclaration({
                    type: DeclarationType.Class,
                    node,
                    path: this._fileInfo.filePath,
                    range: convertOffsetsToRange(node.name.start,
                        TextRange.getEnd(node.name), this._fileInfo.lines)
                });
            }
        }

        this.walkMultiple(node.arguments);

        let sawMetaclass = false;
        let nonMetaclassBaseClassCount = 0;
        node.arguments.forEach(arg => {
            let isKeywordArg = false;
            let isMetaclass = false;
            if (arg.name) {
                if (arg.name.nameToken.value === 'metaclass') {
                    if (sawMetaclass) {
                        this._addError(`Only one metaclass can be provided`, arg);
                    }
                    isMetaclass = true;
                    sawMetaclass = true;
                } else {
                    // Other named parameters are ignored here; they are passed
                    // directly to the metaclass.
                    isKeywordArg = true;
                }
            }

            if (!isKeywordArg) {
                ClassType.addBaseClass(classType, UnknownType.create(), isMetaclass);

                if (!isMetaclass) {
                    nonMetaclassBaseClassCount++;
                }
            }
        });

        if (nonMetaclassBaseClassCount === 0) {
            // Make sure we don't have 'object' derive from itself. Infinite
            // recursion will result.
            if (!ClassType.isBuiltIn(classType, 'object')) {
                const objectType = ScopeUtils.getBuiltInType(this._currentScope, 'object');
                ClassType.addBaseClass(classType, objectType, false);
            }
        }

        AnalyzerNodeInfo.setExpressionType(node, classType);

        // Also set the type of the name node. This will be replaced by the analyzer
        // once any class decorators are analyzed, but we need to add it here to
        // accommodate some circular references between builtins and typing type stubs.
        AnalyzerNodeInfo.setExpressionType(node.name, classType);

        this._createNewScope(ScopeType.Class, this._currentScope, () => {
            AnalyzerNodeInfo.setScope(node, this._currentScope);

            // The scope for this class becomes the "fields" for the corresponding type.
            ClassType.setFields(classType, this._currentScope.getSymbolTable());
            assert(classType && classType.category === TypeCategory.Class);

            // Bind implicit names.
            // Note that __class__, __dict__ and __doc__ are skipped here
            // because the builtins.pyi type stub declares these in the
            // 'object' class.
            this._addBuiltInSymbolToCurrentScope('__name__',
                ScopeUtils.getBuiltInObject(this._currentScope, 'str'));
            if (this._fileInfo.executionEnvironment.pythonVersion >= PythonVersion.V33) {
                this._addBuiltInSymbolToCurrentScope('__qualname__',
                    ScopeUtils.getBuiltInObject(this._currentScope, 'str'));
            }

            // Create a start node for the class.
            this._currentFlowNode = this._createStartFlowNode();

            // Analyze the suite.
            this.walk(node.suite);
        });

        // Add the class symbol. We do this in the binder to speed
        // up overall analysis times. Without this, the type analyzer needs
        // to do more passes to resolve classes.
        this._addSymbolToCurrentScope(node.name.nameToken.value, classType, node.name.id);

        return false;
    }

    visitFunction(node: FunctionNode): boolean {
        // The "__new__" magic method is not an instance method.
        // It acts as a static method instead.
        let functionFlags = FunctionTypeFlags.None;
        if (node.name.nameToken.value === '__new__') {
            functionFlags |= FunctionTypeFlags.StaticMethod;
            functionFlags |= FunctionTypeFlags.ConstructorMethod;
            functionFlags &= ~FunctionTypeFlags.InstanceMethod;
        }

        const savedTargetFunctionDeclaration = this._targetFunctionDeclaration;
        this._targetFunctionDeclaration = undefined;

        const functionType = FunctionType.create(functionFlags,
            this._getDocString(node.suite.statements));

        const symbol = this._bindNameToScope(this._currentScope, node.name.nameToken.value);
        if (!this._isUnexecutedCode) {
            const containingClassNode = ParseTreeUtils.getEnclosingClass(node, true);
            const declarationType = containingClassNode ?
                DeclarationType.Method : DeclarationType.Function;
            const functionDeclaration: FunctionDeclaration = {
                type: declarationType,
                node,
                path: this._fileInfo.filePath,
                range: convertOffsetsToRange(node.name.start, TextRange.getEnd(node.name),
                    this._fileInfo.lines)
            };
            this._targetFunctionDeclaration = functionDeclaration;

            if (symbol) {
                symbol.addDeclaration(functionDeclaration);
            }
        }

        this.walkMultiple(node.decorators);
        node.parameters.forEach(param => {
            if (param.defaultValue) {
                this.walk(param.defaultValue);
            }

            const typeParam: FunctionParameter = {
                category: param.category,
                name: param.name ? param.name.nameToken.value : undefined,
                hasDefault: !!param.defaultValue,
                type: UnknownType.create()
            };

            FunctionType.addParameter(functionType, typeParam);

            if (param.typeAnnotation) {
                this.walk(param.typeAnnotation);
            }
        });

        if (node.returnTypeAnnotation) {
            this.walk(node.returnTypeAnnotation);
        }

        AnalyzerNodeInfo.setExpressionType(node, functionType);

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
            this._addBuiltInSymbolToCurrentScope('__doc__',
                ScopeUtils.getBuiltInObject(this._currentScope, 'str'));
            this._addBuiltInSymbolToCurrentScope('__name__',
                ScopeUtils.getBuiltInObject(this._currentScope, 'str'));
            if (this._fileInfo.executionEnvironment.pythonVersion >= PythonVersion.V33) {
                this._addBuiltInSymbolToCurrentScope('__qualname__',
                    ScopeUtils.getBuiltInObject(this._currentScope, 'str'));
            }
            this._addBuiltInSymbolToCurrentScope('__module__',
                ScopeUtils.getBuiltInObject(this._currentScope, 'str'));
            this._addBuiltInSymbolToCurrentScope('__defaults__', AnyType.create());
            this._addBuiltInSymbolToCurrentScope('__code__', AnyType.create());
            this._addBuiltInSymbolToCurrentScope('__globals__', AnyType.create());
            this._addBuiltInSymbolToCurrentScope('__dict__', AnyType.create());
            this._addBuiltInSymbolToCurrentScope('__closure__', AnyType.create());
            this._addBuiltInSymbolToCurrentScope('__annotations__', AnyType.create());
            this._addBuiltInSymbolToCurrentScope('__kwdefaults__', AnyType.create());

            const enclosingClass = ParseTreeUtils.getEnclosingClass(node);
            if (enclosingClass) {
                const enclosingClassType = AnalyzerNodeInfo.getExpressionType(enclosingClass);
                if (enclosingClassType) {
                    this._addBuiltInSymbolToCurrentScope('__class__', enclosingClassType);
                }
            }

            this._deferBinding(() => {
                node.parameters.forEach(paramNode => {
                    if (paramNode.name) {
                        const symbol = this._bindNameToScope(this._currentScope, paramNode.name.nameToken.value);
                        if (symbol) {
                            symbol.addDeclaration({
                                type: DeclarationType.Parameter,
                                node: paramNode,
                                path: this._fileInfo.filePath,
                                range: convertOffsetsToRange(paramNode.start, TextRange.getEnd(paramNode),
                                    this._fileInfo.lines)
                            });
                        }
                    }
                });

                // Create a start node for the function.
                this._currentFlowNode = this._createStartFlowNode(node);

                // Walk the statements that make up the function.
                this.walk(node.suite);
            });
        });

        this._targetFunctionDeclaration = savedTargetFunctionDeclaration;

        // We'll walk the child nodes in a deffered manner, so don't walk
        // them now.
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
                node.parameters.forEach(paramNode => {
                    if (paramNode.name) {
                        const symbol = this._bindNameToScope(this._currentScope, paramNode.name.nameToken.value);
                        if (symbol) {
                            symbol.addDeclaration({
                                type: DeclarationType.Parameter,
                                node: paramNode,
                                path: this._fileInfo.filePath,
                                range: convertOffsetsToRange(paramNode.start, TextRange.getEnd(paramNode),
                                    this._fileInfo.lines)
                            });
                        }
                    }
                });

                // Create a start node for the lambda.
                this._currentFlowNode = this._createStartFlowNode(node);

                // Walk the expression that make up the lambda body.
                this.walk(node.expression);
            });
        });

        // We'll walk the child nodes in a deffered manner.
        return false;
    }

    visitAssignment(node: AssignmentNode) {
        if (!this._handleTypingStubAssignment(node)) {
            this._bindPossibleTupleNamedTarget(node.leftExpression);

            if (node.typeAnnotationComment) {
                if (!this._isUnexecutedCode) {
                    this._addTypeDeclarationForVariable(node.leftExpression, node.typeAnnotationComment);
                }
            }

            this._addInferredTypeAssignmentForVariable(node.leftExpression, node.rightExpression);
        }

        this._createAssignmentTargetFlowNodes(node.leftExpression);

        return true;
    }

    visitAssignmentExpression(node: AssignmentExpressionNode) {
        this._bindPossibleTupleNamedTarget(node.name);
        this._addInferredTypeAssignmentForVariable(node.name, node.rightExpression);

        this._createAssignmentTargetFlowNodes(node.name);

        return true;
    }

    visitAugmentedAssignment(node: AugmentedAssignmentExpressionNode) {
        this._bindPossibleTupleNamedTarget(node.leftExpression);
        this._addInferredTypeAssignmentForVariable(node.leftExpression, node.rightExpression);

        this._createAssignmentTargetFlowNodes(node.leftExpression);

        return true;
    }

    visitDel(node: DelNode) {
        node.expressions.forEach(expr => {
            this._bindPossibleTupleNamedTarget(expr);
        });

        node.expressions.forEach(expr => {
            this._createAssignmentTargetFlowNodes(expr);
        });

        return true;
    }

    visitTypeAnnotation(node: TypeAnnotationExpressionNode): boolean {
        this._bindPossibleTupleNamedTarget(node.valueExpression);
        if (!this._isUnexecutedCode) {
            this._addTypeDeclarationForVariable(node.valueExpression, node.typeAnnotation);
        }
        return true;
    }

    visitFor(node: ForNode) {
        this._bindPossibleTupleNamedTarget(node.targetExpression);
        this._addInferredTypeAssignmentForVariable(node.targetExpression, node);

        this.walk(node.iterableExpression);

        const preLoopLabel = this._createLoopLabel();
        const postLoopLabel = this._createBranchLabel();
        const postForElseLabel = this._createBranchLabel();
        const preElseFlowNode = this._currentFlowNode;

        this._addAntecedent(preLoopLabel, this._currentFlowNode);

        this._bindLoopStatement(preLoopLabel, postLoopLabel, () => {
            this._currentFlowNode = preLoopLabel;
            this.walk(node.targetExpression);
            this._createAssignmentTargetFlowNodes(node.targetExpression);
            this.walk(node.forSuite);
            this._addAntecedent(preLoopLabel, this._currentFlowNode);
            this._addAntecedent(postLoopLabel, this._currentFlowNode);
        });
        this._addAntecedent(postForElseLabel, postLoopLabel);

        if (node.elseSuite) {
            this._currentFlowNode = preElseFlowNode;
            this.walk(node.forSuite);
            this._addAntecedent(postForElseLabel, this._currentFlowNode);
        }

        this._currentFlowNode = this._finishFlowLabel(postForElseLabel);

        return false;
    }

    visitContinue(node: ContinueNode): boolean {
        if (this._currentContinueTarget) {
            this._addAntecedent(this._currentContinueTarget, this._currentFlowNode);
        }
        this._currentFlowNode = Binder._unreachableFlowNode;
        return true;
    }

    visitBreak(node: BreakNode): boolean {
        if (this._currentBreakTarget) {
            this._addAntecedent(this._currentBreakTarget, this._currentFlowNode);
        }
        this._currentFlowNode = Binder._unreachableFlowNode;
        return true;
    }

    visitReturn(node: ReturnNode): boolean {
        if (this._targetFunctionDeclaration) {
            if (!this._targetFunctionDeclaration.returnExpressions) {
                this._targetFunctionDeclaration.returnExpressions = [];
            }
            this._targetFunctionDeclaration.returnExpressions.push(node);
        }

        this._currentFlowNode = Binder._unreachableFlowNode;
        return true;
    }

    visitYield(node: YieldExpressionNode): boolean {
        this._validateYieldUsage(node);

        if (this._targetFunctionDeclaration) {
            if (!this._targetFunctionDeclaration.yieldExpressions) {
                this._targetFunctionDeclaration.yieldExpressions = [];
            }
            this._targetFunctionDeclaration.yieldExpressions.push(node);
        }

        return true;
    }

    visitMemberAccess(node: MemberAccessExpressionNode): boolean {
        AnalyzerNodeInfo.setFlowNode(node, this._currentFlowNode);
        return true;
    }

    visitName(node: NameNode): boolean {
        AnalyzerNodeInfo.setFlowNode(node, this._currentFlowNode);
        // Names have no children.
        return false;
    }

    visitYieldFrom(node: YieldFromExpressionNode): boolean {
        this._validateYieldUsage(node);

        if (this._targetFunctionDeclaration) {
            if (!this._targetFunctionDeclaration.yieldExpressions) {
                this._targetFunctionDeclaration.yieldExpressions = [];
            }
            this._targetFunctionDeclaration.yieldExpressions.push(node);
        }
        return true;
    }

    visitIf(node: IfNode): boolean {
        this._handleIfWhileCommon(node.testExpression, node.ifSuite, node.elseSuite, false);
        return false;
    }

    visitWhile(node: WhileNode): boolean {
        this._handleIfWhileCommon(node.testExpression, node.whileSuite, node.elseSuite, true);
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
        if (node.name) {
            const symbol = this._bindNameToScope(this._currentScope, node.name.nameToken.value);
            this._createAssignmentTargetFlowNodes(node.name);
            if (symbol) {
                const declaration: VariableDeclaration = {
                    type: DeclarationType.Variable,
                    node: node.name,
                    isConstant: isConstantName(node.name.nameToken.value),
                    path: this._fileInfo.filePath,
                    range: convertOffsetsToRange(node.name.start, TextRange.getEnd(node.name),
                        this._fileInfo.lines)
                };
                symbol.addDeclaration(declaration);
            }
        }

        return true;
    }

    visitRaise(node: RaiseNode): boolean {
        this._currentScope.setAlwaysRaises();

        if (!node.typeExpression && this._nestedExceptDepth === 0) {
            this._addError(
                `Raise requires parameter(s) when used outside of except clause `,
                node);
        }

        this._currentFlowNode = Binder._unreachableFlowNode;
        return true;
    }

    visitTry(node: TryNode): boolean {
        // Create one flow label for every except clause.
        const curExceptTargets = node.exceptClauses.map(() => this._createBranchLabel());
        const preFinallyLabel = this._createBranchLabel();

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

        // Handle the except blocks.
        this._nestedExceptDepth++;
        node.exceptClauses.forEach((exceptNode, index) => {
            this._currentFlowNode = this._finishFlowLabel(curExceptTargets[index]);
            this.walk(exceptNode);
            this._addAntecedent(preFinallyLabel, this._currentFlowNode);
        });
        this._nestedExceptDepth--;

        // Handle the finally block.
        if (node.finallySuite) {
            this._currentFlowNode = this._finishFlowLabel(preFinallyLabel);
            this.walk(node.finallySuite);
        }

        return false;
    }

    visitAwait(node: AwaitExpressionNode) {
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

                unescapedResult.unescapeErrors.forEach(error => {
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
            const nameValue = name.nameToken.value;

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
                const nameValue = name.nameToken.value;

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
        if (this._isUnexecutedCode) {
            return true;
        }

        if (node.module.nameParts.length > 0) {
            const firstNamePartValue = node.module.nameParts[0].nameToken.value;

            let symbolName: string | undefined;
            if (node.alias) {
                // The symbol name is defined by the alias.
                symbolName = node.alias.nameToken.value;
            } else {
                // There was no alias, so we need to use the first element of
                // the name parts as the symbol.
                symbolName = firstNamePartValue;
            }

            const symbol = this._bindNameToScope(this._currentScope, symbolName);

            const importInfo = AnalyzerNodeInfo.getImportInfo(node.module);
            assert(importInfo !== undefined);

            if (importInfo && importInfo.isImportFound && importInfo.resolvedPaths.length > 0 && symbol) {
                // See if there's already a matching alias delaration for this import.
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
                    path: '',
                    range: getEmptyRange(),
                    firstNamePart: firstNamePartValue,
                    implicitImports: new Map<string, ModuleLoaderActions>()
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

                        const namePartValue = node.module.nameParts[i].nameToken.value;

                        // Is there an existing loader action for this name?
                        let loaderActions = curLoaderActions.implicitImports.get(namePartValue);
                        if (!loaderActions) {
                            // Allocate a new loader action.
                            loaderActions = {
                                path: '',
                                implicitImports: new Map<string, ModuleLoaderActions>()
                            };
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

            this._createFlowAssignment(node.alias ?
                node.alias : node.module.nameParts[0]);
        }

        return true;
    }

    visitImportFrom(node: ImportFromNode): boolean {
        if (this._isUnexecutedCode) {
            return true;
        }

        const importInfo = AnalyzerNodeInfo.getImportInfo(node.module);

        let resolvedPath = '';
        if (importInfo && importInfo.isImportFound) {
            resolvedPath = importInfo.resolvedPaths[importInfo.resolvedPaths.length - 1];
        }

        if (node.isWildcardImport) {
            if (importInfo && importInfo.implicitImports) {
                const names: string[] = [];
                const lookupInfo = this._fileInfo.importLookup(resolvedPath);

                if (lookupInfo) {
                    lookupInfo.symbolTable.forEach((symbol, name) => {
                        // Don't include the implicit names in the symbol table.
                        if (!symbol.isIgnoredForProtocolMatch()) {
                            const symbol = this._bindNameToScope(this._currentScope, name);
                            if (symbol) {
                                const aliasDecl: AliasDeclaration = {
                                    type: DeclarationType.Alias,
                                    path: resolvedPath,
                                    range: getEmptyRange(),
                                    symbolName: name,
                                    implicitImports: new Map<string, ModuleLoaderActions>()
                                };
                                symbol.addDeclaration(aliasDecl);
                                names.push(name);
                            }
                        }
                    });
                }

                // Also add all of the implicitly-imported modules for
                // the import  module.
                importInfo.implicitImports.forEach(implicitImport => {
                    const symbol = this._bindNameToScope(this._currentScope, implicitImport.name);
                    if (symbol) {
                        const aliasDecl: AliasDeclaration = {
                            type: DeclarationType.Alias,
                            path: implicitImport.path,
                            range: getEmptyRange(),
                            implicitImports: new Map<string, ModuleLoaderActions>()
                        };
                        symbol.addDeclaration(aliasDecl);
                        names.push(implicitImport.name);
                    }
                });

                this._createFlowWildcardImport(node, names);
            }
        } else {
            node.imports.forEach(importSymbolNode => {
                const importedName = importSymbolNode.name.nameToken.value;
                const nameNode = importSymbolNode.alias || importSymbolNode.name;
                const symbol = this._bindNameToScope(this._currentScope, nameNode.nameToken.value);

                if (symbol) {
                    let aliasDecl: AliasDeclaration | undefined;

                    // Is the import referring to an implicitly-imported module?
                    let implicitImport: ImplicitImport | undefined;
                    if (importInfo && importInfo.implicitImports) {
                        implicitImport = importInfo.implicitImports.find(imp => imp.name === importedName);
                    }

                    if (implicitImport) {
                        aliasDecl = {
                            type: DeclarationType.Alias,
                            path: implicitImport.path,
                            range: getEmptyRange(),
                            implicitImports: new Map<string, ModuleLoaderActions>()
                        };
                    } else if (resolvedPath) {
                        aliasDecl = {
                            type: DeclarationType.Alias,
                            path: resolvedPath,
                            range: getEmptyRange(),
                            symbolName: importedName,
                            implicitImports: new Map<string, ModuleLoaderActions>()
                        };
                    }

                    if (aliasDecl) {
                        symbol.addDeclaration(aliasDecl);
                    }
                }
            });
        }

        return true;
    }

    visitWith(node: WithNode): boolean {
        node.withItems.forEach(item => {
            if (item.target) {
                this._bindPossibleTupleNamedTarget(item.target);
                this._addInferredTypeAssignmentForVariable(item.target, item);
                this._createAssignmentTargetFlowNodes(item.target);
            }
        });

        return true;
    }

    visitTernary(node: TernaryExpressionNode): boolean {
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

    visitUnaryOperation(node: UnaryExpressionNode): boolean {
        if (node.operator === OperatorType.Not) {
            // Temporarily swap the true and false targets.
            const saveTrueTarget = this._currentTrueTarget;
            this._currentTrueTarget = this._currentFalseTarget;
            this._currentFalseTarget = saveTrueTarget;

            // Evaluate the operand expression.
            this.walk(node.expression);

            // Swap the true and false targets back.
            this._currentFalseTarget = this._currentTrueTarget;
            this._currentTrueTarget = saveTrueTarget;
            return false;
        }

        return true;
    }

    visitBinaryOperation(node: BinaryExpressionNode): boolean {
        if (node.operator === OperatorType.And || node.operator === OperatorType.Or) {
            if (this._isTopLevelLogicalExpression(node)) {
                const postExpressionLabel = this._createBranchLabel();
                this._bindLogicalExpression(node, postExpressionLabel, postExpressionLabel);
                this._currentFlowNode = this._finishFlowLabel(postExpressionLabel);
            } else {
                this._bindLogicalExpression(node, this._currentTrueTarget!,
                    this._currentFalseTarget!);
            }

            return false;
        }

        return true;
    }

    visitListComprehension(node: ListComprehensionNode): boolean {
        // Allocate a new scope.
        const prevScope = this._currentScope;
        this._currentScope = new Scope(ScopeType.ListComprehension, prevScope);
        const falseLabel = this._createBranchLabel();

        for (let i = 0; i < node.comprehensions.length; i++) {
            const compr = node.comprehensions[i];
            if (compr.nodeType === ParseNodeType.ListComprehensionFor) {
                this.walk(compr.iterableExpression);

                this._bindPossibleTupleNamedTarget(compr.targetExpression);
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

        AnalyzerNodeInfo.setScope(node, this._currentScope);

        this._currentScope = prevScope;

        return false;
    }

    private _createStartFlowNode(node?: FunctionNode | LambdaNode) {
        const flowNode: FlowStart = {
            flags: FlowFlags.Start,
            function: node
        };
        return flowNode;
    }

    private _createBranchLabel() {
        const flowNode: FlowLabel = {
            flags: FlowFlags.BranchLabel,
            antecedents: []
        };
        return flowNode;
    }

    private _createLoopLabel() {
        const flowNode: FlowLabel = {
            flags: FlowFlags.LoopLabel,
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
        const staticValue = StaticExpressions.evaluateStaticExpression(
            expression, this._fileInfo.executionEnvironment);
        if (staticValue === true && (flags & FlowFlags.FalseCondition) ||
                staticValue === false && (flags & FlowFlags.TrueCondition)) {

            return Binder._unreachableFlowNode;
        }

        if (!this._isNarrowingExpression(expression)) {
            return antecedent;
        }

        const conditionalFlowNode: FlowCondition = {
            flags,
            expression,
            antecedent
        };

        this._addExceptTargets(conditionalFlowNode);

        return conditionalFlowNode;
    }

    private _isTopLevelLogicalExpression(node: ExpressionNode): boolean {
        let curNode = node as ParseNode;
        while (curNode.parent &&
                curNode.parent.nodeType === ParseNodeType.UnaryOperation &&
                curNode.parent.operator === OperatorType.Not) {

            curNode = curNode.parent;
        }

        const parentNode = curNode.parent;
        if (!parentNode) {
            return true;
        }

        switch (parentNode.nodeType) {
            case ParseNodeType.If:
            case ParseNodeType.While:
            case ParseNodeType.Ternary:
            case ParseNodeType.ListComprehensionIf:
                if (parentNode.testExpression === node) {
                    return false;
                }
                break;

            case ParseNodeType.BinaryOperation:
            case ParseNodeType.UnaryOperation:
               return !this._isLogicalExpression(parentNode);
        }

        return true;
    }

    private _bindLogicalExpression(node: BinaryExpressionNode,
            trueTarget: FlowLabel, falseTarget: FlowLabel) {

        const preRightLabel = this._createBranchLabel();
        if (node.operator === OperatorType.And) {
            this._bindConditional(node.leftExpression, preRightLabel, falseTarget);
        } else {
            this._bindConditional(node.leftExpression, trueTarget, preRightLabel);
        }
        this._currentFlowNode = this._finishFlowLabel(preRightLabel);
        this._bindConditional(node.rightExpression, trueTarget, falseTarget);
    }

    // Indicates whether the expression is a NOT, AND or OR expression.
    private _isLogicalExpression(expression: ExpressionNode): boolean {
        switch (expression.nodeType) {
            case ParseNodeType.UnaryOperation: {
                return expression.operator === OperatorType.Not &&
                    this._isLogicalExpression(expression.expression);
            }

            case ParseNodeType.BinaryOperation: {
                return expression.operator === OperatorType.And ||
                    expression.operator === OperatorType.Or;
            }
        }

        return false;
    }

    private _isNarrowingExpression(expression: ExpressionNode): boolean {
        switch (expression.nodeType) {
            case ParseNodeType.Name:
            case ParseNodeType.MemberAccess: {
                return true;
            }

            case ParseNodeType.BinaryOperation: {
                if (expression.operator === OperatorType.Is ||
                        expression.operator === OperatorType.IsNot) {

                    // Look for "X is None" or "X is not None". These are commonly-used
                    // patterns used in control flow.
                    if (expression.rightExpression.nodeType === ParseNodeType.Constant &&
                            expression.rightExpression.token.keywordType === KeywordType.None) {

                        return true;
                    }

                    // Look for "type(X) is Y" or "type(X) is not Y".
                    if (expression.leftExpression.nodeType === ParseNodeType.Call &&
                        expression.leftExpression.leftExpression.nodeType === ParseNodeType.Name &&
                        expression.leftExpression.leftExpression.nameToken.value === 'type' &&
                        expression.leftExpression.arguments.length === 1 &&
                            expression.leftExpression.arguments[0].argumentCategory === ArgumentCategory.Simple) {

                        return true;
                    }
                }

                return false;
            }

            case ParseNodeType.UnaryOperation: {
                return expression.operator === OperatorType.Not &&
                    this._isNarrowingExpression(expression.expression);
            }

            case ParseNodeType.AugmentedAssignment: {
                return this._isNarrowingExpression(expression.rightExpression);
            }

            case ParseNodeType.Call: {
                return expression.leftExpression.nodeType === ParseNodeType.Name &&
                    (expression.leftExpression.nameToken.value === 'isinstance' ||
                        expression.leftExpression.nameToken.value === 'issubclass') &&
                    expression.arguments.length === 2;
            }
        }

        return false;
    }

    private _createAssignmentTargetFlowNodes(target: ExpressionNode) {
        if (target.nodeType === ParseNodeType.Name || target.nodeType === ParseNodeType.MemberAccess) {
            this._createFlowAssignment(target);
        } else if (target.nodeType === ParseNodeType.Tuple) {
            target.expressions.forEach(expr => {
                this._createAssignmentTargetFlowNodes(expr);
            });
        } else if (target.nodeType === ParseNodeType.TypeAnnotation) {
            this._createAssignmentTargetFlowNodes(target.valueExpression);
        } else if (target.nodeType === ParseNodeType.Unpack) {
            this._createAssignmentTargetFlowNodes(target.expression);
        } else if (target.nodeType === ParseNodeType.List) {
            target.entries.forEach(entry => {
                this._createAssignmentTargetFlowNodes(entry);
            });
        }
    }

    private _createFlowAssignment(node: NameNode | MemberAccessExpressionNode) {
        if (!(this._currentFlowNode.flags & FlowFlags.Unreachable)) {
            const flowNode: FlowAssignment = {
                flags: FlowFlags.Assignment,
                node,
                antecedent: this._currentFlowNode
            };

            this._addExceptTargets(flowNode);
            this._currentFlowNode = flowNode;
        }

        AnalyzerNodeInfo.setFlowNode(node, this._currentFlowNode);
    }

    private _createFlowWildcardImport(node: ImportFromNode, names: string[]) {
        if (!(this._currentFlowNode.flags & FlowFlags.Unreachable)) {
            const flowNode: FlowWildcardImport = {
                flags: FlowFlags.WildcardImport,
                node,
                names,
                antecedent: this._currentFlowNode
            };

            this._addExceptTargets(flowNode);
            this._currentFlowNode = flowNode;
        }

        AnalyzerNodeInfo.setFlowNode(node, this._currentFlowNode);
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
            label.antecedents.push(antecedent);
        }
    }

    private _bindNameToScope(scope: Scope, name: string) {
        if (this._notLocalBindings.get(name) === undefined) {
            // Don't overwrite an existing symbol.
            let symbol = scope.lookUpSymbol(name);
            if (!symbol) {
                symbol = scope.addSymbol(name,
                    SymbolFlags.InitiallyUnbound | SymbolFlags.ClassMember);
            }

            return symbol;
        }

        return undefined;
    }

    private _bindPossibleTupleNamedTarget(target: ExpressionNode) {
        if (target.nodeType === ParseNodeType.Name) {
            this._bindNameToScope(this._currentScope, target.nameToken.value);
        } else if (target.nodeType === ParseNodeType.Tuple) {
            target.expressions.forEach(expr => {
                this._bindPossibleTupleNamedTarget(expr);
            });
        } else if (target.nodeType === ParseNodeType.List) {
            target.entries.forEach(expr => {
                this._bindPossibleTupleNamedTarget(expr);
            });
        } else if (target.nodeType === ParseNodeType.TypeAnnotation) {
            this._bindPossibleTupleNamedTarget(target.valueExpression);
        } else if (target.nodeType === ParseNodeType.Unpack) {
            this._bindPossibleTupleNamedTarget(target.expression);
        }
    }

    private _addBuiltInSymbolToCurrentScope(nameValue: string, type: Type) {
        // Handle a special case where a built-in type is not known
        // at binding time. This happens specifically when binding
        // the buitins.pyi module. We'll convert the Unknown types
        // into Any and not add a real declaration so other classes
        // can override the type without getting an error.
        if (type.category === TypeCategory.Unknown) {
            this._addSymbolToCurrentScope(nameValue, AnyType.create(), defaultTypeSourceId);
        } else {
            const symbol = this._addSymbolToCurrentScope(nameValue, type, defaultTypeSourceId);
            if (symbol) {
                symbol.addDeclaration({
                    type: DeclarationType.BuiltIn,
                    declaredType: type,
                    path: this._fileInfo.filePath,
                    range: getEmptyRange()
                });
                symbol.setIsIgnoredForProtocolMatch();
            }
        }
    }

    // Finds the nearest permanent scope (as opposed to temporary scope) and
    // adds a new symbol with the specified name if it doesn't already exist.
    private _addSymbolToCurrentScope(nameValue: string, type: Type, typeSourceId: TypeSourceId) {
        if (this._isUnexecutedCode) {
            return;
        }

        assert(this._currentScope.getType() !== ScopeType.Temporary);
        let symbol = this._currentScope.lookUpSymbol(nameValue);

        if (!symbol) {
            let symbolFlags = SymbolFlags.None;

            // If the caller specified a default type source ID, it's a
            // symbol that's populated by the module loader, so it's
            // bound at the time the module starts executing.
            if (typeSourceId !== defaultTypeSourceId) {
                symbolFlags |= SymbolFlags.InitiallyUnbound;
            }

            if (this._currentScope.getType() === ScopeType.Class) {
                symbolFlags |= SymbolFlags.ClassMember;
            }

            // Add the symbol. Assume that symbols with a default type source ID
            // are "implicit" symbols added to the scope. These are not initially unbound.
            symbol = this._currentScope.addSymbol(nameValue, symbolFlags);
        }

        symbol.setInferredTypeForSource(type, typeSourceId);
        return symbol;
    }

    private _getDocString(statements: StatementNode[]): string | undefined {
        // See if the first statement in the suite is a triple-quote string.
        if (statements.length === 0) {
            return undefined;
        }

        if (statements[0].nodeType !== ParseNodeType.StatementList) {
            return undefined;
        }

        // If the first statement in the suite isn't a StringNode,
        // assume there is no docString.
        const statementList = statements[0];
        if (statementList.statements.length === 0 ||
                statementList.statements[0].nodeType !== ParseNodeType.StringList) {
            return undefined;
        }

        const docStringNode = statementList.statements[0];
        const docStringToken = docStringNode.strings[0].token;

        // Ignore f-strings.
        if ((docStringToken.flags & StringTokenFlags.Format) !== 0) {
            return undefined;
        }

        return DocStringUtils.decodeDocString(docStringNode.strings[0].value);
    }

    private _createNewScope(scopeType: ScopeType, parentScope: Scope | undefined,
            callback: () => void) {

        const prevScope = this._currentScope;
        this._currentScope = new Scope(scopeType, parentScope);

        const prevNonLocalBindings = this._notLocalBindings;
        this._notLocalBindings = new StringMap<NameBindingType>();

        callback();

        this._currentScope = prevScope;
        this._notLocalBindings = prevNonLocalBindings;
    }

    private _addInferredTypeAssignmentForVariable(target: ExpressionNode, source: ParseNode) {
        if (target.nodeType === ParseNodeType.Name) {
            const name = target.nameToken;
            const symbolWithScope = this._currentScope.lookUpSymbolRecursive(name.value);
            if (symbolWithScope && symbolWithScope.symbol) {
                const declaration: VariableDeclaration = {
                    type: DeclarationType.Variable,
                    node: target,
                    isConstant: isConstantName(target.nameToken.value),
                    inferredTypeSource: source,
                    path: this._fileInfo.filePath,
                    range: convertOffsetsToRange(name.start, TextRange.getEnd(name), this._fileInfo.lines)
                };
                symbolWithScope.symbol.addDeclaration(declaration);
            }
        } else if (target.nodeType === ParseNodeType.MemberAccess) {
            const memberAccessInfo = this._getMemberAccessInfo(target);
            if (memberAccessInfo) {
                const name = target.memberName.nameToken;

                let symbol = memberAccessInfo.classScope.lookUpSymbol(name.value);
                if (!symbol) {
                    symbol = memberAccessInfo.classScope.addSymbol(name.value,
                        SymbolFlags.InitiallyUnbound);
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
        } else if (target.nodeType === ParseNodeType.Tuple) {
            target.expressions.forEach(expr => {
                this._addInferredTypeAssignmentForVariable(expr, source);
            });
        } else if (target.nodeType === ParseNodeType.TypeAnnotation) {
            this._addInferredTypeAssignmentForVariable(target.valueExpression, source);
        } else if (target.nodeType === ParseNodeType.Unpack) {
            this._addInferredTypeAssignmentForVariable(target.expression, source);
        } else if (target.nodeType === ParseNodeType.List) {
            target.entries.forEach(entry => {
                this._addInferredTypeAssignmentForVariable(entry, source);
            });
        }
    }

    private _addTypeDeclarationForVariable(target: ExpressionNode, typeAnnotation: ExpressionNode) {
        let declarationHandled = false;

        if (target.nodeType === ParseNodeType.Name) {
            const name = target.nameToken;
            const symbolWithScope = this._currentScope.lookUpSymbolRecursive(name.value);
            if (symbolWithScope && symbolWithScope.symbol) {
                const declaration: VariableDeclaration = {
                    type: DeclarationType.Variable,
                    node: target,
                    isConstant: isConstantName(name.value),
                    path: this._fileInfo.filePath,
                    typeAnnotationNode: typeAnnotation,
                    range: convertOffsetsToRange(name.start, TextRange.getEnd(name), this._fileInfo.lines)
                };
                symbolWithScope.symbol.addDeclaration(declaration);
            }

            declarationHandled = true;
        } else if (target.nodeType === ParseNodeType.MemberAccess) {
            // We need to determine whether this expression is declaring a class or
            // instance variable. This is difficult because python doesn't provide
            // a keyword for accessing "this". Instead, it uses naming conventions
            // of "cls" and "self", but we don't want to rely on these naming
            // conventions here. Instead, we'll apply some heuristics to determine
            // whether the symbol on the LHS is a reference to the current class
            // or an instance of the current class.

            const memberAccessInfo = this._getMemberAccessInfo(target);
            if (memberAccessInfo) {
                const name = target.memberName.nameToken;

                let symbol = memberAccessInfo.classScope.lookUpSymbol(name.value);
                if (!symbol) {
                    symbol = memberAccessInfo.classScope.addSymbol(name.value,
                        SymbolFlags.InitiallyUnbound);
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
                    path: this._fileInfo.filePath,
                    typeAnnotationNode: typeAnnotation,
                    range: convertOffsetsToRange(target.memberName.start,
                        target.memberName.start + target.memberName.length,
                        this._fileInfo.lines)
                };
                symbol.addDeclaration(declaration);

                declarationHandled = true;
            }
        }

        if (!declarationHandled) {
            this._addError(
                `Type annotation not supported for this type of expression`,
                typeAnnotation);
        }
    }

    // Determines whether a member access expression is referring to a
    // member of a class (either a class or instance member). This will
    // typically take the form "self.x" or "cls.x".
    private _getMemberAccessInfo(node: MemberAccessExpressionNode): MemberAccessInfo | undefined {
        // We handle only simple names on the left-hand side of the expression,
        // not calls, nested member accesses, index expressions, etc.
        if (node.leftExpression.nodeType !== ParseNodeType.Name) {
            return undefined;
        }

        const leftSymbolName = node.leftExpression.nameToken.value;

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

        const className = classNode.name.nameToken.value;
        const firstParamName = methodNode.parameters[0].name.nameToken.value;

        if (leftSymbolName === className) {
            isInstanceMember = false;
        } else {
            if (leftSymbolName !== firstParamName) {
                return undefined;
            }

            // To determine whether the first parameter of the method
            // refers to the class or the instance, we need to apply
            // some heuristics.
            if (methodNode.name.nameToken.value === '__new__') {
                // The __new__ method is special. It acts as a classmethod even
                // though it doesn't have a @classmethod decorator.
                isInstanceMember = false;
            } else {
                // Assume that it's an instance member unless we find
                // a decorator that tells us otherwise.
                isInstanceMember = true;
                for (const decorator of methodNode.decorators) {
                    if (decorator.leftExpression.nodeType === ParseNodeType.Name) {
                        const decoratorName = decorator.leftExpression.nameToken.value;

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
            const existingLoaderAction = loaderActions.implicitImports.get(implicitImport.name);
            if (existingLoaderAction) {
                existingLoaderAction.path = implicitImport.path;
            } else {
                loaderActions.implicitImports.set(implicitImport.name, {
                    path: implicitImport.path,
                    implicitImports: new Map<string, ModuleLoaderActions>()
                });
            }
        });
    }

    // Handles some special-case assignment statements that are found
    // within the typings.pyi file.
    private _handleTypingStubAssignment(node: AssignmentNode) {
        if (!this._fileInfo.isTypingStubFile) {
            return false;
        }

        let assignedNameNode: NameNode | undefined;
        if (node.leftExpression.nodeType === ParseNodeType.Name) {
            assignedNameNode = node.leftExpression;
        } else if (node.leftExpression.nodeType === ParseNodeType.TypeAnnotation &&
            node.leftExpression.valueExpression.nodeType === ParseNodeType.Name) {
            assignedNameNode = node.leftExpression.valueExpression;
        }

        const specialTypes: { [name: string]: boolean } = {
            'overload': true,
            'TypeVar': true,
            '_promote': true,
            'no_type_check': true,
            'NoReturn': true,
            'Union': true,
            'Optional': true,
            'List': true,
            'Dict': true,
            'DefaultDict': true,
            'Set': true,
            'FrozenSet': true,
            'Deque': true,
            'ChainMap': true,
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

        if (assignedNameNode) {
            const assignedName = assignedNameNode.nameToken.value;
            let specialType: Type | undefined;

            if (assignedName === 'Any') {
                specialType = AnyType.create();
            } else if (specialTypes[assignedName]) {
                const specialClassType = ClassType.create(assignedName,
                    ClassTypeFlags.BuiltInClass | ClassTypeFlags.SpecialBuiltIn,
                    defaultTypeSourceId);

                // We'll fill in the actual base class in the analysis phase.
                ClassType.addBaseClass(specialClassType, UnknownType.create(), false);
                specialType = specialClassType;
            }

            if (specialType) {
                AnalyzerNodeInfo.setExpressionType(assignedNameNode, specialType);
                const symbol = this._bindNameToScope(this._currentScope, assignedName);

                if (symbol) {
                    symbol.addDeclaration({
                        type: DeclarationType.BuiltIn,
                        node: assignedNameNode,
                        declaredType: specialType,
                        path: this._fileInfo.filePath,
                        range: convertOffsetsToRange(node.leftExpression.start,
                            TextRange.getEnd(node.leftExpression), this._fileInfo.lines)
                    });
                }

                return true;
            }
        }

        return false;
    }

    private _deferBinding(callback: () => void) {
        this._deferredBindingTasks.push({
            scope: this._currentScope,
            nonLocalBindingsMap: this._notLocalBindings,
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
            this._isUnexecutedCode = false;

            nextItem.callback();
        }
    }

    private _validateYieldUsage(node: YieldExpressionNode | YieldFromExpressionNode) {
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
    }

    private _handleIfWhileCommon(testExpression: ExpressionNode, ifWhileSuite: SuiteNode,
            elseSuite: SuiteNode | IfNode | undefined, isWhile: boolean) {

        const thenLabel = isWhile ? this._createLoopLabel() : this._createBranchLabel();
        const elseLabel = this._createBranchLabel();
        const postIfLabel = this._createBranchLabel();

        // Determine if the if condition is always true or always false. If so,
        // we can treat either the if or the else clause as unconditional.
        const constExprValue = StaticExpressions.evaluateStaticExpression(
            testExpression, this._fileInfo.executionEnvironment);

        this._bindConditional(testExpression, thenLabel, elseLabel);
        this._currentFlowNode = this._finishFlowLabel(thenLabel);
        if (isWhile) {
            this._bindLoopStatement(thenLabel, postIfLabel, () => {
                this._markNotExecuted(constExprValue !== false, () => {
                    this.walk(ifWhileSuite);
                });
            });
            this._addAntecedent(thenLabel, this._currentFlowNode);
        } else {
            this._markNotExecuted(constExprValue !== false, () => {
                this.walk(ifWhileSuite);
            });
            this._addAntecedent(postIfLabel, this._currentFlowNode);
        }

        // Now handle the else statement if it's present. If there
        // are chained "else if" statements, they'll be handled
        // recursively here.
        this._currentFlowNode = this._finishFlowLabel(elseLabel);
        if (elseSuite) {
            this._markNotExecuted(constExprValue !== true, () => {
                this.walk(elseSuite);
            });
        }
        this._addAntecedent(postIfLabel, this._currentFlowNode);
        this._currentFlowNode = this._finishFlowLabel(postIfLabel);
    }

    private _markNotExecuted(isExecutable: boolean, callback: () => void) {
        const wasUnexecutedCode = this._isUnexecutedCode;

        if (!isExecutable) {
            this._isUnexecutedCode = true;
        }

        callback();

        this._isUnexecutedCode = wasUnexecutedCode;
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

    private _addError(message: string, textRange: TextRange) {
        return this._fileInfo.diagnosticSink.addErrorWithTextRange(message, textRange);
    }

    private _addWarning(message: string, textRange: TextRange) {
        return this._fileInfo.diagnosticSink.addWarningWithTextRange(message, textRange);
    }
}
