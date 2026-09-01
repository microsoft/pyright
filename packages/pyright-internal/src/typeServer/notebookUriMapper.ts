/*
 * notebookUriMapper.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Maps notebook cell URIs to file-like URIs so notebook cells can be analyzed as if
 * they were regular Python files.
 *
 * In a virtual workspace, a notebook might have a path like:
 *   vscode-vfs://path/to/notebook.ipynb
 * but its cells arrive with paths like:
 *   vscode-notebook-cell://path/to/notebook.ipynb#cellName
 * meaning the 'virtual' portion of the cell path is lost in the cell URI. This class
 * resolves that by turning cell URIs into cell URIs that carry the virtual information:
 *   vscode-notebook-cell://path/to/notebook.ipynb#cellName
 * becomes
 *   vscode-vfs://path/to/notebook.ipynb#cellName
 */

import {
    DidChangeNotebookDocumentParams,
    DidCloseNotebookDocumentParams,
    DidOpenNotebookDocumentParams,
} from 'vscode-languageserver-protocol';

import { CaseSensitivityDetector } from '../common/caseSensitivityDetector';
import { Uri } from '../common/uri/uri';

export interface INotebookUriMapper {
    parseNotebookOpen(params: DidOpenNotebookDocumentParams): Uri;
    parseNotebookClose(params: DidCloseNotebookDocumentParams): Uri;
    parseNotebookChange(params: DidChangeNotebookDocumentParams): Uri;
    getOriginalCellUri(cellUri: Uri): Uri;
    getMappedCellUri(original: Uri): Uri;
    getNotebookUriFromCell(cellUri: Uri): Uri;
    markUsing(uri: Uri, using: boolean): void;
}

export namespace INotebookUriMapper {
    export function is(obj: any): obj is INotebookUriMapper {
        return obj && typeof obj.parseNotebookOpen === 'function';
    }
}

const notebookPrefixCellFragment = 'pylancePrefixCell';
const NotebookCellScheme = 'vscode-notebook-cell';
const InteractiveWindowInputBoxScheme = 'vscode-interactive-input';
const VSCodeChatCodeBlockScheme = 'vscode-chat-code-block';
const VSCodeCopilotChatCodeBlockScheme = 'vscode-copilot-chat-code-block';

export class NotebookUriMapper implements INotebookUriMapper {
    private _originalToMapped = new Map<string, Uri>();
    private _mappedToOriginal = new Map<string, Uri>();
    private _pendingDeletes = new Set<string>();
    private _inUseUris = new Set<string>();

    constructor(private readonly _caseDetector: CaseSensitivityDetector) {
        // Empty
    }

    parseNotebookOpen(params: DidOpenNotebookDocumentParams) {
        // Clear out any pending deletes that are no longer in use. This might
        // include the cells we're about to open.
        this._clearPendingDeletes();

        // First get the uri to the notebook. This is used as the base for the cells.
        const notebookUri = Uri.parse(params.notebookDocument.uri, this._caseDetector);

        // If there are any cell uris in the params, stick them in the map.
        params.cellTextDocuments.forEach((c) => {
            const cellOriginal = Uri.parse(c.uri, this._caseDetector);
            const cellMapped = this._generateCellMappedUri(notebookUri, cellOriginal);
            this._save(cellOriginal, cellMapped);
        });

        return notebookUri;
    }

    parseNotebookChange(params: DidChangeNotebookDocumentParams) {
        // Any cell closures should be added to the pending deletes.
        params.change.cells?.structure?.didClose?.forEach((c) => {
            const cellOriginal = Uri.parse(c.uri, this._caseDetector);
            this._pendDelete(cellOriginal);
        });

        // Any new cell adds should be added to the cell URI map.
        const notebookUri = Uri.parse(params.notebookDocument.uri, this._caseDetector);
        params.change.cells?.structure?.didOpen?.forEach((c) => {
            const cellOriginal = Uri.parse(c.uri, this._caseDetector);
            const cellMapped = this._generateCellMappedUri(notebookUri, cellOriginal);
            this._save(cellOriginal, cellMapped);
        });

        return notebookUri;
    }

