/*
 * typeEvaluator1.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Unit tests for pyright type evaluator. Tests are split
 * arbitrarily among multiple files so they can run in parallel.
 */

import * as assert from 'assert';

import * as AnalyzerNodeInfo from '../analyzer/analyzerNodeInfo';
import { ScopeType } from '../analyzer/scope';
import { ConfigOptions } from '../common/configOptions';
import { PythonVersion } from '../common/pythonVersion';
import * as TestUtils from './testUtils';

test('Builtins1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['builtins1.py']);

    assert.strictEqual(analysisResults.length, 1);
    assert.notStrictEqual(analysisResults[0].parseResults, undefined);
    assert.strictEqual(analysisResults[0].errors.length, 0);
    assert.strictEqual(analysisResults[0].warnings.length, 0);

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
        'ellipsis',
    ];

    const moduleScope = AnalyzerNodeInfo.getScope(analysisResults[0].parseResults!.parseTree)!;
    assert.notStrictEqual(moduleScope, undefined);

    const builtinsScope = moduleScope.parent!;
    assert.notStrictEqual(builtinsScope, undefined);
    assert.strictEqual(builtinsScope.type, ScopeType.Builtin);

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

test('Complex1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['complex1.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowing1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing1.py']);

    TestUtils.validateResults(analysisResults, 6);
});

