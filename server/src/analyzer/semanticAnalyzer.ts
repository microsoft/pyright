/*
* semanticAnalyzer.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* A parse tree walker that performs general semantic analysis. It does
* this at the scope level. A scope in Python is defined by a module,
* class, function or lambda.
* The analyzer walks the parse tree by scopes starting at the module
* level. When a new scope is detected, it is pushed onto a list and
* analyzed separately at a later time. (The exception is a class scope,
* which is immediately analyzed.) Walking the tree in this manner
* simulates the order in which execution normally occurs in a Python
* file. The analyzer attempts to statically detect runtime errors that
* would be reported by the python interpreter when executing the code.
* This analyzer doesn't perform any static type checking.
*/

import * as assert from 'assert';

import { DiagnosticLevel } from '../common/configOptions';
import { convertOffsetsToRange } from '../common/positionUtils';
import { PythonVersion } from '../common/pythonVersion';
import { TextRange } from '../common/textRange';
import { AssignmentNode, AwaitExpressionNode, ClassNode, DelNode, ExceptNode, ExpressionNode, ForNode,
    FunctionNode, GlobalNode, IfNode, ImportAsNode, ImportFromAsNode,
    IndexExpressionNode, LambdaNode, ListComprehensionForNode, ListComprehensionNode, ListNode,
    MemberAccessExpressionNode, ModuleNameNode, ModuleNode, NameNode, NonlocalNode, ParameterCategory,
    ParameterNode, RaiseNode, ReturnNode, StarExpressionNode,
    TryNode, TupleExpressionNode, TypeAnnotationExpressionNode, WithNode } from '../parser/parseNodes';
import { ScopeUtils } from '../scopeUtils';
import { AnalyzerFileInfo } from './analyzerFileInfo';
import { AnalyzerNodeInfo } from './analyzerNodeInfo';
import { EvaluatorFlags, ExpressionEvaluator } from './expressionEvaluator';
import { ExpressionUtils } from './expressionUtils';
import { ImportType } from './importResult';
import { DefaultTypeSourceId } from './inferredType';
import { ParseTreeUtils } from './parseTreeUtils';
import { ParseTreeWalker } from './parseTreeWalker';
import { Scope, ScopeType } from './scope';
import { Declaration, Symbol, SymbolCategory } from './symbol';
import { AnyType, ClassType, ClassTypeFlags, FunctionParameter, FunctionType,
    FunctionTypeFlags, ModuleType, OverloadedFunctionType, Type, TypeCategory, UnboundType,
    UnknownType } from './types';
import { TypeUtils } from './typeUtils';

type ScopedNode = ModuleNode | ClassNode | FunctionNode | LambdaNode;

export abstract class SemanticAnalyzer extends ParseTreeWalker {
    protected readonly _scopedNode: ScopedNode;
    protected readonly _fileInfo: AnalyzerFileInfo;

    // A queue of scoped nodes that need to be analyzed.
    protected _subscopesToAnalyze: SemanticAnalyzer[] = [];

    // The current scope in effect. This is either the base scope or a
    // "temporary scope", used for analyzing conditional code blocks. Their
    // contents are eventually merged in to the base scope.
    protected _currentScope: Scope;

    constructor(node: ScopedNode, parentScope: Scope | undefined, fileInfo: AnalyzerFileInfo) {
        super();

        this._scopedNode = node;
        this._fileInfo = fileInfo;

        // Allocate a new scope and associate it with the node
        // we've been asked to analyze.
        let scopeType = parentScope === undefined ? ScopeType.BuiltIn :
            this._scopedNode instanceof ModuleNode ?
                ScopeType.Global : ScopeType.Local;
        this._currentScope = new Scope(scopeType, parentScope);

        // If this is the built-in scope, we need to hide symbols
        // that are in the stub file but are not officially part of
        // the built-in list of symbols in Python.
        if (scopeType === ScopeType.BuiltIn) {
            const namesToHide = ['sys', 'TypeVar', 'Iterator', 'Iterable', 'NoReturn', 'overload', 'Container',
                'Sequence', 'MutableSequence', 'Mapping', 'MutableMapping', 'Tuple', 'List', 'Any', 'Dict', 'Callable', 'Generic',
                'Set', 'AbstractSet', 'FrozenSet', 'MutableSet', 'Sized', 'Reversible', 'SupportsInt', 'SupportsFloat', 'SupportsAbs',
                'SupportsComplex', 'SupportsRound', 'IO', 'BinaryIO', 'Union',
                'ItemsView', 'KeysView', 'ValuesView', 'ByteString', 'Optional', 'AnyStr', 'Type', 'Text',
                '_T', '_T_co', '_KT', '_VT', '_S', '_T1', '_T2', '_T3', '_T4', '_T5', '_TT'
            ];
            namesToHide.forEach(name => {
                this._currentScope.hideName(name);
            });
        }

        AnalyzerNodeInfo.setScope(this._scopedNode, this._currentScope);
    }

    // We separate analysis into two passes. The first happens immediately when
    // the scope analyzer is created. The second happens after its parent scope
    // has been fully analyzed.
    abstract analyzeImmediate(): void;
    abstract analyzeDeferred(): void;

