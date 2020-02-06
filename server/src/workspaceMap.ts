/*
 * workspaceMap.ts
 *
 * Workspace management related functionality.
 */

import { LanguageServerBase, WorkspaceServiceInstance } from './languageServerBase';

export class WorkspaceMap extends Map<string, WorkspaceServiceInstance> {
    private _workspaceMap = new Map<string, WorkspaceServiceInstance>();
    private _defaultWorkspacePath = '<default>';

    constructor(private _ls: LanguageServerBase) {
        super();
    }

    getWorkspaceForFile(filePath: string): WorkspaceServiceInstance {
        let bestRootPath: string | undefined;
        let bestInstance: WorkspaceServiceInstance | undefined;

        this._workspaceMap.forEach(workspace => {
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
            let defaultWorkspace = this._workspaceMap.get(this._defaultWorkspacePath);
            if (!defaultWorkspace) {
                // If there is only one workspace, use that one.
                const workspaceNames = [...this._workspaceMap.keys()];
                if (workspaceNames.length === 1) {
                    return this._workspaceMap.get(workspaceNames[0])!;
                }

                // Create a default workspace for files that are outside
                // of all workspaces.
                defaultWorkspace = {
                    workspaceName: '',
                    rootPath: '',
                    rootUri: '',
                    serviceInstance: this._ls.createAnalyzerService(this._defaultWorkspacePath),
                    disableLanguageServices: false
                };
                this._workspaceMap.set(this._defaultWorkspacePath, defaultWorkspace);
                this._ls.updateSettingsForWorkspace(defaultWorkspace).ignoreErrors();
            }

            return defaultWorkspace;
        }

        return bestInstance;
    }
}
