/*
 * checker.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Unit tests for pyright type checker and type analyzer.
 */

import * as assert from 'assert';

import * as AnalyzerNodeInfo from '../analyzer/analyzerNodeInfo';
import { ScopeType } from '../analyzer/scope';
import { ConfigOptions } from '../common/configOptions';
import { PythonVersion } from '../common/pythonVersion';
import * as TestUtils from './testUtils';

test('Builtins1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['builtins1.py']);

    assert.equal(analysisResults.length, 1);
    assert.notEqual(analysisResults[0].parseResults, undefined);
    assert.equal(analysisResults[0].errors.length, 0);
    assert.equal(analysisResults[0].warnings.length, 0);

    // This list comes from python directly.
    // `python`
    // `import builtins
    // `dir(builtins)`
    // Remove True, False, None, _, __build_class__, __debug__, __doc__
    const expectedBuiltinsSymbols = [
        'ArithmeticError',
        'AssertionError',
        'AttributeError',
        'BaseException',
        'BlockingIOError',
        'BrokenPipeError',
        'BufferError',
        'BytesWarning',
        'ChildProcessError',
        'ConnectionAbortedError',
        'ConnectionError',
        'ConnectionRefusedError',
        'ConnectionResetError',
        'DeprecationWarning',
        'EOFError',
        'Ellipsis',
        'EnvironmentError',
        'Exception',
        'FileExistsError',
        'FileNotFoundError',
        'FloatingPointError',
        'FutureWarning',
        'GeneratorExit',
        'IOError',
        'ImportError',
        'ImportWarning',
        'IndentationError',
        'IndexError',
        'InterruptedError',
        'IsADirectoryError',
        'KeyError',
        'KeyboardInterrupt',
        'LookupError',
        'ModuleNotFoundError',
        'MemoryError',
        'NameError',
        'NotADirectoryError',
        'NotImplemented',
        'NotImplementedError',
        'OSError',
        'OverflowError',
        'PendingDeprecationWarning',
        'PermissionError',
        'ProcessLookupError',
        'RecursionError',
        'ReferenceError',
        'ResourceWarning',
        'RuntimeError',
        'RuntimeWarning',
        'StopAsyncIteration',
        'StopIteration',
        'SyntaxError',
        'SyntaxWarning',
        'SystemError',
        'SystemExit',
        'TabError',
        'TimeoutError',
        'TypeError',
        'UnboundLocalError',
        'UnicodeDecodeError',
        'UnicodeEncodeError',
        'UnicodeError',
        'UnicodeTranslateError',
        'UnicodeWarning',
        'UserWarning',
        'ValueError',
        'Warning',
        'WindowsError',
        'ZeroDivisionError',
        '__import__',
        '__loader__',
        '__name__',
        '__package__',
        '__spec__',
        'abs',
        'all',
        'any',
        'ascii',
        'bin',
        'bool',
        'breakpoint',
        'bytearray',
        'bytes',
        'callable',
        'chr',
        'classmethod',
        'compile',
        'complex',
        'copyright',
        'credits',
        'delattr',
        'dict',
        'dir',
        'divmod',
        'enumerate',
        'eval',
        'exec',
        'exit',
        'filter',
        'float',
        'format',
        'frozenset',
        'getattr',
        'globals',
        'hasattr',
        'hash',
        'help',
        'hex',
        'id',
        'input',
        'int',
        'isinstance',
        'issubclass',
        'iter',
        'len',
        'license',
        'list',
        'locals',
        'map',
        'max',
        'memoryview',
        'min',
        'next',
        'object',
        'oct',
        'open',
        'ord',
        'pow',
        'print',
        'property',
        'quit',
        'range',
        'repr',
        'reversed',
        'round',
        'set',
        'setattr',
        'slice',
        'sorted',
        'staticmethod',
        'str',
        'sum',
        'super',
        'tuple',
        'type',
        'vars',
        'zip',
        // These really shouldn't be exposed but are defined by builtins.pyi currently.
        'function',
        'ellipsis'
    ];

    const moduleScope = AnalyzerNodeInfo.getScope(analysisResults[0].parseResults!.parseTree)!;
    assert.notEqual(moduleScope, undefined);

    const builtinsScope = moduleScope.parent!;
    assert.notEqual(builtinsScope, undefined);
    assert.equal(builtinsScope.type, ScopeType.Builtin);

    // Make sure all the expected symbols are present.
    const builtinsSymbolTable = builtinsScope.symbolTable;
    for (const symbolName of expectedBuiltinsSymbols) {
        const symbol = moduleScope.lookUpSymbolRecursive(symbolName);
        if (symbol === undefined) {
            assert.fail(`${symbolName} is missing from builtins scope`);
        }
    }

    // Make sure the builtins scope doesn't contain symbols that
    // shouldn't be present.
    const symbolMap = new Map<string, string>();
    for (const symbolName of expectedBuiltinsSymbols) {
        symbolMap.set(symbolName, symbolName);
    }

    for (const builtinName of builtinsSymbolTable.keys()) {
        const symbolInfo = moduleScope.lookUpSymbolRecursive(builtinName);
        if (symbolInfo && symbolInfo.isBeyondExecutionScope) {
            if (symbolMap.get(builtinName) === undefined) {
                assert.fail(`${builtinName} should not be in builtins scope`);
            }
        }
    }
});

