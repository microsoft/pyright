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
        'ellipsis',
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

function validateResults(
    results: TestUtils.FileAnalysisResult[],
    errorCount: number,
    warningCount = 0,
    infoCount?: number,
    unusedCode?: number
) {
    assert.equal(results.length, 1);
    assert.equal(results[0].errors.length, errorCount);
    assert.equal(results[0].warnings.length, warningCount);

    if (infoCount !== undefined) {
        assert.equal(results[0].infos.length, infoCount);
    }

    if (unusedCode !== undefined) {
        assert.equal(results[0].unusedCodes.length, unusedCode);
    }
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

test('TypeNarrowing1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing1.py']);

    validateResults(analysisResults, 6);
});

test('TypeNarrowing2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing2.py']);

    validateResults(analysisResults, 4);
});

test('TypeNarrowing3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing3.py']);

    validateResults(analysisResults, 1);
});

test('TypeNarrowing4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing4.py']);

    validateResults(analysisResults, 2);
});

test('TypeNarrowing5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing5.py']);

    validateResults(analysisResults, 0);
});

test('TypeNarrowing6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing6.py']);

    validateResults(analysisResults, 1);
});

test('TypeNarrowing7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing7.py']);

    validateResults(analysisResults, 0);
});

test('TypeNarrowing8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing8.py']);

    validateResults(analysisResults, 0);
});

test('TypeNarrowing9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing9.py']);

    validateResults(analysisResults, 0);
});

test('TypeNarrowing10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing10.py']);

    validateResults(analysisResults, 0);
});

test('TypeNarrowing11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing11.py']);

    validateResults(analysisResults, 0);
});

test('TypeNarrowing12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing12.py']);

    validateResults(analysisResults, 0);
});

test('TypeNarrowing13', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing13.py']);

    validateResults(analysisResults, 0);
});

test('TypeNarrowing14', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing14.py']);

    validateResults(analysisResults, 0);
});

test('TypeNarrowing15', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing15.py']);

    validateResults(analysisResults, 2);
});

test('TypeNarrowing16', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing16.py']);

    validateResults(analysisResults, 2);
});

test('TypeNarrowing17', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeNarrowing17.py']);

    validateResults(analysisResults, 8);
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

    validateResults(analysisResults, 8);
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

test('Expressions4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['expressions4.py']);

    validateResults(analysisResults, 2);
});

test('Expressions5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['expressions5.py']);

    validateResults(analysisResults, 12);
});

test('Unpack1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['unpack1.py']);

    validateResults(analysisResults, 1);
});

test('Unpack2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['unpack2.py']);

    validateResults(analysisResults, 1);
});

test('Unpack3', () => {
    const configOptions = new ConfigOptions('.');

    // Analyze with Python 3.7 settings.
    configOptions.defaultPythonVersion = PythonVersion.V3_7;
    const analysisResults37 = TestUtils.typeAnalyzeSampleFiles(['unpack3.py'], configOptions);
    validateResults(analysisResults37, 1);

    // Analyze with Python 3.8 settings.
    configOptions.defaultPythonVersion = PythonVersion.V3_8;
    const analysisResults38 = TestUtils.typeAnalyzeSampleFiles(['unpack3.py'], configOptions);
    validateResults(analysisResults38, 0);
});

test('Lambda1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['lambda1.py']);

    validateResults(analysisResults, 5);
});

test('Lambda2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['lambda2.py']);

    validateResults(analysisResults, 5);
});

test('Lambda3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['lambda3.py']);

    validateResults(analysisResults, 1);
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
    configOptions.defaultPythonVersion = PythonVersion.V3_7;
    const analysisResults37 = TestUtils.typeAnalyzeSampleFiles(['function3.py'], configOptions);
    validateResults(analysisResults37, 19);

    // Analyze with Python 3.8 settings.
    configOptions.defaultPythonVersion = PythonVersion.V3_8;
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

test('Function6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['function6.py']);

    validateResults(analysisResults, 0);
});

test('Function7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['function7.py']);

    validateResults(analysisResults, 4);
});

test('Function8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['function8.py']);

    validateResults(analysisResults, 0);
});

test('Function9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['function9.py']);

    validateResults(analysisResults, 1);
});

