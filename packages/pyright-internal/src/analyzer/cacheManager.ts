/*
 * cacheManager.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * A singleton that track the size of caches and empty them
 * if memory usage approaches the max heap space.
 */

import { getHeapStatistics } from 'v8';

import { ConsoleInterface } from '../common/console';
import { fail } from '../common/debug';

export interface CacheOwner {
    // Returns a number between 0 and 1 that indicates how full
    // the cache is.
    getCacheUsage(): number;

    // Empties the cache, typically in response to a low-memory condition.
    emptyCache(): void;
}

export class CacheManager {
    private static _cacheOwners: CacheOwner[] = [];

    static registerCacheOwner(provider: CacheOwner) {
        CacheManager._cacheOwners.push(provider);
    }

    static unregisterCacheOwner(provider: CacheOwner) {
        const index = CacheManager._cacheOwners.findIndex((p) => p === provider);
        if (index < 0) {
            fail('Specified cache provider not found');
        } else {
            CacheManager._cacheOwners.splice(index, 1);
        }
    }

    static getCacheUsage() {
        let totalUsage = 0;

        CacheManager._cacheOwners.forEach((p) => {
            totalUsage += p.getCacheUsage();
        });

        return totalUsage;
    }

    static emptyCache(console?: ConsoleInterface) {
        if (console) {
            const heapStats = getHeapStatistics();

            console.info(
                `Emptying type cache to avoid heap overflow. Used ${this._convertToMB(
                    heapStats.used_heap_size
                )} out of ${this._convertToMB(heapStats.heap_size_limit)}.`
            );
        }

        CacheManager._cacheOwners.forEach((p) => {
            p.emptyCache();
        });
    }

    // Returns a ratio of used bytes to total bytes.
    static getUsedHeapRatio(console?: ConsoleInterface) {
        const heapStats = getHeapStatistics();

        if (console) {
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

    private static _convertToMB(bytes: number) {
        return `${Math.round(bytes / (1024 * 1024))}MB`;
    }
}
