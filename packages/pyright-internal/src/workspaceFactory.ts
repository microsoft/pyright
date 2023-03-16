/*
 * workspaceFactory.ts
 *
 * Workspace management related functionality.
 */

import { InitializeParams, WorkspaceFoldersChangeEvent } from 'vscode-languageserver';

import { AnalyzerService } from './analyzer/service';
import { ConsoleInterface } from './common/console';
import { createDeferred } from './common/deferred';
import { UriParser } from './common/uriParser';

let WorkspaceFactoryIdCounter = 0;

export enum WellKnownWorkspaceKinds {
    Default = 'default',
    Regular = 'regular',
    Limited = 'limited',
    Cloned = 'cloned',
    Test = 'test',
}

export enum WorkspacePythonPathKind {
    Immutable = 'immutable',
    Mutable = 'mutable',
}

export interface InitStatus {
    resolve(): void;
    reset(): InitStatus;
    markCalled(): void;
    promise: Promise<void>;
    resolved(): boolean;
}

export function createInitStatus(): InitStatus {
    // Due to the way we get `python path`, `include/exclude` from settings to initialize workspace,
    // we need to wait for getSettings to finish before letting IDE features to use workspace (`isInitialized` field).
    // So most of cases, whenever we create new workspace, we send request to workspace/configuration right way
    // except one place which is `initialize` LSP call.
    // In `initialize` method where we create `initial workspace`, we can't do that since LSP spec doesn't allow
    // LSP server from sending any request to client until `initialized` method is called.
    // This flag indicates whether we had our initial updateSetting call or not after `initialized` call.
    let called = false;

    const deferred = createDeferred<void>();
    const self = {
        promise: deferred.promise,
        resolve: () => {
            called = true;
            deferred.resolve();
        },
        markCalled: () => {
            called = true;
        },
        reset: () => {
            if (!called) {
                return self;
            }

            return createInitStatus();
        },
        resolved: () => {
            return deferred.resolved;
        },
    };

    return self;
}

// path and uri will point to a workspace itself. It could be a folder
// if the workspace represents a folder. it could be '' if it is the default workspace.
// But it also could be a file if it is a virtual workspace.
// rootPath will always point to the folder that contains the workspace.
export interface Workspace {
    workspaceName: string;
    rootPath: string;
    uri: string;
    kinds: string[];
    service: AnalyzerService;
    disableLanguageServices: boolean;
    disableOrganizeImports: boolean;
    disableWorkspaceSymbol: boolean;
    isInitialized: InitStatus;
    searchPathsToWatch: string[];
    pythonPath: string | undefined;
    pythonPathKind: WorkspacePythonPathKind;
}

export class WorkspaceFactory {
    private _defaultWorkspacePath = '<default>';
    private _map = new Map<string, Workspace>();
    private _id = WorkspaceFactoryIdCounter++;

    constructor(
        private readonly _console: ConsoleInterface,
        private readonly _uriParser: UriParser,
        private readonly _createService: (
            name: string,
            rootPath: string,
            uri: string,
            kinds: string[]
        ) => AnalyzerService,
        private readonly _isPythonPathImmutable: (path: string) => boolean,
        private readonly _onWorkspaceCreated: (workspace: Workspace) => void
    ) {
        this._console.log(`WorkspaceFactory ${this._id} created`);
    }

    handleInitialize(params: InitializeParams) {
        // Create a service instance for each of the workspace folders.
        if (params.workspaceFolders) {
            params.workspaceFolders.forEach((folder) => {
                const path = this._uriParser.decodeTextDocumentUri(folder.uri);
                this._add(folder.uri, path, folder.name, undefined, WorkspacePythonPathKind.Mutable, [
                    WellKnownWorkspaceKinds.Regular,
                ]);
            });
        } else if (params.rootPath) {
            this._add(params.rootPath, params.rootPath, params.rootPath, undefined, WorkspacePythonPathKind.Mutable, [
                WellKnownWorkspaceKinds.Regular,
            ]);
        }
    }

    handleWorkspaceFoldersChanged(params: WorkspaceFoldersChangeEvent) {
        params.removed.forEach((workspaceInfo) => {
            const rootPath = this._uriParser.decodeTextDocumentUri(workspaceInfo.uri);
            // Delete all workspaces for this folder. Even the ones generated for notebook kernels.
            const workspaces = this.getNonDefaultWorkspaces().filter((w) => w.rootPath === rootPath);
            workspaces.forEach((w) => {
                this._remove(w);
            });
        });

        params.added.forEach((workspaceInfo) => {
            const rootPath = this._uriParser.decodeTextDocumentUri(workspaceInfo.uri);
            this._add(workspaceInfo.uri, rootPath, workspaceInfo.name, undefined, WorkspacePythonPathKind.Mutable, [
                WellKnownWorkspaceKinds.Regular,
            ]);
        });
    }

