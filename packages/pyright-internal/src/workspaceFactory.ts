/*
 * workspaceFactory.ts
 *
 * Workspace management related functionality.
 */

import {
    InitializeParams,
    WorkspaceFoldersChangeEvent,
    WorkspaceFolder as lspWorkspaceFolder,
} from 'vscode-languageserver';

import { AnalyzerService } from './analyzer/service';
import { ConsoleInterface } from './common/console';
import { createDeferred } from './common/deferred';
import { Uri } from './common/uri/uri';
import { ServiceProvider } from './common/serviceProvider';

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

export interface WorkspaceFolder {
    workspaceName: string;
    rootUri: Uri | undefined;
}

// path and uri will point to a workspace itself. It could be a folder
// if the workspace represents a folder. it could be '' if it is the default workspace.
// But it also could be a file if it is a virtual workspace.
// rootPath will always point to the folder that contains the workspace.
export interface Workspace extends WorkspaceFolder {
    kinds: string[];
    service: AnalyzerService;
    disableLanguageServices: boolean;
    disableTaggedHints: boolean;
    disableOrganizeImports: boolean;
    disableWorkspaceSymbol: boolean;
    isInitialized: InitStatus;
    searchPathsToWatch: Uri[];
    pythonPath: Uri | undefined;
    pythonPathKind: WorkspacePythonPathKind;
    pythonEnvironmentName: string | undefined;
}

export interface NormalWorkspace extends Workspace {
    rootUri: Uri;
}

export function renameWorkspace(workspace: Workspace, name: string) {
    workspace.workspaceName = name;
    workspace.service.setServiceName(name);
}

export interface IWorkspaceFactory {
    handleInitialize(params: InitializeParams): void;
    handleWorkspaceFoldersChanged(params: WorkspaceFoldersChangeEvent, workspaces: lspWorkspaceFolder[] | null): void;

    getWorkspaceForFile(uri: Uri, pythonPath: Uri | undefined): Promise<Workspace>;
    getContainingWorkspacesForFile(filePath: Uri): Promise<Workspace[]>;

    applyPythonPath(workspace: Workspace, newPythonPath: Uri | undefined): Uri | undefined;
    getNonDefaultWorkspaces(kind?: string): NormalWorkspace[];

    clear(): void;
    items(): AllWorkspace[];
}

export class WorkspaceFactory implements IWorkspaceFactory {
    private _defaultWorkspacePath = '<default>';
    private _map = new Map<string, AllWorkspace>();
    private _id = WorkspaceFactoryIdCounter++;

    constructor(
        private readonly _console: ConsoleInterface,
        private readonly _createService: (name: string, rootPath: Uri, kinds: string[]) => AnalyzerService,
        private readonly _onWorkspaceCreated: (workspace: AllWorkspace) => void,
        private readonly _onWorkspaceRemoved: (workspace: AllWorkspace) => void,
        private readonly _serviceProvider: ServiceProvider
    ) {
        this._console.log(`WorkspaceFactory ${this._id} created`);
    }

    handleInitialize(params: InitializeParams) {
        // Create a service instance for each of the workspace folders.
        if (params.workspaceFolders) {
            params.workspaceFolders.forEach((folder) => {
                this._add(Uri.parse(folder.uri, this._serviceProvider), folder.name, undefined, [
                    WellKnownWorkspaceKinds.Regular,
                ]);
            });
        } else if (params.rootPath) {
            this._add(Uri.file(params.rootPath, this._serviceProvider), '', undefined, [
                WellKnownWorkspaceKinds.Regular,
            ]);
        }
    }

    handleWorkspaceFoldersChanged(params: WorkspaceFoldersChangeEvent, workspaces: lspWorkspaceFolder[] | null) {
        params.removed.forEach((workspaceInfo) => {
            const uri = Uri.parse(workspaceInfo.uri, this._serviceProvider);
            // Delete all workspaces for this folder. Even the ones generated for notebook kernels.
            const workspaces = this.getNonDefaultWorkspaces().filter((w) => w.rootUri.equals(uri));
            workspaces.forEach((w) => {
                this._remove(w);
            });
        });

        params.added.forEach((workspaceInfo) => {
            const uri = Uri.parse(workspaceInfo.uri, this._serviceProvider);

            // Add the new workspace.
            this._add(uri, workspaceInfo.name, undefined, [WellKnownWorkspaceKinds.Regular]);
        });

        // Ensure name changes are also reflected.
        const foldersToCheck =
            workspaces?.filter(
                (w) => !params.added.some((a) => a.uri === w.uri) && !params.removed.some((a) => a.uri === w.uri)
            ) ?? [];
        foldersToCheck.forEach((workspaceInfo) => {
            const uri = Uri.parse(workspaceInfo.uri, this._serviceProvider);

            const workspaces = this.getNonDefaultWorkspaces().filter(
                (w) => w.rootUri.equals(uri) && w.workspaceName !== workspaceInfo.name
            );

            workspaces.forEach((w) => renameWorkspace(w, workspaceInfo.name));
        });
    }

