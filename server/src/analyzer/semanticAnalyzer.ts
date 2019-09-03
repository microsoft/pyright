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
import { CreateTypeStubFileAction } from '../common/diagnostic';
import { PythonVersion } from '../common/pythonVersion';
import { TextRange } from '../common/textRange';
import { AwaitExpressionNode, ClassNode, ErrorExpressionNode,
    ExpressionNode, FunctionNode, GlobalNode, IfNode, LambdaNode, ModuleNameNode,
    ModuleNode, NonlocalNode, RaiseNode, StatementListNode, StatementNode,
    StringListNode, SuiteNode, TryNode, TypeAnnotationExpressionNode, WhileNode,
    YieldExpressionNode, YieldFromExpressionNode } from '../parser/parseNodes';
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

    // Indicates whether type annotations are evaluated at runtime
    // in the order in which they are encountered or whether their
    // evaluation is postponed. In type stub files, type annotations
    // are never evaluated at runtime.
    private _postponeAnnotationEvaluation: boolean;

    constructor(node: ScopedNode, scopeType: ScopeType, parentScope: Scope | undefined,
            fileInfo: AnalyzerFileInfo) {

        super();

        this._scopedNode = node;
        this._fileInfo = fileInfo;
        this._postponeAnnotationEvaluation = fileInfo.isStubFile ||
            fileInfo.futureImports.get('annotations') !== undefined;

        // Allocate a new scope and associate it with the node
        // we've been asked to analyze.
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
    abstract analyzeImmediate(): void;
    abstract analyzeDeferred(): void;

    visitModule(node: ModuleNode): boolean {
        // Tree walking should start with the children of
        // the node, so we should never get here.
        assert.fail('We should never get here');
        return false;
    }

    visitModuleName(node: ModuleNameNode): boolean {
        const importResult = AnalyzerNodeInfo.getImportInfo(node);
        assert(importResult !== undefined);
        if (importResult) {
            if (!importResult.isImportFound) {
                this._addDiagnostic(this._fileInfo.diagnosticSettings.reportMissingImports,
                    `Import '${ importResult.importName }' could not be resolved`, node);
            } else if (importResult.importType === ImportType.ThirdParty) {
                if (!importResult.isStubFile) {
                    const diagnostic = this._addDiagnostic(this._fileInfo.diagnosticSettings.reportMissingTypeStubs,
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
        if (this._currentScope.getType() === ScopeType.BuiltIn ||
                this._fileInfo.isTypingStubFile ||
                this._fileInfo.isBuiltInStubFile) {

            classFlags |= ClassTypeFlags.BuiltInClass;
        }

        const classType = new ClassType(node.name.nameToken.value, classFlags,
            AnalyzerNodeInfo.getTypeSourceId(node),
            this._getDocString(node.suite.statements));

        // Don't walk the arguments for stub files because of forward
        // declarations.
        if (!this._fileInfo.isStubFile) {
            this.walkMultiple(node.arguments);
        }

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
                classType.addBaseClass(UnknownType.create(), isMetaclass);

                if (!isMetaclass) {
                    nonMetaclassBaseClassCount++;
                }
            }
        });

        if (nonMetaclassBaseClassCount === 0) {
            const objectType = ScopeUtils.getBuiltInType(this._currentScope, 'object');
            // Make sure we don't have 'object' derive from itself. Infinite
            // recursion will result.
            if (!classType.isBuiltIn() || classType.getClassName() !== 'object') {
                classType.addBaseClass(objectType, false);
            }
        }

        AnalyzerNodeInfo.setExpressionType(node, classType);

        const analyzer = new ClassScopeAnalyzer(node, this._currentScope, classType, this._fileInfo);
        this._queueSubScopeAnalyzer(analyzer);

        // Add the class symbol. We do this in the semantic analyzer to speed
        // up overall analysis times. Without this, the type analyzer needs
        // to do more passes to resolve classes.
        this._addSymbolToPermanentScope(node.name.nameToken.value, classType,
            AnalyzerNodeInfo.getTypeSourceId(node.name));

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

        const functionType = new FunctionType(functionFlags,
            this._getDocString(node.suite.statements));

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

            functionType.addParameter(typeParam);

            // If this is not a stub file, make sure the raw type annotation
            // doesn't reference a type that hasn't yet been declared.
            if (!this._postponeAnnotationEvaluation) {
                if (param.typeAnnotation) {
                    this.walk(param.typeAnnotation);
                }
            }
        });

        // If this is not a stub file, make sure the raw type annotation
        // doesn't reference a type that hasn't yet been declared.
        if (!this._postponeAnnotationEvaluation) {
            if (node.returnTypeAnnotation) {
                this.walk(node.returnTypeAnnotation);
            }
        }

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

        const functionOrModuleScope = AnalyzerNodeInfo.getScope(functionOrModuleNode!);
        assert(functionOrModuleScope !== undefined);

        const analyzer = new FunctionScopeAnalyzer(node, functionOrModuleScope!, this._fileInfo);
        this._queueSubScopeAnalyzer(analyzer);
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

        const analyzer = new LambdaScopeAnalyzer(node, this._currentScope, this._fileInfo);
        this._queueSubScopeAnalyzer(analyzer);

        return false;
    }

    visitTypeAnnotation(node: TypeAnnotationExpressionNode): boolean {
        this.walk(node.valueExpression);
        if (!this._postponeAnnotationEvaluation) {
            this.walk(node.typeAnnotation);
        }

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

    visitIf(node: IfNode): boolean {
        this._handleIfWhileCommon(node.testExpression, node.ifSuite, node.elseSuite);
        return false;
    }

    visitWhile(node: WhileNode): boolean {
        this._handleIfWhileCommon(node.testExpression, node.whileSuite, node.elseSuite);
        return false;
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
                    const textRange = new TextRange(start, error.length);

                    if (error.errorType === UnescapeErrorType.InvalidEscapeSequence) {
                        this._addDiagnostic(this._fileInfo.diagnosticSettings.reportInvalidStringEscapeSequence,
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

        // Don't explore the parsed forward reference in
        // a string node because this pass of the analyzer
        // isn't capable of handling forward references.
        return false;
    }

    visitGlobal(node: GlobalNode): boolean {
        node.nameList.forEach(name => {
            const valueWithScope = this._currentScope.lookUpSymbolRecursive(name.nameToken.value);

            if (!valueWithScope || valueWithScope.scope.getType() !== ScopeType.Module) {
                this._addError(`No binding for global '${ name.nameToken.value }' found`, name);
            }
        });
        return true;
    }

    visitNonlocal(node: NonlocalNode): boolean {
        node.nameList.forEach(name => {
            const valueWithScope = this._currentScope.lookUpSymbolRecursive(name.nameToken.value);

            if (!valueWithScope || (valueWithScope.scope.getType() !== ScopeType.Function &&
                    valueWithScope.scope.getType() !== ScopeType.Class)) {

                this._addError(`No binding for nonlocal '${ name.nameToken.value }' found`, name);
            }
        });
        return true;
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
            let symbol = this._currentScope.lookUpSymbol(name);
            if (!symbol) {
                symbol = this._currentScope.addSymbol(name, true);
            }
        });
    }

    // Analyzes the subscopes that are discovered during the first analysis pass.
    protected _analyzeSubscopesDeferred() {
        for (const subscope of this._subscopesToAnalyze) {
            subscope.analyzeDeferred();
        }

        this._subscopesToAnalyze = [];
    }

    // Finds the nearest permanent scope (as opposed to temporary scope) and
    // adds a new symbol with the specified name if it doesn't already exist.
    protected _addSymbolToPermanentScope(nameValue: string, type: Type,
            typeSourceId = defaultTypeSourceId) {

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

        if (!(statemetns[0] instanceof StatementListNode)) {
            return undefined;
        }

        // If the first statement in the suite isn't a StringNode,
        // assume there is no docString.
        const statementList = statemetns[0] as StatementListNode;
        if (statementList.statements.length === 0 ||
                !(statementList.statements[0] instanceof StringListNode)) {
            return undefined;
        }

        const docStringNode = statementList.statements[0] as StringListNode;
        const docStringToken = docStringNode.strings[0].token;

        // Ignore f-strings.
        if ((docStringToken.flags & StringTokenFlags.Format) !== 0) {
            return undefined;
        }

        return DocStringUtils.decodeDocString(docStringNode.strings[0].value);
    }

    private _validateYieldUsage(node: YieldExpressionNode | YieldFromExpressionNode) {
        const functionNode = ParseTreeUtils.getEnclosingFunction(node);

        if (!functionNode) {
            this._addError(
                `'yield' not allowed outside of a function`, node);
        } else if (functionNode.isAsync && node instanceof YieldFromExpressionNode) {
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
        if (constExprValue !== false) {
            this.walk(ifWhileSuite);
        }

        // Now handle the else statement if it's present. If there
        // are chained "else if" statements, they'll be handled
        // recursively here.
        if (elseSuite && constExprValue !== true) {
            this.walk(elseSuite);
        }

        return false;
    }

    private _queueSubScopeAnalyzer(analyzer: SemanticAnalyzer) {
        analyzer.analyzeImmediate();
        this._subscopesToAnalyze.push(analyzer);
    }

    private _addDiagnostic(diagLevel: DiagnosticLevel, message: string, textRange: TextRange) {
        if (diagLevel === 'error') {
            return this._addError(message, textRange);
        } else if (diagLevel === 'warning') {
            return this._addWarning(message, textRange);
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

export class ModuleScopeAnalyzer extends SemanticAnalyzer {
    constructor(node: ModuleNode, fileInfo: AnalyzerFileInfo) {
        super(node, fileInfo.builtinsScope ? ScopeType.Module : ScopeType.BuiltIn,
            fileInfo.builtinsScope, fileInfo);
    }

    analyze() {
        this.analyzeImmediate();
        this.analyzeDeferred();
    }

    analyzeImmediate() {
        this._bindImplicitNames();
        const nameBindings = AnalyzerNodeInfo.getNameBindings(this._scopedNode);
        assert(nameBindings !== undefined);
        this._addNamesToScope(nameBindings!.getGlobalNames());

        this.walkChildren(this._scopedNode);

        // Associate the module's scope with the module type.
        const moduleType = new ModuleType(this._currentScope.getSymbolTable(),
            this._getDocString((this._scopedNode as ModuleNode).statements));
        AnalyzerNodeInfo.setExpressionType(this._scopedNode, moduleType);
    }

    analyzeDeferred() {
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

export class ClassScopeAnalyzer extends SemanticAnalyzer {
    private _classType: ClassType;

    constructor(node: ClassNode, parentScope: Scope, classType: ClassType, fileInfo: AnalyzerFileInfo) {
        super(node, ScopeType.Class, parentScope, fileInfo);
        this._classType = classType;
    }

    analyzeImmediate() {
        this._bindImplicitNames();
        const nameBindings = AnalyzerNodeInfo.getNameBindings(this._scopedNode);
        assert(nameBindings !== undefined);
        this._addNamesToScope(nameBindings!.getLocalNames());

        // Analyze the suite.
        const classNode = this._scopedNode as ClassNode;

        this.walk(classNode.suite);

        // Record the class fields for this class.
        this._classType.setClassFields(this._currentScope.getSymbolTable());
    }

    analyzeDeferred() {
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

export class FunctionScopeAnalyzer extends SemanticAnalyzer {
    constructor(node: FunctionNode, parentScope: Scope, fileInfo: AnalyzerFileInfo) {
        super(node, ScopeType.Function, parentScope, fileInfo);
    }

    analyzeImmediate() {
        this._bindImplicitNames();

        // Functions don't get analyzed immediately. They are analyzed in a deferred manner.
    }

    analyzeDeferred() {
        const functionNode = this._scopedNode as FunctionNode;

        // Add the names for this scope. They are initially unbound. We
        // do this because current versions of Python use static namespace
        // resolution for functions.
        const nameBindings = AnalyzerNodeInfo.getNameBindings(this._scopedNode);
        assert(nameBindings !== undefined);
        this._addNamesToScope(nameBindings!.getLocalNames());

        // Walk the statements that make up the function.
        this.walk(functionNode.suite);

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

export class LambdaScopeAnalyzer extends SemanticAnalyzer {
    constructor(node: LambdaNode, parentScope: Scope, fileInfo: AnalyzerFileInfo) {
        super(node, ScopeType.Function, parentScope, fileInfo);
    }

    analyzeImmediate() {
        // Lambdas don't get analyzed immediately. They are analyzed in a deferred manner.
    }

    analyzeDeferred() {
        const lambdaNode = this._scopedNode as LambdaNode;

        // Add the names for this scope. They are initially unbound. We
        // do this because current versions of Python use static namespace
        // resolution for functions.
        const nameBindings = AnalyzerNodeInfo.getNameBindings(this._scopedNode);
        assert(nameBindings !== undefined);
        this._addNamesToScope(nameBindings!.getLocalNames());

        // Walk the expression that make up the lambda body.
        this.walk(lambdaNode.expression);

        // Analyze any sub-scopes that were discovered during the earlier pass.
        this._analyzeSubscopesDeferred();
    }
}
