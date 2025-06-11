/*
 * stringUtils.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

import * as assert from 'assert';

import * as core from '../common/core';
import * as utils from '../common/stringUtils';

test('stringUtils isPatternInSymbol', () => {
    assert.equal(utils.isPatternInSymbol('', 'abcd'), true);

    assert.equal(utils.isPatternInSymbol('abcd', 'abcd'), true);
    assert.equal(utils.isPatternInSymbol('abc', 'abcd'), true);

    assert.equal(utils.isPatternInSymbol('ABCD', 'abcd'), true);
    assert.equal(utils.isPatternInSymbol('ABC', 'abcd'), true);

    assert.equal(utils.isPatternInSymbol('acbd', 'abcd'), false);
    assert.equal(utils.isPatternInSymbol('abce', 'abcd'), false);
    assert.equal(utils.isPatternInSymbol('abcde', 'abcd'), false);
    assert.equal(utils.isPatternInSymbol('azcde', 'abcd'), false);
    assert.equal(utils.isPatternInSymbol('acde', 'abcd'), false);
    assert.equal(utils.isPatternInSymbol('zbcd', 'abcd'), false);
});

test('CoreCompareStringsCaseInsensitive1', () => {
    assert.equal(utils.compareStringsCaseInsensitive('Hello', 'hello'), core.Comparison.EqualTo);
});

test('CoreCompareStringsCaseInsensitive2', () => {
    assert.equal(utils.compareStringsCaseInsensitive('Hello', undefined), core.Comparison.GreaterThan);
});

test('CoreCompareStringsCaseInsensitive3', () => {
    assert.equal(utils.compareStringsCaseInsensitive(undefined, 'hello'), core.Comparison.LessThan);
});

test('CoreCompareStringsCaseInsensitive4', () => {
    assert.equal(utils.compareStringsCaseInsensitive(undefined, undefined), core.Comparison.EqualTo);
});

test('CoreCompareStringsCaseSensitive', () => {
    assert.equal(utils.compareStringsCaseSensitive('Hello', 'hello'), core.Comparison.LessThan);
});