test('Function10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['function10.py']);

    validateResults(analysisResults, 1);
});

test('Function11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['function11.py']);

    validateResults(analysisResults, 2);
});

test('Function12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['function12.py']);

    validateResults(analysisResults, 0, 0, 0, 2);
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

test('AnnotatedVar6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['annotatedVar6.py']);

    validateResults(analysisResults, 0);
});

test('CodeFlow1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['codeFlow1.py']);

    validateResults(analysisResults, 2);
});

test('CodeFlow2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['codeFlow2.py']);

    validateResults(analysisResults, 0);
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

test('Properties5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['properties5.py']);

    validateResults(analysisResults, 0);
});

test('Properties6', () => {
    // Analyze with reportPropertyTypeMismatch enabled.
    const analysisResult1 = TestUtils.typeAnalyzeSampleFiles(['properties6.py']);
    validateResults(analysisResult1, 2);

    // Analyze with reportPropertyTypeMismatch disabled.
    const configOptions = new ConfigOptions('.');
    configOptions.diagnosticRuleSet.reportPropertyTypeMismatch = 'none';
    const analysisResult2 = TestUtils.typeAnalyzeSampleFiles(['properties6.py'], configOptions);
    validateResults(analysisResult2, 0);
});

test('Properties7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['properties7.py']);

    validateResults(analysisResults, 2);
});

test('Operators1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['operators1.py']);

    validateResults(analysisResults, 3);
});

test('Operators2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['operators2.py']);

    validateResults(analysisResults, 1);
});

test('Operators3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['operators3.py']);

    validateResults(analysisResults, 1);
});

test('Operators4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['operators4.py']);

    validateResults(analysisResults, 0);
});

test('Operators5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['operators5.py']);

    validateResults(analysisResults, 1);
});

test('Optional1', () => {
    const configOptions = new ConfigOptions('.');

    // By default, optional diagnostics are ignored.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['optional1.py'], configOptions);
    validateResults(analysisResults, 0);

    // Turn on warnings.
    configOptions.diagnosticRuleSet.reportOptionalSubscript = 'warning';
    configOptions.diagnosticRuleSet.reportOptionalMemberAccess = 'warning';
    configOptions.diagnosticRuleSet.reportOptionalCall = 'warning';
    configOptions.diagnosticRuleSet.reportOptionalIterable = 'warning';
    configOptions.diagnosticRuleSet.reportOptionalContextManager = 'warning';
    configOptions.diagnosticRuleSet.reportOptionalOperand = 'warning';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['optional1.py'], configOptions);
    validateResults(analysisResults, 0, 7);

    // Turn on errors.
    configOptions.diagnosticRuleSet.reportOptionalSubscript = 'error';
    configOptions.diagnosticRuleSet.reportOptionalMemberAccess = 'error';
    configOptions.diagnosticRuleSet.reportOptionalCall = 'error';
    configOptions.diagnosticRuleSet.reportOptionalIterable = 'error';
    configOptions.diagnosticRuleSet.reportOptionalContextManager = 'error';
    configOptions.diagnosticRuleSet.reportOptionalOperand = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['optional1.py'], configOptions);
    validateResults(analysisResults, 7);
});

test('Private1', () => {
    const configOptions = new ConfigOptions('.');

    // By default, optional diagnostics are ignored.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['private1.py'], configOptions);
    validateResults(analysisResults, 0);

    // Turn on errors.
    configOptions.diagnosticRuleSet.reportPrivateUsage = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['private1.py'], configOptions);
    validateResults(analysisResults, 4);
});

test('Constant1', () => {
    const configOptions = new ConfigOptions('.');

    // By default, optional diagnostics are ignored.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['constant1.py'], configOptions);
    validateResults(analysisResults, 0);

    // Turn on errors.
    configOptions.diagnosticRuleSet.reportConstantRedefinition = 'error';
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

test('Tuples5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuples5.py']);

    validateResults(analysisResults, 2);
});

test('Tuples6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuples6.py']);

    validateResults(analysisResults, 7);
});

test('Tuples7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuples7.py']);

    validateResults(analysisResults, 7);
});

test('Tuples8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuples8.py']);

    validateResults(analysisResults, 11);
});

