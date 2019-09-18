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
import { CreateTypeStubFileAction } from '../common/diagnostic';
import { DiagnosticRule } from '../common/diagnosticRules';
import { PythonVersion } from '../common/pythonVersion';
import StringMap from '../common/stringMap';
import { TextRange } from '../common/textRange';
import { AssignmentNode, AugmentedAssignmentExpressionNode, AwaitExpressionNode, ClassNode,
    DelNode, ExceptNode, ExpressionNode, ForNode, FunctionNode, GlobalNode, IfNode,
    ImportAsNode, ImportFromAsNode, LambdaNode, ListComprehensionNode, ModuleNameNode, ModuleNode,
    NonlocalNode, ParseNode, ParseNodeArray, ParseNodeType, RaiseNode, StatementNode,
    StringListNode, SuiteNode, TryNode, TypeAnnotationExpressionNode, WhileNode,
    WithNode, YieldExpressionNode, YieldFromExpressionNode } from '../parser/parseNodes';
import * as StringTokenUtils from '../parser/stringTokenUtils';
import { StringTokenFlags } from '../parser/tokenizerTypes';
import { AnalyzerFileInfo } from './analyzerFileInfo';
import * as AnalyzerNodeInfo from './analyzerNodeInfo';
import * as DocStringUtils from './docStringUtils';
import { ImportType } from './importResult';
import { defaultTypeSourceId } from './inferredType';
import * as ParseTreeUtils from './parseTreeUtils';
import { ParseTreeWalker } from './parseTreeWalker';
import { Scope, ScopeType } from './scope';
import * as ScopeUtils from './scopeUtils';
import * as StaticExpressions from './staticExpressions';
import { SymbolFlags } from './symbol';
import { AnyType, ClassType, ClassTypeFlags, FunctionParameter, FunctionType,
    FunctionTypeFlags, ModuleType, Type, TypeCategory, UnknownType } from './types';

type ScopedNode = ModuleNode | ClassNode | FunctionNode | LambdaNode;

export const enum NameBindingType {
    // With "nonlocal" keyword
    Nonlocal,

    // With "global" keyword
    Global
}

export abstract class Binder extends ParseTreeWalker {
    protected readonly _scopedNode: ScopedNode;
    protected readonly _fileInfo: AnalyzerFileInfo;

    // A queue of scoped nodes that need to be analyzed.
    protected _subscopesToAnalyze: Binder[] = [];

    // The current scope in effect. This is either the base scope or a
    // "temporary scope", used for analyzing conditional code blocks. Their
    // contents are eventually merged in to the base scope.
    protected _currentScope: Scope;

    // Number of nested except statements at current point of analysis.
    // Used to determine if a naked "raise" statement is allowed.
    private _nestedExceptDepth = 0;

    // Indicates that any name that's encountered should be ignored
    // because it's in an unexecuted section of code.
    protected _isUnexecutedCode = false;

    // Name bindings that are not local to the current scope.
    protected _notLocalBindings = new StringMap<NameBindingType>();