test('TypeNarrowing2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing2.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('TypeNarrowing3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing3.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('TypeNarrowing4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing4.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('TypeNarrowing5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowing6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing6.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('TypeNarrowing7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing7.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowing8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing8.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowing9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing9.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowing10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing10.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowing11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing11.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowing12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing12.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowing13', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing13.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowing14', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing14.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowing15', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing15.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('TypeNarrowing16', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing16.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('TypeNarrowing17', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing17.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowing18', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing18.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('TypeNarrowing19', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing19.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowing20', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing20.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowing21', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing21.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('ReturnTypes1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['returnTypes1.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Specialization1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['specialization1.py']);

    TestUtils.validateResults(analysisResults, 7);
});

test('Specialization2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['specialization2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Expressions1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['expressions1.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('Expressions2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['expressions2.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Expressions3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['expressions3.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Expressions4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['expressions4.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Expressions5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['expressions5.py']);

    TestUtils.validateResults(analysisResults, 12);
});

test('Expressions6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['expressions6.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Expressions7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['expressions7.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Expressions8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['expressions8.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Unpack1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['unpack1.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Unpack2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['unpack2.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Unpack3', () => {
    const configOptions = new ConfigOptions('.');

    // Analyze with Python 3.7 settings.
    configOptions.defaultPythonVersion = PythonVersion.V3_7;
    const analysisResults37 = TestUtils.typeAnalyzeSampleFiles(['unpack3.py'], configOptions);
    TestUtils.validateResults(analysisResults37, 1);

    // Analyze with Python 3.8 settings.
    configOptions.defaultPythonVersion = PythonVersion.V3_8;
    const analysisResults38 = TestUtils.typeAnalyzeSampleFiles(['unpack3.py'], configOptions);
    TestUtils.validateResults(analysisResults38, 0);
});

test('Lambda1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['lambda1.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('Lambda2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['lambda2.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('Lambda3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['lambda3.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Function1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['function1.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('Function2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['function2.py']);

    TestUtils.validateResults(analysisResults, 8);
});

test('Function3', () => {
    const configOptions = new ConfigOptions('.');

    // Analyze with Python 3.7 settings. This will generate more errors.
    configOptions.defaultPythonVersion = PythonVersion.V3_7;
    const analysisResults37 = TestUtils.typeAnalyzeSampleFiles(['function3.py'], configOptions);
    TestUtils.validateResults(analysisResults37, 19);

    // Analyze with Python 3.8 settings.
    configOptions.defaultPythonVersion = PythonVersion.V3_8;
    const analysisResults38 = TestUtils.typeAnalyzeSampleFiles(['function3.py'], configOptions);
    TestUtils.validateResults(analysisResults38, 12);
});

test('Function4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['function4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Function5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['function5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Function6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['function6.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Function7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['function7.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('Function8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['function8.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Function9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['function9.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Function10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['function10.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Function11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['function11.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Function12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['function12.py']);

    TestUtils.validateResults(analysisResults, 0, 0, 0, 2);
});

test('Function13', () => {
    // Analyze with reportFunctionMemberAccess disabled.
    const analysisResult1 = TestUtils.typeAnalyzeSampleFiles(['function13.py']);
    TestUtils.validateResults(analysisResult1, 0);

    // Analyze with reportFunctionMemberAccess enabled.
    const configOptions = new ConfigOptions('.');
    configOptions.diagnosticRuleSet.reportFunctionMemberAccess = 'error';
    const analysisResult2 = TestUtils.typeAnalyzeSampleFiles(['function13.py'], configOptions);
    TestUtils.validateResults(analysisResult2, 3);
});

test('Function14', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['function14.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Function15', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['function15.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Annotations1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['annotations1.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('Annotations2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['annotations2.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Annotations3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['annotations3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Annotations4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['annotations4.py']);

    TestUtils.validateResults(analysisResults, 9);
});

test('Annotations5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['annotations5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('AnnotatedVar1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['annotatedVar1.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('AnnotatedVar2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['annotatedVar2.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('AnnotatedVar3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['annotatedVar3.py']);

    TestUtils.validateResults(analysisResults, 7);
});

test('AnnotatedVar4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['annotatedVar4.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('AnnotatedVar5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['annotatedVar5.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('AnnotatedVar6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['annotatedVar6.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('CodeFlow1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['codeFlow1.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('CodeFlow2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['codeFlow2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('CodeFlow3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['codeFlow3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('CodeFlow4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['codeFlow4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Properties1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['properties1.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('Properties2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['properties2.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Properties3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['properties3.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('Properties4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['properties4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Properties5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['properties5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Properties6', () => {
    // Analyze with reportPropertyTypeMismatch enabled.
    const analysisResult1 = TestUtils.typeAnalyzeSampleFiles(['properties6.py']);
    TestUtils.validateResults(analysisResult1, 2);

    // Analyze with reportPropertyTypeMismatch disabled.
    const configOptions = new ConfigOptions('.');
    configOptions.diagnosticRuleSet.reportPropertyTypeMismatch = 'none';
    const analysisResult2 = TestUtils.typeAnalyzeSampleFiles(['properties6.py'], configOptions);
    TestUtils.validateResults(analysisResult2, 0);
});

test('Properties7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['properties7.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Properties8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['properties8.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('Properties9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['properties9.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Properties10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['properties10.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Properties11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['properties11.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Operators1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['operators1.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Operators2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['operators2.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Operators3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['operators3.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Operators4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['operators4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Operators5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['operators5.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Optional1', () => {
    const configOptions = new ConfigOptions('.');

    // By default, optional diagnostics are ignored.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['optional1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    // Turn on warnings.
    configOptions.diagnosticRuleSet.reportOptionalSubscript = 'warning';
    configOptions.diagnosticRuleSet.reportOptionalMemberAccess = 'warning';
    configOptions.diagnosticRuleSet.reportOptionalCall = 'warning';
    configOptions.diagnosticRuleSet.reportOptionalIterable = 'warning';
    configOptions.diagnosticRuleSet.reportOptionalContextManager = 'warning';
    configOptions.diagnosticRuleSet.reportOptionalOperand = 'warning';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['optional1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0, 7);

    // Turn on errors.
    configOptions.diagnosticRuleSet.reportOptionalSubscript = 'error';
    configOptions.diagnosticRuleSet.reportOptionalMemberAccess = 'error';
    configOptions.diagnosticRuleSet.reportOptionalCall = 'error';
    configOptions.diagnosticRuleSet.reportOptionalIterable = 'error';
    configOptions.diagnosticRuleSet.reportOptionalContextManager = 'error';
    configOptions.diagnosticRuleSet.reportOptionalOperand = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['optional1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 7);
});

test('Tuples1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuples1.py']);

    TestUtils.validateResults(analysisResults, 10);
});

test('Tuples2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuples2.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Tuples3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuples3.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Tuples4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuples4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Tuples5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuples5.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Tuples6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuples6.py']);

    TestUtils.validateResults(analysisResults, 8);
});

test('Tuples7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuples7.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Tuples8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuples8.py']);

    TestUtils.validateResults(analysisResults, 11);
});

test('Tuples9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuples9.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Tuples10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuples10.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Tuples11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuples11.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Tuples12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuples12.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('NamedTuples1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['namedTuples1.py']);

    TestUtils.validateResults(analysisResults, 9);
});

test('NamedTuples2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['namedTuples2.py']);

    TestUtils.validateResults(analysisResults, 8);
});

test('NamedTuples3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['namedTuples3.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Module1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['module1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Module2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['module2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Ellipsis1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['ellipsis1.pyi']);

    TestUtils.validateResults(analysisResults, 10);
});

test('Generators1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generators1.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('Generators2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generators2.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Generators3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generators3.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Generators4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generators4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Generators5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generators5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Generators6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generators6.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Generators7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generators7.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Generators8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generators8.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Generators9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generators9.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Generators10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generators10.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Generators11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generators11.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Generators12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generators12.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Coroutines1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['coroutines1.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Coroutines2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['coroutines2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loops1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops1.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Loops2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loops3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loops4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loops5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loops6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops6.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('ForLoop1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['forLoop1.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('ForLoop2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['forLoop2.py']);

    TestUtils.validateResults(analysisResults, 7);
});

test('ListComprehension1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['listComprehension1.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('ListComprehension2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['listComprehension2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('ListComprehension3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['listComprehension3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('ListComprehension4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['listComprehension4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('ListComprehension5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['listComprehension5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('ListComprehension6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['listComprehension6.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('SetComprehension1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['setComprehension1.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Literals1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['literals1.py']);

    TestUtils.validateResults(analysisResults, 7);
});

test('Literals2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['literals2.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Literals3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['literals3.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('Literals4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['literals4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Literals5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['literals5.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('TypeAlias1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAlias1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeAlias2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAlias2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeAlias3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAlias3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeAlias4', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_9;
    const analysisResults3_9 = TestUtils.typeAnalyzeSampleFiles(['typeAlias4.py'], configOptions);
    TestUtils.validateResults(analysisResults3_9, 7);

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults3_10 = TestUtils.typeAnalyzeSampleFiles(['typeAlias4.py'], configOptions);
    TestUtils.validateResults(analysisResults3_10, 6);
});

test('TypeAlias5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAlias5.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('TypeAlias6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAlias6.py']);

    TestUtils.validateResults(analysisResults, 7);
});

test('TypeAlias7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAlias7.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('TypeAlias8', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAlias8.py'], configOptions);

    TestUtils.validateResults(analysisResults, 4);
});

test('TypeAlias9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAlias9.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeAlias10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAlias10.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeAlias11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAlias11.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeAlias12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAlias12.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Dictionary1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dictionary1.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Dictionary2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dictionary2.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Classes1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classes1.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Classes2', () => {
    const configOptions = new ConfigOptions('.');

    // By default, optional diagnostics are ignored.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['classes2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    // Turn on errors.
    configOptions.diagnosticRuleSet.reportIncompatibleMethodOverride = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['classes2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 19);
});

test('Classes3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classes3.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Classes4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classes4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Classes5', () => {
    const configOptions = new ConfigOptions('.');

    // By default, optional diagnostics are ignored.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['classes5.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    // Turn on errors.
    configOptions.diagnosticRuleSet.reportIncompatibleVariableOverride = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['classes5.py'], configOptions);
    TestUtils.validateResults(analysisResults, 5);
});

test('Classes6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classes6.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Classes7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classes7.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Enums1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['enums1.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Enums2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['enums2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Enums3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['enums3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Enums4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['enums4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Enums5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['enums5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Enums6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['enums6.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeGuard1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeGuard1.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('Never1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['never1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypePromotions1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typePromotions1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Index1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['index1.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('ProtocolModule2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocolModule2.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('VariadicTypeVar1', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 12);
});

test('VariadicTypeVar2', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 13);
});

test('VariadicTypeVar3', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar3.py'], configOptions);
    TestUtils.validateResults(analysisResults, 7);
});

test('VariadicTypeVar4', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar4.py'], configOptions);
    TestUtils.validateResults(analysisResults, 4);
});

test('VariadicTypeVar5', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar5.py'], configOptions);
    TestUtils.validateResults(analysisResults, 13);
});

test('VariadicTypeVar6', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar6.py'], configOptions);
    TestUtils.validateResults(analysisResults, 9);
});

test('VariadicTypeVar7', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar7.py'], configOptions);
    TestUtils.validateResults(analysisResults, 6);
});

test('VariadicTypeVar8', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar8.py'], configOptions);
    TestUtils.validateResults(analysisResults, 4);
});

test('Match1', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['match1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 18);
});

test('Match2', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['match2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('Match3', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['match3.py'], configOptions);
    TestUtils.validateResults(analysisResults, 1);
});

test('Match4', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['match4.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('Match5', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['match5.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('Match6', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['match6.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('List1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['list1.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('Comparison1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['comparison1.py']);
    TestUtils.validateResults(analysisResults, 3);
});

test('EmptyContainers1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['emptyContainers1.py']);
    TestUtils.validateResults(analysisResults, 5);
});
