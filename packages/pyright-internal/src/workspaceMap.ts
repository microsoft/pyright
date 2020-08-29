/*
 * workspaceMap.ts
 *
 * Workspace management related functionality.
 */

import { createDeferred } from './common/deferred';
import { LanguageServerBase, WorkspaceServiceInstance } from './languageServerBase';

export class WorkspaceMap extends Map<string, WorkspaceServiceInstance> {
    private _defaultWorkspacePath = '<default>';

    constructor(private _ls: LanguageServerBase) {
        super();
    }

    getNonDefaultWorkspaces(): WorkspaceServiceInstance[] {
        const workspaces: WorkspaceServiceInstance[] = [];
        this.forEach((workspace) => {
            if (workspace.rootPath) {
                workspaces.push(workspace);
            }
        });

        return workspaces;
    }

    getWorkspaceForFile(filePath: string): WorkspaceServiceInstance {
        let bestRootPath: string | undefined;
        let bestInstance: WorkspaceServiceInstance | undefined;

        this.forEach((workspace) => {
            if (workspace.rootPath) {
                // Is the file is under this workspace folder?
                if (filePath.startsWith(workspace.rootPath)) {
                    // Is this the fist candidate? If not, is this workspace folder
                    // contained within the previous candidate folder? We always want
                    // to select the innermost folder, since that overrides the
                    // outer folders.
                    if (bestRootPath === undefined || workspace.rootPath.startsWith(bestRootPath)) {
                        bestRootPath = workspace.rootPath;
                        bestInstance = workspace;
                    }
                }
            }
        });

        // If there were multiple workspaces or we couldn't find any,
        // create a default one to use for this file.
        if (bestInstance === undefined) {
            let defaultWorkspace = this.get(this._defaultWorkspacePath);
            if (!defaultWorkspace) {
                // If there is only one workspace, use that one.
                const workspaceNames = [...this.keys()];
                if (workspaceNames.length === 1) {
                    return this.get(workspaceNames[0])!;
                }

                // Create a default workspace for files that are outside
                // of all workspaces.
                defaultWorkspace = {
                    workspaceName: '',
                    rootPath: '',
                    rootUri: '',
                    serviceInstance: this._ls.createAnalyzerService(this._defaultWorkspacePath),
                    disableLanguageServices: false,
                    disableOrganizeImports: false,
                    isInitialized: createDeferred<boolean>(),
                };
                this.set(this._defaultWorkspacePath, defaultWorkspace);
                this._ls.updateSettingsForWorkspace(defaultWorkspace).ignoreErrors();
            }

            return defaultWorkspace;
        }

        return bestInstance;
    }
}
