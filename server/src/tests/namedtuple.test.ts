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

test('NamedTuple', () => {
    let [analysisResult] = TestUtils.typeAnalyzeSampleFiles(['namedtuple.py']);

    assert.equal(analysisResult.errors.length, 0);
    assert.equal(analysisResult.warnings.length, 0);
});

test('NamedTuple field name error', () => {
  let [analysisResult] = TestUtils.typeAnalyzeSampleFiles(['namedtuple2.py']);

  assert.equal(analysisResult.errors.length, 1);
  assert.ok(/start with _/.test(analysisResult.errors[0].message));
  assert.equal(analysisResult.warnings.length, 0);
});
