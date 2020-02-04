/*
 * binder.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Unit tests for pyright name binder.
 */

import * as assert from 'assert';

import * as TestUtils from './testUtils';

test('TryExcept1', () => {
    const analysisResults = TestUtils.bindSampleFile('tryExcept1.py');

    assert.equal(analysisResults.errors.length, 1);
    assert.equal(analysisResults.warnings.length, 0);
});

test('FString1', () => {
    const analysisResults = TestUtils.bindSampleFile('fstring1.py');

    assert.equal(analysisResults.errors.length, 2);
    assert.equal(analysisResults.warnings.length, 0);
});