function validateResults(results: TestUtils.FileAnalysisResult[], errorCount: number, warningCount = 0) {
    assert.equal(results.length, 1);
    assert.equal(results[0].errors.length, errorCount);
    assert.equal(results[0].warnings.length, warningCount);
}

test('BadToken1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['badToken1.py']);

    // We include this in the checker test rather than the tokenizer or
    // parser test suite because it has cascading effects that potentially
    // affect the type checker logic.
    validateResults(analysisResults, 1);
});

test('Complex1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['complex1.py']);
    validateResults(analysisResults, 0);
});

test('TypeConstraint1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeConstraint1.py']);

    validateResults(analysisResults, 6);
});

test('TypeConstraint2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeConstraint2.py']);

    validateResults(analysisResults, 8);
});

test('TypeConstraint3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeConstraint3.py']);

    validateResults(analysisResults, 1);
});

test('TypeConstraint4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeConstraint4.py']);

    validateResults(analysisResults, 2);
});

test('TypeConstraint5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeConstraint5.py']);

    validateResults(analysisResults, 0);
});

test('TypeConstraint6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeConstraint6.py']);

    validateResults(analysisResults, 1);
});

test('TypeConstraint7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeConstraint7.py']);

    validateResults(analysisResults, 0);
});

test('TypeConstraint8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeConstraint8.py']);

    validateResults(analysisResults, 0);
});

test('TypeConstraint9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeConstraint9.py']);

    validateResults(analysisResults, 0);
});

test('CircularBaseClass', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['circularBaseClass.py']);

    validateResults(analysisResults, 2);
});

test('ReturnTypes1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['returnTypes1.py']);

    validateResults(analysisResults, 2);
});

test('Specialization1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['specialization1.py']);

    validateResults(analysisResults, 7);
});

test('Specialization2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['specialization2.py']);

    validateResults(analysisResults, 0);
});

test('Expressions1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['expressions1.py']);

    validateResults(analysisResults, 4);
});

test('Expressions2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['expressions2.py']);

    validateResults(analysisResults, 1);
});

test('Expressions3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['expressions3.py']);

    validateResults(analysisResults, 1);
});

test('Unpack1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['unpack1.py']);

    validateResults(analysisResults, 1);
});

test('Unpack2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['unpack2.py']);

    validateResults(analysisResults, 1);
});

test('Lambda1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['lambda1.py']);

    validateResults(analysisResults, 5);
});

test('Function1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['function1.py']);

    validateResults(analysisResults, 5);
});

test('Function2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['function2.py']);

    validateResults(analysisResults, 6);
});

test('Function3', () => {
    const configOptions = new ConfigOptions('.');

    // Analyze with Python 3.7 settings. This will generate more errors.
    configOptions.defaultPythonVersion = PythonVersion.V37;
    const analysisResults37 = TestUtils.typeAnalyzeSampleFiles(['function3.py'], configOptions);
    validateResults(analysisResults37, 18);

    // Analyze with Python 3.8 settings.
    configOptions.defaultPythonVersion = PythonVersion.V38;
    const analysisResults38 = TestUtils.typeAnalyzeSampleFiles(['function3.py'], configOptions);
    validateResults(analysisResults38, 11);
});

test('Function4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['function4.py']);

    validateResults(analysisResults, 0);
});

test('Function5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['function5.py']);

    validateResults(analysisResults, 0);
});

test('Annotations1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['annotations1.py']);

    validateResults(analysisResults, 2);
});

test('Annotations2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['annotations2.py']);

    validateResults(analysisResults, 2);
});