    visitModule(node: ModuleNode): boolean {
        // Tree walking should start with the children of
        // the node, so we should never get here.
        assert.fail('We should never get here');
        return false;
    }

    visitModuleName(node: ModuleNameNode): boolean {
        let importResult = AnalyzerNodeInfo.getImportInfo(node);
        assert(importResult !== undefined);
        if (importResult) {
            if (!importResult.importFound) {
                this._addDiagnostic(this._fileInfo.configOptions.reportMissingImports,
                    `Import '${ importResult.importName }' could not be resolved`, node);
            } else if (importResult.importType === ImportType.ThirdParty) {
                if (!importResult.isStubFile) {
                    this._addDiagnostic(this._fileInfo.configOptions.reportMissingTypeStubs,
                        `Stub file not found for '${ importResult.importName }'`, node);
                }
            }
        }

        return true;
    }

    visitClass(node: ClassNode): boolean {
        this.walkMultiple(node.decorators);

        let classFlags = ClassTypeFlags.None;
        if (this._currentScope.getType() === ScopeType.BuiltIn ||
                this._fileInfo.isTypingStubFile ||
                this._fileInfo.isCollectionsStubFile) {

            classFlags |= ClassTypeFlags.BuiltInClass;
        }
        if (node.decorators.length > 0) {
            classFlags |= ClassTypeFlags.HasDecorators;
        }

        let classType = new ClassType(node.name.nameToken.value, classFlags,
            AnalyzerNodeInfo.getTypeSourceId(node));

        // Don't walk the arguments for stub files because of forward
        // declarations.
        if (!this._fileInfo.isStubFile) {
            this.walkMultiple(node.arguments);
        }

        let sawMetaclass = false;
        let evaluator = new ExpressionEvaluator(this._currentScope, this._fileInfo.diagnosticSink);
        node.arguments.forEach(arg => {
            let argType: Type;

            if (this._fileInfo.isStubFile) {
                // For stub files, we won't try to evaluate the type at this
                // time because forward declarations are supported in stub files.
                argType = UnknownType.create();
            } else {
                argType = evaluator.getType(arg.valueExpression, EvaluatorFlags.None);
            }

            let isMetaclass = false;

            if (arg.name) {
                if (arg.name.nameToken.value === 'metaclass') {
                    if (sawMetaclass) {
                        this._addError(`Only one metaclass can be provided`, arg);
                    }
                    isMetaclass = true;
                    sawMetaclass = true;
                } else {
                    this._addError(`Named parameter '${ arg.name.nameToken.value }' not supported for classes`, arg);
                }
            }

            if (!argType.isAny()) {
                if (argType.category !== TypeCategory.Class) {
                    this._addError(`Argument to class must be a base class`, arg);
                }
            }

            classType.addBaseClass(argType, isMetaclass);
        });

        if (node.arguments.length === 0) {
            let objectType = ScopeUtils.getBuiltInType(this._currentScope, 'object');
            // Make sure we don't have 'object' derive from itself. Infinite
            // recursion will result.
            if (objectType !== classType) {
                classType.addBaseClass(objectType, false);
            }
        }

        let declaration: Declaration = {
            category: SymbolCategory.Class,
            node: node.name,
            path: this._fileInfo.filePath,
            range: convertOffsetsToRange(node.name.start, node.name.end, this._fileInfo.lines)
        };
        this._bindNameNodeToType(node.name, classType, true, declaration);

        AnalyzerNodeInfo.setExpressionType(node, classType);
        AnalyzerNodeInfo.setExpressionType(node.name, classType);

        let analyzer = new ClassScopeAnalyzer(node, this._currentScope, classType, this._fileInfo);
        this._queueSubScopeAnalyzer(analyzer);

        return false;
    }