test('Tuples9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuples9.py']);

    validateResults(analysisResults, 1);
});

test('NamedTuples1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['namedTuples1.py']);

    validateResults(analysisResults, 6);
});

test('NamedTuples2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['namedTuples2.py']);

    validateResults(analysisResults, 8);
});

test('AbstractClass1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['abstractClass1.py']);

    validateResults(analysisResults, 2);
});

test('AbstractClass2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['abstractClass2.py']);

    validateResults(analysisResults, 0);
});

test('AbstractClass3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['abstractClass3.py']);

    validateResults(analysisResults, 0);
});

test('AbstractClass4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['abstractClass4.py']);

    validateResults(analysisResults, 1);
});

test('AbstractClass5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['abstractClass5.py']);

    validateResults(analysisResults, 2);
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

test('Generators7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generators7.py']);

    validateResults(analysisResults, 0);
});

test('Generators8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generators8.py']);

    validateResults(analysisResults, 0);
});

test('Generators9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generators9.py']);

    validateResults(analysisResults, 2);
});

test('Coroutines1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['coroutines1.py']);

    validateResults(analysisResults, 3);
});

test('Coroutines2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['coroutines2.py']);

    validateResults(analysisResults, 0);
});

test('Loops1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops1.py']);

    validateResults(analysisResults, 2);
});

test('Loops2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops2.py']);

    validateResults(analysisResults, 0);
});

test('Loops3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops3.py']);

    validateResults(analysisResults, 0);
});

test('Loops4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops4.py']);

    validateResults(analysisResults, 0);
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

    validateResults(analysisResults, 3);
});

test('With2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['with2.py']);

    validateResults(analysisResults, 3);
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

test('ListComprehension5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['listComprehension5.py']);

    validateResults(analysisResults, 0);
});

test('ListComprehension6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['listComprehension6.py']);

    validateResults(analysisResults, 4);
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

test('Literals3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['literals3.py']);

    validateResults(analysisResults, 4);
});

test('Literals4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['literals4.py']);

    validateResults(analysisResults, 0);
});

test('Literals5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['literals5.py']);

    validateResults(analysisResults, 2);
});

test('TypeAlias1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAlias1.py']);

    validateResults(analysisResults, 0);
});

test('TypeAlias2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAlias2.py']);

    validateResults(analysisResults, 0);
});

test('TypeAlias3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAlias3.py']);

    validateResults(analysisResults, 0);
});

test('TypeAlias4', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_9;
    const analysisResults3_9 = TestUtils.typeAnalyzeSampleFiles(['typeAlias4.py'], configOptions);
    validateResults(analysisResults3_9, 1);

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults3_10 = TestUtils.typeAnalyzeSampleFiles(['typeAlias4.py'], configOptions);
    validateResults(analysisResults3_10, 6);
});

test('TypeAlias5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAlias5.py']);

    validateResults(analysisResults, 1);
});

test('TypeAlias6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAlias6.py']);

    validateResults(analysisResults, 7);
});

test('TypeAlias7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAlias7.py']);

    validateResults(analysisResults, 2);
});

test('TypeAlias8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAlias8.py']);

    validateResults(analysisResults, 4);
});

test('Dictionary1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dictionary1.py']);

    validateResults(analysisResults, 2);
});

test('Dictionary2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dictionary2.py']);

    validateResults(analysisResults, 1);
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
    configOptions.diagnosticRuleSet.reportIncompatibleMethodOverride = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['classes2.py'], configOptions);
    validateResults(analysisResults, 13);
});

test('Classes3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classes3.py']);

    validateResults(analysisResults, 2);
});

test('Classes4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classes4.py']);

    validateResults(analysisResults, 0);
});

test('Classes5', () => {
    const configOptions = new ConfigOptions('.');

    // By default, optional diagnostics are ignored.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['classes5.py'], configOptions);
    validateResults(analysisResults, 0);

    // Turn on errors.
    configOptions.diagnosticRuleSet.reportIncompatibleVariableOverride = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['classes5.py'], configOptions);
    validateResults(analysisResults, 4);
});

test('Classes6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classes6.py']);

    validateResults(analysisResults, 3);
});

test('Classes7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classes7.py']);

    validateResults(analysisResults, 1);
});

