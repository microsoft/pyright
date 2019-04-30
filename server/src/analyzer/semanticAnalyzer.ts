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
import { AssignmentNode, AwaitExpressionNode, ClassNode, ErrorExpressionNode,
    ExceptNode, ExpressionNode, ForNode, FunctionNode, GlobalNode, IfNode,
    ImportAsNode, ImportFromAsNode, LambdaNode, ListComprehensionForNode,
    ListComprehensionNode, ListNode, MemberAccessExpressionNode,
    ModuleNameNode, ModuleNode, NameNode, NonlocalNode, ParameterNode, RaiseNode,
    ReturnNode, StringNode, SuiteNode, TryNode, TupleExpressionNode,
    TypeAnnotationExpressionNode, WhileNode, WithNode, YieldExpressionNode,
    YieldFromExpressionNode } from '../parser/parseNodes';
import { StringTokenFlags } from '../parser/tokenizerTypes';
import { ScopeUtils } from '../scopeUtils';
import { AnalyzerFileInfo } from './analyzerFileInfo';
import { AnalyzerNodeInfo } from './analyzerNodeInfo';
import { EvaluatorFlags, ExpressionEvaluator } from './expressionEvaluator';
import { ExpressionUtils } from './expressionUtils';
import { ImportType } from './importResult';
import { DefaultTypeSourceId, TypeSourceId } from './inferredType';
import { ParseTreeUtils } from './parseTreeUtils';
import { ParseTreeWalker } from './parseTreeWalker';
import { Scope, ScopeType } from './scope';
import { Declaration, SymbolCategory } from './symbol';
import { AnyType, ClassType, ClassTypeFlags, FunctionParameter, FunctionType,
    FunctionTypeFlags, ModuleType, Type, UnknownType } from './types';

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

    // Number of nested except statements at current point of analysis.
    // Used to determine if a naked "raise" statement is allowed.
    private _nestedExceptDepth = 0;

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
                '__package__', '__spec__', 'abs', 'all', 'any', 'ascii', 'bin', 'bool',
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
                this._fileInfo.isBuiltInStubFile) {

            classFlags |= ClassTypeFlags.BuiltInClass;
        }

        let classType = new ClassType(node.name.nameToken.value, classFlags,
            AnalyzerNodeInfo.getTypeSourceId(node));

        // Don't walk the arguments for stub files because of forward
        // declarations.
        if (!this._fileInfo.isStubFile) {
            this.walkMultiple(node.arguments);
        }

        let sawMetaclass = false;
        let nonMetaclassBaseClassCount = 0;
        let evaluator = new ExpressionEvaluator(this._currentScope,
            this._fileInfo.configOptions, this._fileInfo.useStrictMode,
            this._fileInfo.executionEnvironment, this._fileInfo.diagnosticSink);
        node.arguments.forEach(arg => {
            let argType: Type;

            if (this._fileInfo.isStubFile) {
                // For stub files, we won't try to evaluate the type at this
                // time because forward declarations are supported in stub files.
                argType = UnknownType.create();
            } else {
                argType = evaluator.getType(arg.valueExpression,
                    { method: 'get' }, EvaluatorFlags.None);
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
                    this._addError(`Named parameter '${ arg.name.nameToken.value }' ` +
                        `not supported for classes`, arg);
                }
            }

            classType.addBaseClass(argType, isMetaclass);

            if (!isMetaclass) {
                nonMetaclassBaseClassCount++;
            }
        });

        if (nonMetaclassBaseClassCount === 0) {
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

        AnalyzerNodeInfo.setExpressionType(node, classType);
        AnalyzerNodeInfo.setExpressionType(node.name, classType);

        let analyzer = new ClassScopeAnalyzer(node, this._currentScope, classType, this._fileInfo);
        this._queueSubScopeAnalyzer(analyzer);

        // Don't bind the name of the class until after we've done the
        // first pass of its scope analysis. This guarantees that we'll flag
        // any references to the as-yet-undeclared class as an error.
        this._addSymbolToPermanentScope(node.name.nameToken.value, classType,
            AnalyzerNodeInfo.getTypeSourceId(node.name), node.name);
        this._assignTypeToSymbol(node.name, classType, declaration);

        return false;
    }

    visitFunction(node: FunctionNode): boolean {
        const containingClass = ParseTreeUtils.getEnclosingClass(node, true);

        // The "__new__" magic method is not an instance method.
        // It acts as a static method instead.
        let functionFlags = FunctionTypeFlags.None;
        if (node.name.nameToken.value === '__new__') {
            functionFlags |= FunctionTypeFlags.StaticMethod;
            functionFlags |= FunctionTypeFlags.ConstructorMethod;
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

            // If this is not a stub file, make sure the raw type annotation
            // doesn't reference a type that hasn't yet been declared.
            if (!this._fileInfo.isStubFile) {
                if (param.typeAnnotation) {
                    this.walk(param.typeAnnotation);
                }
            }
        });

        // If this is not a stub file, make sure the raw type annotation
        // doesn't reference a type that hasn't yet been declared.
        if (!this._fileInfo.isStubFile) {
            if (node.returnTypeAnnotation) {
                this.walk(node.returnTypeAnnotation);
            }
        }

        let declaration: Declaration = {
            category: containingClass ? SymbolCategory.Method : SymbolCategory.Function,
            node: node.name,
            path: this._fileInfo.filePath,
            range: convertOffsetsToRange(node.name.start, node.name.end, this._fileInfo.lines)
        };

        // Use an unknown type for now since we don't do any
        // decorator processing in this pass.
        this._addSymbolToPermanentScope(node.name.nameToken.value,
            UnknownType.create(), AnalyzerNodeInfo.getTypeSourceId(node.name));
        this._assignTypeToSymbol(node.name, UnknownType.create(), declaration);

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

    visitYield(node: YieldExpressionNode): boolean {
        this._validateYieldUsage(node);
        return true;
    }

    visitYieldFrom(node: YieldFromExpressionNode): boolean {
        this._validateYieldUsage(node);
        return true;
    }

    visitFor(node: ForNode): boolean {
        this.walk(node.iterableExpression);

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
                    this.walk(compr.iterableExpression);

                    this._addNamedTargetToCurrentScope(compr.targetExpression);
                } else {
                    this.walk(compr.testExpression);
                }
            });

            this.walk(node.baseExpression);
        });

        return false;
    }

    visitIf(node: IfNode): boolean {
        this._handleIfWhileCommon(node.testExpression, node.ifSuite, node.elseSuite);
        return false;
    }

    visitWhile(node: WhileNode): boolean {
        this._handleIfWhileCommon(node.testExpression, node.whileSuite, node.elseSuite);
        return false;
    }

    visitReturn(node: ReturnNode): boolean {
        this._currentScope.setAlwaysReturns();
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

    visitExcept(node: ExceptNode): boolean {
        if (node.typeExpression) {
            this.walk(node.typeExpression);
        }

        let exceptScope: Scope | undefined;
        this._enterTemporaryScope(() => {
            if (node.typeExpression && node.name) {
                this._addNamedTargetToCurrentScope(node.name);
                this._assignTypeToSymbol(node.name, UnknownType.create());
            }

            exceptScope = this._enterTemporaryScope(() => {
                this.walk(node.exceptSuite);
            });
        });

        this._currentScope.mergeSymbolTable(exceptScope!);

        return false;
    }

    visitTry(node: TryNode): boolean {
        let alwaysRaisesBeforeTry = this._currentScope.getAlwaysRaises();

        this.walk(node.trySuite);

        let allPathsRaise = true;

        // Wrap the except clauses in a conditional scope
        // so we can throw away any names that are bound
        // in this scope.
        this._nestedExceptDepth++;
        node.exceptClauses.forEach(exceptNode => {
            const exceptScope = this._enterTemporaryScope(() => {
                this.walk(exceptNode);
            });

            if (!exceptScope.getAlwaysRaises()) {
                allPathsRaise = false;
            }
        });
        this._nestedExceptDepth--;

        if (node.elseSuite) {
            let elseScope = this._enterTemporaryScope(() => {
                this.walk(node.elseSuite!);
            });

            this._currentScope.mergeSymbolTable(elseScope);

            if (!elseScope.getAlwaysRaises()) {
                allPathsRaise = false;
            }
        }

        // If we can't prove that exceptions will propagate beyond
        // the try/catch block. clear the "alwyas raises" condition.
        if (alwaysRaisesBeforeTry || allPathsRaise) {
            this._currentScope.setAlwaysRaises();
        } else {
            this._currentScope.clearAlwaysRaises();
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

        this._assignTypeForTargetExpression(node.leftExpression);

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

    visitString(node: StringNode): boolean {
        for (let stringToken of node.tokens) {
            if (stringToken.flags & StringTokenFlags.Unterminated) {
                this._addError('String literal is unterminated', stringToken);
            }

            if (stringToken.flags & StringTokenFlags.NonAsciiInBytes) {
                this._addError('Non-ASCII character not allowed in bytes string literal', stringToken);
            }

            if (stringToken.flags & StringTokenFlags.UnrecognizedEscape) {
                if (stringToken.invalidEscapeOffsets) {
                    stringToken.invalidEscapeOffsets.forEach(offset => {
                        const textRange = new TextRange(stringToken.start + offset, 1);
                        this._addDiagnostic(this._fileInfo.configOptions.reportInvalidStringEscapeSequence,
                            'Unsupported escape sequence in string literal', textRange);
                    });
                }
            }
        }

        // Don't explore the parsed forward reference in
        // a string node because this pass of the analyzer
        // isn't capable of handling forward references.
        return false;
    }

    visitImportAs(node: ImportAsNode): boolean {
        if (node.alias || node.module.nameParts.length > 0) {
            let nameNode = node.alias ? node.alias : node.module.nameParts[0];
            this._assignTypeToSymbol(nameNode, UnknownType.create());
        }
        return true;
    }

    visitImportFromAs(node: ImportFromAsNode): boolean {
        let nameNode = node.alias ? node.alias : node.name;
        this._assignTypeToSymbol(nameNode, UnknownType.create());

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

    visitTypeAnnotation(node: TypeAnnotationExpressionNode): boolean {
        // For now, the type is unknown. We'll fill in the type during
        // the type hint phase.
        this._assignTypeForTargetExpression(node.valueExpression);

        this.walk(node.valueExpression);

        // If this is not a stub file, make sure the raw type annotation
        // doesn't reference a type that hasn't yet been declared.
        if (!this._fileInfo.isStubFile) {
            this.walk(node.typeAnnotation);
        }

        return false;
    }

    visitError(node: ErrorExpressionNode) {
        // Don't analyze an error node.
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
                    this._assignTypeToSymbol(param.name, UnknownType.create());
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

    private _assignTypeForTargetExpression(node: ExpressionNode) {
        if (node instanceof NameNode) {
            this._assignTypeToSymbol(node, UnknownType.create());
        } else if (node instanceof TypeAnnotationExpressionNode) {
            this._assignTypeForTargetExpression(node.valueExpression);
        } else if (node instanceof TupleExpressionNode) {
            node.expressions.forEach(expr => {
                this._assignTypeForTargetExpression(expr);
            });
        } else if (node instanceof ListNode) {
            node.entries.forEach(expr => {
                this._assignTypeForTargetExpression(expr);
            });
        }
    }

    protected _assignTypeToSymbol(nameNode: NameNode, type: Type,
            declaration?: Declaration) {

        const nameValue = nameNode.nameToken.value;

        // Add a new source to the symbol.
        const symbolWithScope = this._currentScope.lookUpSymbolRecursive(nameValue);
        if (symbolWithScope) {
            symbolWithScope.symbol.inferredType.addSource(type,
                AnalyzerNodeInfo.getTypeSourceId(nameNode));

            // Add the declaration if provided.
            if (declaration) {
                symbolWithScope.symbol.addDeclaration(declaration);
            }
        } else {
            // We should never get here!
            assert.fail('Missing symbol');
        }
    }

    protected _addNamedTargetToCurrentScope(node: ExpressionNode) {
        if (node instanceof NameNode) {
            this._currentScope.addUnboundSymbol(node.nameToken.value);
        } else if (node instanceof TypeAnnotationExpressionNode) {
            this._addNamedTargetToCurrentScope(node.valueExpression);
        } else if (node instanceof TupleExpressionNode) {
            node.expressions.forEach(expr => {
                this._addNamedTargetToCurrentScope(expr);
            });
        } else if (node instanceof ListNode) {
            node.entries.forEach(expr => {
                this._addNamedTargetToCurrentScope(expr);
            });
        }
    }

    // Finds the nearest permanent scope (as opposed to temporary scope) and
    // adds a new symbol with the specified name if it doesn't already exist.
    protected _addSymbolToPermanentScope(nameValue: string, type: Type,
            typeSourceId: TypeSourceId, warnIfDuplicateNode?: NameNode) {

        const permanentScope = ScopeUtils.getPermanentScope(this._currentScope);
        assert(permanentScope.getType() !== ScopeType.Temporary);

        let symbol = permanentScope.lookUpSymbol(nameValue);

        if (!symbol) {
            symbol = this._currentScope.addUnboundSymbol(nameValue);
        } else if (warnIfDuplicateNode) {
            if (symbol.inferredType.getSourceCount() > 0) {
                this._fileInfo.diagnosticSink.addWarningWithTextRange(
                    `'${ nameValue }' is already defined`, warnIfDuplicateNode);
            }
        }

        symbol.inferredType.addSource(type, typeSourceId);
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

    private _validateYieldUsage(node: YieldExpressionNode | YieldFromExpressionNode) {
        const functionNode = ParseTreeUtils.getEnclosingFunction(node);

        if (!functionNode) {
            this._addError(
                `'yield' not allowed outside of a function`, node);
        } else if (functionNode.isAsync) {
            this._addError(
                `'yield' not allowed in an async function`, node);
        }
    }

    private _handleIfWhileCommon(testExpression: ExpressionNode, ifWhileSuite: SuiteNode,
            elseSuite: SuiteNode | IfNode | undefined) {

        this.walk(testExpression);

        // Determine if the if condition is always true or always false. If so,
        // we can treat either the if or the else clause as unconditional.
        let constExprValue = ExpressionUtils.evaluateConstantExpression(
            testExpression, this._fileInfo.executionEnvironment);

        // Push a temporary scope so we can track
        // which variables have been assigned to conditionally.
        const ifScope = this._enterTemporaryScope(() => {
            if (constExprValue !== false) {
                this.walk(ifWhileSuite);
            }
        }, true, constExprValue === false);

        // Now handle the else statement if it's present. If there
        // are chained "else if" statements, they'll be handled
        // recursively here.
        const elseScope = this._enterTemporaryScope(() => {
            if (elseSuite && constExprValue !== true) {
                this.walk(elseSuite);
            }
        }, true, constExprValue === true);

        let isUnconditional = false;
        if (constExprValue !== undefined) {
            isUnconditional = true;
            if (constExprValue) {
                ifScope.setUnconditional();
            } else {
                elseScope.setUnconditional();
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

        if (ifScope.getAlwaysReturnsOrRaises()) {
            elseScope.setUnconditional();
            isUnconditional = true;
        }

        if (elseScope.getAlwaysReturnsOrRaises()) {
            ifScope.setUnconditional();
            isUnconditional = true;
        }

        // Figure out how to combine the scopes.
        if (!isUnconditional) {
            // If both an "if" and an "else" scope are conditional, combine the two scopes.
            const combinedScope = Scope.combineConditionalScopes(ifScope, elseScope);
            this._currentScope.mergeSymbolTable(combinedScope);
        } else if (!ifScope.isConditional()) {
            this._currentScope.mergeSymbolTable(ifScope);
        } else if (!elseScope.isConditional()) {
            this._currentScope.mergeSymbolTable(elseScope);
        }

        return false;
    }

    private _queueSubScopeAnalyzer(analyzer: SemanticAnalyzer) {
        analyzer.analyzeImmediate();
        this._subscopesToAnalyze.push(analyzer);
    }

    private _addDiagnostic(diagLevel: DiagnosticLevel, message: string, textRange: TextRange) {
        if (diagLevel === 'error' || this._fileInfo.useStrictMode) {
            this._addError(message, textRange);
        } else if (diagLevel === 'warning') {
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
        this._addSymbolToPermanentScope('__name__',
            ScopeUtils.getBuiltInObject(this._currentScope, 'str'), DefaultTypeSourceId);
        this._addSymbolToPermanentScope('__loader__',
            AnyType.create(), DefaultTypeSourceId);
        this._addSymbolToPermanentScope('__package__',
            ScopeUtils.getBuiltInObject(this._currentScope, 'str'), DefaultTypeSourceId);
        this._addSymbolToPermanentScope('__spec__',
            AnyType.create(), DefaultTypeSourceId);
        this._addSymbolToPermanentScope('__path__',
            ScopeUtils.getBuiltInObject(this._currentScope, 'str'), DefaultTypeSourceId);
        this._addSymbolToPermanentScope('__file__',
            ScopeUtils.getBuiltInObject(this._currentScope, 'str'), DefaultTypeSourceId);
        this._addSymbolToPermanentScope('__cached__',
            ScopeUtils.getBuiltInObject(this._currentScope, 'str'), DefaultTypeSourceId);
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

        this.walk(classNode.suite);

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
        this._addSymbolToPermanentScope('__class__',
            classType!, DefaultTypeSourceId);
        this._addSymbolToPermanentScope('__dict__',
            AnyType.create(), DefaultTypeSourceId);
        this._addSymbolToPermanentScope('__doc__',
            ScopeUtils.getBuiltInObject(this._currentScope, 'str'), DefaultTypeSourceId);
        this._addSymbolToPermanentScope('__name__',
            ScopeUtils.getBuiltInObject(this._currentScope, 'str'), DefaultTypeSourceId);
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

        // Walk the statements that make up the function.
        this.walk(functionNode.suite);

        // Analyze any sub-scopes that were discovered during the earlier pass.
        this._analyzeSubscopesDeferred();
    }

    private _bindImplicitNames() {
        // List taken from https://docs.python.org/3/reference/datamodel.html
        this._addSymbolToPermanentScope('__doc__',
            ScopeUtils.getBuiltInObject(this._currentScope, 'str'), DefaultTypeSourceId);
        this._addSymbolToPermanentScope('__name__',
            ScopeUtils.getBuiltInObject(this._currentScope, 'str'), DefaultTypeSourceId);
        if (this._fileInfo.executionEnvironment.pythonVersion >= PythonVersion.V33) {
            this._addSymbolToPermanentScope('__qualname__',
                ScopeUtils.getBuiltInObject(this._currentScope, 'str'), DefaultTypeSourceId);
        }
        this._addSymbolToPermanentScope('__module__',
            ScopeUtils.getBuiltInObject(this._currentScope, 'str'), DefaultTypeSourceId);
        this._addSymbolToPermanentScope('__defaults__',
            AnyType.create(), DefaultTypeSourceId);
        this._addSymbolToPermanentScope('__code__',
            AnyType.create(), DefaultTypeSourceId);
        this._addSymbolToPermanentScope('__globals__',
            AnyType.create(), DefaultTypeSourceId);
        this._addSymbolToPermanentScope('__dict__',
            AnyType.create(), DefaultTypeSourceId);
        this._addSymbolToPermanentScope('__closure__',
            AnyType.create(), DefaultTypeSourceId);
        this._addSymbolToPermanentScope('__annotations__',
            AnyType.create(), DefaultTypeSourceId);
        this._addSymbolToPermanentScope('__kwdefaults__',
            AnyType.create(), DefaultTypeSourceId);
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

        // Walk the expression that make up the lambda body.
        this.walk(lambdaNode.expression);

        // Analyze any sub-scopes that were discovered during the earlier pass.
        this._analyzeSubscopesDeferred();
    }
}
