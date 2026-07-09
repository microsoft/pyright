/*
 * notebookCellChain.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Mode-agnostic helpers for analyzing notebook documents as chains of cell "files".
 *
 * A notebook is modeled as a linear chain of source files: a synthetic prefix cell followed
 * by one file per code cell, each chained to its predecessor (via Pyright's chained-source-file
 * support and `IPythonMode.CellDocs`). This lets symbols defined in an earlier cell be visible
 * in later cells, matching Jupyter execution semantics.
 *
 * These functions are a near-direct port of Pylance's notebook helpers from
 * `pylance-internal/src/server/common.ts`, retyped onto Pyright's `Workspace`. They only touch
 * `workspace.service` (an `AnalyzerService`) so they work with any workspace implementation.
 */

import {
    DidChangeNotebookDocumentParams,
    NotebookCellArrayChange,
    NotebookDocumentSyncOptions,
    TextDocumentIdentifier,
    TextDocumentItem,
} from 'vscode-languageserver-protocol';

import { IPythonMode } from '../analyzer/sourceFile';
import { CaseSensitivityDetector } from '../common/caseSensitivityDetector';
import { ConsoleInterface } from '../common/console';
import { Uri } from '../common/uri/uri';
import { Workspace } from '../workspaceFactory';

import { INotebookUriMapper, NotebookUriMapper } from './notebookUriMapper';

/**
 * Notebook selector matching file- and untitled-scheme notebooks with Python cells.
 */
export const NotebookDocumentSelector: NotebookDocumentSyncOptions = {
    notebookSelector: [
        {
            notebook: { scheme: 'file' },
            cells: [{ language: 'python' }],
        },
        {
            notebook: { scheme: 'untitled' },
            cells: [{ language: 'python' }],
        },
    ],
};

/**
 * Notebook selector matching notebooks of any scheme with Python cells.
 */
export const AnyNotebookDocumentSelector: NotebookDocumentSyncOptions = {
    notebookSelector: [
        {
            notebook: undefined,
            cells: [{ language: 'python' }],
        },
    ],
};

/**
 * The default contents of the synthetic prefix cell that precedes all notebook cells.
 * Mirrors Jupyter's implicit `from IPython.display import *`.
 */
export function getDefaultPrefixCellContents(): string {
    return `from IPython.display import *\n\n`;
}

export interface NotebookData {
    notebookUri: Uri;
    mappedCellUris: Uri[];
    prefixCellContents: string;
    prefixCellUri: Uri;
    pythonPath: Uri | undefined;
    pythonEnvironmentName: string | undefined; // Basically the kernel name.
    operations: string[];
}

export function createNotebookData(
    notebookUri: Uri,
    cells: TextDocumentItem[],
    uriMapper: INotebookUriMapper,
    caseSensitivityDetector: CaseSensitivityDetector,
    prefixCellContents?: string,
    pythonPath?: Uri,
    pythonEnvironmentName?: string
): NotebookData {
    const notebookData: NotebookData = {
        notebookUri: notebookUri,
        mappedCellUris: cells.map((x) => uriMapper.getMappedCellUri(Uri.parse(x.uri, caseSensitivityDetector))),
        prefixCellUri: NotebookUriMapper.getNotebookPrefixUri(notebookUri),
        prefixCellContents: prefixCellContents || '',
        pythonPath: pythonPath,
        pythonEnvironmentName: pythonEnvironmentName,
        operations: [`Created ${cells.length} cells`],
    };

    return notebookData;
}

export function verifyCellChainIsLinear(notebookData: NotebookData, workspace: Workspace, console?: ConsoleInterface) {
    if (!notebookData.mappedCellUris) {
        console?.error('All notebooks should have mapped cell Uris');
        return;
    }

    // Check for duplicate URIs. When found, log which cells are duplicated and repair by
    // removing the later occurrences (keeping the first).
    const seenKeys = new Map<string, number>(); // key -> first index where seen
    const duplicateIndices: number[] = [];
    for (let i = 0; i < notebookData.mappedCellUris.length; i++) {
        const uri = notebookData.mappedCellUris[i];
        const key = uri?.key ?? `<undefined:${i}>`;
        const firstIndex = seenKeys.get(key);
        if (firstIndex !== undefined) {
            duplicateIndices.push(i);
            console?.error(
                `Notebook cell chain integrity error: cell at index ${i} ` +
                    `(${uri?.toUserVisibleString() ?? 'undefined'}) is a duplicate of cell at index ${firstIndex}. ` +
                    `Removing duplicate. Operations: ${notebookData.operations.join(', ')}`
            );
        } else {
            seenKeys.set(key, i);
        }
    }

    if (duplicateIndices.length > 0) {
        notebookData.mappedCellUris = notebookData.mappedCellUris.filter((_, index) => !duplicateIndices.includes(index));
    }

    // Verify that chained file paths match the expected order. When a mismatch is found,
    // log the broken cell (index, URI, actual chain, expected chain) and repair it.
    for (let i = notebookData.mappedCellUris.length - 1; i >= 0; --i) {
        const cell = notebookData.mappedCellUris[i];
        const actualChainedUri = workspace.service.getChainedUri(cell);
        const expectedChainedUri = i > 0 ? notebookData.mappedCellUris[i - 1] : notebookData.prefixCellUri;

        if (!actualChainedUri?.equals(expectedChainedUri)) {
            console?.error(
                `Notebook cell chain integrity error at cell index ${i} ` +
                    `(${cell?.toUserVisibleString() ?? 'undefined'}): ` +
                    `chained to ${actualChainedUri?.toUserVisibleString() ?? 'undefined'}, ` +
                    `expected ${expectedChainedUri?.toUserVisibleString() ?? 'undefined'}. ` +
                    `Repairing. Operations: ${notebookData.operations.join(', ')}`
            );
            workspace.service.updateChainedUri(cell, expectedChainedUri);
        }
    }
}

