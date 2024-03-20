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
    pythonVersion3_7,
    pythonVersion3_8,
    pythonVersion3_9,
} from '../common/pythonVersion';
import { Uri } from '../common/uri/uri';
import * as TestUtils from './testUtils';

test('Unreachable1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['unreachable1.py']);

    TestUtils.validateResults(analysisResults, 0, 0, 2, 1, 4);
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

test('TypeNarrowingTupleLength1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingTupleLength1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeNarrowingIn1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowingIn1.py']);

    TestUtils.validateResults(analysisResults, 2);
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

    TestUtils.validateResults(analysisResults, 2);
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

    TestUtils.validateResults(analysisResults, 17);
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

    TestUtils.validateResults(analysisResults, 4);
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

    TestUtils.validateResults(analysisResults, 16);
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

    TestUtils.validateResults(analysisResults, 6);
});

test('AnnotatedVar3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['annotatedVar3.py']);

    TestUtils.validateResults(analysisResults, 7);
});

test('AnnotatedVar4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['annotatedVar4.py']);

    TestUtils.validateResults(analysisResults, 6);
});

test('AnnotatedVar5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['annotatedVar5.py']);

    TestUtils.validateResults(analysisResults, 6);
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

test('CodeFlow6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['codeFlow6.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('CodeFlow7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['codeFlow7.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('CodeFlow8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['codeFlow8.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('CapturedVariable1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['capturedVariable1.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('CapturedVariable2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['capturedVariable2.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Property1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['property1.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('Property2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['property2.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Property3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['property3.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('Property4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['property4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Property5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['property5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Property6', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    // Analyze with reportPropertyTypeMismatch enabled.
    configOptions.diagnosticRuleSet.reportPropertyTypeMismatch = 'error';
    const analysisResult1 = TestUtils.typeAnalyzeSampleFiles(['property6.py'], configOptions);
    TestUtils.validateResults(analysisResult1, 2);

    // Analyze with reportPropertyTypeMismatch disabled.
    configOptions.diagnosticRuleSet.reportPropertyTypeMismatch = 'none';
    const analysisResult2 = TestUtils.typeAnalyzeSampleFiles(['property6.py'], configOptions);
    TestUtils.validateResults(analysisResult2, 0);
});

test('Property7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['property7.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Property8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['property8.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('Property9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['property9.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Property10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['property10.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Property11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['property11.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Property12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['property12.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Property13', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['property13.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Property14', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['property14.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Property15', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['property15.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Property16', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['property16.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Property17', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['property17.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Operator1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['operator1.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('Operator2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['operator2.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Operator3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['operator3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Operator4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['operator4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Operator5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['operator5.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Operator6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['operator6.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Operator7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['operator7.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Operator8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['operator8.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Operator9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['operator9.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Operator10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['operator10.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Operator11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['operator11.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Optional1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

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
    const configOptions = new ConfigOptions(Uri.empty());

    // Disable diagnostics.
    configOptions.diagnosticRuleSet.reportOptionalOperand = 'none';
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['optional2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    // Turn on errors.
    configOptions.diagnosticRuleSet.reportOptionalOperand = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['optional2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 1);
});

test('Tuple1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuple1.py']);

    TestUtils.validateResults(analysisResults, 24);
});

test('Tuple2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuple2.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('Tuple3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuple3.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('Tuple4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuple4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Tuple5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuple5.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Tuple6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuple6.py']);

    TestUtils.validateResults(analysisResults, 9);
});

test('Tuple7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuple7.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Tuple8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuple8.py']);

    TestUtils.validateResults(analysisResults, 11);
});

test('Tuple9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuple9.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Tuple10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuple10.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Tuple11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuple11.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Tuple12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuple12.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Tuple13', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuple13.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Tuple15', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuple15.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Tuple16', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuple16.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Tuple17', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuple17.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Tuple18', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuple18.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('NamedTuple1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['namedTuple1.py']);

    TestUtils.validateResults(analysisResults, 13);
});

test('NamedTuple2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['namedTuple2.py']);

    TestUtils.validateResults(analysisResults, 8);
});

test('NamedTuple3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['namedTuple3.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('NamedTuple4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['namedTuple4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('NamedTuple5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['namedTuple5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('NamedTuple6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['namedTuple6.py']);

    TestUtils.validateResults(analysisResults, 6);
});

test('NamedTuple7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['namedTuple7.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('NamedTuple8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['namedTuple8.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('NamedTuple9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['namedTuple9.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('NamedTuple10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['namedTuple10.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Slots1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['slots1.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Slots2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['slots2.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Slots3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['slots3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Parameters1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.diagnosticRuleSet.reportMissingParameterType = 'none';
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['parameters1.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 0);

    configOptions.diagnosticRuleSet.reportMissingParameterType = 'error';
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['parameters1.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 1);
});

test('Self1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['self1.py']);

    TestUtils.validateResults(analysisResults, 15);
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

test('Self6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['self6.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Self7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['self7.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Self8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['self8.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Self9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['self9.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Self10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['self10.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('UnusedVariable1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

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

test('Descriptor2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['descriptor2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Descriptor3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['descriptor3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Partial1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['partial1.py']);

    TestUtils.validateResults(analysisResults, 18);
});

test('Partial2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['partial2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Partial3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['partial3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Partial4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['partial4.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Partial5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['partial5.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('TotalOrdering1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['totalOrdering1.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('TupleUnpack1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tupleUnpack1.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('TupleUnpack2', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['tupleUnpack2.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 18);

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['tupleUnpack2.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 4);
});

test('TupleUnpack3', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['tupleUnpack3.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 1);
});

test('PseudoGeneric1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['pseudoGeneric1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('PseudoGeneric2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['pseudoGeneric2.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('PseudoGeneric3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['pseudoGeneric3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('LiteralString1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['literalString1.py']);

    TestUtils.validateResults(analysisResults, 10);
});

test('LiteralString2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['literalString2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('LiteralString3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['literalString3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('ParamInference1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['paramInference1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('ParamInference2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['paramInference2.py']);

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

test('Dictionary3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dictionary3.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Dictionary4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dictionary4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('StaticExpression1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_8;
    configOptions.defaultPythonPlatform = 'windows';

    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['staticExpression1.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 9);

    configOptions.defaultPythonVersion = pythonVersion3_11;
    configOptions.defaultPythonPlatform = 'Linux';

    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['staticExpression1.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 6);

    configOptions.defineConstant.set('DEFINED_TRUE', true);
    configOptions.defineConstant.set('DEFINED_FALSE', false);
    configOptions.defineConstant.set('DEFINED_STR', 'hi!');
    const analysisResults3 = TestUtils.typeAnalyzeSampleFiles(['staticExpression1.py'], configOptions);
    TestUtils.validateResults(analysisResults3, 0);
});

test('StaticExpression2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['staticExpression2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('SpecialForm1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['specialForm1.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('SpecialForm2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['specialForm2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('SpecialForm3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['specialForm3.py']);

    TestUtils.validateResults(analysisResults, 22);
});

test('SpecialForm4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['specialForm4.py']);

    TestUtils.validateResults(analysisResults, 72);
});
