/*
* stringUtils.test.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
*/

import * as assert from 'assert';
import * as utils from '../common/stringUtils';
import * as core from '../common/core';

test('CoreCompareStringsCaseInsensitive1', () => {
    assert.equal(utils.compareStringsCaseInsensitive("Hello", "hello"), core.Comparison.EqualTo);
});

test('CoreCompareStringsCaseInsensitive2', () => {
    assert.equal(utils.compareStringsCaseInsensitive("Hello", undefined), core.Comparison.GreaterThan);
});

test('CoreCompareStringsCaseInsensitive3', () => {
    assert.equal(utils.compareStringsCaseInsensitive(undefined, "hello"), core.Comparison.LessThan);
});

test('CoreCompareStringsCaseInsensitive4', () => {
    assert.equal(utils.compareStringsCaseInsensitive(undefined, undefined), core.Comparison.EqualTo);
});

test('CoreCompareStringsCaseSensitive', () => {
    assert.equal(utils.compareStringsCaseSensitive("Hello", "hello"), core.Comparison.LessThan);
});
