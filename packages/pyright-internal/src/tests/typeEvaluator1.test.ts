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
import {
    pythonVersion3_10,
    pythonVersion3_11,
    pythonVersion3_13,
    pythonVersion3_14,
    pythonVersion3_7,
    pythonVersion3_8,
    pythonVersion3_9,
} from '../common/pythonVersion';
import { Uri } from '../common/uri/uri';
import * as TestUtils from './testUtils';

test('Unreachable1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['unreachable1.py']);

    TestUtils.validateResults(analysisResults, 0, 0, 2, 1, 6);
});

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
        'BaseExceptionGroup',
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
        'ExceptionGroup',
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
        'PythonFinalizationError',
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

    const moduleScope = AnalyzerNodeInfo.getScope(analysisResults[0].parseResults!.parserOutput.parseTree)!;
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

test('Builtins2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['builtins2.py']);
    TestUtils.validateResults(analysisResults, 0);
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

test('TypeNarrowingAssert1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingAssert1.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('TypeNarrowingTypeIs1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingTypeIs1.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('TypeNarrowingTypeEquals1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingTypeEquals1.py']);

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

test('TypeNarrowingIsClass1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingIsClass1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowingIsNoneTuple1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingIsNoneTuple1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowingIsNoneTuple2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingIsNoneTuple2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowingIsEllipsis1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingIsEllipsis1.py']);

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

test('TypeNarrowingIsinstance1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingIsinstance1.py']);

    TestUtils.validateResults(analysisResults, 9);
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

test('TypeNarrowingIsinstance8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingIsinstance8.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowingIsinstance10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingIsinstance10.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowingIsinstance11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingIsinstance11.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowingIsinstance12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingIsinstance12.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowingIsinstance13.py', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingIsinstance13.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowingIsinstance14', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingIsinstance14.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowingIsinstance15', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingIsinstance15.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowingIsinstance16', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingIsinstance16.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowingIsinstance17', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingIsinstance17.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowingIsinstance18', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingIsinstance18.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowingIsinstance19', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingIsinstance19.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowingIsinstance20', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingIsinstance20.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowingIsinstance21', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingIsinstance21.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowingTupleLength1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingTupleLength1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowingIn1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingIn1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowingIn2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingIn2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowingLiteralMember1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingLiteralMember1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowingNoneMember1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingNoneMember1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowingTuple1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingTuple1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowingTypedDict1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingTypedDict1.py']);

    TestUtils.validateResults(analysisResults, 4);
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

    TestUtils.validateResults(analysisResults, 4);
});

test('ReturnTypes2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['returnTypes2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Specialization1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['specialization1.py']);

    TestUtils.validateResults(analysisResults, 7);
});

test('Specialization2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['specialization2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Expression1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['expression1.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('Expression2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['expression2.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Expression3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['expression3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Expression4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['expression4.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Expression5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['expression5.py']);

    TestUtils.validateResults(analysisResults, 12);
});

test('Expression6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['expression6.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Expression7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['expression7.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Expression8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['expression8.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Expression9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['expression9.py']);

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
    const configOptions = new ConfigOptions(Uri.empty());

    // Analyze with Python 3.7 settings.
    configOptions.defaultPythonVersion = pythonVersion3_7;
    const analysisResults37 = TestUtils.typeAnalyzeSampleFiles(['unpack3.py'], configOptions);
    TestUtils.validateResults(analysisResults37, 1);

    // Analyze with Python 3.8 settings.
    configOptions.defaultPythonVersion = pythonVersion3_8;
    const analysisResults38 = TestUtils.typeAnalyzeSampleFiles(['unpack3.py'], configOptions);
    TestUtils.validateResults(analysisResults38, 0);
});

test('Unpack4', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    // Analyze with Python 3.8 settings.
    configOptions.defaultPythonVersion = pythonVersion3_8;
    const analysisResults38 = TestUtils.typeAnalyzeSampleFiles(['unpack4.py'], configOptions);
    TestUtils.validateResults(analysisResults38, 2);

    // Analyze with Python 3.9 settings.
    configOptions.defaultPythonVersion = pythonVersion3_9;
    const analysisResults39 = TestUtils.typeAnalyzeSampleFiles(['unpack4.py'], configOptions);
    TestUtils.validateResults(analysisResults39, 1);
});

test('Unpack4', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['unpack5.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('Lambda1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['lambda1.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('Lambda2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['lambda2.py']);

    TestUtils.validateResults(analysisResults, 6);
});

