/*
 * sourceFileInfoUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Functions that operate on SourceFileInfo objects.
 */

import { fail } from '../common/debug';
import { ProgramView, SourceFileInfo } from '../common/extensibility';
import { ServiceKeys } from '../common/serviceKeys';
import { IPythonMode } from './sourceFile';

export function isUserCode(fileInfo: SourceFileInfo | undefined) {
    return !!fileInfo && fileInfo.isTracked && !fileInfo.isThirdPartyImport && !fileInfo.isTypeshedFile;
}

export function collectImportedByCells<T extends SourceFileInfo>(program: ProgramView, fileInfo: T): Set<T> {
    // The ImportedBy only works when files are parsed. Due to the lazy-loading nature of our system,
    // we can't ensure that all files within the program are parsed, which might lead to an incomplete dependency graph.
    // Parsing all regular files goes against our lazy-nature, but for notebook cells, which we open by default,
    // it makes sense to force complete parsing since they'll be parsed at some point anyway due to things like
    // `semantic tokens` or `checkers`.
    _parseAllOpenCells(program);

    const importedByCells = new Set<T>();
    collectImportedByRecursively(fileInfo, importedByCells);
    return importedByCells;
}

export function collectImportedByRecursively(fileInfo: SourceFileInfo, importedBy: Set<SourceFileInfo>) {
    fileInfo.importedBy.forEach((dep) => {
        if (importedBy.has(dep)) {
            // Already visited.
            return;
        }

        importedBy.add(dep);
        collectImportedByRecursively(dep, importedBy);
    });
}

export function verifyNoCyclesInChainedFiles<T extends SourceFileInfo>(program: ProgramView, fileInfo: T): void {
    let nextChainedFile = fileInfo.chainedSourceFile;
    if (!nextChainedFile) {
        return;
    }

    const set = new Set<string>([fileInfo.uri.key]);
    while (nextChainedFile) {
        const path = nextChainedFile.uri.key;
        if (set.has(path)) {
            // We found a cycle.
            fail(
                program.serviceProvider
                    .tryGet(ServiceKeys.debugInfoInspector)
                    ?.getCycleDetail(program, nextChainedFile) ?? `Found a cycle in implicit imports files for ${path}`
            );
        }

        set.add(path);
        nextChainedFile = nextChainedFile.chainedSourceFile;
    }
}

export function createChainedByList<T extends SourceFileInfo>(program: ProgramView, fileInfo: T): T[] {
    // We want to create reverse map of all chained files.
    const map = new Map<SourceFileInfo, SourceFileInfo>();
    for (const file of program.getSourceFileInfoList()) {
        if (!file.chainedSourceFile) {
            continue;
        }

        map.set(file.chainedSourceFile, file);
    }

    const visited = new Set<SourceFileInfo>();

    const chainedByList: SourceFileInfo[] = [fileInfo];
    let current: SourceFileInfo | undefined = fileInfo;
    while (current) {
        if (visited.has(current)) {
            fail(
                program.serviceProvider.tryGet(ServiceKeys.debugInfoInspector)?.getCycleDetail(program, current) ??
                    'detected a cycle in chained files'
            );
        }
        visited.add(current);

        current = map.get(current);
        if (current) {
            chainedByList.push(current);
        }
    }

    return chainedByList as T[];
}

function _parseAllOpenCells(program: ProgramView): void {
    for (const file of program.getSourceFileInfoList()) {
        if (file.ipythonMode !== IPythonMode.CellDocs) {
            continue;
        }

        program.getParserOutput(file.uri);
        program.handleMemoryHighUsage();
    }
}
