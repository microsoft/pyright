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
} from '../analyzer/typeCacheUtils';
import { Type, TypeVarType } from '../analyzer/types';

interface TestCacheEntry extends ContextualTypeCacheEntry {
    value: number;
}

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