    parseNotebookClose(params: DidCloseNotebookDocumentParams) {
        // Add all of the current cells to the list of pending deletes.
        params.cellTextDocuments.forEach((c) => {
            const cellUri = Uri.parse(c.uri, this._caseDetector);
            this._pendDelete(cellUri);
        });

        return Uri.parse(params.notebookDocument.uri, this._caseDetector);
    }

    markUsing(uri: Uri, using: boolean) {
        if (NotebookUriMapper.isNotebookCell(uri)) {
            // Remove or add to the in use set.
            if (using) {
                this._inUseUris.add(uri.key);
            } else {
                this._inUseUris.delete(uri.key);
            }
        }
    }

    getOriginalCellUri(cellUri: Uri) {
        // Should be in the map. Cell paths are added to
        // the map when opening/changing a notebook.
        return this._mappedToOriginal.get(cellUri.key) || cellUri;
    }

    getMappedCellUri(cellUri: Uri) {
        // Should be in the map. Cell paths are added to the map
        // when opening/changing a notebook.
        return this._originalToMapped.get(cellUri.key) || cellUri;
    }

    getNotebookUriFromCell(cellUri: Uri): Uri {
        // If this is the original cell, we need the mapped cell.
        const mappedCell = this.getMappedCellUri(cellUri);

        // The mapped cell contains the URI from the notebook in it. Just
        // need to remove the cell fragment and the last extension
        return mappedCell.replaceExtension('').withQuery(mappedCell.query);
    }

    static isNotebookPrefixCell(uri: Uri) {
        return uri.fragment === notebookPrefixCellFragment;
    }

    static isNotebookFile(uri: Uri) {
        if (uri.scheme === VSCodeChatCodeBlockScheme || uri.scheme === VSCodeCopilotChatCodeBlockScheme) {
            return false;
        }

        return uri.hasExtension('.ipynb') && uri.fragment.length <= 0;
    }

    static isNotebookCell(uri: Uri) {
        if (uri.scheme === InteractiveWindowInputBoxScheme) {
            return true;
        }

        // A URI with a fragment is a notebook cell if it contains the .ipynb extension (regular notebook
        // mapped cell), uses the vscode-notebook-cell scheme (original cell URI), or contains the
        // .interactive extension (interactive window mapped cell, e.g. untitled:/Foo.interactive.py#cellN).
        return uri.fragment
            ? uri.containsExtension('.ipynb') ||
                  uri.scheme === NotebookCellScheme ||
                  uri.containsExtension('.interactive')
            : false;
    }

    static getNotebookPrefixUri(notebookUri: Uri) {
        return notebookUri.addExtension('.py').withFragment(notebookPrefixCellFragment);
    }

    private _generateCellMappedUri(notebookUri: Uri, cellUri: Uri) {
        // Should just be the notebook URI with the cell fragment with a '.py' extension.
        return notebookUri.addExtension('.py').withFragment(cellUri.fragment);
    }

    private _clearPendingDeletes() {
        const pending = [...this._pendingDeletes];
        pending.forEach((key) => {
            if (!this._inUseUris.has(key)) {
                this._delete(key);
            }
        });
    }

    private _pendDelete(original: Uri) {
        this._pendingDeletes.add(original.key);
    }

    private _save(original: Uri, mapped: Uri) {
        this._originalToMapped.set(original.key, mapped);
        this._mappedToOriginal.set(mapped.key, original);
        this._pendingDeletes.delete(original.key);
    }

    private _delete(originalKey: string) {
        const mapped = this._originalToMapped.get(originalKey);
        if (mapped) {
            this._originalToMapped.delete(originalKey);
            this._mappedToOriginal.delete(mapped.key);
            this._pendingDeletes.delete(originalKey);
        }
    }
}
