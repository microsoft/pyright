/*
 * languageServerInterface.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Interface for language server
 */

import { MarkupKind } from 'vscode-languageserver';
import { MaxAnalysisTime } from '../analyzer/program';
import { BackgroundAnalysisBase } from '../backgroundAnalysisBase';
import { Workspace } from '../workspaceFactory';
import { CancellationProvider } from './cancellationUtils';
import { DiagnosticBooleanOverridesMap, DiagnosticSeverityOverridesMap } from './commandLineOptions';
import { SignatureDisplayType } from './configOptions';
import { ConsoleInterface, LogLevel } from './console';
import { TaskListToken } from './diagnostic';
import { FileSystem } from './fileSystem';
import { FileWatcherHandler } from './fileWatcher';
import { ServiceProvider } from './serviceProvider';
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
    diagnosticBooleanOverrides?: DiagnosticBooleanOverridesMap | undefined;
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

export interface WorkspaceServices {
    fs: FileSystem | undefined;
    backgroundAnalysis: BackgroundAnalysisBase | undefined;
}

export interface ServerOptions {
    productName: string;
    rootDirectory: Uri;
    version: string;
    cancellationProvider: CancellationProvider;
    serviceProvider: ServiceProvider;
    fileWatcherHandler: FileWatcherHandler;
    maxAnalysisTimeInForeground?: MaxAnalysisTime;
    disableChecker?: boolean;
    supportedCommands?: string[];
    supportedCodeActions?: string[];
    supportsTelemetry?: boolean;
}

export interface ClientCapabilities {
    hasConfigurationCapability: boolean;
    hasVisualStudioExtensionsCapability: boolean;
    hasWorkspaceFoldersCapability: boolean;
    hasWatchFileCapability: boolean;
    hasWatchFileRelativePathCapability: boolean;
    hasActiveParameterCapability: boolean;
    hasSignatureLabelOffsetCapability: boolean;
    hasHierarchicalDocumentSymbolCapability: boolean;
    hasWindowProgressCapability: boolean;
    hasGoToDeclarationCapability: boolean;
    hasDocumentChangeCapability: boolean;
    hasDocumentAnnotationCapability: boolean;
    hasCompletionCommitCharCapability: boolean;
    hoverContentFormat: MarkupKind;
    completionDocFormat: MarkupKind;
    completionSupportsSnippet: boolean;
    signatureDocFormat: MarkupKind;
    supportsDeprecatedDiagnosticTag: boolean;
    supportsUnnecessaryDiagnosticTag: boolean;
    supportsTaskItemDiagnosticTag: boolean;
    completionItemResolveSupportsAdditionalTextEdits: boolean;
}

export interface LanguageServerBaseInterface {
    readonly console: ConsoleInterface;
    readonly window: WindowInterface;
    readonly supportAdvancedEdits: boolean;
    readonly serviceProvider: ServiceProvider;

    createBackgroundAnalysis(serviceId: string, workspaceRoot: Uri): BackgroundAnalysisBase | undefined;
    reanalyze(): void;
    restart(): void;

    getWorkspaces(): Promise<Workspace[]>;
    getSettings(workspace: Workspace): Promise<ServerSettings>;
}

export interface LanguageServerInterface extends LanguageServerBaseInterface {
    getWorkspaceForFile(fileUri: Uri, pythonPath?: Uri): Promise<Workspace>;
}

export interface WindowService extends WindowInterface {
    createGoToOutputAction(): MessageAction;
    createOpenUriAction(title: string, uri: string): MessageAction;
}

export namespace WindowService {
    export function is(obj: any): obj is WindowService {
        return obj.createGoToOutputAction !== undefined && WindowInterface.is(obj);
    }
}

export interface CommandService {
    sendCommand(id: string, ...args: string[]): void;
}

export namespace CommandService {
    export function is(obj: any): obj is CommandService {
        return !!obj && obj.sendCommand !== undefined;
    }
}
