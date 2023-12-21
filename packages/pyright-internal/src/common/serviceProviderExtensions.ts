/*
 * serviceProviderExtensions.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Shortcuts to common services.
 */
import { CacheManager } from '../analyzer/cacheManager';
import { ISourceFileFactory } from '../analyzer/program';
import { IPythonMode, SourceFile, SourceFileEditMode } from '../analyzer/sourceFile';
import { SupportPartialStubs } from '../pyrightFileSystem';
import { ConsoleInterface } from './console';
import {
    DebugInfoInspector,
    ServiceProvider as ReadOnlyServiceProvider,
    StatusMutationListener,
    SymbolDefinitionProvider,
    SymbolUsageProviderFactory,
} from './extensibility';
import { FileSystem, TempFile } from './fileSystem';
import { LogTracker } from './logTracker';
import { GroupServiceKey, ServiceKey, ServiceProvider } from './serviceProvider';
import { Uri } from './uri/uri';

declare module './serviceProvider' {
    interface ServiceProvider {
        fs(): FileSystem;
        console(): ConsoleInterface;
        tmp(): TempFile | undefined;
        sourceFileFactory(): ISourceFileFactory;
        partialStubs(): SupportPartialStubs;
    }
}

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
}

export function createServiceProvider(...services: any): ServiceProvider {
    const sp = new ServiceProvider();

    // For known interfaces, register the service.
    services.forEach((service: any) => {
        if (FileSystem.is(service)) {
            sp.add(ServiceKeys.fs, service);
        }
        if (ConsoleInterface.is(service)) {
            sp.add(ServiceKeys.console, service);
        }
        if (ISourceFileFactory.is(service)) {
            sp.add(ServiceKeys.sourceFileFactory, service);
        }
        if (SupportPartialStubs.is(service)) {
            sp.add(ServiceKeys.partialStubs, service);
        }
        if (TempFile.is(service)) {
            sp.add(ServiceKeys.tempFile, service);
        }
        if (CacheManager.is(service)) {
            sp.add(ServiceKeys.cacheManager, service);
        }
    });
    return sp;
}

ServiceProvider.prototype.fs = function () {
    return this.get(ServiceKeys.fs);
};
ServiceProvider.prototype.console = function () {
    return this.get(ServiceKeys.console);
};
ServiceProvider.prototype.partialStubs = function () {
    return this.get(ServiceKeys.partialStubs);
};
ServiceProvider.prototype.tmp = function () {
    return this.tryGet(ServiceKeys.tempFile);
};
ServiceProvider.prototype.sourceFileFactory = function () {
    const result = this.tryGet(ServiceKeys.sourceFileFactory);
    return result || DefaultSourceFileFactory;
};

const DefaultSourceFileFactory: ISourceFileFactory = {
    createSourceFile(
        serviceProvider: ReadOnlyServiceProvider,
        fileUri: Uri,
        moduleName: string,
        isThirdPartyImport: boolean,
        isThirdPartyPyTypedPresent: boolean,
        editMode: SourceFileEditMode,
        console?: ConsoleInterface,
        logTracker?: LogTracker,
        ipythonMode?: IPythonMode
    ) {
        return new SourceFile(
            serviceProvider,
            fileUri,
            moduleName,
            isThirdPartyImport,
            isThirdPartyPyTypedPresent,
            editMode,
            console,
            logTracker,
            ipythonMode
        );
    },
};