    items() {
        return Array.from(this._map.values());
    }

    applyPythonPath(workspace: Workspace, newPythonPath: Uri | undefined): Uri | undefined {
        // See if were allowed to apply the new python path
        if (workspace.pythonPathKind === WorkspacePythonPathKind.Mutable && !Uri.isEmpty(newPythonPath)) {
            workspace.pythonPath = newPythonPath;

            // This may not be the workspace in our map. Update the workspace in the map too.
            // This can happen during startup were the Initialize creates a workspace and then
            // onDidChangeConfiguration is called right away.
            const key = this._getWorkspaceKey(workspace);
            const workspaceInMap = this._map.get(key);
            if (workspaceInMap) {
                workspaceInMap.pythonPath = newPythonPath;
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

    getContainingWorkspace(filePath: Uri, pythonPath?: Uri): NormalWorkspace | undefined {
        return this._getBestRegularWorkspace(
            this.getNonDefaultWorkspaces(WellKnownWorkspaceKinds.Regular).filter((w) => filePath.startsWith(w.rootUri)),
            pythonPath
        );
    }

    getNonDefaultWorkspaces(kind?: string): NormalWorkspace[] {
        const workspaces: NormalWorkspace[] = [];
        this._map.forEach((workspace) => {
            if (!workspace.rootUri) {
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
    async getWorkspaceForFile(uri: Uri, pythonPath: Uri | undefined): Promise<Workspace> {
        // Wait for all workspaces to be initialized before attempting to find the best workspace. Otherwise
        // the list of files won't be complete and the `contains` check might fail.
        await Promise.all(this.items().map((w) => w.isInitialized.promise));

        // Find or create best match.
        const workspace = await this._getOrCreateBestWorkspaceForFile(uri, pythonPath);

        // The workspace may have just been created. Wait for it to be initialized before returning it.
        await workspace.isInitialized.promise;

        return workspace;
    }

    async getContainingWorkspacesForFile(filePath: Uri): Promise<Workspace[]> {
        // Wait for all workspaces to be initialized before attempting to find the best workspace. Otherwise
        // the list of files won't be complete and the `contains` check might fail.
        await Promise.all(this.items().map((w) => w.isInitialized.promise));

        // Find or create best match.
        // All workspaces that track the file should be considered.
        const workspaces = this.items().filter((w) => w.service.isTracked(filePath));

        // If that list is empty, get the best workspace
        if (workspaces.length === 0) {
            workspaces.push(this._getBestWorkspaceForFile(filePath, undefined));
        }

        // The workspaces may have just been created, wait for them all to be initialized
        await Promise.all(workspaces.map((w) => w.isInitialized.promise));

        return workspaces;
    }

    private _add<T extends Uri | undefined>(
        rootUri: T,
        name: string,
        pythonPath: Uri | undefined,
        kinds: string[]
    ): ConditionalWorkspaceReturnType<T> {
        const uri = rootUri ?? Uri.empty();

        // Update the kind based if the uri is local or not
        if (!kinds.includes(WellKnownWorkspaceKinds.Default) && !uri.isLocal()) {
            // Web based workspace should be limited.
            kinds = [...kinds, WellKnownWorkspaceKinds.Limited];
        }

        const result: Workspace = {
            workspaceName: name,
            rootUri,
            kinds,
            pythonPath,
            pythonPathKind: WorkspacePythonPathKind.Mutable,
            service: this._createService(name, uri, kinds),
            disableLanguageServices: false,
            disableTaggedHints: false,
            disableOrganizeImports: false,
            disableWorkspaceSymbol: false,
            isInitialized: createInitStatus(),
            searchPathsToWatch: [],
            pythonEnvironmentName: pythonPath?.toString(),
        };

        // Stick in our map
        const key = this._getWorkspaceKey(result);

        // Make sure to delete existing workspaces if there are any.
        this._remove(result);
        this._console.log(`WorkspaceFactory ${this._id} add ${key}`);
        this._map.set(key, result);

        // Tell our owner we added something. Order matters here as we
        // don't want to fire the workspace created while the old copy of this
        // workspace is still in the map.
        this._onWorkspaceCreated(result);

        return result as ConditionalWorkspaceReturnType<T>;
    }

    private _remove(value: Workspace) {
        const key = this._getWorkspaceKey(value);
        const workspace = this._map.get(key);
        if (workspace) {
            workspace.isInitialized.resolve();

            this._onWorkspaceRemoved(workspace);

            workspace.service.dispose();
            this._console.log(`WorkspaceFactory ${this._id} remove ${key}`);
            this._map.delete(key);
        }
    }

    private _getDefaultWorkspaceKey() {
        return `${this._defaultWorkspacePath}`;
    }

    private _getWorkspaceKey(value: Workspace) {
        // Special the root path for the default workspace. It will be created
        // without a root path
        if (value.kinds.includes(WellKnownWorkspaceKinds.Default)) {
            return this._getDefaultWorkspaceKey();
        }

        // Key is defined by the rootPath and the pythonPath. We might include platform in this, but for now
        // platform is only used by the import resolver.
        return `${value.rootUri}`;
    }

    private async _getOrCreateBestWorkspaceForFile(uri: Uri, pythonPath: Uri | undefined): Promise<Workspace> {
        // Find the current best workspace (without creating a new one)
        const bestInstance = this._getBestWorkspaceForFile(uri, pythonPath);

        // Make sure the best instance is initialized so that it has its pythonPath.
        await bestInstance.isInitialized.promise;

        return bestInstance;
    }

    private _getBestWorkspaceForFile(uri: Uri, pythonPath: Uri | undefined): Workspace {
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

        // First find the workspaces that are tracking the file
        const trackingWorkspaces = this.items()
            .filter((w) => w.service.isTracked(uri))
            .filter(isNormalWorkspace);

        // Then find the best in all of those that actually matches the pythonPath.
        bestInstance = this._getBestRegularWorkspace(trackingWorkspaces, pythonPath);

        const regularWorkspaces = this.getNonDefaultWorkspaces(WellKnownWorkspaceKinds.Regular);

        // If it's not in a tracked workspace, see if we only have regular workspaces with the same
        // length root path (basically, the same workspace with just different python paths)
        if (
            bestInstance === undefined &&
            regularWorkspaces.every(
                (w) =>
                    w.rootUri.scheme === regularWorkspaces[0].rootUri.scheme &&
                    (w.rootUri.scheme === uri.scheme || uri.isUntitled()) &&
                    w.rootUri.equals(regularWorkspaces[0].rootUri)
            )
        ) {
            bestInstance = this._getBestRegularWorkspace(regularWorkspaces, pythonPath);
        }

        // If the regular workspaces don't all have the same length or they don't
        // actually match on the python path, then try the workspaces that already have the file open or scanned.
        if (bestInstance === undefined || !bestInstance.pythonPath?.equals(pythonPath)) {
            bestInstance =
                this._getBestRegularWorkspace(
                    regularWorkspaces.filter((w) => w.service.hasSourceFile(uri) && w.rootUri.scheme === uri.scheme),
                    pythonPath
                ) || bestInstance;
        }

        // If that still didn't work, that must mean we don't have a workspace. Create a default one.
        if (bestInstance === undefined) {
            bestInstance = this._getOrCreateDefaultWorkspace(pythonPath);
        }

        return bestInstance;
    }

    private _getOrCreateDefaultWorkspace(pythonPath: Uri | undefined): DefaultWorkspace {
        // Default key depends upon the pythonPath
        let defaultWorkspace = this._map.get(this._getDefaultWorkspaceKey()) as DefaultWorkspace;
        if (!defaultWorkspace) {
            // Create a default workspace for files that are outside
            // of all workspaces.
            defaultWorkspace = this._add(undefined, this._defaultWorkspacePath, pythonPath, [
                WellKnownWorkspaceKinds.Default,
            ]);
        }

        return defaultWorkspace;
    }

    private _getLongestPathWorkspace(workspaces: NormalWorkspace[]): NormalWorkspace {
        const longestPath = workspaces.reduce((previousPath, currentWorkspace) => {
            if (!previousPath) {
                return currentWorkspace.rootUri;
            }
            if (currentWorkspace.rootUri.getPathLength() > previousPath.getPathLength()) {
                return currentWorkspace.rootUri;
            }

            return previousPath;
        }, Uri.empty());
        return workspaces.find((w) => w.rootUri.equals(longestPath))!;
    }

    private _getBestRegularWorkspace(workspaces: NormalWorkspace[], pythonPath?: Uri): NormalWorkspace | undefined {
        if (workspaces.length === 0) {
            return undefined;
        }

        // If there's only one, then it's the best.
        if (workspaces.length === 1) {
            return workspaces[0];
        }

        // If there's any that match the python path, take the one with the longest path from those.
        if (!Uri.isEmpty(pythonPath)) {
            const matchingWorkspaces = workspaces.filter((w) => Uri.equals(w.pythonPath, pythonPath));
            if (matchingWorkspaces.length > 0) {
                return this._getLongestPathWorkspace(matchingWorkspaces);
            }
        }

        // Otherwise, just take the longest path.
        return this._getLongestPathWorkspace(workspaces);
    }
}

interface DefaultWorkspace extends Workspace {
    rootUri: undefined;
}

type AllWorkspace = DefaultWorkspace | NormalWorkspace;

type ConditionalWorkspaceReturnType<T> = T extends undefined ? DefaultWorkspace : NormalWorkspace;

function isNormalWorkspace(workspace: AllWorkspace): workspace is NormalWorkspace {
    return !!workspace.rootUri;
}