    visitFunction(node: FunctionNode): boolean {
        const isMethod = ParseTreeUtils.isFunctionInClass(node);
        let hasCustomDecorators = false;

        let functionFlags = FunctionTypeFlags.None;
        if (node.decorators.length > 0) {
            hasCustomDecorators = true;
        }

        if (isMethod) {
            if (ParseTreeUtils.functionHasDecorator(node, 'staticmethod')) {
                hasCustomDecorators = false;
            } else if (ParseTreeUtils.functionHasDecorator(node, 'classmethod')) {
                functionFlags |= FunctionTypeFlags.ClassMethod;
                hasCustomDecorators = false;
            } else {
                functionFlags |= FunctionTypeFlags.InstanceMethod;
            }
        }

        // The "__new__" magic method is not an instance method.
        // It acts as a class method instead.
        if (node.name.nameToken.value === '__new__') {
            functionFlags |= FunctionTypeFlags.ClassMethod;
            functionFlags &= ~FunctionTypeFlags.InstanceMethod;
        }

        let functionType = new FunctionType(functionFlags);

        this.walkMultiple(node.decorators);
        node.parameters.forEach(param => {
            if (param.defaultValue) {
                this.walk(param.defaultValue);
            }

            let typeParam: FunctionParameter = {
                category: param.category,
                name: param.name ? param.name.nameToken.value : undefined,
                hasDefault: !!param.defaultValue,
                type: UnknownType.create()
            };

            functionType.addParameter(typeParam);
        });

        let decoratedType: Type = functionType;
        let warnIfDuplicate = true;

        // Handle overload decorators specially.
        let overloadedType: OverloadedFunctionType | undefined;
        let evaluator = new ExpressionEvaluator(this._currentScope);
        [overloadedType, warnIfDuplicate] = evaluator.getOverloadedFunctionType(node, functionType);
        if (overloadedType) {
            decoratedType = overloadedType;
            hasCustomDecorators = false;
        } else {
            // Determine if the function is a property getter or setter.
            if (ParseTreeUtils.isFunctionInClass(node)) {
                let propertyType = evaluator.getPropertyType(node, functionType);
                if (propertyType) {
                    decoratedType = propertyType;
                    hasCustomDecorators = false;

                    // Allow setters or deleters to replace the getter.
                    warnIfDuplicate = false;
                } else {
                    this._validateMethod(node);
                }
            }
        }

        if (hasCustomDecorators) {
            // TODO - handle decorators in a better way. For now, we
            // don't assume anything about the decorated type.
            decoratedType = UnknownType.create();
        }

        let declaration: Declaration = {
            category: isMethod ? SymbolCategory.Method : SymbolCategory.Function,
            node: node.name,
            path: this._fileInfo.filePath,
            range: convertOffsetsToRange(node.name.start, node.name.end, this._fileInfo.lines)
        };
        this._bindNameNodeToType(node.name, decoratedType, warnIfDuplicate, declaration);

        AnalyzerNodeInfo.setExpressionType(node, functionType);
        AnalyzerNodeInfo.setExpressionType(node.name, functionType);

        // Find the function or module that contains this function and use its scope.
        // We can't simply use this._currentScope because functions within a class use
        // the scope of the containing function or module when they execute.
        let functionOrModuleNode = node.parent;
        while (functionOrModuleNode) {
            if (functionOrModuleNode instanceof ModuleNode ||
                    functionOrModuleNode instanceof FunctionNode) {
                break;
            }

            functionOrModuleNode = functionOrModuleNode.parent;
        }
        assert(functionOrModuleNode !== undefined);

        let functionOrModuleScope = AnalyzerNodeInfo.getScope(functionOrModuleNode!);
        assert(functionOrModuleScope !== undefined);

        let analyzer = new FunctionScopeAnalyzer(node, functionOrModuleScope!, this._fileInfo);
        this._queueSubScopeAnalyzer(analyzer);
        return false;
    }

    visitLambda(node: LambdaNode): boolean {
        // Analyze the parameters in the context of the parent's scope
        // before we add any names from the function's scope.
        node.parameters.forEach(param => {
            if (param.defaultValue) {
                this.walk(param.defaultValue);
            }
        });

        let analyzer = new LambdaScopeAnalyzer(node, this._currentScope, this._fileInfo);
        this._queueSubScopeAnalyzer(analyzer);

        return false;
    }

    visitFor(node: ForNode): boolean {
        this.walk(node.sequenceExpression);

        // Populate the new scope with target parameters.
        this._addNamedTarget(node.targetExpression);

        this.walk(node.targetExpression);
        this.walk(node.forSuite);

        if (node.elseSuite) {
            this.walk(node.elseSuite);
        }

        return false;
    }

    visitListComprehension(node: ListComprehensionNode): boolean {
        // We need to "execute" the comprehension clauses first, even
        // though they appear afterward in the syntax. We'll do so
        // within a temporary scope so we can throw away the target
        // when complete.
        this._enterTemporaryScope(() => {
            node.comprehensions.forEach(compr => {
                if (compr instanceof ListComprehensionForNode) {
                    this.walk(compr.sequenceExpression);

                    this._addNamedTarget(compr.targetExpression);
                } else {
                    this.walk(compr.testExpression);
                }
            });

            this.walk(node.baseExpression);
        });

        return false;
    }