    constructor(node: ScopedNode, scopeType: ScopeType, parentScope: Scope | undefined,
            fileInfo: AnalyzerFileInfo) {

        super();

        this._scopedNode = node;
        this._fileInfo = fileInfo;

        // Allocate a new scope and associate it with the node
        // we've been asked to analyze.
        this._currentScope = new Scope(scopeType, parentScope);

        // If this is the built-in scope, we need to hide symbols
        // that are in the stub file but are not officially part of
        // the built-in list of symbols in Python.
        if (scopeType === ScopeType.Builtin) {
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
                'UnicodeWarning', 'UserWarning', 'ValueError', 'Warning', 'ZeroDivisionError',
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

        AnalyzerNodeInfo.setScope(this._scopedNode, this._currentScope);
    }

    // We separate binding into two passes. The first happens immediately when
    // the scope analyzer is created. The second happens after its parent scope
    // has been fully analyzed.
    bindDeferred() {
        // Analyze any sub-scopes that were discovered during the earlier pass.
        this._analyzeSubscopesDeferred();
    }

    visitNode(node: ParseNode) {
        const children = super.visitNode(node);

        this._addParentLinks(node, children);

        return children;
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
        this._addParentLinks(node, [...node.decorators, node.name,
            ...node.arguments, node.suite]);

        this.walkMultiple(node.decorators);

        let classFlags = ClassTypeFlags.None;
        if (this._currentScope.getType() === ScopeType.Builtin ||
                this._fileInfo.isTypingStubFile ||
                this._fileInfo.isBuiltInStubFile) {

            classFlags |= ClassTypeFlags.BuiltInClass;
        }

        const classType = ClassType.create(node.name.nameToken.value, classFlags,
            node.id, this._getDocString(node.suite.statements));

        this._bindNameToScope(this._currentScope, node.name.nameToken.value);

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
            const objectType = ScopeUtils.getBuiltInType(this._currentScope, 'object');
            // Make sure we don't have 'object' derive from itself. Infinite
            // recursion will result.
            if (!ClassType.isBuiltIn(classType, 'object')) {
                ClassType.addBaseClass(classType, objectType, false);
            }
        }

        AnalyzerNodeInfo.setExpressionType(node, classType);

        const binder = new ClassScopeBinder(node, this._currentScope, classType, this._fileInfo);
        this._queueSubScopeAnalyzer(binder);

        // Add the class symbol. We do this in the binder to speed
        // up overall analysis times. Without this, the type analyzer needs
        // to do more passes to resolve classes.
        this._addSymbolToCurrentScope(node.name.nameToken.value, classType, node.name.id);

        return false;
    }