test('Lambda3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['lambda3.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Lambda4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['lambda4.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Lambda5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['lambda5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Lambda6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['lambda6.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Lambda7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['lambda7.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Lambda8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['lambda8.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Lambda9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['lambda9.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Lambda10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['lambda10.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Lambda11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['lambda11.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Lambda12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['lambda12.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Lambda13', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['lambda13.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Lambda14', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['lambda14.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Lambda15', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['lambda15.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Call1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['call1.py']);

    TestUtils.validateResults(analysisResults, 6);
});

test('Call2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['call2.py']);

    TestUtils.validateResults(analysisResults, 18);
});

test('Call3', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    // Analyze with Python 3.7 settings. This will generate more errors.
    configOptions.defaultPythonVersion = pythonVersion3_7;
    const analysisResults37 = TestUtils.typeAnalyzeSampleFiles(['call3.py'], configOptions);
    TestUtils.validateResults(analysisResults37, 36);

    // Analyze with Python 3.8 settings.
    configOptions.defaultPythonVersion = pythonVersion3_8;
    const analysisResults38 = TestUtils.typeAnalyzeSampleFiles(['call3.py'], configOptions);
    TestUtils.validateResults(analysisResults38, 20);
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

    TestUtils.validateResults(analysisResults, 4);
});

test('Call7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['call7.py']);

    TestUtils.validateResults(analysisResults, 8);
});

test('Call8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['call8.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Call9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['call9.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Call10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['call10.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Call11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['call11.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Call12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['call12.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Call13', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['call13.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Call14', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['call14.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('Call15', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['call15.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Call16', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['call16.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Call17', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['call17.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Call18', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_13;
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['call18.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 2);

    configOptions.defaultPythonVersion = pythonVersion3_14;
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['call18.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 0);
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

    TestUtils.validateResults(analysisResults, 1);
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

    TestUtils.validateResults(analysisResults, 2);
});

test('Function8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['function8.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Function9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['function9.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Function10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['function10.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('KwargsUnpack1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['kwargsUnpack1.py']);

    TestUtils.validateResults(analysisResults, 12);
});

test('FunctionMember1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.diagnosticRuleSet.reportFunctionMemberAccess = 'none';
    const analysisResult1 = TestUtils.typeAnalyzeSampleFiles(['functionMember1.py'], configOptions);
    TestUtils.validateResults(analysisResult1, 0);

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

    TestUtils.validateResults(analysisResults, 19);
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

    TestUtils.validateResults(analysisResults, 8);
});

test('Annotations5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['annotations5.py']);

    TestUtils.validateResults(analysisResults, 1);
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

test('AnnotatedVar7', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['annotatedVar7.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 0);

    configOptions.diagnosticRuleSet.reportTypeCommentUsage = 'error';
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['annotatedVar7.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 3);
});

test('AnnotatedVar8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['annotatedVar8.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('Required1', () => {
    // Analyze with Python 3.10 settings.
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['required1.py'], configOptions);

    TestUtils.validateResults(analysisResults, 8);
});

test('Required2', () => {
    // Analyze with Python 3.10 settings.
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['required2.py'], configOptions);

    TestUtils.validateResults(analysisResults, 7);
});

test('Required3', () => {
    // Analyze with Python 3.10 settings.
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['required3.py'], configOptions);

    TestUtils.validateResults(analysisResults, 2);
});

test('Metaclass1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['metaclass1.py']);
    TestUtils.validateResults(analysisResults, 4);
});

test('Metaclass2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['metaclass2.py']);
    TestUtils.validateResults(analysisResults, 2);
});

test('Metaclass3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['metaclass3.py']);
    TestUtils.validateResults(analysisResults, 1);
});

test('Metaclass4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['metaclass4.py']);
    TestUtils.validateResults(analysisResults, 1);
});

test('Metaclass5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['metaclass5.py']);
    TestUtils.validateResults(analysisResults, 1);
});

test('Metaclass6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['metaclass6.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('Metaclass7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['metaclass7.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('Metaclass8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['metaclass8.py']);
    TestUtils.validateResults(analysisResults, 1);
});

test('Metaclass9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['metaclass9.py']);
    TestUtils.validateResults(analysisResults, 6);
});

test('Metaclass10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['metaclass10.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('Metaclass11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['metaclass11.py']);
    TestUtils.validateResults(analysisResults, 4);
});

test('AssignmentExpr1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignmentExpr1.py']);
    TestUtils.validateResults(analysisResults, 7);
});

test('AssignmentExpr2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignmentExpr2.py']);
    TestUtils.validateResults(analysisResults, 8);
});

test('AssignmentExpr3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignmentExpr3.py']);
    TestUtils.validateResults(analysisResults, 5);
});

test('AssignmentExpr4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignmentExpr4.py']);
    TestUtils.validateResults(analysisResults, 16);
});

test('AssignmentExpr5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignmentExpr5.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('AssignmentExpr6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignmentExpr6.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('AssignmentExpr7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignmentExpr7.py']);
    TestUtils.validateResults(analysisResults, 2);
});

test('AssignmentExpr8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignmentExpr8.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('AssignmentExpr9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignmentExpr9.py']);
    TestUtils.validateResults(analysisResults, 0);
});
