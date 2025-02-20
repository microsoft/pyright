/*
 * cacheManager.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * A singleton that tracks the size of caches and empties them
 * if memory usage approaches the max heap space.
 */

import type { HeapInfo } from 'v8';
import { Worker } from 'worker_threads';
import { ConsoleInterface } from '../common/console';
import { fail } from '../common/debug';
import { getHeapStatistics, getSystemMemoryInfo } from '../common/memUtils';

export interface CacheOwner {
    // Returns a number between 0 and 1 that indicates how full
    // the cache is.
    getCacheUsage(): number;

    // Empties the cache, typically in response to a low-memory condition.
    emptyCache(): void;
}

export class CacheManager {
    private _pausedCount = 0;
    private readonly _cacheOwners: CacheOwner[] = [];
    private _sharedUsageBuffer: SharedArrayBuffer | undefined;
    private _sharedUsagePosition = 0;
    private _lastHeapStats = Date.now();

    constructor(private readonly _maxWorkers: number = 0) {
        // Empty
    }

    registerCacheOwner(provider: CacheOwner) {
        this._cacheOwners.push(provider);
    }

    addWorker(index: number, worker: Worker) {
        // Send the sharedArrayBuffer to the worker so it can be used
        // to keep track of heap usage on all threads.
        const buffer = this._getSharedUsageBuffer();
        if (buffer) {
            // The SharedArrayBuffer needs to be separate from data in order for it
            // to be marshalled correctly.
            worker.postMessage({ requestType: 'cacheUsageBuffer', sharedUsageBuffer: buffer, data: index.toString() });
            worker.on('exit', () => {
                const view = new Float64Array(buffer);
                view[index] = 0;
            });
        }
    }

    handleCachedUsageBufferMessage(msg: {
        requestType: string;
        data: string | null;
        sharedUsageBuffer?: SharedArrayBuffer;
    }) {
        if (msg.requestType === 'cacheUsageBuffer') {
            const index = parseInt(msg.data || '0');
            const buffer = msg.sharedUsageBuffer;
            // Index of zero is reserved for the main thread so if
            // the index isn't passed, don't save the shared buffer.
            if (buffer && index) {
                this._sharedUsageBuffer = buffer;
                this._sharedUsagePosition = index;
            }
        }
    }

    unregisterCacheOwner(provider: CacheOwner) {
        const index = this._cacheOwners.findIndex((p) => p === provider);
        if (index < 0) {
            fail('Specified cache provider not found');
        } else {
            this._cacheOwners.splice(index, 1);
        }
    }

    pauseTracking(): { dispose(): void } {
        const local = this;
        local._pausedCount++;
        return {
            dispose() {
                local._pausedCount--;
            },
        };
    }

    getCacheUsage() {
        if (this._pausedCount > 0) {
            return -1;
        }

        let totalUsage = 0;

        this._cacheOwners.forEach((p) => {
            totalUsage += p.getCacheUsage();
        });

        return totalUsage;
    }

    emptyCache(console?: ConsoleInterface) {
        if (console) {
            const heapStats = getHeapStatistics();

            console.info(
                `Emptying type cache to avoid heap overflow. Used ${this._convertToMB(
                    heapStats.used_heap_size
                )} out of ${this._convertToMB(heapStats.heap_size_limit)}.`
            );
        }

        this._cacheOwners.forEach((p) => {
            p.emptyCache();
        });
    }

    // Returns a ratio of used bytes to total bytes.
    getUsedHeapRatio(console?: ConsoleInterface) {
        if (this._pausedCount > 0) {
            return -1;
        }

        const heapStats = getHeapStatistics();
        let usage = this._getTotalHeapUsage(heapStats);

        if (console && Date.now() - this._lastHeapStats > 1000) {
            // This can fill up the user's console, so we only do it once per second.
            this._lastHeapStats = Date.now();
            const systemMemInfo = getSystemMemoryInfo();

            console.info(
                `Heap stats: ` +
                    `total_memory_size=${this._convertToMB(systemMemInfo.total)}, ` +
                    `total_free_size=${this._convertToMB(systemMemInfo.free)}, ` +
                    `total_heap_size=${this._convertToMB(heapStats.total_heap_size)}, ` +
                    `used_heap_size=${this._convertToMB(heapStats.used_heap_size)}, ` +
                    `cross_worker_used_heap_size=${this._convertToMB(usage)}, ` +
                    `total_physical_size=${this._convertToMB(heapStats.total_physical_size)}, ` +
                    `total_available_size=${this._convertToMB(heapStats.total_available_size)}, ` +
                    `heap_size_limit=${this._convertToMB(heapStats.heap_size_limit)}`
            );
        }

        // Total usage seems to be off by about 5%, so we'll add that back in
        // to make the ratio more accurate. (200MB at 4GB)
        usage += usage * 0.05;

        return usage / heapStats.heap_size_limit;
    }

    private _convertToMB(bytes: number) {
        return `${Math.round(bytes / (1024 * 1024))}MB`;
    }

    private _getSharedUsageBuffer() {
        try {
            if (!this._sharedUsageBuffer && this._maxWorkers > 0) {
                // Allocate enough space for the workers and the main thread.
                this._sharedUsageBuffer = new SharedArrayBuffer(8 * (this._maxWorkers + 1));
            }

            return this._sharedUsageBuffer;
        } catch {
            // SharedArrayBuffer is not supported.
            return undefined;
        }
    }

    private _getTotalHeapUsage(heapStats: HeapInfo): number {
        // If the SharedArrayBuffer is supported, we'll use it to to get usage
        // from other threads and add that to our own
        const buffer = this._getSharedUsageBuffer();
        if (buffer) {
            const view = new Float64Array(buffer);
            view[this._sharedUsagePosition] = heapStats.used_heap_size;
            return view.reduce((a, b) => a + b, 0);
        }

        return heapStats.used_heap_size;
    }
}

export namespace CacheManager {
    export function is(obj: any): obj is CacheManager {
        return (
            obj.registerCacheOwner !== undefined &&
            obj.unregisterCacheOwner !== undefined &&
            obj.pauseTracking !== undefined &&
            obj.getCacheUsage !== undefined &&
            obj.emptyCache !== undefined &&
            obj.getUsedHeapRatio !== undefined
        );
    }
}
