/*
 * common.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

import * as assert from 'assert';

import { doRangesOverlap, isPositionInRange, Range, rangesAreEqual, TextRange } from '../common/textRange';

test('textRange create', () => {
    assert.throws(() => TextRange.create(-1, 1), Error);
    assert.throws(() => TextRange.create(1, -1), Error);
});

test('textRange from bounds', () => {
    assert.throws(() => TextRange.fromBounds(-1, 1), Error);
    assert.throws(() => TextRange.fromBounds(1, -1), Error);
});

test('textRange overlap', () => {
    const textRangeOne: Range = {
        start: {
            line: 0,
            character: 0,
        },
        end: {
            line: 10,
            character: 0,
        },
    };

    const textRangeTwo: Range = {
        start: {
            line: 11,
            character: 0,
        },
        end: {
            line: 20,
            character: 0,
        },
    };

    const textRangeThree: Range = {
        start: {
            line: 5,
            character: 0,
        },
        end: {
            line: 15,
            character: 0,
        },
    };

    assert.equal(doRangesOverlap(textRangeOne, textRangeTwo), false);
    assert.equal(doRangesOverlap(textRangeTwo, textRangeOne), false);
    assert.equal(doRangesOverlap(textRangeOne, textRangeThree), true);
});

test('textRange contain', () => {
    const textRangeOne: Range = {
        start: {
            line: 0,
            character: 5,
        },
        end: {
            line: 10,
            character: 1,
        },
    };

    assert.equal(isPositionInRange(textRangeOne, { line: 0, character: 0 }), false);
    assert.equal(isPositionInRange(textRangeOne, { line: 0, character: 5 }), true);
    assert.equal(isPositionInRange(textRangeOne, { line: 5, character: 0 }), true);
    assert.equal(isPositionInRange(textRangeOne, { line: 10, character: 0 }), true);
    assert.equal(isPositionInRange(textRangeOne, { line: 10, character: 1 }), true);
    assert.equal(isPositionInRange(textRangeOne, { line: 10, character: 2 }), false);
});

test('textRange equal', () => {
    const textRangeOne: Range = {
        start: {
            line: 0,
            character: 0,
        },
        end: {
            line: 10,
            character: 0,
        },
    };

    const textRangeTwo: Range = {
        start: {
            line: 0,
            character: 0,
        },
        end: {
            line: 10,
            character: 0,
        },
    };

    const textRangeThree: Range = {
        start: {
            line: 5,
            character: 0,
        },
        end: {
            line: 15,
            character: 0,
        },
    };

    assert.equal(rangesAreEqual(textRangeOne, textRangeTwo), true);
    assert.equal(rangesAreEqual(textRangeTwo, textRangeOne), true);
    assert.equal(rangesAreEqual(textRangeOne, textRangeThree), false);
});