test('Annotations3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['annotations3.py']);

    validateResults(analysisResults, 0);
});

test('Annotations4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['annotations4.py']);

    validateResults(analysisResults, 9);
});

test('AnnotatedVar1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['annotatedVar1.py']);

    validateResults(analysisResults, 2);
});

test('AnnotatedVar2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['annotatedVar2.py']);

    validateResults(analysisResults, 5);
});

test('AnnotatedVar3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['annotatedVar3.py']);

    validateResults(analysisResults, 7);
});

test('AnnotatedVar4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['annotatedVar4.py']);

    validateResults(analysisResults, 5);
});

test('AnnotatedVar5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['annotatedVar5.py']);

    validateResults(analysisResults, 5);
});

test('Execution1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['execution1.py']);

    validateResults(analysisResults, 2);
});

test('Properties1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['properties1.py']);

    validateResults(analysisResults, 5);
});

test('Properties2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['properties2.py']);

    validateResults(analysisResults, 2);
});

test('Properties3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['properties3.py']);

    validateResults(analysisResults, 4);
});

test('Properties4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['properties4.py']);

    validateResults(analysisResults, 0);
});

test('Operators1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['operators1.py']);

    validateResults(analysisResults, 3);
});

test('Operators2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['operators2.py']);

    validateResults(analysisResults, 1);
});

test('Optional1', () => {
    const configOptions = new ConfigOptions('.');

    // By default, optional diagnostics are ignored.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['optional1.py'], configOptions);
    validateResults(analysisResults, 0);

    // Turn on warnings.
    configOptions.diagnosticSettings.reportOptionalSubscript = 'warning';
    configOptions.diagnosticSettings.reportOptionalMemberAccess = 'warning';
    configOptions.diagnosticSettings.reportOptionalCall = 'warning';
    configOptions.diagnosticSettings.reportOptionalIterable = 'warning';
    configOptions.diagnosticSettings.reportOptionalContextManager = 'warning';
    configOptions.diagnosticSettings.reportOptionalOperand = 'warning';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['optional1.py'], configOptions);
    validateResults(analysisResults, 0, 7);

    // Turn on errors.
    configOptions.diagnosticSettings.reportOptionalSubscript = 'error';
    configOptions.diagnosticSettings.reportOptionalMemberAccess = 'error';
    configOptions.diagnosticSettings.reportOptionalCall = 'error';
    configOptions.diagnosticSettings.reportOptionalIterable = 'error';
    configOptions.diagnosticSettings.reportOptionalContextManager = 'error';
    configOptions.diagnosticSettings.reportOptionalOperand = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['optional1.py'], configOptions);
    validateResults(analysisResults, 7);
});

test('Private1', () => {
    const configOptions = new ConfigOptions('.');

    // By default, optional diagnostics are ignored.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['private1.py'], configOptions);
    validateResults(analysisResults, 0);

    // Turn on errors.
    configOptions.diagnosticSettings.reportPrivateUsage = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['private1.py'], configOptions);
    validateResults(analysisResults, 4);
});

test('Constant1', () => {
    const configOptions = new ConfigOptions('.');

    // By default, optional diagnostics are ignored.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['constant1.py'], configOptions);
    validateResults(analysisResults, 0);

    // Turn on errors.
    configOptions.diagnosticSettings.reportConstantRedefinition = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['constant1.py'], configOptions);
    validateResults(analysisResults, 5);
});

test('Tuples1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuples1.py']);

    validateResults(analysisResults, 8);
});

test('Tuples2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuples2.py']);

    validateResults(analysisResults, 3);
});

test('Tuples3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuples3.py']);

    validateResults(analysisResults, 2);
});

test('Tuples4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuples4.py']);

    validateResults(analysisResults, 0);
});

test('NamedTuples1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['namedTuples1.py']);

    validateResults(analysisResults, 6);
});

test('AbstractClass1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['abstractClass1.py']);

    validateResults(analysisResults, 2);
});

test('AbstractClass2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['abstractClass2.py']);

    validateResults(analysisResults, 1);
});

test('AbstractClass3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['abstractClass3.py']);

    validateResults(analysisResults, 0);
});

test('AbstractClass4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['abstractClass4.py']);

    validateResults(analysisResults, 1);
});

test('Module1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['module1.py']);

    validateResults(analysisResults, 0);
});

test('Module2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['module2.py']);

    validateResults(analysisResults, 0);
});

