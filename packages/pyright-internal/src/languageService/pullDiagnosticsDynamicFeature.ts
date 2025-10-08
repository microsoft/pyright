/*
 * PullDiagnosticsDynamicFeature.ts
 * Copyright (c) Microsoft Corporation.
 *
 * implementation of pull mode diagnostics feature registration
 */
import {
    Connection,
    DiagnosticRegistrationOptions,
    Disposable,
    DocumentDiagnosticRequest,
} from 'vscode-languageserver';
import { DynamicFeature } from './dynamicFeature';
import { ServerSettings } from '../common/languageServerInterface';

export class PullDiagnosticsDynamicFeature extends DynamicFeature {
    private _workspaceSupport = false;
    private _registered = false;

    constructor(private readonly _connection: Connection, private readonly _id: string = 'pyright') {
        super('pull diagnostics');
    }

    override update(settings: ServerSettings): void {
        // There is one caveat with these settings. These settings can be set
        // per workspace, but these features apply to the entire language server.
        // Therefore, if the user has set these settings differently per workspace,
        // the last setting will take precedence.
        const workspaceSupport = settings.openFilesOnly === false;
        if (this._workspaceSupport !== workspaceSupport || !this._registered) {
            this._workspaceSupport = workspaceSupport;
            this.register();
        }
    }

    protected override registerFeature(): Promise<Disposable> {
        this._registered = true;
        const options: DiagnosticRegistrationOptions = {
            interFileDependencies: true,
            workspaceDiagnostics: this._workspaceSupport,
            documentSelector: null,
            identifier: this._id,
        };
        return this._connection.client.register(DocumentDiagnosticRequest.type, options);
    }
}
