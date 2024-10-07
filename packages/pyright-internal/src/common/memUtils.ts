/*
 * memUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Platform-independent helper functions for memory.
 */
import * as os from 'os';
type HeapInfo = ReturnType<typeof import('v8').getHeapStatistics>;

function getHeapStatisticsFunc(): () => HeapInfo {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const getHeapStatistics = require('v8').getHeapStatistics;
        if (getHeapStatistics) {
            return getHeapStatistics;
        }
    } catch {
        // empty on purpose
    }

    return () => ({
        total_heap_size: 0,
        total_heap_size_executable: 0,
        total_physical_size: 0,
        total_available_size: 0,
        used_heap_size: 0,
        heap_size_limit: 0,
        malloced_memory: 0,
        peak_malloced_memory: 0,
        does_zap_garbage: 0,
        number_of_native_contexts: 0,
        number_of_detached_contexts: 0,
        total_global_handles_size: 0,
        used_global_handles_size: 0,
        external_memory: 0,
    });
}
export const getHeapStatistics = getHeapStatisticsFunc();

export function getSystemMemoryInfo() {
    if (!os.totalmem || !os.freemem) {
        return { total: 0, free: 0 };
    }

    return { total: os.totalmem(), free: os.freemem() };
}
