/*
 * docStringUtils.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for the docStringUtils.ts module.
 */

import * as assert from 'assert';

import { decodeDocString } from '../analyzer/docStringUtils';

test('EmptyDocString', () => {
    const input = '';
    const result = decodeDocString(input);
    assert.equal(result, '');
});

test('OneLine', () => {
    const input = 'Simple text';
    const result = decodeDocString(input);
    assert.equal(result, input);
});

test('OneLineLeftTrim', () => {
    const input = '    Simple text';
    const result = decodeDocString(input);
    assert.equal(result, input);
});

test('OneLineRightTrim', () => {
    const input = 'Simple text';
    const inputWithSpaces = input + '      ';
    const result = decodeDocString(inputWithSpaces);
    assert.equal(result, input);
});

test('OneLineTrimBoth', () => {
    const input = '  Simple text';
    const inputWithSpaces = input + '      ';
    const result = decodeDocString(inputWithSpaces);
    assert.equal(result, input);
});

test('TwoLines', () => {
    const input = 'Simple text';
    const inputWithSpaces = input + '   \n    ';
    const result = decodeDocString(inputWithSpaces);
    assert.equal(result, input);
});

test('TwoLinesIndentation', () => {
    const input = 'Line 1  \n    Line2  \n      Line3\n    Line4\n    ';
    const result = decodeDocString(input);
    assert.equal(result, 'Line 1\nLine2\n  Line3\nLine4');
});