    visitFunction(node: FunctionNode): boolean {
        this._addParentLinks(node, [...node.decorators, node.name, ...node.parameters,
            node.returnTypeAnnotation, node.suite]);

        // The "__new__" magic method is not an instance method.
        // It acts as a static method instead.
        let functionFlags = FunctionTypeFlags.None;
        if (node.name.nameToken.value === '__new__') {
            functionFlags |= FunctionTypeFlags.StaticMethod;
            functionFlags |= FunctionTypeFlags.ConstructorMethod;
            functionFlags &= ~FunctionTypeFlags.InstanceMethod;
        }

        const functionType = FunctionType.create(functionFlags,
            this._getDocString(node.suite.statements));

        this._bindNameToScope(this._currentScope, node.name.nameToken.value);

        this.walkMultiple(node.decorators);
        node.parameters.forEach(param => {
            this._addParentLinks(param, [param.name, param.typeAnnotation,
                param.defaultValue]);

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
        AnalyzerNodeInfo.setExpressionType(node.name, functionType);

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

        const binder = new FunctionScopeBinder(node, functionOrModuleScope!, this._fileInfo);
        this._queueSubScopeAnalyzer(binder);

        return false;
    }

    visitLambda(node: LambdaNode): boolean {
        this._addParentLinks(node, [...node.parameters, node.expression]);

        // Analyze the parameter defaults in the context of the parent's scope
        // before we add any names from the function's scope.
        node.parameters.forEach(param => {
            this._addParentLinks(param, [param.name, param.typeAnnotation,
                param.defaultValue]);

            if (param.defaultValue) {
                this.walk(param.defaultValue);
            }
        });

        const binder = new LambdaScopeBinder(node, this._currentScope, this._fileInfo);
        this._queueSubScopeAnalyzer(binder);

        return false;
    }

    visitAssignment(node: AssignmentNode) {
        this._bindPossibleTupleNamedTarget(node.leftExpression);
        return true;
    }

    visitAugmentedAssignment(node: AugmentedAssignmentExpressionNode) {
        this._bindPossibleTupleNamedTarget(node.leftExpression);
        return true;
    }

    visitDel(node: DelNode) {
        node.expressions.forEach(expr => {
            this._bindPossibleTupleNamedTarget(expr);
        });
        return true;
    }

    visitTypeAnnotation(node: TypeAnnotationExpressionNode): boolean {
        this._bindPossibleTupleNamedTarget(node.valueExpression);

        return true;
    }

    visitFor(node: ForNode) {
        this._bindPossibleTupleNamedTarget(node.targetExpression);
        return true;
    }

    visitYield(node: YieldExpressionNode): boolean {
        this._validateYieldUsage(node);
        return true;
    }

    visitYieldFrom(node: YieldFromExpressionNode): boolean {
        this._validateYieldUsage(node);
        return true;
    }

    visitIf(node: IfNode): boolean {
        this._addParentLinks(node, [node.testExpression, node.ifSuite, node.elseSuite]);
        this._handleIfWhileCommon(node.testExpression, node.ifSuite, node.elseSuite);
        return false;
    }

    visitWhile(node: WhileNode): boolean {
        this._addParentLinks(node, [node.testExpression, node.whileSuite, node.elseSuite]);
        this._handleIfWhileCommon(node.testExpression, node.whileSuite, node.elseSuite);
        return false;
    }

    visitExcept(node: ExceptNode): boolean {
        if (node.name) {
            this._bindNameToScope(this._currentScope, node.name.nameToken.value);
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

        return true;
    }

    visitTry(node: TryNode): boolean {
        this._addParentLinks(node, [node.trySuite, ...node.exceptClauses,
            node.elseSuite, node.finallySuite]);

        this.walk(node.trySuite);

        // Wrap the except clauses in a conditional scope
        // so we can throw away any names that are bound
        // in this scope.
        this._nestedExceptDepth++;
        node.exceptClauses.forEach(exceptNode => {
            this.walk(exceptNode);
        });
        this._nestedExceptDepth--;

        if (node.elseSuite) {
            this.walk(node.elseSuite);
        }

        if (node.finallySuite) {
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
        if (node.alias) {
            this._bindNameToScope(this._currentScope, node.alias.nameToken.value);
        } else if (node.module.nameParts.length > 0) {
            this._bindNameToScope(this._currentScope, node.module.nameParts[0].nameToken.value);
        }

        return true;
    }

    visitImportFromAs(node: ImportFromAsNode): boolean {
        const nameNode = node.alias || node.name;
        this._bindNameToScope(this._currentScope, nameNode.nameToken.value);

        return true;
    }

    visitWith(node: WithNode): boolean {
        node.withItems.forEach(item => {
            if (item.target) {
                this._bindPossibleTupleNamedTarget(item.target);
            }
        });

        return true;
    }

    visitListComprehension(node: ListComprehensionNode): boolean {
        this._addParentLinks(node, [...node.comprehensions, node.expression]);

        // Allocate a new scope.
        const prevScope = this._currentScope;
        this._currentScope = new Scope(ScopeType.ListComprehension, prevScope);

        node.comprehensions.forEach(compr => {
            if (compr.nodeType === ParseNodeType.ListComprehensionFor) {
                this._addParentLinks(compr, [compr.iterableExpression, compr.targetExpression]);

                this.walk(compr.iterableExpression);

                this._bindPossibleTupleNamedTarget(compr.targetExpression);
                this.walk(compr.targetExpression);
            } else {
                this._addParentLinks(compr, [compr.testExpression]);
                this.walk(compr.testExpression);
            }
        });

        this.walk(node.expression);

        AnalyzerNodeInfo.setScope(node, this._currentScope);

        this._currentScope = prevScope;

        return false;
    }

    protected _bindNameToScope(scope: Scope, name: string) {
        if (this._notLocalBindings.get(name) === undefined) {
            // Don't overwrite an existing symbol.
            let symbol = scope.lookUpSymbol(name);
            if (!symbol) {
                symbol = scope.addSymbol(name,
                    SymbolFlags.InitiallyUnbound | SymbolFlags.ClassMember);
            }
        }
    }

    protected _bindPossibleTupleNamedTarget(node: ExpressionNode) {
        if (node.nodeType === ParseNodeType.Name) {
            this._bindNameToScope(this._currentScope, node.nameToken.value);
        } else if (node.nodeType === ParseNodeType.Tuple) {
            node.expressions.forEach(expr => {
                this._bindPossibleTupleNamedTarget(expr);
            });
        } else if (node.nodeType === ParseNodeType.List) {
            node.entries.forEach(expr => {
                this._bindPossibleTupleNamedTarget(expr);
            });
        } else if (node.nodeType === ParseNodeType.TypeAnnotation) {
            this._bindPossibleTupleNamedTarget(node.valueExpression);
        } else if (node.nodeType === ParseNodeType.Unpack) {
            this._bindPossibleTupleNamedTarget(node.expression);
        }
    }

    // Finds the nearest permanent scope (as opposed to temporary scope) and
    // adds a new symbol with the specified name if it doesn't already exist.
    protected _addSymbolToCurrentScope(nameValue: string, type: Type,
            typeSourceId = defaultTypeSourceId) {

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
    }

    protected _getDocString(statements: StatementNode[]): string | undefined {
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

    protected _addParentLinks(parentNode: ParseNode, children: ParseNodeArray) {
        // Add the parent link to each of the child nodes.
        children.forEach(child => {
            if (child) {
                child.parent = parentNode;
            }
        });
    }

    // Analyzes the subscopes that are discovered during the first analysis pass.
    private _analyzeSubscopesDeferred() {
        for (const subscope of this._subscopesToAnalyze) {
            subscope.bindDeferred();
        }

        this._subscopesToAnalyze = [];
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
            elseSuite: SuiteNode | IfNode | undefined) {

        this.walk(testExpression);

        // Determine if the if condition is always true or always false. If so,
        // we can treat either the if or the else clause as unconditional.
        const constExprValue = StaticExpressions.evaluateStaticExpression(
            testExpression, this._fileInfo.executionEnvironment);

        // which variables have been assigned to conditionally.
        this._markNotExecuted(constExprValue === true, () => {
            this.walk(ifWhileSuite);
        });

        // Now handle the else statement if it's present. If there
        // are chained "else if" statements, they'll be handled
        // recursively here.
        if (elseSuite) {
            this._markNotExecuted(constExprValue === false, () => {
                this.walk(elseSuite);
            });
        }
    }

    private _markNotExecuted(isExecutable: boolean, callback: () => void) {
        const wasUnexecutedCode = this._isUnexecutedCode;

        if (!isExecutable) {
            this._isUnexecutedCode = true;
        }

        callback();

        this._isUnexecutedCode = wasUnexecutedCode;
    }

    private _queueSubScopeAnalyzer(binder: Binder) {
        this._subscopesToAnalyze.push(binder);
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

export class ModuleScopeBinder extends Binder {
    constructor(node: ModuleNode, fileInfo: AnalyzerFileInfo) {
        super(node, fileInfo.builtinsScope ? ScopeType.Module : ScopeType.Builtin,
            fileInfo.builtinsScope, fileInfo);

        // Bind implicit names.
        // List taken from https://docs.python.org/3/reference/import.html#__name__
        this._addSymbolToCurrentScope('__name__',
            ScopeUtils.getBuiltInObject(this._currentScope, 'str'));
        this._addSymbolToCurrentScope('__loader__', AnyType.create());
        this._addSymbolToCurrentScope('__package__',
            ScopeUtils.getBuiltInObject(this._currentScope, 'str'));
        this._addSymbolToCurrentScope('__spec__', AnyType.create());
        this._addSymbolToCurrentScope('__path__', ScopeUtils.getBuiltInObject(this._currentScope, 'str'));
        this._addSymbolToCurrentScope('__file__', ScopeUtils.getBuiltInObject(this._currentScope, 'str'));
        this._addSymbolToCurrentScope('__cached__', ScopeUtils.getBuiltInObject(this._currentScope, 'str'));

        const moduleNode = this._scopedNode as ModuleNode;
        this._addParentLinks(moduleNode, moduleNode.statements);
        this.walkMultiple(moduleNode.statements);

        // Associate the module's scope with the module type.
        const moduleType = ModuleType.create(this._currentScope.getSymbolTable(),
            this._getDocString((this._scopedNode as ModuleNode).statements));
        AnalyzerNodeInfo.setExpressionType(this._scopedNode, moduleType);
    }

    bind() {
        this.bindDeferred();
    }
}

export class ClassScopeBinder extends Binder {
    constructor(node: ClassNode, parentScope: Scope, classType: ClassType,
            fileInfo: AnalyzerFileInfo) {
        super(node, ScopeType.Class, parentScope, fileInfo);

        // The scope for this class becomes the "fields" for the corresponding type.
        ClassType.setFields(classType, this._currentScope.getSymbolTable());

        // Bind implicit names.
        assert(classType && classType.category === TypeCategory.Class);
        this._addSymbolToCurrentScope('__class__', classType);
        this._addSymbolToCurrentScope('__dict__', AnyType.create());
        this._addSymbolToCurrentScope('__doc__', ScopeUtils.getBuiltInObject(this._currentScope, 'str'));
        this._addSymbolToCurrentScope('__name__', ScopeUtils.getBuiltInObject(this._currentScope, 'str'));
        if (this._fileInfo.executionEnvironment.pythonVersion >= PythonVersion.V33) {
            this._addSymbolToCurrentScope('__qualname__', ScopeUtils.getBuiltInObject(this._currentScope, 'str'));
        }

        // Analyze the suite.
        const classNode = this._scopedNode as ClassNode;

        this.walk(classNode.suite);
    }
}

export class FunctionScopeBinder extends Binder {
    constructor(node: FunctionNode, parentScope: Scope, fileInfo: AnalyzerFileInfo) {
        super(node, ScopeType.Function, parentScope, fileInfo);

        // Bind implicit names.
        // List taken from https://docs.python.org/3/reference/datamodel.html
        this._addSymbolToCurrentScope('__doc__', ScopeUtils.getBuiltInObject(this._currentScope, 'str'));
        this._addSymbolToCurrentScope('__name__', ScopeUtils.getBuiltInObject(this._currentScope, 'str'));
        if (this._fileInfo.executionEnvironment.pythonVersion >= PythonVersion.V33) {
            this._addSymbolToCurrentScope('__qualname__', ScopeUtils.getBuiltInObject(this._currentScope, 'str'));
        }
        this._addSymbolToCurrentScope('__module__', ScopeUtils.getBuiltInObject(this._currentScope, 'str'));
        this._addSymbolToCurrentScope('__defaults__', AnyType.create());
        this._addSymbolToCurrentScope('__code__', AnyType.create());
        this._addSymbolToCurrentScope('__globals__', AnyType.create());
        this._addSymbolToCurrentScope('__dict__', AnyType.create());
        this._addSymbolToCurrentScope('__closure__', AnyType.create());
        this._addSymbolToCurrentScope('__annotations__', AnyType.create());
        this._addSymbolToCurrentScope('__kwdefaults__', AnyType.create());
    }

    bindDeferred() {
        const functionNode = this._scopedNode as FunctionNode;

        functionNode.parameters.forEach(param => {
            if (param.name) {
                this._bindNameToScope(this._currentScope, param.name.nameToken.value);
            }
        });

        // Walk the statements that make up the function.
        this.walk(functionNode.suite);

        // Analyze any sub-scopes that were discovered during the earlier pass.
        super.bindDeferred();
    }
}

export class LambdaScopeBinder extends Binder {
    constructor(node: LambdaNode, parentScope: Scope, fileInfo: AnalyzerFileInfo) {
        super(node, ScopeType.Function, parentScope, fileInfo);
    }

    bindDeferred() {
        const lambdaNode = this._scopedNode as LambdaNode;

        lambdaNode.parameters.forEach(param => {
            if (param.name) {
                this._bindNameToScope(this._currentScope, param.name.nameToken.value);
            }
        });

        // Walk the expression that make up the lambda body.
        this.walk(lambdaNode.expression);

        // Analyze any sub-scopes that were discovered during the earlier pass.
        super.bindDeferred();
    }
}
