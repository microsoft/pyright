/*
* semanticAnalyzer.test.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Unit tests for pyright semantic analyzer.
*/

import * as assert from 'assert';

import { TestUtils } from './testUtils';

test('TryExcept1', () => {
    let analysisResults = TestUtils.semanticallyAnalyzeSampleFile('tryExcept1.py');

    assert.equal(analysisResults.errors.length, 1);
    assert.equal(analysisResults.warnings.length, 0);
});