    visitIf(node: IfNode): boolean {
        let ifScope: Scope | undefined;
        let elseScope: Scope | undefined;
        let isUnconditional = false;

        this.walk(node.testExpression);

        // Determine if the if condition is always true or always false. If so,
        // we can treat either the if or the else clause as unconditional.
        let constExprValue = ExpressionUtils.evaluateConstantExpression(
            node.testExpression, this._fileInfo.executionEnvironment);

        // Push a temporary scope so we can track
        // which variables have been assigned to conditionally.
        ifScope = this._enterTemporaryScope(() => {
            this.walk(node.ifSuite);
        }, true, constExprValue === false);

        // Now handle the else statement if it's present. If there
        // are chained "else if" statements, they'll be handled
        // recursively here.
        if (node.elseSuite) {
            elseScope = this._enterTemporaryScope(() => {
                this.walk(node.elseSuite!);
            }, true, constExprValue === true);
        }

        if (constExprValue !== undefined) {
            isUnconditional = true;
            if (constExprValue) {
                elseScope = undefined;
            } else {
                ifScope = undefined;
            }
        }

        if (ifScope && ifScope.getAlwaysReturnsOrRaises() && elseScope && elseScope.getAlwaysReturnsOrRaises()) {
            // If both an if and else clause are executed but they both return or raise an exception,
            // mark the current scope as always returning or raising an exception.
            if (ifScope.getAlwaysRaises() && elseScope.getAlwaysRaises()) {
                this._currentScope.setAlwaysRaises();
            } else {
                this._currentScope.setAlwaysReturns();
            }
        }

        if (ifScope && ifScope.getAlwaysReturnsOrRaises()) {
            ifScope = undefined;
            isUnconditional = true;
        }

        if (elseScope && elseScope.getAlwaysReturnsOrRaises()) {
            elseScope = undefined;
            isUnconditional = true;
        }

        // Figure out how to combine the scopes.
        if (ifScope && elseScope) {
            // If both an "if" and an "else" scope exist, combine the names from both scopes.
            ifScope.combineConditionalSymbolTable(elseScope);
            this._currentScope.mergeSymbolTable(ifScope);
        } else if (ifScope) {
            // If there's only an "if" scope executed, mark all of its contents as conditional.
            if (!isUnconditional) {
                ifScope.markAllSymbolsConditional();
            }
            this._currentScope.mergeSymbolTable(ifScope);
        } else if (elseScope) {
            // If there's only an "else" scope executed, mark all of its contents as conditional.
            if (!isUnconditional) {
                elseScope.markAllSymbolsConditional();
            }
            this._currentScope.mergeSymbolTable(elseScope);
        }

        return false;
    }

    visitWith(node: WithNode): boolean {
        node.withItems.forEach(item => {
            this.walk(item.expression);
        });

        node.withItems.forEach(item => {
            if (item.target) {
                this._addNamedTarget(item.target);
            }
        });

        this.walk(node.suite);
        return false;
    }

    visitReturn(node: ReturnNode): boolean {
        this._currentScope.setAlwaysReturns();
        return true;
    }

    visitRaise(node: RaiseNode): boolean {
        if (this._currentScope.getNestedTryDepth() === 0) {
            this._currentScope.setAlwaysRaises();
        }
        return true;
    }

    visitExcept(node: ExceptNode): boolean {
        if (node.typeExpression) {
            this.walk(node.typeExpression);
        }

        let exceptScope: Scope | undefined;
        this._enterTemporaryScope(() => {
            if (node.typeExpression && node.name) {
                this._currentScope.addUnboundSymbol(node.name.nameToken.value);
                this._bindNameNodeToType(node.name, UnknownType.create());
            }

            exceptScope = this._enterTemporaryScope(() => {
                this.walk(node.exceptSuite);
            });
        });

        this._currentScope.mergeSymbolTable(exceptScope!);

        return false;
    }

    visitTry(node: TryNode): boolean {
        this._currentScope.incrementNestedTryDepth();
        this.walk(node.trySuite);
        this._currentScope.decrementNestedTryDepth();

        // Wrap the except clauses in a conditional scope
        // so we can throw away any names that are bound
        // in this scope.
        node.exceptClauses.forEach(exceptNode => {
            this._enterTemporaryScope(() => {
                this.walk(exceptNode);
            });
        });

        if (node.elseSuite) {
            this.walk(node.elseSuite);
        }

        if (node.finallySuite) {
            this.walk(node.finallySuite);
        }

        return false;
    }

    visitAssignment(node: AssignmentNode): boolean {
        if (!this._fileInfo.isStubFile) {
            this.walk(node.rightExpression);
        }

        // See if this is a simple or tuple assignment.
        if (!this._addNamedTarget(node.leftExpression)) {
            // Bind the name to an instance or class variable if appropriate.
            this._bindPossibleMember(node.leftExpression);
        }

        this.walk(node.leftExpression);
        return false;
    }

    visitMemberAccess(node: MemberAccessExpressionNode) {
        this.walk(node.leftExpression);

        // Don't walk the member name.
        return false;
    }

    visitAwait(node: AwaitExpressionNode) {
        // Make sure this is within an async lambda or function.
        let enclosingFunction = ParseTreeUtils.getEnclosingFunction(node);
        if (enclosingFunction === undefined || !enclosingFunction.isAsync) {
            this._addError(`'await' allowed only within async function`, node);
        }

        return true;
    }

