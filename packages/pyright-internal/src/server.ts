/*
 * server.ts
 *
 * Implements pyright language server.
 */

import { isArray } from 'util';
import {
    CancellationToken,
    CodeAction,
    CodeActionKind,
    CodeActionParams,
    Command,
    ExecuteCommandParams,
} from 'vscode-languageserver/node';
import { isMainThread } from 'worker_threads';

import { AnalysisResults } from './analyzer/analysis';
import { BackgroundAnalysis, BackgroundAnalysisRunner } from './backgroundAnalysis';
import { BackgroundAnalysisBase } from './backgroundAnalysisBase';
import { CommandController } from './commands/commandController';
import { getCancellationFolderName } from './common/cancellationUtils';
import { LogLevel } from './common/console';
import { isDebugMode, isString } from './common/core';
import { convertUriToPath, normalizeSlashes } from './common/pathUtils';
import { ProgressReporter } from './common/progressReporter';
import {
    LanguageServerBase,
    ProgressReporterConnection,
    ServerSettings,
    WorkspaceServiceInstance,
} from './languageServerBase';
import { CodeActionProvider } from './languageService/codeActionProvider';

const maxAnalysisTimeInForeground = { openFilesTimeInMs: 50, noOpenFilesTimeInMs: 200 };

class PyrightServer extends LanguageServerBase {
    private _controller: CommandController;

    constructor() {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const version = require('../package.json').version || '';

        // When executed from CLI command (pyright-langserver), __rootDirectory is
        // already defined. When executed from VSCode extension, rootDirectory should
        // be __dirname.
        const rootDirectory = (global as any).__rootDirectory || __dirname;
        super({
            productName: 'Pyright',
            rootDirectory,
            version,
            maxAnalysisTimeInForeground,
            progressReporterFactory: reporterFactory,
            supportedCodeActions: [CodeActionKind.QuickFix, CodeActionKind.SourceOrganizeImports],
        });

        this._controller = new CommandController(this);
    }

    async getSettings(workspace: WorkspaceServiceInstance): Promise<ServerSettings> {
        const serverSettings: ServerSettings = {
            watchForSourceChanges: true,
            watchForLibraryChanges: true,
            openFilesOnly: true,
            useLibraryCodeForTypes: false,
            disableLanguageServices: false,
            disableOrganizeImports: false,
            typeCheckingMode: 'basic',
            diagnosticSeverityOverrides: {},
            logLevel: LogLevel.Info,
            autoImportCompletions: true,
        };

        try {
            const pythonSection = await this.getConfiguration(workspace.rootUri, 'python');
            if (pythonSection) {
                serverSettings.pythonPath = normalizeSlashes(pythonSection.pythonPath);
                serverSettings.venvPath = normalizeSlashes(pythonSection.venvPath);
            }

            const pythonAnalysisSection = await this.getConfiguration(workspace.rootUri, 'python.analysis');
            if (pythonAnalysisSection) {
                const typeshedPaths = pythonAnalysisSection.typeshedPaths;
                if (typeshedPaths && isArray(typeshedPaths) && typeshedPaths.length > 0) {
                    serverSettings.typeshedPath = normalizeSlashes(typeshedPaths[0]);
                }

                const stubPath = pythonAnalysisSection.stubPath;
                if (stubPath && isString(stubPath)) {
                    serverSettings.stubPath = normalizeSlashes(stubPath);
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

                serverSettings.logLevel = this.convertLogLevel(pythonAnalysisSection.logLevel);
                serverSettings.autoSearchPaths = !!pythonAnalysisSection.autoSearchPaths;

                const extraPaths = pythonAnalysisSection.extraPaths;
                if (extraPaths && isArray(extraPaths) && extraPaths.length > 0) {
                    serverSettings.extraPaths = extraPaths.map((p) => normalizeSlashes(p));
                }

                if (pythonAnalysisSection.typeCheckingMode !== undefined) {
                    serverSettings.typeCheckingMode = pythonAnalysisSection.typeCheckingMode;
                }

                if (pythonAnalysisSection.autoImportCompletions !== undefined) {
                    serverSettings.autoImportCompletions = pythonAnalysisSection.autoImportCompletions;
                }
            } else {
                serverSettings.autoSearchPaths = true;
            }

            const pyrightSection = await this.getConfiguration(workspace.rootUri, 'pyright');
            if (pyrightSection) {
                if (pyrightSection.openFilesOnly !== undefined) {
                    serverSettings.openFilesOnly = !!pyrightSection.openFilesOnly;
                }

                if (pyrightSection.useLibraryCodeForTypes !== undefined) {
                    serverSettings.useLibraryCodeForTypes = !!pyrightSection.useLibraryCodeForTypes;
                }

                serverSettings.disableLanguageServices = !!pyrightSection.disableLanguageServices;
                serverSettings.disableOrganizeImports = !!pyrightSection.disableOrganizeImports;
                if (pyrightSection.typeCheckingMode !== undefined) {
                    serverSettings.typeCheckingMode = pyrightSection.typeCheckingMode;
                }
            }
        } catch (error) {
            this.console.error(`Error reading settings: ${error}`);
        }
        return serverSettings;
    }

    createBackgroundAnalysis(): BackgroundAnalysisBase | undefined {
        if (isDebugMode() || !getCancellationFolderName()) {
            // Don't do background analysis if we're in debug mode or an old client
            // is used where cancellation is not supported.
            return undefined;
        }

        return new BackgroundAnalysis(this.console);
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

        const filePath = convertUriToPath(params.textDocument.uri);
        const workspace = await this.getWorkspaceForFile(filePath);
        return CodeActionProvider.getCodeActionsForPosition(workspace, filePath, params.range, token);
    }
}

function reporterFactory(connection: ProgressReporterConnection): ProgressReporter {
    return {
        isEnabled(data: AnalysisResults): boolean {
            return true;
        },

        begin(): void {
            connection.sendNotification('pyright/beginProgress');
        },

        report(message: string): void {
            connection.sendNotification('pyright/reportProgress', message);
        },

        end(): void {
            connection.sendNotification('pyright/endProgress');
        },
    };
}

export function main() {
    if (isMainThread) {
        new PyrightServer();
    } else {
        const runner = new BackgroundAnalysisRunner();
        runner.start();
    }
}
