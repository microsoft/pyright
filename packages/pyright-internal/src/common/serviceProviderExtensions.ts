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
import { PartialStubService, SupportPartialStubs } from '../partialStubService';
import { CancellationProvider, DefaultCancellationProvider } from './cancellationUtils';
import { CaseSensitivityDetector } from './caseSensitivityDetector';
import { ConsoleInterface } from './console';
import { DocStringService, PyrightDocStringService } from './docStringService';
import { FileSystem, TempFile } from './fileSystem';
import { CommandService, WindowService } from './languageServerInterface';
import { LogTracker } from './logTracker';
import { ServiceKeys } from './serviceKeys';
import { ServiceProvider } from './serviceProvider';
import { Uri } from './uri/uri';

declare module './serviceProvider' {
    interface ServiceProvider {
        fs(): FileSystem;
        console(): ConsoleInterface;
        cancellationProvider(): CancellationProvider;
        tmp(): TempFile | undefined;
        sourceFileFactory(): ISourceFileFactory;
        partialStubs(): SupportPartialStubs;
        cacheManager(): CacheManager | undefined;
        docStringService(): DocStringService;
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
        if (DocStringService.is(service)) {
            sp.add(ServiceKeys.docStringService, service);
        }
        if (WindowService.is(service)) {
            sp.add(ServiceKeys.windowService, service);
        }
        if (CommandService.is(service)) {
            sp.add(ServiceKeys.commandService, service);
        }
        if (CancellationProvider.is(service)) {
            sp.add(ServiceKeys.cancellationProvider, service);
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
    const result = this.tryGet(ServiceKeys.partialStubs);
    if (!result) {
        this.add(ServiceKeys.partialStubs, new PartialStubService(this.fs()));
    }
    return this.get(ServiceKeys.partialStubs);
};
ServiceProvider.prototype.tmp = function () {
    return this.tryGet(ServiceKeys.tempFile);
};

ServiceProvider.prototype.cancellationProvider = function () {
    return this.tryGet(ServiceKeys.cancellationProvider) ?? new DefaultCancellationProvider();
};

ServiceProvider.prototype.sourceFileFactory = function () {
    const result = this.tryGet(ServiceKeys.sourceFileFactory);
    return result || DefaultSourceFileFactory;
};

ServiceProvider.prototype.docStringService = function () {
    const result = this.tryGet(ServiceKeys.docStringService);
    return result || new PyrightDocStringService();
};

ServiceProvider.prototype.cacheManager = function () {
    const result = this.tryGet(ServiceKeys.cacheManager);
    return result;
};

const DefaultSourceFileFactory: ISourceFileFactory = {
    createSourceFile(
        serviceProvider: ServiceProvider,
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
