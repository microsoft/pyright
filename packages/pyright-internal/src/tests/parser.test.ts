/*
 * parser.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Unit tests for Python parser. These are very basic because
 * the parser gets lots of exercise in the type checker tests.
 */

import * as assert from 'assert';

import { findNodeByOffset, getFirstAncestorOrSelfOfKind } from '../analyzer/parseTreeUtils';
import { ExecutionEnvironment, getStandardDiagnosticRuleSet } from '../common/configOptions';
import { DiagnosticSink } from '../common/diagnosticSink';
import { pythonVersion3_13, pythonVersion3_14 } from '../common/pythonVersion';
import { TextRange } from '../common/textRange';
import { UriEx } from '../common/uri/uriUtils';
import { ParseNodeType, StatementListNode } from '../parser/parseNodes';
import { getNodeAtMarker, parseAndGetTestState } from './harness/fourslash/testState';
import * as TestUtils from './testUtils';

test('Empty', () => {
    const diagSink = new DiagnosticSink();
    const parserOutput = TestUtils.parseText('', diagSink).parserOutput;

    assert.equal(diagSink.fetchAndClear().length, 0);
    assert.equal(parserOutput.parseTree.d.statements.length, 0);
});

test('Parser1', () => {
    const diagSink = new DiagnosticSink();
    const parserOutput = TestUtils.parseSampleFile('parser1.py', diagSink).parserOutput;

    assert.equal(diagSink.fetchAndClear().length, 0);
    assert.equal(parserOutput.parseTree.d.statements.length, 4);
});

test('Parser2', () => {
    const diagSink = new DiagnosticSink();
    TestUtils.parseSampleFile('parser2.py', diagSink);
    assert.strictEqual(diagSink.getErrors().length, 0);
});

test('FStringEmptyTuple', () => {
    assert.doesNotThrow(() => {
        const diagSink = new DiagnosticSink();
        TestUtils.parseSampleFile('fstring6.py', diagSink);
    });
});

test('SuiteExpectedColon1', () => {
    const diagSink = new DiagnosticSink();
    TestUtils.parseSampleFile('suiteExpectedColon1.py', diagSink);
    assert.strictEqual(diagSink.getErrors().length, 1);
});

test('SuiteExpectedColon2', () => {
    const diagSink = new DiagnosticSink();
    TestUtils.parseSampleFile('suiteExpectedColon2.py', diagSink);
    assert.strictEqual(diagSink.getErrors().length, 1);
});

test('SuiteExpectedColon3', () => {
    const diagSink = new DiagnosticSink();
    TestUtils.parseSampleFile('suiteExpectedColon3.py', diagSink);
    assert.strictEqual(diagSink.getErrors().length, 1);
});

test('ExpressionWrappedInParens', () => {
    const diagSink = new DiagnosticSink();
    const parserOutput = TestUtils.parseText('(str)', diagSink).parserOutput;

    assert.equal(diagSink.fetchAndClear().length, 0);
    assert.equal(parserOutput.parseTree.d.statements.length, 1);
    assert.equal(parserOutput.parseTree.d.statements[0].nodeType, ParseNodeType.StatementList);

    const statementList = parserOutput.parseTree.d.statements[0] as StatementListNode;
    assert.equal(statementList.d.statements.length, 1);

    // length of node should include parens
    assert.equal(statementList.d.statements[0].nodeType, ParseNodeType.Name);
    assert.equal(statementList.d.statements[0].length, 5);
});

test('MaxParseDepth1', () => {
    const diagSink = new DiagnosticSink();
    TestUtils.parseSampleFile('maxParseDepth1.py', diagSink);
    assert.strictEqual(diagSink.getErrors().length, 1);
});

test('MaxParseDepth2', () => {
    const diagSink = new DiagnosticSink();
    TestUtils.parseSampleFile('maxParseDepth2.py', diagSink);
    assert.strictEqual(diagSink.getErrors().length, 4);
});

