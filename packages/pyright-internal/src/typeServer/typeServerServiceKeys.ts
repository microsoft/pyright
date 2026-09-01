/*
 * typeServerServiceKeys.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Service keys used by the type server. This is the slim subset of Pylance's
 * `pylanceServiceKeys` that the ported type-server core actually references.
 */

import { ServiceKey } from '../common/serviceProvider';

import { INotebookUriMapper } from './notebookUriMapper';
import { IProfilingService } from './profilingStub';

export namespace TypeServerServiceKeys {
    export const uriMapper = new ServiceKey<INotebookUriMapper>('INotebookUriMapper');

    // Profiling is a Pylance-only feature and is never registered in the standalone
    // Pyright type server, so `tryGet` returns undefined and profiling becomes a no-op.
    export const profilingService = new ServiceKey<IProfilingService>('IProfilingService');
}
