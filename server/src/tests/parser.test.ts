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

import { DiagnosticSink } from '../common/diagnosticSink';
import * as TestUtils from './testUtils';

test('Empty', () => {
    const diagSink = new DiagnosticSink();
    const parseResults = TestUtils.parseText('', diagSink);

    assert.equal(diagSink.fetchAndClear().length, 0);
    assert.equal(parseResults.parseTree.statements.length, 0);
});

test('Sample1', () => {
    const diagSink = new DiagnosticSink();
    const parseInfo = TestUtils.parseSampleFile('sample1.py', diagSink);

    assert.equal(diagSink.fetchAndClear().length, 0);
    assert.equal(parseInfo.parseResults.parseTree.statements.length, 4);
});

test('TypeSyntax1', () => {
    const diagSink = new DiagnosticSink();
    TestUtils.parseSampleFile('typeSyntax1.py', diagSink);

    assert.equal(diagSink.fetchAndClear().length, 13);
});