test('ModuleName range', () => {
    const code = `
//// from [|/*marker*/...|] import A
        `;

    const state = parseAndGetTestState(code).state;
    const expectedRange = state.getRangeByMarkerName('marker');
    const node = getNodeAtMarker(state);

    assert.strictEqual(node.start, expectedRange?.pos);
    assert.strictEqual(TextRange.getEnd(node), expectedRange?.end);
});

test('ParserRecovery1', () => {
    const diagSink = new DiagnosticSink();
    const parseResults = TestUtils.parseSampleFile('parserRecovery1.py', diagSink);

    const node = findNodeByOffset(parseResults.parserOutput.parseTree, parseResults.text.length - 2);
    const functionNode = getFirstAncestorOrSelfOfKind(node, ParseNodeType.Function);
    assert.equal(functionNode!.parent!.nodeType, ParseNodeType.Module);
});

test('ParserRecovery2', () => {
    const diagSink = new DiagnosticSink();
    const parseResults = TestUtils.parseSampleFile('parserRecovery2.py', diagSink);

    const node = findNodeByOffset(parseResults.parserOutput.parseTree, parseResults.text.length - 2);
    const functionNode = getFirstAncestorOrSelfOfKind(node, ParseNodeType.Function);
    assert.equal(functionNode!.parent!.nodeType, ParseNodeType.Suite);
});

test('ParserRecovery3', () => {
    const diagSink = new DiagnosticSink();
    const parseResults = TestUtils.parseSampleFile('parserRecovery3.py', diagSink);

    const node = findNodeByOffset(parseResults.parserOutput.parseTree, parseResults.text.length - 2);
    const functionNode = getFirstAncestorOrSelfOfKind(node, ParseNodeType.Function);
    assert.equal(functionNode!.parent!.nodeType, ParseNodeType.Module);
});

test('FinallyExit1', () => {
    const execEnvironment = new ExecutionEnvironment(
        'python',
        UriEx.file('.'),
        getStandardDiagnosticRuleSet(),
        /* defaultPythonVersion */ undefined,
        /* defaultPythonPlatform */ undefined,
        /* defaultExtraPaths */ undefined
    );

    const diagSink1 = new DiagnosticSink();
    execEnvironment.pythonVersion = pythonVersion3_13;
    TestUtils.parseSampleFile('finallyExit1.py', diagSink1, execEnvironment);
    assert.strictEqual(diagSink1.getErrors().length, 0);

    const diagSink2 = new DiagnosticSink();
    execEnvironment.pythonVersion = pythonVersion3_14;
    TestUtils.parseSampleFile('finallyExit1.py', diagSink2, execEnvironment);
    assert.strictEqual(diagSink2.getErrors().length, 5);
});

test('TrailingBackslashCRAtEOF', () => {
    // A file that ends with a line-continuation backslash followed by a CR
    // should produce a syntax error.
    const code = '"""Comment"""\n\n\\\r';

    const diagSink = new DiagnosticSink();
    TestUtils.parseText(code, diagSink);
    const errors = diagSink.getErrors();
    assert.strictEqual(errors.length > 0, true);
    assert.ok(errors.some((e) => e.message.includes('Unexpected EOF')));
});

// ============================================================================
// Statement Type Tests
// ============================================================================