test('Mro1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['mro1.py']);

    validateResults(analysisResults, 1);
});

test('Mro2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['mro2.py']);

    validateResults(analysisResults, 1);
});

test('Mro3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['mro3.py']);

    validateResults(analysisResults, 0);
});

test('Enums1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['enums1.py']);

    validateResults(analysisResults, 3);
});

test('Enums2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['enums2.py']);

    validateResults(analysisResults, 0);
});

test('Enums3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['enums3.py']);

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

test('Assignment7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignment7.py']);

    validateResults(analysisResults, 0);
});

test('Assignment8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignment8.py']);

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
    configOptions.diagnosticRuleSet.reportCallInDefaultInitializer = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['defaultInitializer1.py'], configOptions);
    validateResults(analysisResults, 2);
});

test('Super1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['super1.py']);

    validateResults(analysisResults, 4);
});

test('Super2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['super2.py']);

    validateResults(analysisResults, 0, 0, 3);
});

test('NewType1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['newType1.py']);

    validateResults(analysisResults, 1);
});

test('NewType2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['newType2.py']);

    validateResults(analysisResults, 4);
});

test('NewType3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['newType3.py']);

    validateResults(analysisResults, 4);
});

test('isInstance2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['isinstance2.py']);

    validateResults(analysisResults, 1);
});

test('isInstance3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['isinstance3.py']);

    validateResults(analysisResults, 2);
});

test('isInstance4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['isinstance4.py']);

    validateResults(analysisResults, 0);
});

test('UnnecessaryIsInstance1', () => {
    const configOptions = new ConfigOptions('.');

    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['unnecessaryIsInstance1.py'], configOptions);
    validateResults(analysisResults, 1);

    // Turn on errors.
    configOptions.diagnosticRuleSet.reportUnnecessaryIsInstance = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['unnecessaryIsInstance1.py'], configOptions);
    validateResults(analysisResults, 4);
});

test('UnnecessaryIsSubclass1', () => {
    const configOptions = new ConfigOptions('.');

    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['unnecessaryIsSubclass1.py'], configOptions);
    validateResults(analysisResults, 0);

    // Turn on errors.
    configOptions.diagnosticRuleSet.reportUnnecessaryIsInstance = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['unnecessaryIsSubclass1.py'], configOptions);
    validateResults(analysisResults, 3);
});

test('Unbound1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['unbound1.py']);

    validateResults(analysisResults, 1);
});

test('Unbound2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['unbound2.py']);

    validateResults(analysisResults, 1);
});

test('Unbound3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['unbound3.py']);

    validateResults(analysisResults, 1);
});

test('UnnecessaryCast', () => {
    const configOptions = new ConfigOptions('.');

    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['unnecessaryCast1.py'], configOptions);
    validateResults(analysisResults, 0);

    // Turn on errors.
    configOptions.diagnosticRuleSet.reportUnnecessaryCast = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['unnecessaryCast1.py'], configOptions);
    validateResults(analysisResults, 1);
});

test('AssertAlwaysTrue', () => {
    const configOptions = new ConfigOptions('.');

    // By default, this is reported as a warning.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['assert1.py'], configOptions);
    validateResults(analysisResults, 0, 2);

    // Enable it as an error.
    configOptions.diagnosticRuleSet.reportAssertAlwaysTrue = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['assert1.py'], configOptions);
    validateResults(analysisResults, 2, 0);

    // Turn off the diagnostic.
    configOptions.diagnosticRuleSet.reportAssertAlwaysTrue = 'none';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['assert1.py'], configOptions);
    validateResults(analysisResults, 0, 0);
});

test('RevealedType1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['revealedType1.py']);

    validateResults(analysisResults, 0, 0, 3);
});

test('NameBindings1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['nameBindings1.py']);

    validateResults(analysisResults, 4);
});

test('NameBindings2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['nameBindings2.py']);

    validateResults(analysisResults, 1);
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

    validateResults(analysisResults, 6);
});

test('GenericTypes19', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes19.py']);

    validateResults(analysisResults, 0);
});

test('GenericTypes20', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes20.py']);

    validateResults(analysisResults, 0);
});

test('GenericTypes21', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes21.py']);

    validateResults(analysisResults, 1);
});

