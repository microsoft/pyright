/*
 * server.ts
 *
 * Implements pyright language server.
 */

import {
    CancellationToken,
    CodeAction,
    CodeActionKind,
    CodeActionParams,
    Command,
    Connection,
    ExecuteCommandParams,
    WorkDoneProgressServerReporter,
} from 'vscode-languageserver';

import { AnalysisResults } from './analyzer/analysis';
import { CacheManager } from './analyzer/cacheManager';
import { ImportResolver } from './analyzer/importResolver';
import { isPythonBinary } from './analyzer/pythonPathUtils';
import { BackgroundAnalysis } from './backgroundAnalysis';
import { BackgroundAnalysisBase } from './backgroundAnalysisBase';
import { CommandController } from './commands/commandController';
import { getCancellationFolderName } from './common/cancellationUtils';
import { ConfigOptions, SignatureDisplayType } from './common/configOptions';
import { ConsoleWithLogLevel, LogLevel, convertLogLevel } from './common/console';
import { isDebugMode, isString } from './common/core';
import { expandPathVariables } from './common/envVarUtils';
import { FileBasedCancellationProvider } from './common/fileBasedCancellationUtils';
import { FullAccessHost } from './common/fullAccessHost';
import { Host } from './common/host';
import { realCasePath, resolvePaths } from './common/pathUtils';
import { ProgressReporter } from './common/progressReporter';
import { RealTempFile, WorkspaceFileWatcherProvider, createFromRealFileSystem } from './common/realFileSystem';
import { ServiceProvider } from './common/serviceProvider';
import { createServiceProvider } from './common/serviceProviderExtensions';
import { Uri } from './common/uri';
import { LanguageServerBase, ServerSettings } from './languageServerBase';
import { CodeActionProvider } from './languageService/codeActionProvider';
import { PyrightFileSystem } from './pyrightFileSystem';
import { Workspace } from './workspaceFactory';

const maxAnalysisTimeInForeground = { openFilesTimeInMs: 50, noOpenFilesTimeInMs: 200 };

export class PyrightServer extends LanguageServerBase {
    private _controller: CommandController;

    constructor(connection: Connection) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const version = require('../package.json').version || '';

        // When executed from CLI command (pyright-langserver), __rootUri is
        // already defined. When executed from VSCode extension, rootDirectory should
        // be __dirname.
        const rootDirectory = (global as any).__rootUri || Uri.file(__dirname);

        const console = new ConsoleWithLogLevel(connection.console);
        const fileWatcherProvider = new WorkspaceFileWatcherProvider();
        const fileSystem = createFromRealFileSystem(console, fileWatcherProvider);
        const pyrightFs = new PyrightFileSystem(fileSystem);
        const tempFile = new RealTempFile();
        const cacheManager = new CacheManager();

        const serviceProvider = createServiceProvider(pyrightFs, tempFile, console, cacheManager);
        const realPathRoot = realCasePath(rootDirectory, pyrightFs);

        super(
            {
                productName: 'Pyright',
                rootDirectory: realPathRoot,
                version,
                serviceProvider,
                fileWatcherHandler: fileWatcherProvider,
                cancellationProvider: new FileBasedCancellationProvider('bg'),
                maxAnalysisTimeInForeground,
                supportedCodeActions: [CodeActionKind.QuickFix, CodeActionKind.SourceOrganizeImports],
            },
            connection
        );