test('Statement: if/elif/else', () => {
    const code = `
if x:
    pass
elif y:
    pass
else:
    pass
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
    assert.equal(result.parserOutput.parseTree.d.statements.length, 1);
    assert.equal(result.parserOutput.parseTree.d.statements[0].nodeType, ParseNodeType.If);
});

test('Statement: nested if', () => {
    const code = `
if x:
    if y:
        pass
    else:
        pass
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: while loop', () => {
    const code = `
while True:
    pass
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
    assert.equal(result.parserOutput.parseTree.d.statements[0].nodeType, ParseNodeType.While);
});

test('Statement: while with else', () => {
    const code = `
while x:
    pass
else:
    pass
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: for loop', () => {
    const code = `
for i in range(10):
    pass
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
    assert.equal(result.parserOutput.parseTree.d.statements[0].nodeType, ParseNodeType.For);
});

test('Statement: for with else', () => {
    const code = `
for i in items:
    pass
else:
    pass
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: for with tuple unpacking', () => {
    const code = `
for a, b, c in items:
    pass
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: async for', () => {
    const code = `
async def f():
    async for i in items:
        pass
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: try/except', () => {
    const code = `
try:
    pass
except:
    pass
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
    assert.equal(result.parserOutput.parseTree.d.statements[0].nodeType, ParseNodeType.Try);
});

test('Statement: try/except with type', () => {
    const code = `
try:
    pass
except ValueError:
    pass
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: try/except with type and binding', () => {
    const code = `
try:
    pass
except ValueError as e:
    pass
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: try/except multiple', () => {
    const code = `
try:
    pass
except ValueError:
    pass
except TypeError:
    pass
except:
    pass
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: try/except/else/finally', () => {
    const code = `
try:
    pass
except:
    pass
else:
    pass
finally:
    pass
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: try/finally', () => {
    const code = `
try:
    pass
finally:
    pass
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: except* (exception groups)', () => {
    const code = `
try:
    pass
except* ValueError:
    pass
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: function definition', () => {
    const code = `
def foo():
    pass
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
    assert.equal(result.parserOutput.parseTree.d.statements[0].nodeType, ParseNodeType.Function);
});

test('Statement: function with parameters', () => {
    const code = `
def foo(a, b, c=1, *args, **kwargs):
    pass
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: function with type annotations', () => {
    const code = `
def foo(a: int, b: str = "") -> None:
    pass
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: function with positional-only parameters', () => {
    const code = `
def foo(a, b, /, c, d):
    pass
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: function with keyword-only parameters', () => {
    const code = `
def foo(a, *, b, c):
    pass
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: async function', () => {
    const code = `
async def foo():
    pass
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: class definition', () => {
    const code = `
class Foo:
    pass
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
    assert.equal(result.parserOutput.parseTree.d.statements[0].nodeType, ParseNodeType.Class);
});

test('Statement: class with inheritance', () => {
    const code = `
class Foo(Bar, Baz):
    pass
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: class with metaclass', () => {
    const code = `
class Foo(metaclass=ABCMeta):
    pass
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: class with type parameters', () => {
    const code = `
class Foo[T]:
    pass
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: with statement', () => {
    const code = `
with open("file") as f:
    pass
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
    assert.equal(result.parserOutput.parseTree.d.statements[0].nodeType, ParseNodeType.With);
});

test('Statement: with multiple items', () => {
    const code = `
with open("a") as a, open("b") as b:
    pass
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: with parenthesized items', () => {
    const code = `
with (
    open("a") as a,
    open("b") as b
):
    pass
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: async with', () => {
    const code = `
async def f():
    async with resource:
        pass
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: decorator', () => {
    const code = `
@decorator
def foo():
    pass
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: decorator with arguments', () => {
    const code = `
@decorator(arg1, arg2)
def foo():
    pass
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: multiple decorators', () => {
    const code = `
@decorator1
@decorator2
@decorator3
class Foo:
    pass
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: import', () => {
    const code = `import os`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
    assert.equal(result.parserOutput.parseTree.d.statements[0].nodeType, ParseNodeType.StatementList);
});

