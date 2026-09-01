/*
 * cellChainIndex.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Maintains a lazily-built index that maps each CellDocs cell
 * to the tail of its chain, enabling efficient forward-cell
 * lookups for notebook inter-cell symbol resolution.
 */

import { Uri } from '../common/uri/uri';
import { ModuleNode } from '../parser/parseNodes';
import { IPythonMode } from './sourceFile';
import { SourceFileInfo } from './sourceFileInfo';

/** Read-only provider surface for consumers that only need later-cell lookups. */
export interface CellChainIndexProvider {
    getLaterModuleNodes(fileUri: Uri): Iterable<ModuleNode> | undefined;
}

export class CellChainIndex implements CellChainIndexProvider {
    private _tailMap: Map<string, SourceFileInfo> | undefined;

    constructor(
        private readonly _getSourceFileList: () => readonly SourceFileInfo[],
        private readonly _getSourceFileInfo: (uri: Uri) => SourceFileInfo | undefined
    ) {}

    /** Mark the cached tail map as stale. Call when cell chains are mutated. */
    invalidate(): void {
        this._tailMap = undefined;
    }

    /**
     * Return an iterable of module nodes from cells *later* in the
     * chain than `fileUri`. Returns `undefined` when there are no
     * later cells (or when the file is not a CellDocs cell).
     */
    getLaterModuleNodes(fileUri: Uri): Iterable<ModuleNode> | undefined {
        const sourceFileInfo = this._getSourceFileInfo(fileUri);
        if (!sourceFileInfo || sourceFileInfo.ipythonMode !== IPythonMode.CellDocs) {
            return undefined;
        }

        const tailMap = this._ensureTailMap();
        const chainTail = tailMap.get(fileUri.key);
        if (!chainTail || chainTail === sourceFileInfo) {
            return undefined;
        }

        const laterFiles = this._getLaterCellChainFiles(sourceFileInfo, chainTail);
        if (laterFiles.length === 0) {
            return undefined;
        }

        // The later-files list is captured eagerly above; parse trees are
        // resolved lazily per-yield. Callers consume the iterable synchronously
        // during a single scope-lookup pass.
        return (function* () {
            for (const laterCellFileInfo of laterFiles) {
                const parseTree = laterCellFileInfo.sourceFile.getParserOutput()?.parseTree;
                if (parseTree) {
                    yield parseTree;
                }
            }
        })();
    }

    /**
     * Return `[sourceFileInfo, ...laterFiles]` for the chain that
     * `sourceFileInfo` belongs to. Used by Program's dependent-file
     * checker logic.
     */
    getCellChainFiles(sourceFileInfo: SourceFileInfo): SourceFileInfo[] {
        const tailMap = this._ensureTailMap();
        const chainTail = tailMap.get(sourceFileInfo.uri.key);
        if (!chainTail || chainTail === sourceFileInfo) {
            return [sourceFileInfo];
        }

        return [sourceFileInfo, ...this._getLaterCellChainFiles(sourceFileInfo, chainTail)];
    }

    private _ensureTailMap(): Map<string, SourceFileInfo> {
        if (!this._tailMap) {
            this._tailMap = this._buildTailMap();
        }
        return this._tailMap;
    }

    // The tail map is rebuilt in O(n) over the source file list on first
    // access after invalidation. This is acceptable because cell-chain
    // mutations (open/close/reorder) are infrequent relative to lookups.
    private _buildTailMap(): Map<string, SourceFileInfo> {
        const tailMap = new Map<string, SourceFileInfo>();
        const sourceFileList = this._getSourceFileList();

        // Build a "next-cell-in-chain" reverse map: for each cell that is
        // chained *to* another cell, record `chainedTo -> chainingCell`.
        const nextCellInChainMap = new Map<string, SourceFileInfo>();
        for (const sourceFileInfo of sourceFileList) {
            if (
                sourceFileInfo.ipythonMode !== IPythonMode.CellDocs ||
                sourceFileInfo.chainedSourceFile?.ipythonMode !== IPythonMode.CellDocs
            ) {
                continue;
            }

            nextCellInChainMap.set(sourceFileInfo.chainedSourceFile.uri.key, sourceFileInfo);
        }

        // Walk from each tail (a cell with no next-cell) backwards through
        // the chain, recording the tail for every cell in that chain.
        for (const sourceFileInfo of sourceFileList) {
            if (sourceFileInfo.ipythonMode !== IPythonMode.CellDocs || nextCellInChainMap.has(sourceFileInfo.uri.key)) {
                continue;
            }

            let current: SourceFileInfo | undefined = sourceFileInfo;
            while (current && current.ipythonMode === IPythonMode.CellDocs) {
                tailMap.set(current.uri.key, sourceFileInfo);
                current = current.chainedSourceFile;
            }
        }

        return tailMap;
    }

    /**
     * Walk backward from `chainTail` to `sourceFileInfo`, collecting
     * every cell in between (in forward order, excluding `sourceFileInfo`).
     */
    private _getLaterCellChainFiles(sourceFileInfo: SourceFileInfo, chainTail: SourceFileInfo): SourceFileInfo[] {
        // Walk backward from tail to sourceFileInfo, then reverse for forward order.
        const reversedLaterCellChainFiles: SourceFileInfo[] = [];
        let current: SourceFileInfo | undefined = chainTail;

        while (current && current !== sourceFileInfo) {
            reversedLaterCellChainFiles.push(current);
            current = current.chainedSourceFile;
        }

        if (current !== sourceFileInfo) {
            return [];
        }

        const laterCellChainFiles: SourceFileInfo[] = [];
        for (let i = reversedLaterCellChainFiles.length - 1; i >= 0; i--) {
            laterCellChainFiles.push(reversedLaterCellChainFiles[i]);
        }

        return laterCellChainFiles;
    }
}