    visitName(node: NameNode): boolean {
        let valueWithScope = this._currentScope.lookUpSymbolRecursive(node.nameToken.value);

        if (!valueWithScope) {
            this._addError(`'${ node.nameToken.value }' is not defined`, node.nameToken);
        } else {
            if (valueWithScope.symbol.currentType.isUnbound()) {
                // It's possible that the name is unbound in the current scope
                // at this point in the code but is available in an outer scope.
                // Like this:
                // a = 3
                // def foo():
                //    b = a  # 'a' is unbound locally but is available in outer scope
                //    a = None
                let isReallyUnbound = true;
                let parentScope = valueWithScope.scope.getParent();
                if (parentScope) {
                    valueWithScope = parentScope.lookUpSymbolRecursive(node.nameToken.value);
                    if (valueWithScope && !valueWithScope.symbol.currentType.isUnbound()) {
                        isReallyUnbound = false;
                    }
                }

                // Don't report unbound error in stub files, which support out-of-order
                // declarations of classes.
                if (isReallyUnbound && !this._fileInfo.isStubFile) {
                    this._addError(`'${ node.nameToken.value }' is not bound`, node.nameToken);
                }
            } else if (valueWithScope.symbol.currentType.isPossiblyUnbound()) {
                this._fileInfo.diagnosticSink.addWarningWithTextRange(
                    `'${ node.nameToken.value }' may be unbound`, node.nameToken);
            }
        }

        return true;
    }

    visitImportAs(node: ImportAsNode): boolean {
        if (node.alias || node.module.nameParts.length > 0) {
            let nameNode = node.alias ? node.alias : node.module.nameParts[0];
            this._bindNameNodeToType(nameNode, UnknownType.create(), !!node.alias);
        }
        return true;
    }

    visitImportFromAs(node: ImportFromAsNode): boolean {
        let nameNode = node.alias ? node.alias : node.name;
        this._bindNameNodeToType(nameNode, UnknownType.create(), !!node.alias);

        return false;
    }

    visitGlobal(node: GlobalNode): boolean {
        node.nameList.forEach(name => {
            let valueWithScope = this._currentScope.lookUpSymbolRecursive(name.nameToken.value);
            if (!valueWithScope || valueWithScope.scope.getType() !== ScopeType.Global) {
                this._addError(`No binding for global '${ name.nameToken.value }' found`, name);
            }
        });
        return true;
    }

    visitNonlocal(node: NonlocalNode): boolean {
        node.nameList.forEach(name => {
            let valueWithScope = this._currentScope.lookUpSymbolRecursive(name.nameToken.value);
            if (!valueWithScope || valueWithScope.scope.getType() !== ScopeType.Local) {
                this._addError(`No binding for nonlocal '${ name.nameToken.value }' found`, name);
            }
        });
        return true;
    }

    visitDel(node: DelNode): boolean {
        this.walkMultiple(node.expressions);

        node.expressions.forEach(expr => {
            if (expr instanceof NameNode) {
                let symbolWithScope = this._currentScope.lookUpSymbolRecursive(expr.nameToken.value);
                if (symbolWithScope) {
                    if (symbolWithScope.symbol.declarations) {
                        const category = symbolWithScope.symbol.declarations[0].category;
                        if (category === SymbolCategory.Function || category === SymbolCategory.Method) {
                            this._addError('Del should not be applied to function', expr);
                        } else if (category === SymbolCategory.Class) {
                            this._addError('Del should not be applied to class', expr);
                        } else if (category === SymbolCategory.Parameter) {
                            this._addError('Del should not be applied to parameter', expr);
                        }
                    }
                }

                this._bindNameNodeToType(expr, UnboundType.create());
            }
        });

        return false;
    }

    visitTypeAnnotation(node: TypeAnnotationExpressionNode): boolean {
        // For now, the type is unknown. We'll fill in the type during
        // the type hint phase.
        this._addNamedTarget(node.valueExpression);

        // Don't walk the type annotation node in this pass.
        this.walk(node.valueExpression);

        return false;
    }

    protected _addNamesToScope(namesToAdd: string[]) {
        // Add the names for this scope. They are initially unbound.
        namesToAdd.forEach(name => {
            // Don't overwrite the implicit bound names that have already
            // been added to the scope.
            if (!this._currentScope.lookUpSymbol(name)) {
                this._currentScope.addUnboundSymbol(name);
            }
        });
    }

    protected _addParametersToScope(parameters: ParameterNode[]) {
        parameters.forEach(param => {
            if (param.name) {
                if (param.name) {
                    this._bindNameNodeToType(param.name, UnknownType.create(), false);
                }
            }
        });
    }

    // Analyzes the subscopes that are discovered during the first analysis pass.
    protected _analyzeSubscopesDeferred() {
        for (let subscope of this._subscopesToAnalyze) {
            subscope.analyzeDeferred();
        }

        this._subscopesToAnalyze = [];
    }

    protected _bindNameNodeToType(nameNode: NameNode, type: Type, warnIfDuplicate = false,
            declaration?: Declaration) {
        const nameValue = nameNode.nameToken.value;

        if (!this._currentScope.lookUpSymbol(nameValue)) {
            this._currentScope.addUnboundSymbol(nameValue);
        }

        if (warnIfDuplicate) {
            let currentBinding = this._currentScope.lookUpSymbol(nameValue);
            if (!currentBinding || !(currentBinding.currentType instanceof UnboundType)) {
                this._fileInfo.diagnosticSink.addWarningWithTextRange(
                    `'${ nameValue }' is already defined`, nameNode);
            }
        }

        this._currentScope.setSymbolCurrentType(nameValue, type,
            AnalyzerNodeInfo.getTypeSourceId(nameNode));
        if (declaration) {
            this._currentScope.addSymbolDeclaration(nameValue, declaration);
        }
    }