test('Statement: import multiple', () => {
    const code = `import os, sys, json`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: import as', () => {
    const code = `import numpy as np`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: import from', () => {
    const code = `from os import path`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: import from multiple', () => {
    const code = `from os import path, getcwd, chdir`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: import from with alias', () => {
    const code = `from os import path as p`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: import from relative', () => {
    const code = `from . import module`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: import from parent', () => {
    const code = `from .. import module`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: import star', () => {
    const code = `from os import *`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: import with parentheses', () => {
    const code = `from os import (
    path,
    getcwd,
    chdir,
)`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: assert', () => {
    const code = `assert x`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: assert with message', () => {
    const code = `assert x, "error message"`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: assignment', () => {
    const code = `x = 1`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: multiple assignment', () => {
    const code = `x = y = z = 1`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: tuple unpacking', () => {
    const code = `a, b, c = (1, 2, 3)`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: augmented assignment', () => {
    const code = `x += 1`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: all augmented assignments', () => {
    const code = `
x += 1
x -= 1
x *= 1
x /= 1
x //= 1
x %= 1
x **= 1
x &= 1
x |= 1
x ^= 1
x <<= 1
x >>= 1
x @= 1
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: annotated assignment', () => {
    const code = `x: int = 1`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: annotated without value', () => {
    const code = `x: int`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: del', () => {
    const code = `del x`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: del multiple', () => {
    const code = `del x, y, z`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: pass', () => {
    const code = `pass`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: break', () => {
    const code = `
while True:
    break
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: continue', () => {
    const code = `
while True:
    continue
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: return', () => {
    const code = `
def foo():
    return
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: return with value', () => {
    const code = `
def foo():
    return 42
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: raise', () => {
    const code = `raise`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: raise with exception', () => {
    const code = `raise ValueError()`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: raise from', () => {
    const code = `raise ValueError() from original`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: global', () => {
    const code = `
def foo():
    global x
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: global multiple', () => {
    const code = `
def foo():
    global x, y, z
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: nonlocal', () => {
    const code = `
def outer():
    x = 1
    def inner():
        nonlocal x
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: match/case basic', () => {
    const code = `
match x:
    case 1:
        pass
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
    assert.equal(result.parserOutput.parseTree.d.statements[0].nodeType, ParseNodeType.Match);
});

test('Statement: match/case multiple', () => {
    const code = `
match x:
    case 1:
        pass
    case 2:
        pass
    case _:
        pass
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: match/case with guard', () => {
    const code = `
match x:
    case n if n > 0:
        pass
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: match/case sequence pattern', () => {
    const code = `
match x:
    case [a, b, c]:
        pass
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: match/case mapping pattern', () => {
    const code = `
match x:
    case {"key": value}:
        pass
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: match/case class pattern', () => {
    const code = `
match x:
    case Point(x=0, y=0):
        pass
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: match/case OR pattern', () => {
    const code = `
match x:
    case 1 | 2 | 3:
        pass
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: match/case AS pattern', () => {
    const code = `
match x:
    case [a, b] as whole:
        pass
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: type alias', () => {
    const code = `type IntList = list[int]`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: type alias with type parameters', () => {
    const code = `type Vector[T] = list[T]`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: function with type parameters', () => {
    const code = `
def foo[T](x: T) -> T:
    return x
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: yield', () => {
    const code = `
def gen():
    yield 1
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: yield from', () => {
    const code = `
def gen():
    yield from other_gen()
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: await', () => {
    const code = `
async def foo():
    await bar()
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: lambda', () => {
    const code = `f = lambda x: x + 1`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: lambda with multiple parameters', () => {
    const code = `f = lambda a, b, c=1: a + b + c`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: lambda with no parameters', () => {
    const code = `f = lambda: 42`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: multiple statements on one line', () => {
    const code = `a = 1; b = 2; c = 3`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: empty lines and comments', () => {
    const code = `
# This is a comment
x = 1

# Another comment

y = 2
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: line continuation', () => {
    const code = `
x = 1 + \\
    2 + \\
    3
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: implicit line continuation in parens', () => {
    const code = `
x = (1 +
     2 +
     3)
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});

test('Statement: walrus operator', () => {
    const code = `
if (n := len(items)) > 0:
    pass
`;
    const diagSink = new DiagnosticSink();
    const result = TestUtils.parseText(code, diagSink);
    assert.equal(diagSink.getErrors().length, 0);
});
