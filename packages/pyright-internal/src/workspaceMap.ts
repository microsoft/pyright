/*
 * workspaceMap.ts
 *
 * Workspace management related functionality.
 */

import {
    createInitStatus,
    LanguageServerBase,
    WellKnownWorkspaceKinds,
    WorkspaceServiceInstance,
} from './languageServerBase';

export class WorkspaceMap extends Map<string, WorkspaceServiceInstance> {
    private _defaultWorkspacePath = '<default>';

    override set(key: string, value: WorkspaceServiceInstance): this {
        // Make sure to delete existing workspace if there is one.
        this.delete(key);
        return super.set(key, value);
    }

    override delete(key: string): boolean {
        const workspace = this.get(key);
        if (!workspace) {
            return false;
        }

        // Make sure to unblock if there is someone waiting this workspace.
        workspace.isInitialized.resolve();

        // Properly dispose of the service instance.
        workspace.serviceInstance.dispose();

        return super.delete(key);
    }

    hasMultipleWorkspaces(kind?: string) {
        if (this.size === 0 || this.size === 1) {
            return false;
        }

        let count = 0;
        for (const kv of this) {
            if (!kind || kv[1].kinds.some((k) => k === kind)) {
                count++;
            }

            if (count > 1) {
                return true;
            }
        }

        return false;
    }

    getNonDefaultWorkspaces(kind?: string): WorkspaceServiceInstance[] {
        const workspaces: WorkspaceServiceInstance[] = [];
        this.forEach((workspace) => {
            if (!workspace.path) {
                return;
            }

            if (kind && !workspace.kinds.some((k) => k === kind)) {
                return;
            }

            workspaces.push(workspace);
        });

        return workspaces;
    }

    // Returns the best workspace for a file. Waits for the workspace to be finished handling other events before
    // returning the appropriate workspace.
    async getWorkspaceForFile(ls: LanguageServerBase, filePath: string): Promise<WorkspaceServiceInstance> {
        // Make sure we always have a default workspace.
        const defaultWorkspace = this._createDefaultWorkspace(ls);

        // Wait for all workspaces to be initialized before attempting to find the best workspace. Otherwise
        // the list of files won't be complete and the `contains` check might fail.
        await Promise.all([...this.values()].map((w) => w.isInitialized.promise));

        // Find best match.
        const workspace = this._getBestWorkspaceForFile(ls, filePath, defaultWorkspace);

        // During the previous await we might have reset to being uninitialized again, wait before returning
        await workspace.isInitialized.promise;

        return workspace;
    }

    getContainingWorkspace(filePath: string) {
        return this._getBestWorkspace(
            this.getNonDefaultWorkspaces(WellKnownWorkspaceKinds.Regular).filter((w) => filePath.startsWith(w.path))
        );
    }

    getDefaultWorkspace(): WorkspaceServiceInstance | undefined {
        return this.get(this._defaultWorkspacePath);
    }

    private _getBestWorkspaceForFile(
        ls: LanguageServerBase,
        filePath: string,
        defaultWorkspace: WorkspaceServiceInstance
    ): WorkspaceServiceInstance {
        let bestRootPath: string | undefined;
        let bestInstance: WorkspaceServiceInstance | undefined;

        // The order of how we find the best matching workspace for the given file is
        // 1. The given file is the workspace itself (ex, a file being a virtual workspace itself).
        // 2. The given file matches the fileSpec of the service under the workspace
        //    (the file is a user file the workspace provides LSP service for).
        // 3. The given file doesn't match anything but we have only 1 regular workspace
        //    (ex, open a library file from the workspace).
        // 4. The given file doesn't match anything and there are multiple workspaces but one of workspaces
        //    contains the file (ex, open a library file already imported by a workspace).
        // 5. If none of the above works, then it matches the default workspace.
        this.forEach((workspace) => {
            if (workspace.path) {
                if (workspace.path !== filePath && !workspace.serviceInstance.isTracked(filePath)) {
                    return;
                }

                // Among workspaces that own the file, make sure we return the inner most one which
                // we consider as the best workspace.
                if (bestRootPath === undefined || workspace.path.startsWith(bestRootPath)) {
                    bestRootPath = workspace.path;
                    bestInstance = workspace;
                }
            }
        });

        // If there were multiple workspaces or we couldn't find any,
        // use the default one.
        if (bestInstance === undefined) {
            const regularWorkspaces = this.getNonDefaultWorkspaces(WellKnownWorkspaceKinds.Regular);

            // If we have only 1 regular workspace, then use that.
            if (regularWorkspaces.length === 1) {
                bestInstance = regularWorkspaces[0];
            } else {
                // If we have multiple workspaces, see whether we can at least find one that contains the file.
                // the file might not be tracked (user file), but still belongs to a workspace as a library file or as an orphan file to the workspace.
                const containingWorkspace = this._getBestWorkspace(
                    regularWorkspaces.filter((w) => w.serviceInstance.contains(filePath))
                );
                if (containingWorkspace) {
                    bestInstance = containingWorkspace;
                } else {
                    // If no workspace contains it, then it belongs to the default workspace.
                    bestInstance = defaultWorkspace;
                }
            }
        }

        return bestInstance;
    }

    private _createDefaultWorkspace(ls: LanguageServerBase) {
        let defaultWorkspace = this.get(this._defaultWorkspacePath);
        if (!defaultWorkspace) {
            // Create a default workspace for files that are outside
            // of all workspaces.
            defaultWorkspace = {
                workspaceName: '',
                rootPath: '',
                path: '',
                uri: '',
                serviceInstance: ls.createAnalyzerService(this._defaultWorkspacePath),
                kinds: [WellKnownWorkspaceKinds.Default],
                disableLanguageServices: false,
                disableOrganizeImports: false,
                disableWorkspaceSymbol: false,
                isInitialized: createInitStatus(),
                searchPathsToWatch: [],
            };
            this.set(this._defaultWorkspacePath, defaultWorkspace);

            // Do not await this. let isInitialized.promise to await. Otherwise, ordering
            // will get messed up. The very first call will run last.
            ls.updateSettingsForWorkspace(defaultWorkspace, defaultWorkspace.isInitialized).ignoreErrors();
        }

        return defaultWorkspace;
    }

    private _getBestWorkspace(workspaces: WorkspaceServiceInstance[]) {
        if (workspaces.length === 0) {
            return undefined;
        }

        if (workspaces.length === 1) {
            return workspaces[0];
        }

        // Best workspace is the inner most workspace.
        return workspaces.reduce((previousWorkspace, currentWorkspace) => {
            if (!previousWorkspace) {
                return currentWorkspace;
            }

            if (currentWorkspace.path.startsWith(previousWorkspace.path)) {
                return currentWorkspace;
            }

            return previousWorkspace;
        }, workspaces[0]);
    }
}
