/*
 * testOnlyCacheTransaction.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Tests for the opt-in exact-node experiment transaction.
 */

import * as assert from 'assert';

import { useTestOnlyCacheIsolation } from '../analyzer/typeCacheUtils';
import { OperationCanceledException } from '../common/cancellationUtils';

test('TestOnlyCacheTransactionCommitsSelectedEntries', () => {
    const original = {};
    const unrelated = {};
    const replacement = {};
    const cache = new Map<number, object | undefined>([
        [1, original],
        [2, unrelated],
        [4, undefined],
    ]);
    const result = useTestOnlyCacheIsolation(
        cache,
        new Set([1, 3, 4]),
        () => {
            assert.ok(!cache.has(1) && !cache.has(3) && !cache.has(4));
            assert.strictEqual(cache.get(2), unrelated);
            cache.set(1, replacement);
            cache.set(3, undefined);
            return replacement;
        },
        true
    );
    assert.strictEqual(result, replacement);
    assert.strictEqual(cache.get(1), replacement);
    assert.strictEqual(cache.get(2), unrelated);
    assert.ok(cache.has(3) && !cache.has(4));
});

test('TestOnlyCacheTransactionRollsBackFailures', () => {
    for (const error of [new Error('failure'), new OperationCanceledException()]) {
        const original = {};
        const unrelated = {};
        const cache = new Map<number, object | undefined>([
            [1, original],
            [2, unrelated],
            [4, undefined],
        ]);
        assert.throws(
            () =>
                useTestOnlyCacheIsolation(
                    cache,
                    new Set([1, 3, 4]),
                    () => {
                        cache.set(1, {});
                        cache.set(3, {});
                        cache.set(4, {});
                        throw error;
                    },
                    true
                ),
            (caught) => caught === error
        );
        assert.strictEqual(cache.get(1), original);
        assert.strictEqual(cache.get(2), unrelated);
        assert.ok(!cache.has(3) && cache.has(4));
        assert.strictEqual(cache.get(4), undefined);
    }
});
