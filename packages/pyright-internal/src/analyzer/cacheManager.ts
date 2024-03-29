/*
 * cacheManager.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * A singleton that tracks the size of caches and empties them
 * if memory usage approaches the max heap space.
 */

import { ConsoleInterface } from '../common/console';
import { fail } from '../common/debug';
import { getHeapStatistics } from '../common/memUtils';

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
    private _lastHeapStats = Date.now();

    registerCacheOwner(provider: CacheOwner) {
        this._cacheOwners.push(provider);
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
        const heapStats = getHeapStatistics();

        if (console && Date.now() - this._lastHeapStats > 1000) {
            // This can fill up the user's console, so we only do it once per second.
            this._lastHeapStats = Date.now();
            console.info(
                `Heap stats: ` +
                    `total_heap_size=${this._convertToMB(heapStats.total_heap_size)}, ` +
                    `used_heap_size=${this._convertToMB(heapStats.used_heap_size)}, ` +
                    `total_physical_size=${this._convertToMB(heapStats.total_physical_size)}, ` +
                    `total_available_size=${this._convertToMB(heapStats.total_available_size)}, ` +
                    `heap_size_limit=${this._convertToMB(heapStats.heap_size_limit)}`
            );
        }

        return heapStats.used_heap_size / heapStats.heap_size_limit;
    }

    private _convertToMB(bytes: number) {
        return `${Math.round(bytes / (1024 * 1024))}MB`;
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
