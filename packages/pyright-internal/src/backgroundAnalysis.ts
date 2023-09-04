/*
 * backgroundAnalysis.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * run analyzer from background thread
 */

import { Worker } from 'worker_threads';

import { ImportResolver } from './analyzer/importResolver';
import { BackgroundAnalysisBase, BackgroundAnalysisRunnerBase } from './backgroundAnalysisBase';
import { InitializationData } from './backgroundThreadBase';
import { getCancellationFolderName } from './common/cancellationUtils';
import { ConfigOptions } from './common/configOptions';
import { ConsoleInterface } from './common/console';
import { FullAccessHost } from './common/fullAccessHost';
import { Host } from './common/host';
import { ServiceProvider } from './common/serviceProvider';

export class BackgroundAnalysis extends BackgroundAnalysisBase {
    constructor(console: ConsoleInterface) {
        super(console);

        const initialData: InitializationData = {
            rootDirectory: (global as any).__rootDirectory as string,
            cancellationFolderName: getCancellationFolderName(),
            runner: undefined,
        };

        // this will load this same file in BG thread and start listener
        const worker = new Worker(__filename, { workerData: initialData });
        this.setup(worker);
    }
}

export class BackgroundAnalysisRunner extends BackgroundAnalysisRunnerBase {
    constructor(serviceProvider: ServiceProvider) {
        super(serviceProvider);
    }

    protected override createHost(): Host {
        return new FullAccessHost(this.fs);
    }

    protected override createImportResolver(
        serviceProvider: ServiceProvider,
        options: ConfigOptions,
        host: Host
    ): ImportResolver {
        return new ImportResolver(serviceProvider, options, host);
    }
}
