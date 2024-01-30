import {
    CancellationToken,
    DidChangeConfigurationParams,
    DidChangeNotebookDocumentParams,
    Disposable,
    NotificationHandler,
    RequestHandler,
} from 'vscode-languageserver-protocol';

import { Uri } from '../../common/uri/uri';

export interface RequestSender {
    sendRequest<R>(method: string, params: any, token?: CancellationToken): Promise<R>;
}

export interface NotificationSender {
    sendNotification: (method: string, params?: any) => void;
}

export interface RequestReceiver {
    onRequest<P, R, E>(method: string, handler: RequestHandler<P, R, E>): Disposable;
}

export interface NotificationReceiver {
    onNotification<P>(method: string, handler: NotificationHandler<P>): Disposable;
}

export interface WorkspaceInfo {
    rootUri: Uri;
    kinds: string[];
    pythonPath: Uri | undefined;
    pythonPathKind: string;
}

// Type-safe LSP wrappers for our custom calls.
export namespace CustomLSP {
    export enum TestSignalKinds {
        Initialization = 'initialization',
        DidOpenDocument = 'didopendocument',
        DidChangeDocument = 'didchangedocument',
        DidOpenNotebookDocument = 'didopennotebookdocument',
        DidChangeNotebookDocument = 'didchangenotebookdocument',
        IndexingDone = 'indexingdone',
    }

    export interface TestSignal {
        uri: string;
        kind: TestSignalKinds;
    }

    export enum Requests {
        AnalyzeFile = 'test/analyzeFile',
        GetWorkspaceConfig = 'test/getWorkspaceConfig',
        GetWorkspaceSettings = 'test/getWorkspaceSettings',
        GetWorkspaceKinds = 'test/getWorkspaceKinds',
        GetWorkspaceInfos = 'test/getWorkspaceInfos',
        GetUserFiles = 'test/getUserFiles',
        GetOpenFiles = 'test/getOpenFiles',
        GetWorkspaceInfo = 'test/getWorkspaceInfo',
        GetFileContent = 'test/getFileContent',
        GetWorkspaceFileContent = 'test/getWorkspaceFileContent',
        AnalyzeWorkspace = 'test/analyzeWorkspace',
        GetDiagnostics = 'test/getDiagnostics',
    }

    export enum Notifications {
        SetStatusBarMessage = 'python/setStatusBarMessage',
        BeginProgress = 'python/beginProgress',
        ReportProgress = 'python/reportProgress',
        EndProgress = 'python/endProgress',
        WorkspaceTrusted = 'python/workspaceTrusted',
        TestSignal = 'test/signal',

        // Due to some restrictions on vscode-languageserver-node package,
        // we can't mix use types from the package in 2 different extensions.
        // Basically due to how lsp package utilizes singleton objects internally,
        // if we use a client created from python core extension, which uses LSP library
        // they imported, with LSP types from LSP library we imported, LSP will throw
        // an exception saying internal singleton objects are not same.
        //
        // To workaround it, we won't use some of LSP types directly but create our own
        // and use them with the client.
        DidChangeConfiguration = 'workspace/didChangeConfiguration',
        DidChangeNotebookDocument = 'notebookDocument/didChange',
        CacheDirCreate = 'python/cacheDirCreate',
        CacheFileWrite = 'python/cacheFileWrite',
        TestAddFile = 'test/addFile',
        // Starting/stopping the server are all notifications so they pass
        // through without any interference.
        TestStartServer = 'test/startServer',
        TestStartServerResponse = 'test/startServerResponse',
    }