    // This is a variant of _bindNameNodeToType that takes a raw name. It should be
    // used only for implicit name binding.
    protected _bindNameToType(nameValue: string, type: Type) {
        if (!this._currentScope.lookUpSymbol(nameValue)) {
            this._currentScope.addUnboundSymbol(nameValue);
        }

        this._currentScope.setSymbolCurrentType(nameValue, type, DefaultTypeSourceId);
    }

    protected _enterTemporaryScope(callback: () => void, isConditional?: boolean,
            isNotExecuted?: boolean) {
        let prevScope = this._currentScope;
        let newScope = new Scope(ScopeType.Temporary, prevScope);
        if (isConditional) {
            newScope.setConditional();
        }
        if (this._currentScope.isNotExecuted() || isNotExecuted) {
            newScope.setIsNotExecuted();
        }
        this._currentScope = newScope;

        callback();

        this._currentScope = prevScope;
        return newScope;
    }

    private _bindPossibleMember(node: ExpressionNode) {
        if (node instanceof MemberAccessExpressionNode) {
            let targetNode = node.leftExpression;
            if (targetNode instanceof NameNode) {
                const nameValue = targetNode.nameToken.value;

                // TODO - we shouldn't rely on these names, which are just conventions.
                if (nameValue === 'self') {
                    this._bindMemberVariable(node.memberName, true);
                } else if (nameValue === 'cls' || nameValue === 'metacls') {
                    this._bindMemberVariable(node.memberName, false);
                }
            }
        } else if (node instanceof TupleExpressionNode) {
            for (let expression of node.expressions) {
                this._bindPossibleMember(expression);
            }
        }
    }

    private _bindMemberVariable(memberNameNode: NameNode, isInstance: boolean) {
        let classDef = ParseTreeUtils.getEnclosingClass(memberNameNode);
        if (classDef) {
            let classType = AnalyzerNodeInfo.getExpressionType(classDef);
            if (classType && classType instanceof ClassType) {
                let memberName = memberNameNode.nameToken.value;
                let memberInfo = TypeUtils.lookUpClassMember(classType, memberName);

                if (!memberInfo) {
                    const memberFields = isInstance ?
                        classType.getInstanceFields() : classType.getClassFields();
                    memberFields.set(memberName,
                        new Symbol(UnboundType.create(), DefaultTypeSourceId));
                }
            }
        }
    }

    private _queueSubScopeAnalyzer(analyzer: SemanticAnalyzer) {
        analyzer.analyzeImmediate();
        this._subscopesToAnalyze.push(analyzer);
    }

    // Returns true if the node was handled by this method, false if it was
    // of an unhandled type.
    private _addNamedTarget(node: ExpressionNode): boolean {
        if (node instanceof TupleExpressionNode) {
            let isHandled = true;
            node.expressions.forEach(expr => {
                if (!this._addNamedTarget(expr)) {
                    isHandled = false;
                }
            });

            return isHandled;
        } else if (node instanceof ListNode) {
            node.entries.forEach(expr => {
                this._addNamedTarget(expr);
            });

            return true;
        } else if (node instanceof TypeAnnotationExpressionNode) {
            return this._addNamedTarget(node.valueExpression);
        } else if (node instanceof StarExpressionNode) {
            if (node.expression instanceof NameNode) {
                this._bindNameNodeToType(node.expression, UnknownType.create());
                return true;
            } else {
                // TODO - need to handle this case.
                this._addError(
                    'Internal error: Unhandled target expression type',
                    node.expression);
            }
        } else if (node instanceof NameNode) {
            this._bindNameNodeToType(node, UnknownType.create());
            return true;
        } else if (node instanceof MemberAccessExpressionNode) {
            // Nothing to do here. The target isn't introducing a new name.
        } else if (node instanceof IndexExpressionNode) {
            // Nothing to do here. The target isn't introducing a new name.
        } else {
            // We should never get here.
            this._addError('Internal error: Unhandled target expression type', node);
        }

        return false;
    }

