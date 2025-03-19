/*
 * serviceKeys.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Define service keys.
 */

import { CacheManager } from '../analyzer/cacheManager';
import { ISourceFileFactory } from '../analyzer/programTypes';
import { SupportPartialStubs } from '../partialStubService';
import { CancellationProvider } from './cancellationUtils';
import { CaseSensitivityDetector } from './caseSensitivityDetector';
import { ConsoleInterface } from './console';
import { DocStringService } from './docStringService';
import {
    DebugInfoInspector,
    StatusMutationListener,
    SymbolDefinitionProvider,
    SymbolUsageProviderFactory,
} from './extensibility';
import { FileSystem, TempFile } from './fileSystem';
import { CommandService, WindowService } from './languageServerInterface';
import { GroupServiceKey, ServiceKey } from './serviceProvider';

export namespace ServiceKeys {
    export const fs = new ServiceKey<FileSystem>();
    export const console = new ServiceKey<ConsoleInterface>();
    export const sourceFileFactory = new ServiceKey<ISourceFileFactory>();
    export const partialStubs = new ServiceKey<SupportPartialStubs>();
    export const symbolDefinitionProvider = new GroupServiceKey<SymbolDefinitionProvider>();
    export const symbolUsageProviderFactory = new GroupServiceKey<SymbolUsageProviderFactory>();
    export const stateMutationListeners = new GroupServiceKey<StatusMutationListener>();
    export const tempFile = new ServiceKey<TempFile>();
    export const cacheManager = new ServiceKey<CacheManager>();
    export const debugInfoInspector = new ServiceKey<DebugInfoInspector>();
    export const caseSensitivityDetector = new ServiceKey<CaseSensitivityDetector>();
    export const docStringService = new ServiceKey<DocStringService>();
    export const windowService = new ServiceKey<WindowService>();
    export const commandService = new ServiceKey<CommandService>();
    export const cancellationProvider = new ServiceKey<CancellationProvider>();
}
