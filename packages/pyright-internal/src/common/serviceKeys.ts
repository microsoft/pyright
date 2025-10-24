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
    export const fs = new ServiceKey<FileSystem>('fs');
    export const console = new ServiceKey<ConsoleInterface>('ConsoleInterface');
    export const sourceFileFactory = new ServiceKey<ISourceFileFactory>('ISourceFileFactory');
    export const partialStubs = new ServiceKey<SupportPartialStubs>('SupportPartialStubs');
    export const symbolDefinitionProvider = new GroupServiceKey<SymbolDefinitionProvider>('SymbolDefinitionProvider');
    export const symbolUsageProviderFactory = new GroupServiceKey<SymbolUsageProviderFactory>(
        'SymbolUsageProviderFactory'
    );
    export const stateMutationListeners = new GroupServiceKey<StatusMutationListener>('StatusMutationListener');
    export const tempFile = new ServiceKey<TempFile>('TempFile');
    export const cacheManager = new ServiceKey<CacheManager>('CacheManager');
    export const debugInfoInspector = new ServiceKey<DebugInfoInspector>('DebugInfoInspector');
    export const caseSensitivityDetector = new ServiceKey<CaseSensitivityDetector>('CaseSensitivityDetector');
    export const docStringService = new ServiceKey<DocStringService>('DocStringService');
    export const windowService = new ServiceKey<WindowService>('WindowService');
    export const commandService = new ServiceKey<CommandService>('CommandService');
    export const cancellationProvider = new ServiceKey<CancellationProvider>('CancellationProvider');
}
