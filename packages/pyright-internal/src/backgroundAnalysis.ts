/*
 * backgroundAnalysis.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * run analyzer from background thread
 */

import { isMainThread, Worker } from 'worker_threads';

import { BackgroundAnalysisBase, BackgroundAnalysisRunnerBase, InitializationData } from './backgroundAnalysisBase';
import { getCancellationFolderName } from './common/cancellationUtils';
import { ConsoleInterface } from './common/console';

export class BackgroundAnalysis extends BackgroundAnalysisBase {
    constructor(console: ConsoleInterface) {
        super(console);

        const initialData: InitializationData = {
            rootDirectory: (global as any).__rootDirectory as string,
            cancellationFolderName: getCancellationFolderName(),
        };

        // this will load this same file in BG thread and start listener
        const worker = new Worker(__filename, { workerData: initialData });
        this.setup(worker);
    }
}

class BackgroundAnalysisRunner extends BackgroundAnalysisRunnerBase {
    constructor() {
        super();
    }
}

// this lets the runner start in the worker thread
if (!isMainThread) {
    const runner = new BackgroundAnalysisRunner();
    runner.start();
}
