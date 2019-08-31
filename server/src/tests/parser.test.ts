/*
* parser.test.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Unit tests for Python parser.
*/

import * as assert from 'assert';

import { DiagnosticSink } from '../common/diagnosticSink';
import { TestUtils } from './testUtils';

test('Empty', () => {
    const diagSink = new DiagnosticSink();
    const parseResults = TestUtils.parseText('', diagSink);

    assert.equal(diagSink.diagnostics.length, 0);
    assert.equal(parseResults.parseTree.statements.length, 0);
});

test('Sample1', () => {
    const diagSink = new DiagnosticSink();
    const parseResults = TestUtils.parseSampleFile('sample1.py', diagSink);

    assert.equal(diagSink.diagnostics.length, 0);
    assert.equal(parseResults.parseTree.statements.length, 4);
});
