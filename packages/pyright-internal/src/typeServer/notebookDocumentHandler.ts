/*
 * notebookDocumentHandler.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Handles notebook document lifecycle events (open/change/close) for the type server, keeping
 * each notebook's cell chain in sync with the analyzer so cells analyze as a linear chain of
 * chained source files.
 *
 * This is a slimmed-down port of Pylance's `DefaultNotebookDocumentHandler`. It preserves the
 * event-ordering model (a serial event queue plus a per-notebook deferred data chain) and the
 * cell-chain maintenance, but drops the Pylance-specific machinery (per-notebook Python-path /
 * kernel resolution, settings transformers, startup commands, and test signals). The type
 * server resolves Python paths from workspace configuration the same way it does for regular
 * files.
 */

import {
    DidChangeNotebookDocumentParams,
    DidCloseNotebookDocumentParams,
    DidOpenNotebookDocumentParams,
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { IPythonMode } from '../analyzer/sourceFile';
import { CaseSensitivityDetector } from '../common/caseSensitivityDetector';
import { ConsoleInterface } from '../common/console';
import { createDeferred, Deferred } from '../common/deferred';
import { Uri } from '../common/uri/uri';
import { Workspace } from '../workspaceFactory';

import {
    createNotebookData,
    getDefaultPrefixCellContents,
    NotebookData,
    openNotebookCellChain,
    updateNotebookStructure,
    verifyCellChainIsLinear,
} from './notebookCellChain';
import { NotebookUriMapper } from './notebookUriMapper';

type NotebookDataChain = {
    old: Promise<NotebookData>;
    new: Deferred<NotebookData>;
    continuation: Promise<NotebookData>;
};

/**
 * A minimal serial task queue: each queued task runs only after the previous one settles,
 * preserving the order in which notebook events arrive regardless of their async work.
 */
class Sequencer {
    private _current: Promise<unknown> = Promise.resolve(null);

    queue<T>(task: () => Promise<T>): Promise<T> {
        return (this._current = this._current.then(
            () => task(),
            () => task()
        ));
    }

    whenIdle(): Promise<void> {
        return this._current.then(
            () => {},
            () => {}
        );
    }
}

export class NotebookDocumentHandler {
    private readonly _eventQueue = new Sequencer();
    private readonly _notebookMap = new Map<string, Promise<NotebookData>>();

    constructor(
        private readonly _uriMapper: NotebookUriMapper,
        private readonly _caseDetector: CaseSensitivityDetector,
        private readonly _console: ConsoleInterface,
        private readonly _getWorkspace: (fileUri: Uri) => Promise<Workspace>
    ) {}

    test_whenIdle(): Promise<void> {
        return this._eventQueue.whenIdle();
    }

    async getNotebookDataForCell(cellUri: Uri): Promise<NotebookData | undefined> {
        if (!NotebookUriMapper.isNotebookCell(cellUri)) {
            return undefined;
        }
        const notebookUri = this._uriMapper.getNotebookUriFromCell(cellUri);
        return this._getNotebookData(notebookUri);
    }

    onDidOpenNotebookDocument(params: DidOpenNotebookDocumentParams): void {
        const notebookUri = this._uriMapper.parseNotebookOpen(params);
        const chain = this._chainNotebookData(notebookUri);

        void this._eventQueue
            .queue(async () => {
                let notebookData = await chain.old;

                try {
                    notebookData = createNotebookData(
                        notebookUri,
                        params.cellTextDocuments,
                        this._uriMapper,
                        this._caseDetector,
                        getDefaultPrefixCellContents()
                    );

                    const workspace = await this._getWorkspace(notebookData.prefixCellUri);

                    openNotebookCellChain(params.cellTextDocuments, notebookData, this._uriMapper, workspace);
                    verifyCellChainIsLinear(notebookData, workspace, this._console);
                } finally {
                    chain.new.resolve(notebookData);
                }
            })
            .catch((error: unknown) => {
                this._console.error(
                    `Error handling notebook open for (${params.notebookDocument.uri}): ${
                        error instanceof Error ? error.message : String(error)
                    }`
                );
            });
    }

    onDidChangeNotebookDocument(params: DidChangeNotebookDocumentParams): void {
        const notebookUri = this._uriMapper.parseNotebookChange(params);
        if (this._notebookMap.get(notebookUri.key) === undefined) {
            this._console.error(`Notebook was never opened but we got a change event for it (${notebookUri})`);
            return;
        }

        const chain = this._chainNotebookData(notebookUri);

        void this._eventQueue
            .queue(async () => {
                const notebookData = await chain.old;

                try {
                    const workspace = await this._getWorkspace(notebookData.prefixCellUri);

                    if (params.change.cells?.structure) {
                        updateNotebookStructure(
                            params.change.cells.structure,
                            notebookData,
                            this._uriMapper,
                            workspace,
                            this._console
                        );
                    }

                    params.change.cells?.textContent?.forEach((textContent) => {
                        const mappedUri = this._uriMapper.getMappedCellUri(
                            Uri.parse(textContent.document.uri, this._caseDetector)
                        );
                        const contents = workspace.service.getSourceFile(mappedUri)?.getFileContent() || '';
                        const textDocument = TextDocument.create(
                            textContent.document.uri,
                            'python',
                            textContent.document.version - 1,
                            contents
                        );

                        TextDocument.update(textDocument, textContent.changes, textContent.document.version);

                        workspace.service.updateOpenFileContents(
                            mappedUri,
                            textContent.document.version,
                            textDocument.getText(),
                            IPythonMode.CellDocs
                        );
                    });
                } finally {
                    chain.new.resolve(notebookData);
                }
            })
            .catch((error: unknown) => {
                this._console.error(
                    `Error handling notebook change for (${params.notebookDocument.uri}): ${
                        error instanceof Error ? error.message : String(error)
                    }`
                );
            });
    }

    onDidCloseNotebookDocument(params: DidCloseNotebookDocumentParams): void {
        const notebookUri = this._uriMapper.parseNotebookClose(params);
        const chain = this._chainNotebookData(notebookUri);

        void this._eventQueue
            .queue(async () => {
                const notebookData = await chain.old;

                try {
                    const workspace = await this._getWorkspace(notebookData.prefixCellUri);

                    const cellPaths = [notebookData.prefixCellUri, ...notebookData.mappedCellUris];
                    cellPaths.forEach((cellPath) => {
                        workspace.service.setFileClosed(cellPath);
                    });

                    const existing = this._notebookMap.get(notebookUri.key);
                    if (existing === chain.continuation) {
                        this._notebookMap.delete(notebookUri.key);
                    }
                } finally {
                    chain.new.resolve(notebookData);
                }
            })
            .catch((error: unknown) => {
                this._console.error(
                    `Error handling notebook close for (${params.notebookDocument.uri}): ${
                        error instanceof Error ? error.message : String(error)
                    }`
                );
            });
    }

    private _getNotebookData(notebookUri: Uri): Promise<NotebookData | undefined> {
        const notebookData = this._notebookMap.get(notebookUri.key);
        return notebookData ?? Promise.resolve(undefined);
    }

    private _chainNotebookData(fileUri: Uri): NotebookDataChain {
        const old =
            this._notebookMap.get(fileUri.key) ||
            Promise.resolve<NotebookData>({
                notebookUri: fileUri,
                mappedCellUris: [],
                prefixCellContents: '',
                prefixCellUri: NotebookUriMapper.getNotebookPrefixUri(fileUri),
                pythonPath: undefined,
                pythonEnvironmentName: undefined,
                operations: ['updated'],
            });
        const deferred = createDeferred<NotebookData>();
        const continuation = old.then(() => deferred.promise);
        this._notebookMap.set(fileUri.key, continuation);
        return { old, new: deferred, continuation };
    }
}
