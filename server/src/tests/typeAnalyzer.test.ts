/*
* typeAnalyzer.test.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Unit tests for pyright type analyzer.
*/

import * as assert from 'assert';

import { AnalyzerNodeInfo } from '../analyzer/analyzerNodeInfo';
import { ScopeType } from '../analyzer/scope';
import { ConfigOptions } from '../common/configOptions';
import StringMap from '../common/stringMap';
import { TestUtils } from './testUtils';

test('Builtins1', () => {
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['builtins1.py']);

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

    const moduleScope = AnalyzerNodeInfo.getScope(analysisResults[0].parseResults!.parseTree)!;
    assert.notEqual(moduleScope, undefined);

    const builtinsScope = moduleScope.getParent()!;
    assert.notEqual(builtinsScope, undefined);
    assert.equal(builtinsScope.getType(), ScopeType.BuiltIn);

    // Make sure all the expected symbols are present.
    const builtinsSymbolTable = builtinsScope.getSymbolTable();
    for (const symbolName of expectedBuiltinsSymbols) {
        const symbol = moduleScope.lookUpSymbolRecursive(symbolName);
        if (symbol === undefined) {
            assert.fail(`${ symbolName } is missing from builtins scope`);
        }
    }

    // Make sure the builtins scope doesn't contain symbols that
    // shouldn't be present.
    const symbolMap = new StringMap<string>();
    for (const symbolName of expectedBuiltinsSymbols) {
        symbolMap.set(symbolName, symbolName);
    }

    for (const builtinName of builtinsSymbolTable.getKeys()) {
        const symbolInfo = moduleScope.lookUpSymbolRecursive(builtinName);
        if (symbolInfo && symbolInfo.isBeyondLocalScope) {
            if (symbolMap.get(builtinName) === undefined) {
                assert.fail(`${ builtinName } should not be in builtins scope`);
            }
        }
    }
});

test('TypeConstraint1', () => {
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeConstraint1.py']);

    assert.equal(analysisResults.length, 1);
    assert.equal(analysisResults[0].errors.length, 6);
});

test('TypeConstraint2', () => {
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeConstraint2.py']);

    assert.equal(analysisResults.length, 1);
    assert.equal(analysisResults[0].errors.length, 4);
});

test('CircularBaseClass', () => {
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['circularBaseClass.py']);

    assert.equal(analysisResults.length, 1);
    assert.equal(analysisResults[0].errors.length, 6);
});

test('ReturnTypes1', () => {
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['returnTypes1.py']);

    assert.equal(analysisResults.length, 1);
    assert.equal(analysisResults[0].errors.length, 2);
});

test('Specialization1', () => {
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['specialization1.py']);

    assert.equal(analysisResults.length, 1);
    assert.equal(analysisResults[0].errors.length, 4);
});

test('Expressions1', () => {
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['expressions1.py']);

    assert.equal(analysisResults.length, 1);
    assert.equal(analysisResults[0].errors.length, 2);
});

test('Expressions2', () => {
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['expressions2.py']);

    assert.equal(analysisResults.length, 1);
    assert.equal(analysisResults[0].errors.length, 1);
});

test('Expressions3', () => {
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['expressions3.py']);

    assert.equal(analysisResults.length, 1);
    assert.equal(analysisResults[0].errors.length, 1);
});

test('Lambda1', () => {
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['lambda1.py']);

    assert.equal(analysisResults.length, 1);
    assert.equal(analysisResults[0].errors.length, 5);
});

test('Function1', () => {
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['function1.py']);

    assert.equal(analysisResults.length, 1);
    assert.equal(analysisResults[0].errors.length, 5);
});

test('Annotations1', () => {
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['annotations1.py']);

    assert.equal(analysisResults.length, 1);
    assert.equal(analysisResults[0].errors.length, 2);
});

test('Execution1', () => {
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['execution1.py']);

    assert.equal(analysisResults.length, 1);
    assert.equal(analysisResults[0].errors.length, 2);
});

test('Optional1', () => {
    const configOptions = new ConfigOptions('.');

    // By default, optional diagnostics are ignored.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['optional1.py'], configOptions);
    assert.equal(analysisResults.length, 1);
    assert.equal(analysisResults[0].errors.length, 0);
    assert.equal(analysisResults[0].warnings.length, 0);

    // Turn on warnings.
    configOptions.reportOptionalSubscript = 'warning';
    configOptions.reportOptionalMemberAccess = 'warning';
    configOptions.reportOptionalCall = 'warning';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['optional1.py'], configOptions);
    assert.equal(analysisResults.length, 1);
    assert.equal(analysisResults[0].errors.length, 0);
    assert.equal(analysisResults[0].warnings.length, 3);

    // Turn on errors.
    configOptions.reportOptionalSubscript = 'error';
    configOptions.reportOptionalMemberAccess = 'error';
    configOptions.reportOptionalCall = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['optional1.py'], configOptions);
    assert.equal(analysisResults.length, 1);
    assert.equal(analysisResults[0].errors.length, 3);
    assert.equal(analysisResults[0].warnings.length, 0);
});

test('Tuples1', () => {
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuples1.py']);

    assert.equal(analysisResults.length, 1);
    assert.equal(analysisResults[0].errors.length, 4);
});

test('DataClass1', () => {
    let [analysisResult] = TestUtils.typeAnalyzeSampleFiles(['dataclass1.py']);

    assert.equal(analysisResult.errors.length, 0);
    assert.equal(analysisResult.warnings.length, 0);
});

test('DataClass2', () => {
    let [analysisResult] = TestUtils.typeAnalyzeSampleFiles(['dataclass2.py']);

    assert.equal(analysisResult.errors.length, 1);
    assert.ok(/start with _/.test(analysisResult.errors[0].message));
    assert.equal(analysisResult.warnings.length, 0);
});

test('DataClass3', () => {
    let [analysisResult] = TestUtils.typeAnalyzeSampleFiles(['dataclass3.py']);

    assert.equal(analysisResult.errors.length, 2);
    assert.equal(analysisResult.warnings.length, 0);
});

test('DataClass4', () => {
    let [analysisResult] = TestUtils.typeAnalyzeSampleFiles(['dataclass4.py']);

    assert.equal(analysisResult.errors.length, 2);
    assert.equal(analysisResult.warnings.length, 0);
});

test('AbstractClass1', () => {
    let [analysisResult] = TestUtils.typeAnalyzeSampleFiles(['abstractClass1.py']);

    assert.equal(analysisResult.errors.length, 2);
    assert.equal(analysisResult.warnings.length, 0);
});

test('Module1', () => {
    let [analysisResult] = TestUtils.typeAnalyzeSampleFiles(['module1.py']);

    assert.equal(analysisResult.errors.length, 0);
    assert.equal(analysisResult.warnings.length, 0);
});