test('Ellipsis1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['ellipsis1.pyi']);

    validateResults(analysisResults, 10);
});

test('Generators1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generators1.py']);

    validateResults(analysisResults, 5);
});

test('Generators2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generators2.py']);

    validateResults(analysisResults, 2);
});

test('Generators3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generators3.py']);

    validateResults(analysisResults, 1);
});

test('Generators4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generators4.py']);

    validateResults(analysisResults, 0);
});

test('Generators5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generators5.py']);

    validateResults(analysisResults, 0);
});

test('Generators6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generators6.py']);

    validateResults(analysisResults, 0);
});

test('Coroutines1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['coroutines1.py']);

    validateResults(analysisResults, 3);
});

test('Loops1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops1.py']);

    validateResults(analysisResults, 2);
});

test('Constants1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constants1.py']);

    validateResults(analysisResults, 20);
});

test('NoReturn1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['noreturn1.py']);

    validateResults(analysisResults, 3);
});

test('With1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['with1.py']);

    validateResults(analysisResults, 2);
});

test('ForLoops1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['forLoops1.py']);

    validateResults(analysisResults, 2);
});

test('ListComprehension1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['listComprehension1.py']);

    validateResults(analysisResults, 1);
});

test('ListComprehension2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['listComprehension2.py']);

    validateResults(analysisResults, 0);
});

test('ListComprehension3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['listComprehension3.py']);

    validateResults(analysisResults, 0);
});

test('ListComprehension4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['listComprehension4.py']);

    validateResults(analysisResults, 0);
});

test('SetComprehension1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['setComprehension1.py']);

    validateResults(analysisResults, 1);
});

test('Literals1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['literals1.py']);

    validateResults(analysisResults, 6);
});

test('Literals2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['literals2.py']);

    validateResults(analysisResults, 3);
});

test('TypeAlias1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAlias1.py']);

    validateResults(analysisResults, 0);
});

test('TypeAlias2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAlias2.py']);

    validateResults(analysisResults, 0);
});

test('Dictionary1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dictionary1.py']);

    validateResults(analysisResults, 2);
});

test('Classes1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classes1.py']);

    validateResults(analysisResults, 1);
});

test('Classes2', () => {
    const configOptions = new ConfigOptions('.');

    // By default, optional diagnostics are ignored.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['classes2.py'], configOptions);
    validateResults(analysisResults, 0);

    // Turn on errors.
    configOptions.diagnosticSettings.reportIncompatibleMethodOverride = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['classes2.py'], configOptions);
    validateResults(analysisResults, 2);
});

test('Mro1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['mro1.py']);

    validateResults(analysisResults, 1);
});

test('Mro2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['mro2.py']);

    validateResults(analysisResults, 1);
});

test('Enums1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['enums1.py']);

    validateResults(analysisResults, 3);
});

test('Enums2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['enums2.py']);

    validateResults(analysisResults, 0);
});

test('CallbackPrototype1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['callbackPrototype1.py']);

    validateResults(analysisResults, 3);
});

test('Assignment1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignment1.py']);

    validateResults(analysisResults, 7);
});

test('Assignment2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignment2.py']);

    validateResults(analysisResults, 2);
});

test('Assignment3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignment3.py']);

    validateResults(analysisResults, 4);
});

test('Assignment4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignment4.py']);

    validateResults(analysisResults, 0);
});

test('Assignment5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignment5.py']);

    validateResults(analysisResults, 0);
});

test('Assignment6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignment6.py']);

    validateResults(analysisResults, 1);
});

test('AugmentedAssignment1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['augmentedAssignment1.py']);

    validateResults(analysisResults, 3);
});

test('DefaultInitializer1', () => {
    const configOptions = new ConfigOptions('.');

    // By default, optional diagnostics are ignored.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['defaultInitializer1.py'], configOptions);
    validateResults(analysisResults, 0);

    // Turn on errors.
    configOptions.diagnosticSettings.reportCallInDefaultInitializer = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['defaultInitializer1.py'], configOptions);
    validateResults(analysisResults, 2);
});

test('Super1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['super1.py']);

    validateResults(analysisResults, 4);
});

test('NewType1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['newType1.py']);

    validateResults(analysisResults, 1);
});

test('UnnecessaryIsInstance1', () => {
    const configOptions = new ConfigOptions('.');

    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['unnecessaryIsInstance1.py'], configOptions);
    validateResults(analysisResults, 1);

    // Turn on errors.
    configOptions.diagnosticSettings.reportUnnecessaryIsInstance = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['unnecessaryIsInstance1.py'], configOptions);
    validateResults(analysisResults, 4);
});