    // Performs checks on a function that is located within a class
    // and has been determined not to be a property accessor.
    private _validateMethod(node: FunctionNode) {
        if (node.name && node.name.nameToken.value === '__new__') {
            // __new__ overrides should have a "cls" parameter.
            if (node.parameters.length === 0 || !node.parameters[0].name ||
                    node.parameters[0].name.nameToken.value !== 'cls') {
                this._addError(
                    `The __new__ override should take a 'cls' parameter`,
                    node.parameters.length > 0 ? node.parameters[0] : node.name);
            }
        } else if (node.name && node.name.nameToken.value === '__init_subclass__') {
            // __init_subclass__ overrides should have a "cls" parameter.
            if (node.parameters.length === 0 || !node.parameters[0].name ||
                    node.parameters[0].name.nameToken.value !== 'cls') {
                this._addError(
                    `The __init_subclass__ override should take a 'cls' parameter`,
                    node.parameters.length > 0 ? node.parameters[0] : node.name);
            }
        } else if (ParseTreeUtils.functionHasDecorator(node, 'staticmethod')) {
            // Static methods should not have "self" or "cls" parameters.
            if (node.parameters.length > 0 && node.parameters[0].name) {
                let paramName = node.parameters[0].name.nameToken.value;
                if (paramName === 'self' || paramName === 'cls') {
                    this._addError(
                        `Static methods should not take a 'self' or 'cls' parameter`,
                        node.parameters[0].name);
                }
            }
        } else if (ParseTreeUtils.functionHasDecorator(node, 'classmethod')) {
            let paramName = '';
            if (node.parameters.length > 0 && node.parameters[0].name) {
                paramName = node.parameters[0].name.nameToken.value;
            }
            // Class methods should have a "cls" parameter. We'll exempt parameter
                // names that start with an underscore since those are used in a few
                // cases in the stdlib pyi files.
            if (paramName !== 'cls') {
                if (!this._fileInfo.isStubFile || (!paramName.startsWith('_') && paramName !== 'metacls')) {
                    this._addError(
                        `Class methods should take a 'cls' parameter`,
                        node.parameters.length > 0 ? node.parameters[0] : node.name);
                }
            }
        } else {
            // The presence of a decorator can change the behavior, so we need
            // to back off from this check if a decorator is present.
            if (node.decorators.length === 0) {
                let paramName = '';
                let firstParamIsSimple = true;
                if (node.parameters.length > 0) {
                    if (node.parameters[0].name) {
                        paramName = node.parameters[0].name.nameToken.value;
                    }

                    if (node.parameters[0].category !== ParameterCategory.Simple) {
                        firstParamIsSimple = false;
                    }
                }

                // Instance methods should have a "self" parameter. We'll exempt parameter
                // names that start with an underscore since those are used in a few
                // cases in the stdlib pyi files.
                if (firstParamIsSimple && paramName !== 'self' && !paramName.startsWith('_')) {
                    // Special-case the ABCMeta.register method in abc.pyi.
                    const isRegisterMethod = this._fileInfo.isStubFile &&
                        paramName === 'cls' &&
                        node.name.nameToken.value === 'register';

                    if (!isRegisterMethod) {
                        this._addError(
                            `Instance methods should take a 'self' parameter`,
                            node.parameters.length > 0 ? node.parameters[0] : node.name);
                    }
                }
            }
        }
    }

    private _addDiagnostic(diagLevel: DiagnosticLevel, message: string, textRange: TextRange) {
        if (diagLevel === 'error') {
            this._addError(message, textRange);
        } else if (diagLevel === 'warn') {
            this._addWarning(message, textRange);
        }
    }

    private _addError(message: string, textRange: TextRange) {
        // Don't emit error if the scope is guaranteed not to be executed.
        if (!this._currentScope.isNotExecuted()) {
            this._fileInfo.diagnosticSink.addErrorWithTextRange(message, textRange);
        }
    }

    private _addWarning(message: string, textRange: TextRange) {
        // Don't emit error if the scope is guaranteed not to be executed.
        if (!this._currentScope.isNotExecuted()) {
            this._fileInfo.diagnosticSink.addWarningWithTextRange(message, textRange);
        }
    }
}

export class ModuleScopeAnalyzer extends SemanticAnalyzer {
    constructor(node: ModuleNode, fileInfo: AnalyzerFileInfo) {
        super(node, fileInfo.builtinsScope, fileInfo);
    }

    analyze() {
        this.analyzeImmediate();
        this.analyzeDeferred();
    }

    analyzeImmediate() {
        this._bindImplicitNames();
        let nameBindings = AnalyzerNodeInfo.getNameBindings(this._scopedNode);
        assert(nameBindings !== undefined);
        this._addNamesToScope(nameBindings!.getGlobalNames());

        this.walkChildren(this._scopedNode);

        // Associate the module's scope with the module type.
        let moduleType = new ModuleType(this._currentScope.getSymbolTable());
        AnalyzerNodeInfo.setExpressionType(this._scopedNode, moduleType);
    }

    analyzeDeferred() {
        // Analyze any sub-scopes that were discovered during the earlier pass.
        this._analyzeSubscopesDeferred();
    }

    private _bindImplicitNames() {
        // List taken from https://docs.python.org/3/reference/import.html#__name__
        this._bindNameToType('__name__', ScopeUtils.getBuiltInObject(this._currentScope, 'str'));
        this._bindNameToType('__loader__', AnyType.create());
        this._bindNameToType('__package__', ScopeUtils.getBuiltInObject(this._currentScope, 'str'));
        this._bindNameToType('__spec__', AnyType.create());
        this._bindNameToType('__path__', ScopeUtils.getBuiltInObject(this._currentScope, 'str'));
        this._bindNameToType('__file__', ScopeUtils.getBuiltInObject(this._currentScope, 'str'));
        this._bindNameToType('__cached__', ScopeUtils.getBuiltInObject(this._currentScope, 'str'));
    }
}

export class ClassScopeAnalyzer extends SemanticAnalyzer {
    private _classType: ClassType;

