/*
 * typeCacheUtils.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Microsoft Corporation.
 *
 * Unit tests for type cache utilities.
 */

import * as assert from 'assert';

import {
    addContextualTypeCacheEntry,
    ContextualTypeCacheEntry,
    contextualTypeCacheEntryMatches,
    findContextualTypeCacheEntry,
    SpeculativeTypeTracker,
} from '../analyzer/typeCacheUtils';
import { Type, TypeVarType } from '../analyzer/types';
import { OperationCanceledException } from '../common/cancellationUtils';
import { DiagnosticSink } from '../common/diagnosticSink';
import { ParseNodeType } from '../parser/parseNodes';
import { parseText } from './testUtils';

interface TestCacheEntry extends ContextualTypeCacheEntry {
    value: number;
}

test.each(['complete', 'error', 'cancel'] as const)(
    'Exact-node isolation preserves disjoint native speculative contexts: %s',
    (outcome) => {
        const module = parseText('first\nsecond\nthird\n', new DiagnosticSink()).parserOutput.parseTree;
        const [first, second, third] = module.d.statements;
        assert.ok(first.nodeType === ParseNodeType.StatementList && second.nodeType === ParseNodeType.StatementList);
        const firstValue = first.d.statements[0];
        const secondValue = second.d.statements[0];
        assert.strictEqual(firstValue.parent, first);
        const tracker = new SpeculativeTypeTracker();
        const type = TypeVarType.createInstance('T');
        const cache = new Map([[secondValue.id, type]]);
        tracker.enterSpeculativeContext(secondValue, { dependentType: type });
        tracker.trackEntry(cache, secondValue.id);
        tracker.addSpeculativeType(secondValue, { type }, 0, undefined);
        const original = tracker.getSpeculativeType(secondValue, undefined);
        assert.ok(original);
        assert.equal(tracker.canUseNodeCacheIsolation(first), true);
        assert.equal(tracker.canUseNodeCacheIsolation(second), false);
        assert.equal(tracker.canUseNodeCacheIsolation(secondValue), false);
        assert.equal(tracker.canUseNodeCacheIsolation(module), false);
        assert.throws(() => tracker.useNodeCacheIsolation(new Set([secondValue.id]), () => {}, second));
        const error = outcome === 'cancel' ? new OperationCanceledException() : new Error('trial interruption');
        const isolated = () =>
            tracker.useNodeCacheIsolation(
                new Set([first.id, firstValue.id]),
                () => {
                    assert.strictEqual(tracker.getSpeculativeType(secondValue, undefined), original);
                    tracker.enterSpeculativeContext(firstValue);
                    try {
                        assert.equal(tracker.canUseNodeCacheIsolation(first), false);
                        assert.equal(tracker.canUseNodeCacheIsolation(third), true);
                        tracker.addSpeculativeType(firstValue, { type }, 0, undefined);
                        if (outcome !== 'complete') {
                            throw error;
                        }
                        return type;
                    } finally {
                        tracker.leaveSpeculativeContext();
                    }
                },
                first
            );
        if (outcome === 'complete') {
            assert.strictEqual(isolated(), type);
        } else {
            assert.throws(isolated, (caught) => caught === error);
        }
        assert.strictEqual(tracker.getSpeculativeType(secondValue, undefined), original);
        assert.strictEqual(cache.get(secondValue.id), type);
        tracker.enterSpeculativeContext(firstValue);
        assert.equal(tracker.getSpeculativeType(firstValue, undefined), undefined);
        tracker.leaveSpeculativeContext();
        tracker.leaveSpeculativeContext();
        assert.equal(cache.has(secondValue.id), false);
        assert.equal(tracker.isSpeculative(undefined), false);
        tracker.enterSpeculativeContext(second);
        assert.equal(tracker.canUseNodeCacheIsolation(secondValue), false);
        assert.throws(() => tracker.useNodeCacheIsolation(new Set([secondValue.id]), () => {}, secondValue));
        tracker.leaveSpeculativeContext();
    }
);

test('ContextualTypeCacheEntryMatching', () => {
    const expectedType = TypeVarType.createInstance('T');
    const otherExpectedType = TypeVarType.createInstance('U');
    const entry: TestCacheEntry = { expectedType, value: 1 };
    const noExpectedTypeEntry: TestCacheEntry = { expectedType: undefined, value: 2 };

    assert.ok(contextualTypeCacheEntryMatches(entry, expectedType));
    assert.ok(!contextualTypeCacheEntryMatches(entry, otherExpectedType));
    assert.ok(!contextualTypeCacheEntryMatches(entry, undefined));
    assert.ok(contextualTypeCacheEntryMatches(noExpectedTypeEntry, undefined));
});

test('ContextualTypeCacheEntryReplacementAndEviction', () => {
    const expectedTypes: Type[] = Array.from({ length: 9 }, (_, index) => TypeVarType.createInstance(`T${index}`));
    let entries: TestCacheEntry[] = [];

    expectedTypes.forEach((expectedType, index) => {
        entries = addContextualTypeCacheEntry(entries, { expectedType, value: index });
    });

    assert.deepStrictEqual(
        entries.map((entry) => entry.value),
        [1, 2, 3, 4, 5, 6, 7, 8]
    );

    entries = addContextualTypeCacheEntry(entries, { expectedType: expectedTypes[4], value: 9 });
    assert.deepStrictEqual(
        entries.map((entry) => entry.value),
        [1, 2, 3, 5, 6, 7, 8, 9]
    );

    entries = addContextualTypeCacheEntry(
        entries,
        { expectedType: undefined, value: 10 },
        (entry) => entry.value !== 2
    );
    assert.deepStrictEqual(
        entries.map((entry) => entry.value),
        [1, 3, 5, 6, 7, 8, 9, 10]
    );
});

test('ContextualTypeCacheEntryLookup', () => {
    const firstExpectedType = TypeVarType.createInstance('T');
    const latestExpectedType = TypeVarType.createInstance('U');
    const equivalentExpectedType = TypeVarType.cloneForNewName(firstExpectedType, 'T');
    const entries: TestCacheEntry[] = [
        { expectedType: firstExpectedType, value: 1 },
        { expectedType: undefined, value: 2 },
        { expectedType: latestExpectedType, value: 3 },
    ];

    assert.strictEqual(findContextualTypeCacheEntry(entries, latestExpectedType)?.value, 3);
    assert.strictEqual(findContextualTypeCacheEntry(entries, firstExpectedType)?.value, 1);
    assert.strictEqual(findContextualTypeCacheEntry(entries, equivalentExpectedType)?.value, 1);
    assert.strictEqual(findContextualTypeCacheEntry(entries, undefined)?.value, 2);
    assert.strictEqual(findContextualTypeCacheEntry(entries, TypeVarType.createInstance('V')), undefined);
});