    interface Params {
        [Requests.AnalyzeFile]: { uri: string };
        [Requests.GetWorkspaceConfig]: { uri: string };
        [Requests.GetWorkspaceSettings]: { uri: string };
        [Requests.GetWorkspaceKinds]: { uri: string };
        [Requests.GetWorkspaceInfos]: undefined;
        [Requests.AnalyzeWorkspace]: { uri: string };
        [Requests.GetUserFiles]: { uri: string };
        [Requests.GetOpenFiles]: { uri: string };
        [Requests.GetWorkspaceInfo]: { uri: string };
        [Requests.GetFileContent]: { uri: string };
        [Requests.GetWorkspaceFileContent]: { workspaceUri: string; fileUri: string };
        [Requests.GetDiagnostics]: { uri: string };
        [Notifications.CacheDirCreate]: { uri: string };
        [Notifications.CacheFileWrite]: { uri: string; contents: string; overwrite: boolean };
        [Notifications.SetStatusBarMessage]: string;
        [Notifications.BeginProgress]: undefined;
        [Notifications.ReportProgress]: string;
        [Notifications.EndProgress]: undefined;
        [Notifications.WorkspaceTrusted]: { isTrusted: boolean };
        [Notifications.TestSignal]: TestSignal;
        [Notifications.TestAddFile]: { code: string; fireFileChange: boolean };
        [Notifications.DidChangeConfiguration]: DidChangeConfigurationParams;
        [Notifications.DidChangeNotebookDocument]: DidChangeNotebookDocumentParams;
        [Notifications.TestStartServer]: TestServerStartOptions;
        [Notifications.TestStartServerResponse]: { testName: string };
    }

    interface Response {
        [Requests.AnalyzeFile]: void;
        [Requests.GetWorkspaceConfig]: { config: string };
        [Requests.GetWorkspaceSettings]: { settings: string };
        [Requests.GetWorkspaceKinds]: { kinds: string[] };
        [Requests.GetWorkspaceInfos]: { infos: string };
        [Requests.GetWorkspaceInfo]: { info: string };
        [Requests.GetFileContent]: { contents: string };
        [Requests.GetWorkspaceFileContent]: { contents: string };
        [Requests.AnalyzeWorkspace]: void;
        [Requests.GetUserFiles]: { files: string };
        [Requests.GetOpenFiles]: { files: string };
        [Requests.GetDiagnostics]: { diagnostics: string };
    }

    // Interface for returning config options as we cannot return a
    // class instance from the server.
    export interface IFileSpec {
        wildcardRoot: Uri;
        regExp: string;
        hasDirectoryWildcard: boolean;
    }
    export interface IConfigOptions {
        projectRoot: Uri;
        pythonPath?: Uri;
        typeshedPath?: Uri;
        include: IFileSpec[];
        exclude: IFileSpec[];
        ignore: IFileSpec[];
        strict: IFileSpec[];
    }

    /**
     * Data passed to the server worker thread in order to setup
     * a test server.
     */
    export interface TestServerStartOptions {
        testName: string; // Helpful for debugging
        pid: string; // Helpful for debugging
        logFile: Uri; // Helpful for debugging
        code: string; // Fourslash data.
        projectRoots: Uri[];
        pythonVersion: number;
        backgroundAnalysis?: boolean;
    }

    export function sendRequest<P extends Params, R extends Response, M extends Requests & keyof P & keyof R & string>(
        connection: RequestSender,
        method: M,
        params: P[M],
        token?: CancellationToken
    ): Promise<R[M]> {
        return connection.sendRequest(method, params, token);
    }

    export function sendNotification<P extends Params, M extends Notifications & keyof P & string>(
        connection: NotificationSender,
        method: M,
        params: P[M]
    ): void {
        connection.sendNotification(method, params);
    }

    export function onRequest<P extends Params, R extends Response, M extends Requests & keyof P & keyof R & string, E>(
        connection: RequestReceiver,
        method: M,
        handler: RequestHandler<P[M], R[M], E>
    ): Disposable {
        return connection.onRequest(method, handler);
    }

    export function onNotification<P extends Params, M extends Notifications & keyof P & string>(
        connection: NotificationReceiver,
        method: M,
        handler: NotificationHandler<P[M]>
    ): Disposable {
        return connection.onNotification(method, handler);
    }
}