    constructor(node: ClassNode, parentScope: Scope, classType: ClassType, fileInfo: AnalyzerFileInfo) {
        super(node, parentScope, fileInfo);
        this._classType = classType;
    }

    analyzeImmediate() {
        this._bindImplicitNames();
        let nameBindings = AnalyzerNodeInfo.getNameBindings(this._scopedNode);
        assert(nameBindings !== undefined);
        this._addNamesToScope(nameBindings!.getLocalNames());

        // Analyze the suite.
        let classNode = this._scopedNode as ClassNode;

        // Create a temporary scope so we can track modifications to
        // non-local names.
        let suiteScope = this._enterTemporaryScope(() => {
            this.walk(classNode.suite);
        });
        this._currentScope.mergeSymbolTable(suiteScope);

        // Record the class fields for this class.
        this._classType.setClassFields(this._currentScope.getSymbolTable());
    }

    analyzeDeferred() {
        // Analyze any sub-scopes that were discovered during the earlier pass.
        this._analyzeSubscopesDeferred();
    }

    private _bindImplicitNames() {
        let classType = AnalyzerNodeInfo.getExpressionType(this._scopedNode);
        assert(classType instanceof ClassType);
        this._bindNameToType('__class__', classType!);
        this._bindNameToType('__dict__', AnyType.create());
        this._bindNameToType('__doc__', ScopeUtils.getBuiltInObject(this._currentScope, 'str'));
        this._bindNameToType('__name__', ScopeUtils.getBuiltInObject(this._currentScope, 'str'));
    }
}

export class FunctionScopeAnalyzer extends SemanticAnalyzer {
    constructor(node: FunctionNode, parentScope: Scope, fileInfo: AnalyzerFileInfo) {
        super(node, parentScope, fileInfo);
    }

    analyzeImmediate() {
        this._bindImplicitNames();

        // Functions don't get analyzed immediately. They are analyzed in a deferred manner.
    }

    analyzeDeferred() {
        let functionNode = this._scopedNode as FunctionNode;

        // Add the names for this scope. They are initially unbound. We
        // do this because current versions of Python use static namespace
        // resolution for functions.
        let nameBindings = AnalyzerNodeInfo.getNameBindings(this._scopedNode);
        assert(nameBindings !== undefined);
        this._addNamesToScope(nameBindings!.getLocalNames());

        // Bind the parameters to the local names.
        this._addParametersToScope(functionNode.parameters);

        // Create a temporary scope so we can track modifications to
        // non-local names.
        let suiteScope = this._enterTemporaryScope(() => {
            // Walk the statements that make up the function.
            this.walk(functionNode.suite);
        });
        this._currentScope.mergeSymbolTable(suiteScope);

        // Analyze any sub-scopes that were discovered during the earlier pass.
        this._analyzeSubscopesDeferred();
    }

    private _bindImplicitNames() {
        // List taken from https://docs.python.org/3/reference/datamodel.html
        this._bindNameToType('__doc__', ScopeUtils.getBuiltInObject(this._currentScope, 'str'));
        this._bindNameToType('__name__', ScopeUtils.getBuiltInObject(this._currentScope, 'str'));
        if (this._fileInfo.executionEnvironment.pythonVersion >= PythonVersion.V33) {
            this._bindNameToType('__qualname__', ScopeUtils.getBuiltInObject(this._currentScope, 'str'));
        }
        this._bindNameToType('__module__', ScopeUtils.getBuiltInObject(this._currentScope, 'str'));
        this._bindNameToType('__defaults__', AnyType.create());
        this._bindNameToType('__code__', AnyType.create());
        this._bindNameToType('__globals__', AnyType.create());
        this._bindNameToType('__dict__', AnyType.create());
        this._bindNameToType('__closure__', AnyType.create());
        this._bindNameToType('__annotations__', AnyType.create());
        this._bindNameToType('__kwdefaults__', AnyType.create());
    }
}

export class LambdaScopeAnalyzer extends SemanticAnalyzer {
    constructor(node: LambdaNode, parentScope: Scope, fileInfo: AnalyzerFileInfo) {
        super(node, parentScope, fileInfo);
    }

    analyzeImmediate() {
        // Lambdas don't get analyzed immediately. They are analyzed in a deferred manner.
    }

    analyzeDeferred() {
        let lambdaNode = this._scopedNode as LambdaNode;

        // Add the names for this scope. They are initially unbound. We
        // do this because current versions of Python use static namespace
        // resolution for functions.
        let nameBindings = AnalyzerNodeInfo.getNameBindings(this._scopedNode);
        assert(nameBindings !== undefined);
        this._addNamesToScope(nameBindings!.getLocalNames());

        // Bind the parameters to the local names.
        this._addParametersToScope(lambdaNode.parameters);

        // Create a temporary scope so we can track modifications to
        // non-local names.
        let suiteScope = this._enterTemporaryScope(() => {
            // Walk the expression that make up the lambda body.
            this.walk(lambdaNode.expression);
        });
        this._currentScope.mergeSymbolTable(suiteScope);

        // Analyze any sub-scopes that were discovered during the earlier pass.
        this._analyzeSubscopesDeferred();
    }
}
