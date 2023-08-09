/*
 * serviceProviderExtensions.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Shortcuts to common services.
 */
import { ISourceFileFactory } from '../analyzer/program';
import { IPythonMode, SourceFile } from '../analyzer/sourceFile';
import { IPyrightFileSystem } from '../pyrightFileSystem';
import { ConsoleInterface } from './console';
import { FileSystem } from './fileSystem';
import { LogTracker } from './logTracker';
import { ServiceKey, ServiceProvider } from './serviceProvider';

declare module './serviceProvider' {
    interface ServiceProvider {
        fs(): IPyrightFileSystem;
        console(): ConsoleInterface;
        sourceFileFactory(): ISourceFileFactory;
    }
}

export namespace ServiceKeys {
    export const fs = new ServiceKey<IPyrightFileSystem>();
    export const console = new ServiceKey<ConsoleInterface>();
    export const sourceFileFactory = new ServiceKey<ISourceFileFactory>();
}

ServiceProvider.prototype.fs = function () {
    return this.get(ServiceKeys.fs);
};
ServiceProvider.prototype.console = function () {
    return this.get(ServiceKeys.console);
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
        editMode: boolean,
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
