/*
 * positionUtils.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for positionUtils module.
 */

import assert from 'assert';

import { DiagnosticSink } from '../common/diagnosticSink';
import { getLineEndPosition } from '../common/positionUtils';
import { ParseOptions, Parser } from '../parser/parser';

test('getLineEndOffset', () => {
    const code = 'a = 1';

    verifyLineEnding(code, 0, 5);
});

test('getLineEndOffset with windows style ending at EOF', () => {
    const code = 'a = 1\r\n';

    verifyLineEnding(code, 0, 5);
});

test('getLineEndOffset with windows style ending', () => {
    const code = 'a = 1\r\nb = 1';

    verifyLineEnding(code, 0, 5);
});

test('getLineEndOffset with unix style ending at EOF', () => {
    const code = 'a = 1\n';

    verifyLineEnding(code, 0, 5);
});

test('getLineEndOffset with unix style ending', () => {
    const code = 'a = 1\nb = 1';

    verifyLineEnding(code, 0, 5);
});

test('getLineEndOffset with mixed style ending', () => {
    const code = 'a = 1\r\nb = 1\nc = 1\n';

    verifyLineEnding(code, 0, 5);
    verifyLineEnding(code, 1, 5);
    verifyLineEnding(code, 2, 5);
});

function verifyLineEnding(code: string, line: number, expected: number) {
    const parser = new Parser();
    const parseResults = parser.parseSourceFile(code, new ParseOptions(), new DiagnosticSink());

    assert.strictEqual(getLineEndPosition(parseResults.tokenizerOutput, parseResults.text, line).character, expected);
}
