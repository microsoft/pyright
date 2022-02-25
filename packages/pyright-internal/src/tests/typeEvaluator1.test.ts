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
        'EncodingWarning',
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
        '__build_class__',
        '__import__',
        '__loader__',
        '__name__',
        '__package__',
        '__spec__',
        'abs',
        'aiter',
        'all',
        'anext',
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

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowing3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing3.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('TypeNarrowing4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowing5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowing6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing6.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowing7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing7.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowingIsinstance1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingIsinstance1.py']);

    TestUtils.validateResults(analysisResults, 8);
});

test('TypeNarrowingAssert1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingAssert1.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('TypeNarrowingTypeIs1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingTypeIs1.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('TypeNarrowingIsNone1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingIsNone1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowingIsNone2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingIsNone2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowingIsNoneTuple1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingIsNoneTuple1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowingLiteral1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingLiteral1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowingLiteral2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingLiteral2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowingEnum1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingEnum1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowingEnum2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingEnum2.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('TypeNarrowingIsinstance2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingIsinstance2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowingIsinstance3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingIsinstance3.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('TypeNarrowingIsinstance4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingIsinstance4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowingIsinstance5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingIsinstance5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowingIsinstance6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingIsinstance6.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowingIsinstance7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingIsinstance7.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowingTupleLength1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingTupleLength1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowingIn1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingIn1.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('TypeNarrowingLiteralMember1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingLiteralMember1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowingTuple1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingTuple1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowingTypedDict1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingTypedDict1.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('TypeNarrowingTypedDict2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingTypedDict2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowingTypedDict3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingTypedDict3.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('typeNarrowingCallable1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingCallable1.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('TypeNarrowingFalsy1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingFalsy1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowingLocalConst1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingLocalConst1.py']);

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

    TestUtils.validateResults(analysisResults, 0);
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

test('Expressions9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['expressions9.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Unpack1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['unpack1.py']);

    TestUtils.validateResults(analysisResults, 4);
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

test('Unpack4', () => {
    const configOptions = new ConfigOptions('.');

    // Analyze with Python 3.8 settings.
    configOptions.defaultPythonVersion = PythonVersion.V3_8;
    const analysisResults38 = TestUtils.typeAnalyzeSampleFiles(['unpack4.py'], configOptions);
    TestUtils.validateResults(analysisResults38, 2);

    // Analyze with Python 3.9 settings.
    configOptions.defaultPythonVersion = PythonVersion.V3_9;
    const analysisResults39 = TestUtils.typeAnalyzeSampleFiles(['unpack4.py'], configOptions);
    TestUtils.validateResults(analysisResults39, 1);
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

test('Lambda4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['lambda4.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Lambda5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['lambda5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Lambda6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['lambda6.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Call1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['call1.py']);

    TestUtils.validateResults(analysisResults, 6);
});

test('Call2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['call2.py']);

    TestUtils.validateResults(analysisResults, 11);
});

test('Call3', () => {
    const configOptions = new ConfigOptions('.');

    // Analyze with Python 3.7 settings. This will generate more errors.
    configOptions.defaultPythonVersion = PythonVersion.V3_7;
    const analysisResults37 = TestUtils.typeAnalyzeSampleFiles(['call3.py'], configOptions);
    TestUtils.validateResults(analysisResults37, 32);

    // Analyze with Python 3.8 settings.
    configOptions.defaultPythonVersion = PythonVersion.V3_8;
    const analysisResults38 = TestUtils.typeAnalyzeSampleFiles(['call3.py'], configOptions);
    TestUtils.validateResults(analysisResults38, 18);
});

test('Call4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['call4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Call5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['call5.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('Call6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['call6.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Call7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['call7.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('Function1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['function1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Function2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['function2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Function3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['function3.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Function4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['function4.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Function6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['function6.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Function7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['function7.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Function8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['function8.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Function9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['function9.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Function10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['function10.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Function11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['function11.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('KwargsUnpack1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['kwargsUnpack1.py']);

    TestUtils.validateResults(analysisResults, 11);
});

test('Unreachable1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['unreachable1.py']);

    TestUtils.validateResults(analysisResults, 0, 0, 0, 2);
});

test('FunctionMember1', () => {
    // Analyze with reportFunctionMemberAccess disabled.
    const analysisResult1 = TestUtils.typeAnalyzeSampleFiles(['functionMember1.py']);
    TestUtils.validateResults(analysisResult1, 0);

    // Analyze with reportFunctionMemberAccess enabled.
    const configOptions = new ConfigOptions('.');
    configOptions.diagnosticRuleSet.reportFunctionMemberAccess = 'error';
    const analysisResult2 = TestUtils.typeAnalyzeSampleFiles(['functionMember1.py'], configOptions);
    TestUtils.validateResults(analysisResult2, 3);
});

test('FunctionMember2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['functionMember2.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Annotations1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['annotations1.py']);

    TestUtils.validateResults(analysisResults, 6);
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

test('Annotations6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['annotations6.py']);

    TestUtils.validateResults(analysisResults, 2);
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

    TestUtils.validateResults(analysisResults, 1);
});

test('CodeFlow3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['codeFlow3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('CodeFlow4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['codeFlow4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('CodeFlow5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['codeFlow5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('CapturedVariable1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['capturedVariable1.py']);

    TestUtils.validateResults(analysisResults, 5);
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
    const configOptions = new ConfigOptions('.');

    // Analyze with reportPropertyTypeMismatch enabled.
    configOptions.diagnosticRuleSet.reportPropertyTypeMismatch = 'error';
    const analysisResult1 = TestUtils.typeAnalyzeSampleFiles(['properties6.py'], configOptions);
    TestUtils.validateResults(analysisResult1, 2);

    // Analyze with reportPropertyTypeMismatch disabled.
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

test('Properties12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['properties12.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Properties13', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['properties13.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Operators1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['operators1.py']);

    TestUtils.validateResults(analysisResults, 4);
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

test('Operators6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['operators6.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Operators7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['operators7.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Operators8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['operators8.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Optional1', () => {
    const configOptions = new ConfigOptions('.');

    // Disable diagnostics.
    configOptions.diagnosticRuleSet.reportOptionalSubscript = 'none';
    configOptions.diagnosticRuleSet.reportOptionalMemberAccess = 'none';
    configOptions.diagnosticRuleSet.reportOptionalCall = 'none';
    configOptions.diagnosticRuleSet.reportOptionalIterable = 'none';
    configOptions.diagnosticRuleSet.reportOptionalContextManager = 'none';
    configOptions.diagnosticRuleSet.reportOptionalOperand = 'none';
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

test('Optional2', () => {
    const configOptions = new ConfigOptions('.');

    // Disable diagnostics.
    configOptions.diagnosticRuleSet.reportOptionalOperand = 'none';
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['optional2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    // Turn on errors.
    configOptions.diagnosticRuleSet.reportOptionalOperand = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['optional2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 1);
});

test('Tuples1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuples1.py']);

    TestUtils.validateResults(analysisResults, 14);
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

    TestUtils.validateResults(analysisResults, 9);
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

test('Tuples13', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuples13.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Tuples14', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuples14.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Tuples15', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuples15.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Tuples16', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuples16.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('NamedTuples1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['namedTuples1.py']);

    TestUtils.validateResults(analysisResults, 12);
});

test('NamedTuples2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['namedTuples2.py']);

    TestUtils.validateResults(analysisResults, 8);
});

test('NamedTuples3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['namedTuples3.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('NamedTuples4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['namedTuples4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('NamedTuples5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['namedTuples5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('NamedTuples6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['namedTuples6.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Slots1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['slots1.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Slots2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['slots2.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Parameters1', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.diagnosticRuleSet.reportMissingParameterType = 'none';
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['parameters1.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 0);

    configOptions.diagnosticRuleSet.reportMissingParameterType = 'error';
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['parameters1.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 1);
});

test('Self1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['self1.py']);

    TestUtils.validateResults(analysisResults, 12);
});

test('Self2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['self2.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('Self3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['self3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Self4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['self4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Self5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['self5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('UnusedVariable1', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.diagnosticRuleSet.reportUnusedVariable = 'none';
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['unusedVariable1.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 0);

    configOptions.diagnosticRuleSet.reportUnusedVariable = 'error';
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['unusedVariable1.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 3);
});

test('Descriptor1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['descriptor1.py']);

    TestUtils.validateResults(analysisResults, 6);
});

test('Partial1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['partial1.py']);

    TestUtils.validateResults(analysisResults, 17);
});

test('Partial2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['partial2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TotalOrdering1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['totalOrdering1.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('TupleUnpack1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tupleUnpack1.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('TupleUnpack2', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['tupleUnpack2.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 20);

    configOptions.defaultPythonVersion = PythonVersion.V3_11;
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['tupleUnpack2.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 5);
});

test('PseudoGeneric1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['pseudoGeneric1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('LiteralString1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['literalString1.py']);

    TestUtils.validateResults(analysisResults, 6);
});

test('ParamInference1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['paramInference1.py']);

    TestUtils.validateResults(analysisResults, 0);
});