test('UnnecessaryIsSubclass1', () => {
    const configOptions = new ConfigOptions('.');

    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['unnecessaryIsSubclass1.py'], configOptions);
    validateResults(analysisResults, 0);

    // Turn on errors.
    configOptions.diagnosticSettings.reportUnnecessaryIsInstance = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['unnecessaryIsSubclass1.py'], configOptions);
    validateResults(analysisResults, 3);
});

test('Unbound1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['unbound1.py']);

    validateResults(analysisResults, 1);
});

test('UnnecessaryCast', () => {
    const configOptions = new ConfigOptions('.');

    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['unnecessaryCast1.py'], configOptions);
    validateResults(analysisResults, 0);

    // Turn on errors.
    configOptions.diagnosticSettings.reportUnnecessaryCast = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['unnecessaryCast1.py'], configOptions);
    validateResults(analysisResults, 1);
});

test('AssertAlwaysTrue', () => {
    const configOptions = new ConfigOptions('.');

    // By default, this is reported as a warning.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['assert1.py'], configOptions);
    validateResults(analysisResults, 0, 1);

    // Enable it as an error.
    configOptions.diagnosticSettings.reportAssertAlwaysTrue = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['assert1.py'], configOptions);
    validateResults(analysisResults, 1, 0);

    // Turn off the diagnostic.
    configOptions.diagnosticSettings.reportAssertAlwaysTrue = 'none';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['assert1.py'], configOptions);
    validateResults(analysisResults, 0, 0);
});

test('RevealedType1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['revealedType1.py']);

    validateResults(analysisResults, 0, 3);
});

test('NameBindings1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['nameBindings1.py']);

    validateResults(analysisResults, 4);
});

test('GenericTypes1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes1.py']);

    validateResults(analysisResults, 2);
});

test('GenericTypes2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes2.py']);

    validateResults(analysisResults, 1);
});

test('GenericTypes3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes3.py']);

    validateResults(analysisResults, 0);
});

test('GenericTypes4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes4.py']);

    validateResults(analysisResults, 5);
});

test('GenericTypes5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes5.py']);

    validateResults(analysisResults, 3);
});

test('GenericTypes6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes6.py']);

    validateResults(analysisResults, 1);
});

test('GenericTypes7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes7.py']);

    validateResults(analysisResults, 0);
});

test('GenericTypes8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes8.py']);

    validateResults(analysisResults, 0);
});

test('GenericTypes9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes9.py']);

    validateResults(analysisResults, 1);
});

test('GenericTypes10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes10.py']);

    validateResults(analysisResults, 1);
});

test('GenericTypes11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes11.py']);

    validateResults(analysisResults, 0);
});

test('GenericTypes12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes12.py']);

    validateResults(analysisResults, 1);
});

test('GenericTypes13', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes13.py']);

    validateResults(analysisResults, 0);
});

test('GenericTypes14', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes14.py']);

    validateResults(analysisResults, 1);
});

test('GenericTypes15', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes15.py']);

    validateResults(analysisResults, 0);
});

test('GenericTypes16', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes16.py']);

    validateResults(analysisResults, 0);
});

test('GenericTypes17', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes17.py']);

    validateResults(analysisResults, 1);
});

test('GenericTypes18', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes18.py']);

    validateResults(analysisResults, 4);
});

test('GenericTypes19', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes19.py']);

    validateResults(analysisResults, 0);
});

test('Protocol1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol1.py']);

    validateResults(analysisResults, 2);
});

test('Protocol2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol2.py']);

    validateResults(analysisResults, 0);
});

test('Protocol3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol3.py']);

    validateResults(analysisResults, 1);
});

test('Protocol4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol4.py']);

    validateResults(analysisResults, 2);
});

test('Protocol5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol5.py']);

    validateResults(analysisResults, 0);
});

test('Protocol6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol6.py']);

    validateResults(analysisResults, 2);
});

test('TypedDict1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict1.py']);

    validateResults(analysisResults, 6);
});

test('TypedDict2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict2.py']);

    validateResults(analysisResults, 4);
});

test('TypedDict3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict3.py']);

    validateResults(analysisResults, 4);
});

test('TypedDict4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict4.py']);

    validateResults(analysisResults, 7);
});

