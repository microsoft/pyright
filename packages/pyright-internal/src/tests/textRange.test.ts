/*
 * textRange.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

import * as assert from 'assert';

import { TextRange } from '../common/textRange';

test('textRange combine', () => {
    const range1 = TextRange.create(10, 2);
    const range2 = TextRange.create(12, 2);
    const range3 = TextRange.create(8, 2);

    const combined = TextRange.combine([range1, range2, range3]);

    assert.ok(combined);
    assert.equal(combined.start, 8);
    assert.equal(combined.length, 6);

    // Ensure input ranges are unchanged
    assert.equal(range1.start, 10);
    assert.equal(range1.length, 2);
    assert.equal(range2.start, 12);
    assert.equal(range2.length, 2);
    assert.equal(range3.start, 8);
    assert.equal(range3.length, 2);
});
