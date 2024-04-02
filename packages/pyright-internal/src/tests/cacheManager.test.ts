/*
 * cacheManager.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for cache manager
 */

import assert from 'assert';

import { Worker } from 'worker_threads';
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

test('Shared memory', async () => {
    const manager = new CacheManager(/* maxWorkers */ 1);

    // Without the .js output from Jest, we need to generate a non module worker. Use a string
    // to do so. This means the worker can't use the CacheManager, but it just needs to
    // listen for the sharedArrayBuffer message.
    const workerSource = `
const { parentPort } = require('worker_threads');
parentPort.on('message', (msg) => {
if (msg.requestType === 'cacheUsageBuffer') {
    const buffer = msg.sharedUsageBuffer;
    const view = new Float64Array(buffer);
    view[1] = 50 * 1024 * 1024 * 1024; // Make this super huge, 50GB to make sure usage is over 100%
    parentPort.postMessage('done');
    }
});
`;
    const worker = new Worker(workerSource, { eval: true });
    worker.on('error', (err) => {
        throw err;
    });
    manager.addWorker(1, worker);

    // Wait for the worker to post a message back to us.
    await new Promise<void>((resolve, reject) => {
        worker.on('message', (msg: string) => {
            if (msg === 'done') {
                resolve();
            }
        });
    });

    // Get the heap usage and verify it's more than 100%
    const usage = manager.getUsedHeapRatio();
    worker.terminate();
    assert(usage > 1);
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