test('TypedDict5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict5.py']);

    validateResults(analysisResults, 3);
});

test('TypedDict6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict6.py']);

    validateResults(analysisResults, 12);
});

test('TypedDict7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict7.py']);

    validateResults(analysisResults, 0);
});

test('TypedDict8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict8.py']);

    validateResults(analysisResults, 2);
});

test('TypedDict9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict9.py']);

    validateResults(analysisResults, 1);
});

test('TypeIgnore1', () => {
    const configOptions = new ConfigOptions('.');

    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeIgnore1.py'], configOptions);
    validateResults(analysisResults, 0);

    // Disable type ignore
    configOptions.diagnosticSettings.enableTypeIgnoreComments = false;
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeIgnore1.py'], configOptions);
    validateResults(analysisResults, 2);
});

test('TypeIgnore2', () => {
    const configOptions = new ConfigOptions('.');

    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeIgnore2.py'], configOptions);
    validateResults(analysisResults, 0);

    // Disable type ignore
    configOptions.diagnosticSettings.enableTypeIgnoreComments = false;
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeIgnore2.py'], configOptions);
    validateResults(analysisResults, 3);
});

test('Metaclass1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['metaclass1.py']);
    validateResults(analysisResults, 0);
});

test('AssignmentExpr1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignmentExpr1.py']);
    validateResults(analysisResults, 4);
});

test('AssignmentExpr2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignmentExpr2.py']);
    validateResults(analysisResults, 5);
});

test('AssignmentExpr3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignmentExpr3.py']);
    validateResults(analysisResults, 3);
});

test('AssignmentExpr4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignmentExpr4.py']);
    validateResults(analysisResults, 17);
});

test('AssignmentExpr5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignmentExpr5.py']);
    validateResults(analysisResults, 0);
});

test('Import1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['import1.py']);
    validateResults(analysisResults, 0);
});

test('Import2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['import2.py']);
    validateResults(analysisResults, 2);
});

test('Import4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['import4.py']);
    validateResults(analysisResults, 1);
});

test('Import6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['import6.py']);
    validateResults(analysisResults, 2);
});

test('Import7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['import7.py']);
    validateResults(analysisResults, 2);
});

test('Import9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['import9.py']);
    validateResults(analysisResults, 0);
});

test('Overload1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overload1.py']);
    validateResults(analysisResults, 2);
});

test('Overload2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overload2.py']);
    validateResults(analysisResults, 0);
});

test('Final1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['final1.py']);
    validateResults(analysisResults, 1);
});

test('Final2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['final2.py']);
    validateResults(analysisResults, 2);
});

test('Final3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['final3.py']);
    validateResults(analysisResults, 12);
});

test('InferredTypes1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['inferredTypes1.py']);
    validateResults(analysisResults, 0);
});

test('CallSite2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['callSite2.py']);
    validateResults(analysisResults, 0);
});

test('DuplicateImports1', () => {
    const configOptions = new ConfigOptions('.');

    // By default, optional diagnostics are ignored.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['duplicateImports1.py'], configOptions);
    validateResults(analysisResults, 0);

    // Turn on errors.
    configOptions.diagnosticSettings.reportDuplicateImport = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['duplicateImports1.py'], configOptions);
    validateResults(analysisResults, 2);
});

test('FString2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['fstring2.py']);
    validateResults(analysisResults, 0);
});

test('FString3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['fstring3.py']);
    validateResults(analysisResults, 0);
});

test('MemberAccess1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['memberAccess1.py']);
    validateResults(analysisResults, 0);
});

test('MemberAccess2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['memberAccess2.py']);
    validateResults(analysisResults, 0);
});

test('ParamName1', () => {
    const configOptions = new ConfigOptions('.');

    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['paramNames1.py'], configOptions);
    validateResults(analysisResults, 0, 4);

    configOptions.diagnosticSettings.reportSelfClsParameterName = 'none';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['paramNames1.py'], configOptions);
    validateResults(analysisResults, 0, 0);

    configOptions.diagnosticSettings.reportSelfClsParameterName = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['paramNames1.py'], configOptions);
    validateResults(analysisResults, 4, 0);
});

test('DataClass8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclass8.py']);

    validateResults(analysisResults, 0);
});

test('Python2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['python2.py']);

    validateResults(analysisResults, 6);
});

test('InconsistentSpaceTab', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['inconsistentSpaceTab.py']);

    validateResults(analysisResults, 4);
});
