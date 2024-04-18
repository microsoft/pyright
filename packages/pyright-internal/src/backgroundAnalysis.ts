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
import { FullAccessHost } from './common/fullAccessHost';
import { Host } from './common/host';
import { ServiceProvider } from './common/serviceProvider';
import { getRootUri } from './common/uri/uriUtils';

export class BackgroundAnalysis extends BackgroundAnalysisBase {
    private static _workerIndex = 0;

    constructor(serviceProvider: ServiceProvider) {
        super(serviceProvider.console());

        const initialData: InitializationData = {
            rootUri: getRootUri(serviceProvider)?.toString() ?? '',
            cancellationFolderName: getCancellationFolderName(),
            runner: undefined,
            workerIndex: ++BackgroundAnalysis._workerIndex,
        };

        // this will load this same file in BG thread and start listener
        const worker = new Worker(__filename, { workerData: initialData });
        this.setup(worker);

        // Tell the cacheManager we have a worker that needs to share data.
        serviceProvider.cacheManager()?.addWorker(initialData.workerIndex, worker);
    }
}

export class BackgroundAnalysisRunner extends BackgroundAnalysisRunnerBase {
    constructor(serviceProvider: ServiceProvider) {
        super(serviceProvider);
    }

    protected override createHost(): Host {
        return new FullAccessHost(this.getServiceProvider());
    }

    protected override createImportResolver(
        serviceProvider: ServiceProvider,
        options: ConfigOptions,
        host: Host
    ): ImportResolver {
        return new ImportResolver(serviceProvider, options, host);
    }
}