test('GenericTypes22', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes22.py']);

    validateResults(analysisResults, 0);
});

test('GenericTypes23', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes23.py']);

    validateResults(analysisResults, 2);
});

test('GenericTypes24', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes24.py']);

    validateResults(analysisResults, 1);
});

test('GenericTypes25', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes25.py']);

    validateResults(analysisResults, 0);
});

test('GenericTypes26', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes26.py']);

    validateResults(analysisResults, 0);
});

test('GenericTypes27', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes27.py']);

    validateResults(analysisResults, 0);
});

test('GenericTypes28', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes28.py']);

    validateResults(analysisResults, 1);
});

test('GenericTypes29', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes29.py']);

    validateResults(analysisResults, 1);
});

test('GenericTypes30', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes30.py']);

    validateResults(analysisResults, 3);
});

test('GenericTypes31', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes31.py']);

    validateResults(analysisResults, 0);
});

test('GenericTypes32', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes32.py']);

    validateResults(analysisResults, 0);
});

test('GenericTypes33', () => {
    const configOptions = new ConfigOptions('.');

    // By default, reportMissingTypeArgument is disabled.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes33.py']);
    validateResults(analysisResults, 0);

    // Turn on errors.
    configOptions.diagnosticRuleSet.reportMissingTypeArgument = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes33.py'], configOptions);
    validateResults(analysisResults, 4);
});

test('GenericTypes34', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes34.py']);

    validateResults(analysisResults, 0);
});

test('GenericTypes35', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes35.py']);

    validateResults(analysisResults, 1);
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

test('Protocol7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol7.py']);

    validateResults(analysisResults, 1);
});

test('Protocol8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol8.py']);

    validateResults(analysisResults, 1);
});

test('Protocol9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol9.py']);

    validateResults(analysisResults, 0);
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

test('TypedDict10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict10.py']);

    validateResults(analysisResults, 3);
});

test('TypedDict11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict11.py']);

    validateResults(analysisResults, 0);
});

test('TypedDict12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict12.py']);

    validateResults(analysisResults, 0);
});

test('TypeIgnore1', () => {
    const configOptions = new ConfigOptions('.');

    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeIgnore1.py'], configOptions);
    validateResults(analysisResults, 0);

    // Disable type ignore
    configOptions.diagnosticRuleSet.enableTypeIgnoreComments = false;
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeIgnore1.py'], configOptions);
    validateResults(analysisResults, 2);
});

test('TypeIgnore2', () => {
    const configOptions = new ConfigOptions('.');

    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeIgnore2.py'], configOptions);
    validateResults(analysisResults, 0);

    // Disable type ignore
    configOptions.diagnosticRuleSet.enableTypeIgnoreComments = false;
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeIgnore2.py'], configOptions);
    validateResults(analysisResults, 3);
});

test('TypeIgnore3', () => {
    const configOptions = new ConfigOptions('.');

    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeIgnore3.py'], configOptions);
    validateResults(analysisResults, 0);

    // Disable type ignore
    configOptions.diagnosticRuleSet.enableTypeIgnoreComments = false;
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeIgnore3.py'], configOptions);
    validateResults(analysisResults, 3);
});

test('Metaclass1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['metaclass1.py']);
    validateResults(analysisResults, 0);
});

test('Metaclass2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['metaclass2.py']);
    validateResults(analysisResults, 0);
});

test('Metaclass3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['metaclass3.py']);
    validateResults(analysisResults, 1);
});

test('Metaclass4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['metaclass4.py']);
    validateResults(analysisResults, 1);
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
    validateResults(analysisResults, 4);
});

test('AssignmentExpr4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignmentExpr4.py']);
    validateResults(analysisResults, 17);
});

test('AssignmentExpr5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignmentExpr5.py']);
    validateResults(analysisResults, 0);
});

test('AssignmentExpr6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignmentExpr6.py']);
    validateResults(analysisResults, 0);
});

test('AssignmentExpr7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignmentExpr7.py']);
    validateResults(analysisResults, 1);
});

test('AssignmentExpr8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignmentExpr8.py']);
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

test('Import10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['import10.py']);
    validateResults(analysisResults, 1);
});

test('Import11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['import11.py']);
    validateResults(analysisResults, 0);
});

