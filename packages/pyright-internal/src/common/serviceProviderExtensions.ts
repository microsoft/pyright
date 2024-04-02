/*
 * serviceProviderExtensions.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Shortcuts to common services.
 */
import { CacheManager } from '../analyzer/cacheManager';
import { ISourceFileFactory } from '../analyzer/programTypes';
import { IPythonMode, SourceFile, SourceFileEditMode } from '../analyzer/sourceFile';
import { SupportPartialStubs } from '../pyrightFileSystem';
import { ServiceKeys } from './serviceKeys';
import { CaseSensitivityDetector } from './caseSensitivityDetector';
import { ConsoleInterface } from './console';
import { ServiceProvider as ReadOnlyServiceProvider } from './extensibility';
import { FileSystem, TempFile } from './fileSystem';
import { LogTracker } from './logTracker';
import { ServiceProvider } from './serviceProvider';
import { Uri } from './uri/uri';

declare module './serviceProvider' {
    interface ServiceProvider {
        fs(): FileSystem;
        console(): ConsoleInterface;
        tmp(): TempFile | undefined;
        sourceFileFactory(): ISourceFileFactory;
        partialStubs(): SupportPartialStubs;
        cacheManager(): CacheManager | undefined;
    }
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
        if (CaseSensitivityDetector.is(service)) {
            sp.add(ServiceKeys.caseSensitivityDetector, service);
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

ServiceProvider.prototype.cacheManager = function () {
    const result = this.tryGet(ServiceKeys.cacheManager);
    return result;
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