        this._controller = new CommandController(this);
    }

    async getSettings(workspace: Workspace): Promise<ServerSettings> {
        const serverSettings: ServerSettings = {
            watchForSourceChanges: true,
            watchForLibraryChanges: true,
            watchForConfigChanges: true,
            openFilesOnly: true,
            useLibraryCodeForTypes: true,
            disableLanguageServices: false,
            disableOrganizeImports: false,
            typeCheckingMode: 'basic',
            diagnosticSeverityOverrides: {},
            logLevel: LogLevel.Info,
            autoImportCompletions: true,
            functionSignatureDisplay: SignatureDisplayType.formatted,
        };

        try {
            const pythonSection = await this.getConfiguration(workspace.uri, 'python');
            if (pythonSection) {
                const pythonPath = pythonSection.pythonPath;
                if (pythonPath && isString(pythonPath) && !isPythonBinary(pythonPath)) {
                    serverSettings.pythonPath = resolvePaths(
                        workspace.rootUri,
                        expandPathVariables(workspace.rootUri, pythonPath)
                    );
                }

                const venvPath = pythonSection.venvPath;

                if (venvPath && isString(venvPath)) {
                    serverSettings.venvPath = resolvePaths(
                        workspace.rootUri,
                        expandPathVariables(workspace.rootUri, venvPath)
                    );
                }
            }

            const pythonAnalysisSection = await this.getConfiguration(workspace.uri, 'python.analysis');
            if (pythonAnalysisSection) {
                const typeshedPaths = pythonAnalysisSection.typeshedPaths;
                if (typeshedPaths && Array.isArray(typeshedPaths) && typeshedPaths.length > 0) {
                    const typeshedPath = typeshedPaths[0];
                    if (typeshedPath && isString(typeshedPath)) {
                        serverSettings.typeshedPath = resolvePaths(
                            workspace.rootUri,
                            expandPathVariables(workspace.rootUri, typeshedPath)
                        );
                    }
                }

                const stubPath = pythonAnalysisSection.stubPath;
                if (stubPath && isString(stubPath)) {
                    serverSettings.stubPath = resolvePaths(
                        workspace.rootUri,
                        expandPathVariables(workspace.rootUri, stubPath)
                    );
                }

                const diagnosticSeverityOverrides = pythonAnalysisSection.diagnosticSeverityOverrides;
                if (diagnosticSeverityOverrides) {
                    for (const [name, value] of Object.entries(diagnosticSeverityOverrides)) {
                        const ruleName = this.getDiagnosticRuleName(name);
                        const severity = this.getSeverityOverrides(value as string);
                        if (ruleName && severity) {
                            serverSettings.diagnosticSeverityOverrides![ruleName] = severity!;
                        }
                    }
                }

                if (pythonAnalysisSection.diagnosticMode !== undefined) {
                    serverSettings.openFilesOnly = this.isOpenFilesOnly(pythonAnalysisSection.diagnosticMode);
                } else if (pythonAnalysisSection.openFilesOnly !== undefined) {
                    serverSettings.openFilesOnly = !!pythonAnalysisSection.openFilesOnly;
                }

                if (pythonAnalysisSection.useLibraryCodeForTypes !== undefined) {
                    serverSettings.useLibraryCodeForTypes = !!pythonAnalysisSection.useLibraryCodeForTypes;
                }

                serverSettings.logLevel = convertLogLevel(pythonAnalysisSection.logLevel);
                serverSettings.autoSearchPaths = !!pythonAnalysisSection.autoSearchPaths;

                const extraPaths = pythonAnalysisSection.extraPaths;
                if (extraPaths && Array.isArray(extraPaths) && extraPaths.length > 0) {
                    serverSettings.extraPaths = extraPaths
                        .filter((p) => p && isString(p))
                        .map((p) => resolvePaths(workspace.rootUri, expandPathVariables(workspace.rootUri, p)));
                }

                serverSettings.fileSpecs = this._getStringValues(pythonAnalysisSection.include);
                serverSettings.excludeFileSpecs = this._getStringValues(pythonAnalysisSection.exclude);
                serverSettings.ignoreFileSpecs = this._getStringValues(pythonAnalysisSection.ignore);

                if (pythonAnalysisSection.typeCheckingMode !== undefined) {
                    serverSettings.typeCheckingMode = pythonAnalysisSection.typeCheckingMode;
                }

                if (pythonAnalysisSection.autoImportCompletions !== undefined) {
                    serverSettings.autoImportCompletions = pythonAnalysisSection.autoImportCompletions;
                }

                if (
                    serverSettings.logLevel === LogLevel.Log &&
                    pythonAnalysisSection.logTypeEvaluationTime !== undefined
                ) {
                    serverSettings.logTypeEvaluationTime = pythonAnalysisSection.logTypeEvaluationTime;
                }

                if (pythonAnalysisSection.typeEvaluationTimeThreshold !== undefined) {
                    serverSettings.typeEvaluationTimeThreshold = pythonAnalysisSection.typeEvaluationTimeThreshold;
                }
            } else {
                serverSettings.autoSearchPaths = true;
            }

            const pyrightSection = await this.getConfiguration(workspace.uri, 'pyright');
            if (pyrightSection) {
                if (pyrightSection.openFilesOnly !== undefined) {
                    serverSettings.openFilesOnly = !!pyrightSection.openFilesOnly;
                }

                if (pyrightSection.useLibraryCodeForTypes !== undefined) {
                    serverSettings.useLibraryCodeForTypes = !!pyrightSection.useLibraryCodeForTypes;
                }

                serverSettings.disableLanguageServices = !!pyrightSection.disableLanguageServices;
                serverSettings.disableOrganizeImports = !!pyrightSection.disableOrganizeImports;

                const typeCheckingMode = pyrightSection.typeCheckingMode;
                if (typeCheckingMode && isString(typeCheckingMode)) {
                    serverSettings.typeCheckingMode = typeCheckingMode;
                }
            }
        } catch (error) {
            this.console.error(`Error reading settings: ${error}`);
        }
        return serverSettings;
    }

    createBackgroundAnalysis(serviceId: string): BackgroundAnalysisBase | undefined {
        if (isDebugMode() || !getCancellationFolderName()) {
            // Don't do background analysis if we're in debug mode or an old client
            // is used where cancellation is not supported.
            return undefined;
        }

        return new BackgroundAnalysis(this.console);
    }

    protected override createHost() {
        return new FullAccessHost(this.fs);
    }

    protected override createImportResolver(
        serviceProvider: ServiceProvider,
        options: ConfigOptions,
        host: Host
    ): ImportResolver {
        const importResolver = new ImportResolver(serviceProvider, options, host);

        // In case there was cached information in the file system related to
        // import resolution, invalidate it now.
        importResolver.invalidateCache();

        return importResolver;
    }

    protected executeCommand(params: ExecuteCommandParams, token: CancellationToken): Promise<any> {
        return this._controller.execute(params, token);
    }

    protected isLongRunningCommand(command: string): boolean {
        return this._controller.isLongRunningCommand(command);
    }

    protected async executeCodeAction(
        params: CodeActionParams,
        token: CancellationToken
    ): Promise<(Command | CodeAction)[] | undefined | null> {
        this.recordUserInteractionTime();

        const filePath = this.uriParser.decodeTextDocumentUri(params.textDocument.uri);
        const workspace = await this.getWorkspaceForFile(filePath);
        return CodeActionProvider.getCodeActionsForPosition(
            workspace,
            filePath,
            params.range,
            params.context.only,
            token
        );
    }

    protected createProgressReporter(): ProgressReporter {
        // The old progress notifications are kept for backwards compatibility with
        // clients that do not support work done progress.

        let workDoneProgress: Promise<WorkDoneProgressServerReporter> | undefined;
        return {
            isEnabled: (data: AnalysisResults) => true,
            begin: () => {
                if (this.client.hasWindowProgressCapability) {
                    workDoneProgress = this.connection.window.createWorkDoneProgress();
                    workDoneProgress
                        .then((progress) => {
                            progress.begin('');
                        })
                        .ignoreErrors();
                } else {
                    this.connection.sendNotification('pyright/beginProgress');
                }
            },
            report: (message: string) => {
                if (workDoneProgress) {
                    workDoneProgress
                        .then((progress) => {
                            progress.report(message);
                        })
                        .ignoreErrors();
                } else {
                    this.connection.sendNotification('pyright/reportProgress', message);
                }
            },
            end: () => {
                if (workDoneProgress) {
                    workDoneProgress
                        .then((progress) => {
                            progress.done();
                        })
                        .ignoreErrors();
                    workDoneProgress = undefined;
                } else {
                    this.connection.sendNotification('pyright/endProgress');
                }
            },
        };
    }

    private _getStringValues(values: any) {
        if (!values || !Array.isArray(values) || values.length === 0) {
            return [];
        }

        return values.filter((p) => p && isString(p)) as string[];
    }
}