test('Import12', () => {
    const configOptions = new ConfigOptions('.');

    // By default, optional diagnostics are ignored.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['import12.py'], configOptions);
    validateResults(analysisResults, 0, 1);

    // Turn on error.
    configOptions.diagnosticRuleSet.reportWildcardImportFromLibrary = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['import12.py'], configOptions);
    validateResults(analysisResults, 1, 0);

    // Turn off diagnostic.
    configOptions.diagnosticRuleSet.reportWildcardImportFromLibrary = 'none';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['import12.py'], configOptions);
    validateResults(analysisResults, 0, 0);
});

test('Overload1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overload1.py']);
    validateResults(analysisResults, 2);
});

test('Overload2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overload2.py']);
    validateResults(analysisResults, 0);
});

test('Overload3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overload3.py']);
    validateResults(analysisResults, 1);
});

test('Overload4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overload4.py']);
    validateResults(analysisResults, 1);
});

test('Overload5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overload5.py']);
    validateResults(analysisResults, 5);
});

test('Overload6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overload6.py']);
    validateResults(analysisResults, 1);
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
    validateResults(analysisResults, 15);
});

test('Final4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['final4.pyi']);
    validateResults(analysisResults, 3);
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
    configOptions.diagnosticRuleSet.reportDuplicateImport = 'error';
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

test('FString4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['fstring4.py']);
    validateResults(analysisResults, 0);
});

test('FString5', () => {
    const configOptions = new ConfigOptions('.');

    // Analyze with Python 3.7 settings. This will generate errors.
    configOptions.defaultPythonVersion = PythonVersion.V3_7;
    const analysisResults37 = TestUtils.typeAnalyzeSampleFiles(['fstring5.py'], configOptions);
    validateResults(analysisResults37, 2);

    // Analyze with Python 3.8 settings.
    configOptions.defaultPythonVersion = PythonVersion.V3_8;
    const analysisResults38 = TestUtils.typeAnalyzeSampleFiles(['fstring5.py'], configOptions);
    validateResults(analysisResults38, 0);
});

test('MemberAccess1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['memberAccess1.py']);
    validateResults(analysisResults, 0);
});

test('MemberAccess2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['memberAccess2.py']);
    validateResults(analysisResults, 0);
});

test('MemberAccess3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['memberAccess3.py']);
    validateResults(analysisResults, 3);
});

test('MemberAccess4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['memberAccess4.py']);
    validateResults(analysisResults, 3);
});

test('MemberAccess5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['memberAccess5.py']);
    validateResults(analysisResults, 0);
});

test('MemberAccess6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['memberAccess6.py']);
    validateResults(analysisResults, 2);
});

test('ParamName1', () => {
    const configOptions = new ConfigOptions('.');

    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['paramNames1.py'], configOptions);
    validateResults(analysisResults, 0, 4);

    configOptions.diagnosticRuleSet.reportSelfClsParameterName = 'none';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['paramNames1.py'], configOptions);
    validateResults(analysisResults, 0, 0);

    configOptions.diagnosticRuleSet.reportSelfClsParameterName = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['paramNames1.py'], configOptions);
    validateResults(analysisResults, 4, 0);
});

test('DataClass1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclass1.py']);

    validateResults(analysisResults, 2);
});

test('DataClass3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclass3.py']);

    validateResults(analysisResults, 1);
});

test('DataClass4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclass4.py']);

    validateResults(analysisResults, 5);
});

test('DataClass5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclass5.py']);

    validateResults(analysisResults, 2);
});

test('DataClass6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclass6.py']);

    validateResults(analysisResults, 2);
});

test('DataClass7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclass7.py']);

    validateResults(analysisResults, 2);
});

test('DataClass8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclass8.py']);

    validateResults(analysisResults, 0);
});

test('DataClass9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclass9.py']);

    validateResults(analysisResults, 0);
});

test('DataClass10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclass10.py']);

    validateResults(analysisResults, 1);
});

test('Python2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['python2.py']);

    validateResults(analysisResults, 6);
});

test('InconsistentSpaceTab', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['inconsistentSpaceTab.py']);

    validateResults(analysisResults, 4);
});

test('Callable1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['callable1.py']);

    validateResults(analysisResults, 3);
});

