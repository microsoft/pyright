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
import { TextRange } from '../common/textRange';
import { NameBindings, NameBindingType } from '../parser/nameBindings';
import { AssignmentNode, AugmentedAssignmentExpressionNode, AwaitExpressionNode, ClassNode,
    DelNode, ExceptNode, ExpressionNode, ForNode, FunctionNode, GlobalNode, IfNode,
    ImportAsNode, ImportFromAsNode, LambdaNode, ListComprehensionNode, ModuleNameNode, ModuleNode,
    NonlocalNode, ParseNode, ParseNodeArray, ParseNodeType, RaiseNode, StatementNode,
    StringListNode, SuiteNode, TryNode, TypeAnnotationExpressionNode, WhileNode,
    WithNode, YieldExpressionNode, YieldFromExpressionNode } from '../parser/parseNodes';
import { StringTokenUtils, UnescapeErrorType } from '../parser/stringTokenUtils';
import { StringTokenFlags } from '../parser/tokenizerTypes';
import { ScopeUtils } from '../scopeUtils';
import { AnalyzerFileInfo } from './analyzerFileInfo';
import { AnalyzerNodeInfo } from './analyzerNodeInfo';
import { DocStringUtils } from './docStringUtils';
import { ExpressionUtils } from './expressionUtils';
import { ImportType } from './importResult';
import { defaultTypeSourceId } from './inferredType';
import { ParseTreeUtils } from './parseTreeUtils';
import { ParseTreeWalker } from './parseTreeWalker';
import { Scope, ScopeType } from './scope';
import { AnyType, ClassType, ClassTypeFlags, FunctionParameter, FunctionType,
    FunctionTypeFlags, ModuleType, Type, UnknownType } from './types';

