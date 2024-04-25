/*
 * languageServerInterface.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Interface for language server
 */

import { BackgroundAnalysisBase } from '../backgroundAnalysisBase';
import { Workspace } from '../workspaceFactory';
import { DiagnosticSeverityOverridesMap } from './commandLineOptions';
import { SignatureDisplayType } from './configOptions';
import { ConsoleInterface, LogLevel } from './console';
import { TaskListToken } from './diagnostic';
import * as ext from './extensibility';
import { Uri } from './uri/uri';

export interface ServerSettings {
    venvPath?: Uri | undefined;
    pythonPath?: Uri | undefined;
    typeshedPath?: Uri | undefined;
    stubPath?: Uri | undefined;
    openFilesOnly?: boolean | undefined;
    typeCheckingMode?: string | undefined;
    useLibraryCodeForTypes?: boolean | undefined;
    disableLanguageServices?: boolean | undefined;
    disableTaggedHints?: boolean | undefined;
    disableOrganizeImports?: boolean | undefined;
    autoSearchPaths?: boolean | undefined;
    extraPaths?: Uri[] | undefined;
    watchForSourceChanges?: boolean | undefined;
    watchForLibraryChanges?: boolean | undefined;
    watchForConfigChanges?: boolean | undefined;
    diagnosticSeverityOverrides?: DiagnosticSeverityOverridesMap | undefined;
    logLevel?: LogLevel | undefined;
    autoImportCompletions?: boolean | undefined;
    indexing?: boolean | undefined;
    logTypeEvaluationTime?: boolean | undefined;
    typeEvaluationTimeThreshold?: number | undefined;
    includeFileSpecs?: string[];
    excludeFileSpecs?: string[];
    ignoreFileSpecs?: string[];
    taskListTokens?: TaskListToken[];
    functionSignatureDisplay?: SignatureDisplayType | undefined;
}

export interface MessageAction {
    title: string;
    [key: string]: string | boolean | number | object;
}

export interface WindowInterface {
    showErrorMessage(message: string): void;
    showErrorMessage(message: string, ...actions: MessageAction[]): Promise<MessageAction | undefined>;

    showWarningMessage(message: string): void;
    showWarningMessage(message: string, ...actions: MessageAction[]): Promise<MessageAction | undefined>;

    showInformationMessage(message: string): void;
    showInformationMessage(message: string, ...actions: MessageAction[]): Promise<MessageAction | undefined>;
}

export namespace WindowInterface {
    export function is(obj: any): obj is WindowInterface {
        return (
            !!obj &&
            obj.showErrorMessage !== undefined &&
            obj.showWarningMessage !== undefined &&
            obj.showInformationMessage !== undefined
        );
    }
}

export interface LanguageServerBaseInterface {
    readonly console: ConsoleInterface;
    readonly window: WindowInterface;
    readonly supportAdvancedEdits: boolean;
    readonly serviceProvider: ext.ServiceProvider;

    createBackgroundAnalysis(serviceId: string): BackgroundAnalysisBase | undefined;
    reanalyze(): void;
    restart(): void;

    getWorkspaces(): Promise<Workspace[]>;
    getSettings(workspace: Workspace): Promise<ServerSettings>;
}

export interface LanguageServerInterface extends LanguageServerBaseInterface {
    getWorkspaceForFile(fileUri: Uri): Promise<Workspace>;
}
