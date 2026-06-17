/*
 * positionUtils.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for positionUtils module.
 */

import assert from 'assert';

import { DiagnosticSink } from '../common/diagnosticSink';
import {
    convertOffsetsToRange,
    convertOffsetToPosition,
    convertPositionToOffset,
    getLineEndPosition,
} from '../common/positionUtils';
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

test('convertOffsetsToRange matches two independent offset conversions', () => {
    // The same-line fast path in convertOffsetsToRange must produce results that
    // are byte-for-byte identical to converting the start and end offsets
    // independently, across single-line, multi-line, boundary and EOF cases.
    const code = ['def foo(bar):', '    baz = bar', '', 'class C:\r', '    x = 1\r', 'last = 2'].join('\n');

    const t = new Tokenizer();
    const lines = t.tokenize(code).lines;

    for (let startOffset = 0; startOffset <= code.length; startOffset++) {
        for (let endOffset = startOffset; endOffset <= code.length; endOffset++) {
            const actual = convertOffsetsToRange(startOffset, endOffset, lines);
            const expected = {
                start: convertOffsetToPosition(startOffset, lines),
                end: convertOffsetToPosition(endOffset, lines),
            };
            assert.deepStrictEqual(
                actual,
                expected,
                `mismatch for offsets [${startOffset}, ${endOffset}]: ` +
                    `${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`
            );
        }
    }
});

test('convertOffsetsToRange handles an empty file', () => {
    const lines = new Tokenizer().tokenize('').lines;
    assert.deepStrictEqual(convertOffsetsToRange(0, 0, lines), {
        start: { line: 0, character: 0 },
        end: { line: 0, character: 0 },
    });
});

function verifyLineEnding(code: string, line: number, expected: number) {
    const parser = new Parser();
    const parseResults = parser.parseSourceFile(code, new ParseOptions(), new DiagnosticSink());

    assert.strictEqual(getLineEndPosition(parseResults.tokenizerOutput, parseResults.text, line).character, expected);
}
