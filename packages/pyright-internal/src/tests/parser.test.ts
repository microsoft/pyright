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
import { DiagnosticSink } from '../common/diagnosticSink';
import { TextRange } from '../common/textRange';
import { ParseNodeType, StatementListNode } from '../parser/parseNodes';
import { getNodeAtMarker, parseAndGetTestState } from './harness/fourslash/testState';
import * as TestUtils from './testUtils';

test('Empty', () => {
    const diagSink = new DiagnosticSink();
    const parserOutput = TestUtils.parseText('', diagSink).parserOutput;

    assert.equal(diagSink.fetchAndClear().length, 0);
    assert.equal(parserOutput.parseTree.statements.length, 0);
});

test('Parser1', () => {
    const diagSink = new DiagnosticSink();
    const parserOutput = TestUtils.parseSampleFile('parser1.py', diagSink).parserOutput;

    assert.equal(diagSink.fetchAndClear().length, 0);
    assert.equal(parserOutput.parseTree.statements.length, 4);
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
    assert.equal(parserOutput.parseTree.statements.length, 1);
    assert.equal(parserOutput.parseTree.statements[0].nodeType, ParseNodeType.StatementList);

    const statementList = parserOutput.parseTree.statements[0] as StatementListNode;
    assert.equal(statementList.statements.length, 1);

    // length of node should include parens
    assert.equal(statementList.statements[0].nodeType, ParseNodeType.Name);
    assert.equal(statementList.statements[0].length, 5);
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