    items() {
        return [...this._map.values()];
    }

    applyPythonPath(workspace: Workspace, newPythonPath: string | undefined): string | undefined {
        // See if were allowed to apply the new python path
        if (workspace.pythonPathKind === WorkspacePythonPathKind.Mutable && newPythonPath) {
            const originalPythonPath = workspace.pythonPath;
            workspace.pythonPath = newPythonPath;

            // This may not be the workspace in our map. Update the workspace in the map too.
            // This can happen during startup were the Initialize creates a workspace and then
            // onDidChangeConfiguration is called right away.
            const key = this._getWorkspaceKey(workspace);
            const workspaceInMap = this._map.get(key);
            if (workspaceInMap) {
                workspaceInMap.pythonPath = newPythonPath;
            }

            // If the python path has changed, we may need to move the immutable files to the correct workspace.
            if (originalPythonPath && originalPythonPath !== newPythonPath && workspaceInMap) {
                // Potentially move immutable files from one workspace to another.
                this._moveImmutableFilesToCorrectWorkspace(originalPythonPath, workspaceInMap);
            }
        }

        // Return the python path that should be used (whether hardcoded or configured)
        return workspace.pythonPath;
    }

    clear() {
        this._map.forEach((workspace) => {
            workspace.isInitialized.resolve();
            workspace.service.dispose();
        });
        this._map.clear();
        this._console.log(`WorkspaceFactory ${this._id} clear`);
    }

    hasMultipleWorkspaces(kind?: string) {
        if (this._map.size === 0 || this._map.size === 1) {
            return false;
        }

        let count = 0;
        for (const kv of this._map) {
            if (!kind || kv[1].kinds.some((k) => k === kind)) {
                count++;
            }

            if (count > 1) {
                return true;
            }
        }

        return false;
    }

    getContainingWorkspace(filePath: string, pythonPath?: string) {
        return this._getBestRegularWorkspace(
            this.getNonDefaultWorkspaces(WellKnownWorkspaceKinds.Regular).filter((w) =>
                filePath.startsWith(w.rootPath)
            ),
            pythonPath
        );
    }

    moveFiles(filePaths: string[], fromWorkspace: Workspace, toWorkspace: Workspace) {
        if (fromWorkspace === toWorkspace) {
            return;
        }

        filePaths.forEach((f) => {
            const fileInfo = fromWorkspace.service.backgroundAnalysisProgram.program.getSourceFileInfo(f);
            if (fileInfo) {
                toWorkspace.service.setFileOpened(
                    f,
                    fileInfo.sourceFile.getClientVersion() || null,
                    fileInfo.sourceFile.getFileContent() || '',
                    fileInfo.sourceFile.getIPythonMode(),
                    fileInfo.chainedSourceFile ? fileInfo.chainedSourceFile.sourceFile.getFilePath() : undefined,
                    fileInfo.sourceFile.getRealFilePath()
                );
                fromWorkspace.service.setFileClosed(f, fileInfo.isTracked);
            }
        });

        // If the fromWorkspace has no more files in it (and it's an immutable pythonPath), then remove it.
        this.removeUnused(fromWorkspace);
    }

