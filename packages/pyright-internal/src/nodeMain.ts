/*
 * nodeMain.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Provides the main entrypoint to the server when running in Node.
 */

import { BackgroundAnalysisRunner } from './backgroundAnalysis';
import { ServiceProvider } from './common/serviceProvider';
import { run } from './nodeServer';
import { PyrightServer } from './server';

export function main(maxWorkers: number) {
    run(
        (conn) => new PyrightServer(conn, maxWorkers),
        () => {
            const runner = new BackgroundAnalysisRunner(new ServiceProvider());
            runner.start();
        }
    );
}
