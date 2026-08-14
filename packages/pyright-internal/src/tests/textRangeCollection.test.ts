/*
 * textRangeCollection.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for TextRangeCollection, focused on the last-hit memo added to
 * getItemContaining. The memo is a hint that is re-validated on every call, so it
 * must return exactly what the underlying binary search (getIndexContaining) returns
 * regardless of the order positions are queried, including for gap and boundary cases.
 */

import assert from 'assert';

import { TextRange } from '../common/textRange';
import { getIndexContaining, TextRangeCollection } from '../common/textRangeCollection';

function ranges(spec: [start: number, length: number][]): TextRange[] {
    return spec.map(([start, length]) => TextRange.create(start, length));
}

// Independent linear-scan oracle for the default (contains) predicate that mirrors the
// pre-guards of getItemContaining.
function bruteContaining(items: TextRange[], position: number): number {
    if (items.length === 0) {
        return -1;
    }
    const start = items[0].start;
    const end = items[items.length - 1].start + items[items.length - 1].length;
    if (position < start || position > end) {
        return -1;
    }
    for (let i = 0; i < items.length; i++) {
        if (TextRange.contains(items[i], position)) {
            return i;
        }
    }
    return -1;
}

function shuffled(values: number[], seed: number): number[] {
    const result = [...values];
    let state = seed >>> 0;
    const rand = () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x100000000;
    };
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

function positionsToProbe(items: TextRange[]): number[] {
    const end = items.length > 0 ? items[items.length - 1].start + items[items.length - 1].length : 0;
    const forward: number[] = [];
    for (let p = -1; p <= end + 1; p++) {
        forward.push(p);
    }
    return forward;
}

// For each access order, a single warm collection (carrying memo state) must agree with
// both a fresh collection and the independent oracle for every probed position.
function verifyAllOrders(items: TextRange[]) {
    const probes = positionsToProbe(items);
    const orders: { name: string; positions: number[] }[] = [
        { name: 'forward', positions: probes },
        { name: 'reverse', positions: [...probes].reverse() },
        { name: 'random', positions: shuffled(probes, 0x1234567) },
        { name: 'repeated', positions: probes.flatMap((p) => [p, p, p]) },
    ];

    for (const order of orders) {
        const warm = new TextRangeCollection(items);
        for (const position of order.positions) {
            const actual = warm.getItemContaining(position);
            const expected = bruteContaining(items, position);
            assert.strictEqual(
                actual,
                expected,
                `[${order.name}] getItemContaining(${position}) => ${actual}, expected ${expected}`
            );

            // Cold collection (memo starts fresh) must also agree, proving warm memo
            // state never alters the result.
            const cold = new TextRangeCollection(items).getItemContaining(position);
            assert.strictEqual(actual, cold, `[${order.name}] warm/cold mismatch at ${position}`);
        }
    }
}

test('getItemContaining on a contiguous (line-like) collection', () => {
    // Contiguous, non-overlapping ranges covering [0, 23), like tokenizer line ranges.
    verifyAllOrders(
        ranges([
            [0, 5],
            [5, 5],
            [10, 10],
            [20, 3],
        ])
    );
});

test('getItemContaining preserves -1 gap semantics on a non-contiguous collection', () => {
    // Gaps between items (positions 3-9 and 13-19) must always return -1, even when the
    // memo points at an adjacent item from a prior lookup.
    const items = ranges([
        [0, 3],
        [10, 3],
        [20, 3],
    ]);

    // Sanity: gaps really do resolve to -1.
    assert.strictEqual(bruteContaining(items, 5), -1);
    assert.strictEqual(bruteContaining(items, 15), -1);

    verifyAllOrders(items);
});

test('getItemContaining on an empty collection returns -1', () => {
    const collection = new TextRangeCollection<TextRange>([]);
    for (const position of [-1, 0, 1, 100]) {
        assert.strictEqual(collection.getItemContaining(position), -1);
    }
});

test('getItemContaining on a single-item collection', () => {
    verifyAllOrders(ranges([[4, 3]]));
});

test('getItemContaining matches getIndexContaining across a randomized order', () => {
    // The memoized method must agree with the underlying (memo-free) module function for
    // every position, in any order.
    const items = ranges([
        [0, 2],
        [2, 4],
        [6, 1],
        [7, 8],
        [15, 5],
    ]);
    const warm = new TextRangeCollection(items);
    const end = items[items.length - 1].start + items[items.length - 1].length;

    const probes: number[] = [];
    for (let p = 0; p < end; p++) {
        probes.push(p);
    }

    for (const position of shuffled(probes, 0xabcdef)) {
        const viaMethod = warm.getItemContaining(position);
        const viaModule = getIndexContaining(items, position);
        assert.strictEqual(viaMethod, viaModule, `mismatch at ${position}: ${viaMethod} !== ${viaModule}`);
    }
});
