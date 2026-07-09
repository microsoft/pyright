/*
 * profilingStub.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * The Pylance type server integrated with a profiling service. Profiling is a
 * Pylance-only feature, so the standalone Pyright type server keeps only the shape
 * (`ProfilingInfo`) that the program interfaces reference; there is no profiler.
 */

import { Uri } from '../common/uri/uri';

export interface ProfilingInfo {
    profileId: number;
    profilingFolderUri: Uri;
    outputFileUris?: Uri[];
}

export interface IProfilingService {
    startProfiling(): Promise<ProfilingInfo | undefined>;
    stopProfiling(): Promise<ProfilingInfo | undefined>;
}

