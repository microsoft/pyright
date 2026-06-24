/*
 * completionProviderUtils.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for helpers in completionProviderUtils.ts.
 */

import assert from 'assert';

import { detectTrailingOverlap } from '../languageService/completionProviderUtils';

describe('detectTrailingOverlap', () => {
    test('returns undefined for empty tail', () => {
        assert.strictEqual(detectTrailingOverlap('', '=foo', 'adjacent'), undefined);
    });

    test('returns undefined when tail contains a non-allow-listed char', () => {
        assert.strictEqual(detectTrailingOverlap('a', 'a)', 'adjacent'), undefined);
        assert.strictEqual(detectTrailingOverlap('=a', '=a)', 'adjacent'), undefined);
        assert.strictEqual(detectTrailingOverlap(' ', ' )', 'adjacent'), undefined);
    });

    test('adjacent policy matches when tail is immediately present', () => {
        const result = detectTrailingOverlap('=', '="value")', 'adjacent');
        assert.deepStrictEqual(result, { consumedChars: 1 });
    });

    test('adjacent policy does not skip whitespace', () => {
        assert.strictEqual(detectTrailingOverlap('=', ' ="value")', 'adjacent'), undefined);
        assert.strictEqual(detectTrailingOverlap('(', ' (arg)', 'adjacent'), undefined);
    });

    test('adjacent policy returns undefined when tail is missing', () => {
        assert.strictEqual(detectTrailingOverlap('=', 'value)', 'adjacent'), undefined);
        assert.strictEqual(detectTrailingOverlap('=', '', 'adjacent'), undefined);
    });

    test('skipInlineWhitespace policy skips spaces and tabs before the tail', () => {
        assert.deepStrictEqual(detectTrailingOverlap('(', '  (arg)', 'skipInlineWhitespace'), {
            consumedChars: 3,
        });
        assert.deepStrictEqual(detectTrailingOverlap('(', '\t(arg)', 'skipInlineWhitespace'), {
            consumedChars: 2,
        });
        assert.deepStrictEqual(detectTrailingOverlap('(', '(arg)', 'skipInlineWhitespace'), {
            consumedChars: 1,
        });
    });

    test('skipInlineWhitespace does not skip newlines', () => {
        assert.strictEqual(detectTrailingOverlap('(', '\n(arg)', 'skipInlineWhitespace'), undefined);
        assert.strictEqual(detectTrailingOverlap('(', '\r\n(arg)', 'skipInlineWhitespace'), undefined);
    });

    test('multi-character tail matches verbatim', () => {
        assert.deepStrictEqual(detectTrailingOverlap('()', '()', 'adjacent'), { consumedChars: 2 });
        assert.strictEqual(detectTrailingOverlap('()', '(x)', 'adjacent'), undefined);
    });
});