    getNonDefaultWorkspaces(kind?: string): Workspace[] {
        const workspaces: Workspace[] = [];
        this._map.forEach((workspace) => {
            if (!workspace.rootPath) {
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
    async getWorkspaceForFile(filePath: string, pythonPath: string | undefined): Promise<Workspace> {
        // Wait for all workspaces to be initialized before attempting to find the best workspace. Otherwise
        // the list of files won't be complete and the `contains` check might fail.
        await Promise.all([...this._map.values()].map((w) => w.isInitialized.promise));

        // Find or create best match.
        const workspace = await this._getOrCreateBestWorkspaceForFile(filePath, pythonPath);

        // The workspace may have just been created. Wait for it to be initialized before returning it.
        await workspace.isInitialized.promise;

        return workspace;
    }

    removeUnused(workspace: Workspace) {
        // Only remove this workspace is it's not being used and it's a hardcoded path kind.
        if (
            workspace.service.getOpenFiles().length === 0 &&
            workspace.pythonPathKind === WorkspacePythonPathKind.Immutable
        ) {
            // Destroy the workspace since it only had immutable files in it.
            this._remove(workspace);
        }
    }

    private async _moveImmutableFilesToCorrectWorkspace(oldPythonPath: string, mutableWorkspace: Workspace) {
        // If the python path changes we may need to move some immutable files around.
        // For example, if a notebook had the old python path, we need to create a new workspace
        // for the notebook.
        // If a notebook has the new python path but is currently in a workspace with the path hardcoded, we need to move it to
        // this workspace.
        const oldPathFiles = new Set<string>(
            mutableWorkspace.service.getOpenFiles().filter((f) => this._isPythonPathImmutable(f))
        );
        const exitingWorkspaceWithSamePath = this.items().find(
            (w) => w.pythonPath === mutableWorkspace.pythonPath && w !== mutableWorkspace
        );
        const newPathFiles = new Set<string>(
            exitingWorkspaceWithSamePath?.service.getOpenFiles().filter((f) => this._isPythonPathImmutable(f))
        );

        // Immutable files that were in this mutableWorkspace have to be moved
        // to a (potentially) new workspace (with the old path).
        for (const file of oldPathFiles) {
            const workspace = this._getOrCreateBestWorkspaceFileSync(file, oldPythonPath);
            if (workspace !== mutableWorkspace) {
                this.moveFiles([file], mutableWorkspace, workspace);
            }
        }

        // Immutable files from a different workspace (with the same path as the new path)
        // have to be moved to the mutable workspace (which now has the new path)
        if (exitingWorkspaceWithSamePath) {
            this.moveFiles([...newPathFiles], exitingWorkspaceWithSamePath!, mutableWorkspace);
            this.removeUnused(exitingWorkspaceWithSamePath);
        }
    }

    private _add(
        rootUri: string,
        rootPath: string,
        name: string,
        pythonPath: string | undefined,
        pythonPathKind: WorkspacePythonPathKind,
        kinds: string[]
    ) {
        // Update the kind based of the uri is local or not
        if (!this._uriParser.isLocal(rootUri)) {
            // Web based workspace should be limited.
            kinds = [...kinds, WellKnownWorkspaceKinds.Limited];
        }

        const result: Workspace = {
            workspaceName: name,
            rootPath,
            uri: rootUri,
            kinds,
            pythonPath,
            pythonPathKind,
            service: this._createService(name, rootPath, rootUri, kinds),
            disableLanguageServices: false,
            disableOrganizeImports: false,
            disableWorkspaceSymbol: false,
            isInitialized: createInitStatus(),
            searchPathsToWatch: [],
        };

        // Tell our owner we added something
        this._onWorkspaceCreated(result);

        // Stick in our map
        const key = this._getWorkspaceKey(result);

        // Make sure to delete existing workspaces if there are any.
        this._remove(result);
        this._console.log(`WorkspaceFactory ${this._id} add ${key}`);
        this._map.set(key, result);

        return result;
    }

    private _remove(value: Workspace) {
        const key = this._getWorkspaceKey(value);
        const workspace = this._map.get(key);
        if (workspace) {
            workspace.isInitialized.resolve();
            workspace.service.dispose();
            this._console.log(`WorkspaceFactory ${this._id} remove ${key}`);
            this._map.delete(key);
        }
    }

    private _getDefaultWorskpaceKey(pythonPath: string | undefined) {
        return `${this._defaultWorkspacePath}:${pythonPath ? pythonPath : WorkspacePythonPathKind.Mutable}`;
    }

    private _getWorkspaceKey(value: Workspace) {
        // Special the root path for the default workspace. It will be created
        // without a root path
        const rootPath = value.kinds.includes(WellKnownWorkspaceKinds.Default)
            ? this._defaultWorkspacePath
            : value.rootPath;

        // Key is defined by the rootPath and the pythonPath. We might include platform in this, but for now
        // platform is only used by the import resolver.
        return `${rootPath}:${
            value.pythonPathKind === WorkspacePythonPathKind.Mutable ? value.pythonPathKind : value.pythonPath
        }`;
    }

    private async _getOrCreateBestWorkspaceForFile(
        filePath: string,
        pythonPath: string | undefined
    ): Promise<Workspace> {
        // Find the current best workspace (without creating a new one)
        let bestInstance = this._getBestWorkspaceForFile(filePath, pythonPath);

        // Make sure the best instance is initialized so that it has its pythonPath.
        await bestInstance.isInitialized.promise;

        // If this best instance doesn't match the pythonPath, then we need to create a new one.
        if (pythonPath && bestInstance.pythonPath !== pythonPath) {
            bestInstance = this._add(
                bestInstance.uri,
                bestInstance.rootPath,
                bestInstance.workspaceName,
                pythonPath,
                WorkspacePythonPathKind.Immutable, // This means the pythonPath should never change.
                bestInstance.kinds
            );
        }

        return bestInstance;
    }

    private _getOrCreateBestWorkspaceFileSync(filePath: string, pythonPath: string) {
        // Find the current best workspace (without creating a new one)
        let bestInstance = this._getBestWorkspaceForFile(filePath, pythonPath);

        // If this best instance doesn't match the pythonPath, then we need to create a new one.
        if (bestInstance.pythonPath !== pythonPath) {
            bestInstance = this._add(
                bestInstance.uri,
                bestInstance.rootPath,
                bestInstance.workspaceName,
                pythonPath,
                WorkspacePythonPathKind.Immutable, // This means the pythonPath should never change.
                bestInstance.kinds
            );
        }

        return bestInstance;
    }

    private _getBestWorkspaceForFile(filePath: string, pythonPath: string | undefined): Workspace {
        let bestRootPath: string | undefined;
        let bestInstance: Workspace | undefined;

        // The order of how we find the best matching workspace for the given file is
        // 1. The given file is the workspace itself (ex, a file being a virtual workspace itself).
        // 2. The given file matches the fileSpec of the service under the workspace
        //    (the file is a user file the workspace provides LSP service for).
        // 3. The given file doesn't match anything but we have only 1 regular workspace
        //    (ex, open a library file from the workspace).
        // 4. The given file doesn't match anything and there are multiple workspaces but one of workspaces
        //    contains the file (ex, open a library file already imported by a workspace).
        // 5. If none of the above works, then it matches the default workspace.
        this._map.forEach((workspace) => {
            if (workspace.rootPath) {
                if (workspace.rootPath !== filePath && !workspace.service.isTracked(filePath)) {
                    return;
                }

                // Among workspaces that own the file, make sure we return the inner most one which
                // we consider as the best workspace.
                if (
                    bestRootPath === undefined ||
                    (workspace.rootPath.startsWith(bestRootPath) && workspace.rootPath !== bestRootPath)
                ) {
                    // Among workspaces with a python path, make sure we return the one that matches the python path
                    if (pythonPath && workspace.pythonPath === pythonPath) {
                        bestRootPath = workspace.rootPath;
                        bestInstance = workspace;
                    } else if (workspace.pythonPathKind === WorkspacePythonPathKind.Mutable && !pythonPath) {
                        // If no python path passed, pick the workspace with the configured python path.
                        bestRootPath = workspace.rootPath;
                        bestInstance = workspace;
                    }
                }
            }
        });

        // If there were multiple workspaces or we couldn't find any,
        // use the default one.
        if (bestInstance === undefined) {
            const regularWorkspaces = this.getNonDefaultWorkspaces(WellKnownWorkspaceKinds.Regular);

            // If we have only regular workspaces with the same path, then pick the one that best matches the python path.
            if (
                regularWorkspaces.length &&
                regularWorkspaces.every((w) => w.rootPath === regularWorkspaces[0].rootPath)
            ) {
                bestInstance = pythonPath
                    ? regularWorkspaces.find((w) => w.pythonPath === pythonPath) || regularWorkspaces[0]
                    : regularWorkspaces[0];
            } else {
                // If we have multiple workspaces, then pick the containing workspace that best matches the python path.
                const containingWorkspace = this._getBestRegularWorkspace(
                    regularWorkspaces.filter((w) => w.service.contains(filePath)),
                    pythonPath
                );
                if (containingWorkspace) {
                    bestInstance = containingWorkspace;
                } else {
                    // If no workspace contains it, then it belongs to the default workspace.
                    bestInstance = this._getOrCreateDefaultWorkspace(pythonPath);
                }
            }
        }

        return bestInstance;
    }

    private _getOrCreateDefaultWorkspace(pythonPath: string | undefined): Workspace {
        // Default key depends upon the pythonPath
        let defaultWorkspace = this._map.get(this._getDefaultWorskpaceKey(pythonPath));
        if (!defaultWorkspace) {
            // Create a default workspace for files that are outside
            // of all workspaces.
            defaultWorkspace = this._add(
                '',
                '',
                this._defaultWorkspacePath,
                pythonPath,
                pythonPath ? WorkspacePythonPathKind.Immutable : WorkspacePythonPathKind.Mutable,
                [WellKnownWorkspaceKinds.Default]
            );
        }

        return defaultWorkspace;
    }

    private _getBestRegularWorkspace(workspaces: Workspace[], pythonPath?: string): Workspace | undefined {
        if (workspaces.length === 0) {
            return undefined;
        }

        if (workspaces.length === 1) {
            return workspaces[0];
        }

        // Further filter by longest paths.
        const longestPath = workspaces.reduce((previousPath, currentWorkspace) => {
            if (!previousPath) {
                return currentWorkspace.rootPath;
            }
            if (currentWorkspace.rootPath.length > previousPath.length) {
                return currentWorkspace.rootPath;
            }

            return previousPath;
        }, '');
        const longestWorkspaces = workspaces.filter((w) => w.rootPath === longestPath);

        // Filter by any that match the current python path.
        return longestWorkspaces.find((w) => !pythonPath || w.pythonPath === pythonPath) || longestWorkspaces[0];
    }
}
