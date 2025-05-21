/*
 * positionUtils.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for positionUtils module.
 */

import assert from 'assert';

import { DiagnosticSink } from '../common/diagnosticSink';
import { convertOffsetToPosition, convertPositionToOffset, getLineEndPosition } from '../common/positionUtils';
import { ParseOptions, Parser } from '../parser/parser';
import { Tokenizer } from '../parser/tokenizer';

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

test('End of file position and offset conversion', () => {
    const code = 'hello\n';

    const t = new Tokenizer();
    const results = t.tokenize(code);

    const position = convertOffsetToPosition(code.length, results.lines);
    assert.strictEqual(position.line, 1);

    const offset = convertPositionToOffset(position, results.lines);
    assert.strictEqual(offset, code.length);
});

function verifyLineEnding(code: string, line: number, expected: number) {
    const parser = new Parser();
    const parseResults = parser.parseSourceFile(code, new ParseOptions(), new DiagnosticSink());

    assert.strictEqual(getLineEndPosition(parseResults.tokenizerOutput, parseResults.text, line).character, expected);
}