type ScopedNode = ModuleNode | ClassNode | FunctionNode | LambdaNode;

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

    // Name binding information used within the current scope.
    protected _nameBindings: NameBindings;

    constructor(node: ScopedNode, scopeType: ScopeType, parentScope: Scope | undefined,
            nameBindingType: NameBindingType, parentBindings: NameBindings | undefined,
            fileInfo: AnalyzerFileInfo) {

        super();

        this._scopedNode = node;
        this._fileInfo = fileInfo;
        this._nameBindings = new NameBindings(nameBindingType, parentBindings);

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

    // We separate analysis into two passes. The first happens immediately when
    // the scope analyzer is created. The second happens after its parent scope
    // has been fully analyzed.
    abstract bindImmediate(): void;
    abstract bindDeferred(): void;

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
                    const diagnostic = this._addDiagnostic(this._fileInfo.diagnosticSettings.reportMissingTypeStubs,
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
            AnalyzerNodeInfo.getTypeSourceId(node),
            this._getDocString(node.suite.statements));

        this._bindName(node.name.nameToken.value);

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
            if (!ClassType.isBuiltIn(classType) || ClassType.getClassName(classType) !== 'object') {
                ClassType.addBaseClass(classType, objectType, false);
            }
        }

        AnalyzerNodeInfo.setExpressionType(node, classType);

        const binder = new ClassScopeBinder(node, this._currentScope, classType,
            this._nameBindings, this._fileInfo);
        this._queueSubScopeAnalyzer(binder);

        // Add the class symbol. We do this in the binder to speed
        // up overall analysis times. Without this, the type analyzer needs
        // to do more passes to resolve classes.
        this._addSymbolToPermanentScope(node.name.nameToken.value, classType,
            AnalyzerNodeInfo.getTypeSourceId(node.name));

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

        const functionType = new FunctionType(functionFlags,
            this._getDocString(node.suite.statements));

        this._bindName(node.name.nameToken.value);

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

            functionType.addParameter(typeParam);

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

        const binder = new FunctionScopeBinder(node, functionOrModuleScope!,
            this._nameBindings, this._fileInfo);
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

        const binder = new LambdaScopeBinder(node, this._currentScope,
            this._nameBindings, this._fileInfo);
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
            this._bindName(node.name.nameToken.value);
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

                    if (error.errorType === UnescapeErrorType.InvalidEscapeSequence) {
                        this._addDiagnostic(this._fileInfo.diagnosticSettings.reportInvalidStringEscapeSequence,
                            DiagnosticRule.reportInvalidStringEscapeSequence,
                            'Unsupported escape sequence in string literal', textRange);
                    } else if (error.errorType === UnescapeErrorType.EscapeWithinFormatExpression) {
                        this._addError(
                            'Escape sequence (backslash) not allowed in expression portion of f-string',
                            textRange);
                    } else if (error.errorType === UnescapeErrorType.SingleCloseBraceWithinFormatLiteral) {
                        this._addError(
                            'Single close brace not allowed within f-string literal; use double close brace',
                            textRange);
                    } else if (error.errorType === UnescapeErrorType.UnterminatedFormatExpression) {
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
        node.nameList.forEach(name => {
            if (!this._nameBindings.addName(name.nameToken.value, NameBindingType.Global)) {
                this._addError(`'${ name.nameToken.value }' is assigned before global declaration`,
                    name);
            }

            // Add it to the global scope as well, in case it's not already added there.
            if (this._nameBindings.getBindingType() !== NameBindingType.Global) {
                let globalScope: NameBindings | undefined = this._nameBindings;
                while (globalScope && globalScope.getBindingType() !== NameBindingType.Global) {
                    globalScope = globalScope.getParentScope();
                }

                if (globalScope) {
                    globalScope.addName(name.nameToken.value, NameBindingType.Global);
                }
            }

            const valueWithScope = this._currentScope.lookUpSymbolRecursive(name.nameToken.value);

            if (!valueWithScope || valueWithScope.scope.getType() !== ScopeType.Module) {
                this._addError(`No binding for global '${ name.nameToken.value }' found`, name);
            }
        });

        return true;
    }

    visitNonlocal(node: NonlocalNode): boolean {
        if (this._nameBindings.getBindingType() === NameBindingType.Global) {
            this._addError('Nonlocal declaration not allowed at module level', node);
        }

        node.nameList.forEach(name => {
            if (!this._nameBindings.addName(name.nameToken.value, NameBindingType.Nonlocal)) {
                this._addError(`'${ name.nameToken.value }' is assigned before nonlocal declaration`,
                    name);
            }

            const valueWithScope = this._currentScope.lookUpSymbolRecursive(name.nameToken.value);

            if (!valueWithScope || (valueWithScope.scope.getType() !== ScopeType.Function &&
                    valueWithScope.scope.getType() !== ScopeType.Class)) {

                this._addError(`No binding for nonlocal '${ name.nameToken.value }' found`, name);
            }
        });

        return true;
    }

    visitImportAs(node: ImportAsNode): boolean {
        if (node.alias) {
            this._bindName(node.alias.nameToken.value);
        } else if (node.module.nameParts.length > 0) {
            this._bindName(node.module.nameParts[0].nameToken.value);
        }

        return true;
    }

    visitImportFromAs(node: ImportFromAsNode): boolean {
        const nameNode = node.alias || node.name;
        this._bindName(nameNode.nameToken.value);

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
        const prevNameBindings = this._nameBindings;
        this._nameBindings = new NameBindings(NameBindingType.Local, prevNameBindings);

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
        this._addNamesToScope(this._nameBindings.getLocalNames());

        this._currentScope = prevScope;
        this._nameBindings = prevNameBindings;

        return false;
    }

    protected _addNamesToScope(namesToAdd: string[]) {
        // Add the names for this scope. They are initially unbound.
        namesToAdd.forEach(name => {
            // Don't overwrite the implicit bound names that have already
            // been added to the scope.
            let symbol = this._currentScope.lookUpSymbol(name);
            if (!symbol) {
                symbol = this._currentScope.addSymbol(name, true);
            }
        });
    }

    // Analyzes the subscopes that are discovered during the first analysis pass.
    protected _analyzeSubscopesDeferred() {
        for (const subscope of this._subscopesToAnalyze) {
            subscope.bindDeferred();
        }

        this._subscopesToAnalyze = [];
    }

    protected _bindPossibleTupleNamedTarget(node: ExpressionNode) {
        if (node.nodeType === ParseNodeType.Name) {
            this._bindName(node.nameToken.value);
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

    protected _bindName(name: string) {
        // Has this name already been added to the current scope? If not,
        // add it with the appropriate binding type.
        const bindingType = this._nameBindings.lookUpName(name);
        if (bindingType === undefined) {
            this._nameBindings.addName(name, this._nameBindings.getBindingType());
        }
    }

    // Finds the nearest permanent scope (as opposed to temporary scope) and
    // adds a new symbol with the specified name if it doesn't already exist.
    protected _addSymbolToPermanentScope(nameValue: string, type: Type,
            typeSourceId = defaultTypeSourceId) {

        if (this._isUnexecutedCode) {
            return;
        }

        const permanentScope = ScopeUtils.getPermanentScope(this._currentScope);
        assert(permanentScope.getType() !== ScopeType.Temporary);

        let symbol = permanentScope.lookUpSymbol(nameValue);

        if (!symbol) {
            // Add the symbol. Assume that symbols with a default type source ID
            // are "implicit" symbols added to the scope. These are not initially unbound.
            symbol = this._currentScope.addSymbol(nameValue,
                typeSourceId !== defaultTypeSourceId);
        }

        symbol.setInferredTypeForSource(type, typeSourceId);
    }

    protected _getDocString(statemetns: StatementNode[]): string | undefined {
        // See if the first statement in the suite is a triple-quote string.
        if (statemetns.length === 0) {
            return undefined;
        }

        if (statemetns[0].nodeType !== ParseNodeType.StatementList) {
            return undefined;
        }

        // If the first statement in the suite isn't a StringNode,
        // assume there is no docString.
        const statementList = statemetns[0];
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
        const constExprValue = ExpressionUtils.evaluateConstantExpression(
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
        binder.bindImmediate();
        this._subscopesToAnalyze.push(binder);
    }

    private _addDiagnostic(diagLevel: DiagnosticLevel, rule: string, message: string, textRange: TextRange) {
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
            fileInfo.builtinsScope, NameBindingType.Global, undefined, fileInfo);
    }

    bind() {
        this.bindImmediate();
        this.bindDeferred();
    }

    bindImmediate() {
        this._bindImplicitNames();

        const moduleNode = this._scopedNode as ModuleNode;
        this._addParentLinks(moduleNode, moduleNode.statements);
        this.walkMultiple(moduleNode.statements);

        // Associate the module's scope with the module type.
        const moduleType = ModuleType.create(this._currentScope.getSymbolTable(),
            this._getDocString((this._scopedNode as ModuleNode).statements));
        AnalyzerNodeInfo.setExpressionType(this._scopedNode, moduleType);

        this._addNamesToScope(this._nameBindings.getGlobalNames());
    }

    bindDeferred() {
        // Analyze any sub-scopes that were discovered during the earlier pass.
        this._analyzeSubscopesDeferred();
    }

    private _bindImplicitNames() {
        // List taken from https://docs.python.org/3/reference/import.html#__name__
        this._addSymbolToPermanentScope('__name__',
            ScopeUtils.getBuiltInObject(this._currentScope, 'str'));
        this._addSymbolToPermanentScope('__loader__', AnyType.create());
        this._addSymbolToPermanentScope('__package__',
            ScopeUtils.getBuiltInObject(this._currentScope, 'str'));
        this._addSymbolToPermanentScope('__spec__', AnyType.create());
        this._addSymbolToPermanentScope('__path__', ScopeUtils.getBuiltInObject(this._currentScope, 'str'));
        this._addSymbolToPermanentScope('__file__', ScopeUtils.getBuiltInObject(this._currentScope, 'str'));
        this._addSymbolToPermanentScope('__cached__', ScopeUtils.getBuiltInObject(this._currentScope, 'str'));
    }
}

export class ClassScopeBinder extends Binder {
    private _classType: ClassType;

    constructor(node: ClassNode, parentScope: Scope, classType: ClassType,
            parentNameBindings: NameBindings, fileInfo: AnalyzerFileInfo) {
        super(node, ScopeType.Class, parentScope, NameBindingType.Local,
                parentNameBindings, fileInfo);

        this._classType = classType;
    }

    bindImmediate() {
        this._bindImplicitNames();

        // Analyze the suite.
        const classNode = this._scopedNode as ClassNode;

        this.walk(classNode.suite);

        // Record the class fields for this class.
        ClassType.setClassFields(this._classType, this._currentScope.getSymbolTable());

        this._addNamesToScope(this._nameBindings.getLocalNames());
}

    bindDeferred() {
        // Analyze any sub-scopes that were discovered during the earlier pass.
        this._analyzeSubscopesDeferred();
    }

    private _bindImplicitNames() {
        const classType = AnalyzerNodeInfo.getExpressionType(this._scopedNode);
        assert(classType instanceof ClassType);
        this._addSymbolToPermanentScope('__class__', classType!);
        this._addSymbolToPermanentScope('__dict__', AnyType.create());
        this._addSymbolToPermanentScope('__doc__', ScopeUtils.getBuiltInObject(this._currentScope, 'str'));
        this._addSymbolToPermanentScope('__name__', ScopeUtils.getBuiltInObject(this._currentScope, 'str'));
        if (this._fileInfo.executionEnvironment.pythonVersion >= PythonVersion.V33) {
            this._addSymbolToPermanentScope('__qualname__', ScopeUtils.getBuiltInObject(this._currentScope, 'str'));
        }
    }
}

export class FunctionScopeBinder extends Binder {
    constructor(node: FunctionNode, parentScope: Scope, parentNameBindings: NameBindings,
            fileInfo: AnalyzerFileInfo) {
        super(node, ScopeType.Function, parentScope, NameBindingType.Local,
                parentNameBindings, fileInfo);
    }

    bindImmediate() {
        this._bindImplicitNames();

        // Functions don't get analyzed immediately. They are analyzed in a deferred manner.
    }

    bindDeferred() {
        const functionNode = this._scopedNode as FunctionNode;

        functionNode.parameters.forEach(param => {
            if (param.name) {
                this._bindName(param.name.nameToken.value);
            }
        });

        // Walk the statements that make up the function.
        this.walk(functionNode.suite);

        this._addNamesToScope(this._nameBindings.getLocalNames());

        // Analyze any sub-scopes that were discovered during the earlier pass.
        this._analyzeSubscopesDeferred();
    }

    private _bindImplicitNames() {
        // List taken from https://docs.python.org/3/reference/datamodel.html
        this._addSymbolToPermanentScope('__doc__', ScopeUtils.getBuiltInObject(this._currentScope, 'str'));
        this._addSymbolToPermanentScope('__name__', ScopeUtils.getBuiltInObject(this._currentScope, 'str'));
        if (this._fileInfo.executionEnvironment.pythonVersion >= PythonVersion.V33) {
            this._addSymbolToPermanentScope('__qualname__', ScopeUtils.getBuiltInObject(this._currentScope, 'str'));
        }
        this._addSymbolToPermanentScope('__module__', ScopeUtils.getBuiltInObject(this._currentScope, 'str'));
        this._addSymbolToPermanentScope('__defaults__', AnyType.create());
        this._addSymbolToPermanentScope('__code__', AnyType.create());
        this._addSymbolToPermanentScope('__globals__', AnyType.create());
        this._addSymbolToPermanentScope('__dict__', AnyType.create());
        this._addSymbolToPermanentScope('__closure__', AnyType.create());
        this._addSymbolToPermanentScope('__annotations__', AnyType.create());
        this._addSymbolToPermanentScope('__kwdefaults__', AnyType.create());
    }
}

export class LambdaScopeBinder extends Binder {
    constructor(node: LambdaNode, parentScope: Scope, parentNameBindings: NameBindings,
            fileInfo: AnalyzerFileInfo) {
        super(node, ScopeType.Function, parentScope, NameBindingType.Local,
                parentNameBindings, fileInfo);
    }

    bindImmediate() {
        // Lambdas don't get analyzed immediately. They are analyzed in a deferred manner.
    }

    bindDeferred() {
        const lambdaNode = this._scopedNode as LambdaNode;

        lambdaNode.parameters.forEach(param => {
            if (param.name) {
                this._bindName(param.name.nameToken.value);
            }
        });

        // Walk the expression that make up the lambda body.
        this.walk(lambdaNode.expression);

        // Analyze any sub-scopes that were discovered during the earlier pass.
        this._analyzeSubscopesDeferred();

        this._addNamesToScope(this._nameBindings.getLocalNames());
    }
}
