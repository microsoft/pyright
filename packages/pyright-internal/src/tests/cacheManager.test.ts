/*
 * cacheManager.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for cache manager
 */

import assert from 'assert';

import { CacheManager, CacheOwner } from '../analyzer/cacheManager';

test('basic', () => {
    const manager = new CacheManager();
    const mock = new MockCacheOwner(10);

    manager.registerCacheOwner(mock);
    assert.strictEqual(manager.getCacheUsage(), 10);

    manager.unregisterCacheOwner(mock);
    assert.strictEqual(manager.getCacheUsage(), 0);
});

test('nested stopTracking', () => {
    const manager = new CacheManager();
    const mock = new MockCacheOwner(10);

    manager.registerCacheOwner(mock);
    assert.strictEqual(manager.getCacheUsage(), 10);

    const handle1 = manager.pauseTracking();
    assert.strictEqual(manager.getCacheUsage(), -1);

    // nested
    const handle2 = manager.pauseTracking();
    assert.strictEqual(manager.getCacheUsage(), -1);

    handle2.dispose();
    assert.strictEqual(manager.getCacheUsage(), -1);

    handle1.dispose();
    assert.strictEqual(manager.getCacheUsage(), 10);

    manager.unregisterCacheOwner(mock);
    assert.strictEqual(manager.getCacheUsage(), 0);
});

test('multiple owners', () => {
    const manager = new CacheManager();
    const mock1 = new MockCacheOwner(10);
    const mock2 = new MockCacheOwner(20);

    manager.registerCacheOwner(mock1);
    assert.strictEqual(manager.getCacheUsage(), 10);

    manager.registerCacheOwner(mock2);
    assert.strictEqual(manager.getCacheUsage(), 30);

    const handle = manager.pauseTracking();
    assert.strictEqual(manager.getCacheUsage(), -1);

    manager.unregisterCacheOwner(mock1);
    assert.strictEqual(manager.getCacheUsage(), -1);

    handle.dispose();
    assert.strictEqual(manager.getCacheUsage(), 20);

    manager.unregisterCacheOwner(mock2);
    assert.strictEqual(manager.getCacheUsage(), 0);
});

class MockCacheOwner implements CacheOwner {
    constructor(private _used: number) {
        // empty
    }

    getCacheUsage(): number {
        return this._used;
    }

    emptyCache(): void {
        this._used = 0;
    }
}