export function openNotebookCellChain(
    cells: TextDocumentItem[],
    notebookData: NotebookData,
    uriMapper: INotebookUriMapper,
    workspace: Workspace,
    chainedFileUri?: Uri
) {
    // If this is the first open, (no chained file path), then we need to open the prefix cell.
    if (chainedFileUri === undefined) {
        chainedFileUri = notebookData.prefixCellUri;
        workspace.service.setFileOpened(chainedFileUri, 0, notebookData.prefixCellContents, IPythonMode.CellDocs);
    }

    cells.forEach((cellTextDocument) => {
        const mappedCellUri = uriMapper.getMappedCellUri(
            Uri.parse(cellTextDocument.uri, workspace.service.serviceProvider)
        );
        workspace.service.setFileOpened(
            mappedCellUri,
            cellTextDocument.version,
            cellTextDocument.text,
            IPythonMode.CellDocs,
            chainedFileUri
        );

        chainedFileUri = mappedCellUri;
    });
}

interface NotebookStructureChange {
    array: NotebookCellArrayChange;
    didOpen?: TextDocumentItem[];
    didClose?: TextDocumentIdentifier[];
}

function updateCellPaths(
    structure: NotebookStructureChange,
    notebookData: NotebookData,
    uriMapper: INotebookUriMapper,
    workspace: Workspace
) {
    if (!notebookData.mappedCellUris) {
        return;
    }

    // cell array changes
    if (structure.array.deleteCount > 0) {
        notebookData.mappedCellUris.splice(structure.array.start, structure.array.deleteCount);
        notebookData.operations.push('Deleted');
    }

    if (structure.array.cells) {
        if (structure.array.start < notebookData.mappedCellUris.length) {
            const dummyElements = new Array<Uri>(structure.array.cells.length);
            notebookData.mappedCellUris.splice(structure.array.start, 0, ...dummyElements);
            notebookData.operations.push('Inserted');
        }

        for (let i = 0; i < structure.array.cells.length; ++i) {
            notebookData.mappedCellUris[structure.array.start + i] = uriMapper.getMappedCellUri(
                Uri.parse(structure.array.cells[i].document, workspace.service.serviceProvider)
            );
            notebookData.operations.push(`Added at position ${structure.array.start + i}:${structure.array.cells.length}`);
        }
    }
}

function openAndCloseCells(
    structure: NotebookStructureChange,
    notebookData: NotebookData,
    uriMapper: INotebookUriMapper,
    workspace: Workspace
) {
    if (!notebookData.mappedCellUris) {
        return;
    }

    // deleted cells
    if (structure.didClose && structure.didClose.length > 0) {
        structure.didClose.forEach((closedDocument) => {
            const closedUri = uriMapper.getMappedCellUri(
                Uri.parse(closedDocument.uri, workspace.service.serviceProvider)
            );

            // For regular files, when a file is closed, we do not want to remove it from the source file list in
            // the service since the user can re-open the file, but for the virtual file for the notebook cell, we
            // want to remove the virtual file when a cell is closed. Make sure we mark the virtual file untracked
            // to remove it from the list.
            workspace.service.setFileClosed(closedUri);
        });
    }

    // new cells
    if (structure.didOpen && structure.didOpen.length > 0) {
        const chainedFileUri: Uri | undefined =
            structure.array.start > 0
                ? notebookData.mappedCellUris[structure.array.start - 1]
                : notebookData.prefixCellUri;

        openNotebookCellChain(structure.didOpen, notebookData, uriMapper, workspace, chainedFileUri);
    }
}

function updateCellChain(
    structure: NotebookStructureChange,
    notebookData: NotebookData,
    workspace: Workspace,
    console?: ConsoleInterface
) {
    if (!notebookData.mappedCellUris) {
        return;
    }

    // reordered cells
    if (structure.array.cells && (!structure.didOpen || structure.array.cells.length !== structure.didOpen.length)) {
        for (let i = structure.array.start; i < structure.array.start + structure.array.cells.length; ++i) {
            updateCellChainedFilePath(notebookData, workspace, i);
        }
    }

    // If cells were added or deleted, we need to update the chainedFilePath of the cell
    // immediately after (below) those changes to point to its new predecessor.
    const dirtyTrailingCellIndex = structure.array.start + (structure.array.cells?.length ?? 0);
    if (dirtyTrailingCellIndex >= 0 && dirtyTrailingCellIndex < notebookData.mappedCellUris.length) {
        updateCellChainedFilePath(notebookData, workspace, dirtyTrailingCellIndex);
    }

    verifyCellChainIsLinear(notebookData, workspace, console);
}

function updateCellChainedFilePath(notebookData: NotebookData, workspace: Workspace, cellIndex: number) {
    workspace.service.updateChainedUri(
        notebookData.mappedCellUris[cellIndex],
        cellIndex > 0 ? notebookData.mappedCellUris[cellIndex - 1] : notebookData.prefixCellUri
    );
}

export function updateNotebookStructure(
    structure: NotebookStructureChange,
    notebookData: NotebookData,
    uriMapper: INotebookUriMapper,
    workspace: Workspace,
    console?: ConsoleInterface
) {
    updateCellPaths(structure, notebookData, uriMapper, workspace);
    openAndCloseCells(structure, notebookData, uriMapper, workspace);
    updateCellChain(structure, notebookData, workspace, console);
}

export function isNotebookKernelChange(params: DidChangeNotebookDocumentParams): boolean {
    return !!(
        (params.change?.metadata as any)?.custom?.metadata?.kernelspec ||
        (params.change?.metadata as any)?.metadata?.kernelspec
    );
}
