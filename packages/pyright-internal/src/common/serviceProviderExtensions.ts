/*
 * serviceProviderExtensions.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Shortcuts to common services.
 */
import { ISourceFileFactory } from '../analyzer/program';
import { IPythonMode, SourceFile, SourceFileEditMode } from '../analyzer/sourceFile';
import { SupportPartialStubs, SupportUriToPathMapping } from '../pyrightFileSystem';
import { ConsoleInterface } from './console';
import { FileSystem } from './fileSystem';
import { LogTracker } from './logTracker';
import { ServiceKey, ServiceProvider } from './serviceProvider';

declare module './serviceProvider' {
    interface ServiceProvider {
        fs(): FileSystem;
        console(): ConsoleInterface;
        sourceFileFactory(): ISourceFileFactory;
        uriMapper(): SupportUriToPathMapping;
        partialStubs(): SupportPartialStubs;
    }
}

export namespace ServiceKeys {
    export const fs = new ServiceKey<FileSystem>();
    export const console = new ServiceKey<ConsoleInterface>();
    export const sourceFileFactory = new ServiceKey<ISourceFileFactory>();
    export const partialStubs = new ServiceKey<SupportPartialStubs>();
    export const uriMapper = new ServiceKey<SupportUriToPathMapping>();
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
        if (SupportUriToPathMapping.is(service)) {
            sp.add(ServiceKeys.uriMapper, service);
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
ServiceProvider.prototype.uriMapper = function () {
    return this.get(ServiceKeys.uriMapper);
};
ServiceProvider.prototype.partialStubs = function () {
    return this.get(ServiceKeys.partialStubs);
};
ServiceProvider.prototype.sourceFileFactory = function () {
    const result = this.tryGet(ServiceKeys.sourceFileFactory);
    return result || DefaultSourceFileFactory;
};

const DefaultSourceFileFactory: ISourceFileFactory = {
    createSourceFile(
        fs: FileSystem,
        filePath: string,
        moduleName: string,
        isThirdPartyImport: boolean,
        isThirdPartyPyTypedPresent: boolean,
        editMode: SourceFileEditMode,
        console?: ConsoleInterface,
        logTracker?: LogTracker,
        realFilePath?: string,
        ipythonMode?: IPythonMode
    ) {
        return new SourceFile(
            fs,
            filePath,
            moduleName,
            isThirdPartyImport,
            isThirdPartyPyTypedPresent,
            editMode,
            console,
            logTracker,
            realFilePath,
            ipythonMode
        );
    },
};