test('ThreePartVersion1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['threePartVersion1.py']);

    validateResults(analysisResults, 0);
});

test('Unions1', () => {
    const configOptions = new ConfigOptions('.');

    // Analyze with Python 3.9 settings. This will generate errors.
    configOptions.defaultPythonVersion = PythonVersion.V3_9;
    const analysisResults3_9 = TestUtils.typeAnalyzeSampleFiles(['unions1.py'], configOptions);
    validateResults(analysisResults3_9, 7);

    // Analyze with Python 3.10 settings.
    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults3_10 = TestUtils.typeAnalyzeSampleFiles(['unions1.py'], configOptions);
    validateResults(analysisResults3_10, 0);
});

test('Unions2', () => {
    const configOptions = new ConfigOptions('.');

    // Analyze with Python 3.8 settings.
    configOptions.defaultPythonVersion = PythonVersion.V3_8;
    const analysisResults38 = TestUtils.typeAnalyzeSampleFiles(['unions2.py'], configOptions);
    validateResults(analysisResults38, 0);
});

test('ParamSpec1', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec1.py'], configOptions);
    validateResults(results, 8);
});

test('ParamSpec2', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_9;
    const analysisResults39 = TestUtils.typeAnalyzeSampleFiles(['paramSpec2.py'], configOptions);
    validateResults(analysisResults39, 6);

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults310 = TestUtils.typeAnalyzeSampleFiles(['paramSpec2.py'], configOptions);
    validateResults(analysisResults310, 0);
});

test('ParamSpec3', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec3.py'], configOptions);
    validateResults(results, 1);
});

test('ParamSpec4', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec4.py'], configOptions);
    validateResults(results, 5);
});

test('ClassVar1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classVar1.py']);

    validateResults(analysisResults, 1);
});

test('ClassVar2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classVar2.py']);

    validateResults(analysisResults, 1);
});

test('TypeVar1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVar1.py']);

    validateResults(analysisResults, 3);
});

test('TypeVar2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVar2.py']);

    validateResults(analysisResults, 0);
});

test('TypeVar3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVar3.py']);

    validateResults(analysisResults, 6);
});

test('Annotated1', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_8;
    const analysisResults38 = TestUtils.typeAnalyzeSampleFiles(['annotated1.py'], configOptions);
    validateResults(analysisResults38, 1);

    configOptions.defaultPythonVersion = PythonVersion.V3_9;
    const analysisResults39 = TestUtils.typeAnalyzeSampleFiles(['annotated1.py'], configOptions);
    validateResults(analysisResults39, 0);
});

test('Circular1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['circular1.py']);

    validateResults(analysisResults, 0);
});

test('TryExcept2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tryExcept2.py']);

    validateResults(analysisResults, 0);
});

test('TryExcept3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tryExcept3.py']);

    validateResults(analysisResults, 0);
});

test('TryExcept4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tryExcept4.py']);

    validateResults(analysisResults, 2);
});

test('Decorator1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['decorator1.py']);

    validateResults(analysisResults, 0);
});

test('Decorator2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['decorator2.py']);

    validateResults(analysisResults, 0);
});

test('FunctionAnnotation1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['functionAnnotation1.py']);

    validateResults(analysisResults, 1);
});

test('FunctionAnnotation2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['functionAnnotation2.py']);

    validateResults(analysisResults, 4);
});

test('FunctionAnnotation3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['functionAnnotation3.py']);

    validateResults(analysisResults, 2);
});

test('Subscript1', () => {
    const configOptions = new ConfigOptions('.');

    // Analyze with Python 3.8 settings.
    configOptions.defaultPythonVersion = PythonVersion.V3_8;
    const analysisResults38 = TestUtils.typeAnalyzeSampleFiles(['subscript1.py'], configOptions);
    validateResults(analysisResults38, 9);

    // Analyze with Python 3.8 settings.
    configOptions.defaultPythonVersion = PythonVersion.V3_9;
    const analysisResults39 = TestUtils.typeAnalyzeSampleFiles(['subscript1.py'], configOptions);
    validateResults(analysisResults39, 0);
});

test('InitSubclass1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['initsubclass1.py']);

    validateResults(analysisResults, 2);
});

test('None1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['none1.py']);

    validateResults(analysisResults, 1);
});
