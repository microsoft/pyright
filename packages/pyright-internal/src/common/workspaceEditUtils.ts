/*
 * workspaceEditUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Convert Pyright's FileEditActions to LanguageServer's WorkspaceEdits.
 */

import {
    ChangeAnnotation,
    CreateFile,
    DeleteFile,
    RenameFile,
    TextDocumentEdit,
    TextEdit,
    WorkspaceEdit,
} from 'vscode-languageserver';

import { SourceFileInfo } from '../analyzer/program';
import { AnalyzerService } from '../analyzer/service';
import { FileEditAction, FileEditActions } from '../common/editAction';
import { convertPathToUri, convertUriToPath } from '../common/pathUtils';
import { createMapFromItems } from './collectionUtils';
import { assertNever } from './debug';
import { FileSystem } from './fileSystem';
import { convertTextRangeToRange } from './positionUtils';

export function convertWorkspaceEdits(fs: FileSystem, edits: FileEditAction[]) {
    const workspaceEdit: WorkspaceEdit = {
        changes: {},
    };

    AddToWorkspaceEdit(fs, workspaceEdit, edits);

    return workspaceEdit;
}

export function AddToWorkspaceEdit(fs: FileSystem, workspaceEdit: WorkspaceEdit, edits: FileEditAction[]) {
    edits.forEach((edit) => {
        const uri = convertPathToUri(fs, edit.filePath);
        workspaceEdit.changes![uri] = workspaceEdit.changes![uri] || [];
        workspaceEdit.changes![uri].push({ range: edit.range, newText: edit.replacementText });
    });
}

export function convertWorkspaceDocumentEdits(
    fs: FileSystem,
    editActions: FileEditActions,
    changeAnnotations?: {
        [id: string]: ChangeAnnotation;
    },
    defaultAnnotationId = 'default'
) {
    const workspaceEdit: WorkspaceEdit = {
        documentChanges: [],
        changeAnnotations: changeAnnotations,
    };

    const mapPerFile = createMapFromItems(editActions.edits, (e) => e.filePath);
    for (const [key, value] of mapPerFile) {
        workspaceEdit.documentChanges!.push(
            TextDocumentEdit.create({ uri: convertPathToUri(fs, key), version: null }, [
                ...value.map((v) => ({
                    range: v.range,
                    newText: v.replacementText,
                    annotationId: defaultAnnotationId,
                })),
            ])
        );
    }

    for (const operation of editActions.fileOperations) {
        switch (operation.kind) {
            case 'create':
                workspaceEdit.documentChanges!.push(
                    CreateFile.create(
                        convertPathToUri(fs, operation.filePath),
                        /* options */ undefined,
                        defaultAnnotationId
                    )
                );
                break;
            case 'rename':
                workspaceEdit.documentChanges!.push(
                    RenameFile.create(
                        convertPathToUri(fs, operation.oldFilePath),
                        convertPathToUri(fs, operation.newFilePath),
                        /* options */ undefined,
                        defaultAnnotationId
                    )
                );
                break;
            case 'delete':
                workspaceEdit.documentChanges!.push(
                    DeleteFile.create(
                        convertPathToUri(fs, operation.filePath),
                        /* options */ undefined,
                        defaultAnnotationId
                    )
                );
                break;
            default:
                assertNever(operation);
        }
    }

    return workspaceEdit;
}

export function applyWorkspaceEdits(service: AnalyzerService, edits: WorkspaceEdit, filesChanged: Set<string>) {
    if (edits.changes) {
        for (const kv of Object.entries(edits.changes)) {
            const filePath = convertUriToPath(service.fs, kv[0]);
            const fileInfo = service.backgroundAnalysisProgram.program.getSourceFileInfo(filePath);
            if (!fileInfo || !fileInfo.isTracked) {
                // We don't allow non user file being modified.
                continue;
            }

            applyDocumentChanges(service, fileInfo, kv[1]);
            filesChanged.add(filePath);
        }
    }

    // For now, we don't support annotations.
    if (edits.documentChanges) {
        for (const change of edits.documentChanges) {
            if (TextDocumentEdit.is(change)) {
                const filePath = convertUriToPath(service.fs, change.textDocument.uri);
                const fileInfo = service.backgroundAnalysisProgram.program.getSourceFileInfo(filePath);
                if (!fileInfo || !fileInfo.isTracked) {
                    // We don't allow non user file being modified.
                    continue;
                }

                applyDocumentChanges(service, fileInfo, change.edits);
                filesChanged.add(filePath);
            }

            // For now, we don't support other kinds of text changes.
            // But if we want to add support for those in future, we should add them here.
        }
    }
}

export function applyDocumentChanges(service: AnalyzerService, fileInfo: SourceFileInfo, edits: TextEdit[]) {
    if (!fileInfo.isOpenByClient) {
        const fileContent = fileInfo.sourceFile.getFileContent();
        service.setFileOpened(
            fileInfo.sourceFile.getFilePath(),
            0,
            fileContent ?? '',
            fileInfo.sourceFile.getIPythonMode(),
            fileInfo.sourceFile.getRealFilePath()
        );
    }

    const version = (fileInfo.sourceFile.getClientVersion() ?? 0) + 1;
    service.updateOpenFileContents(
        fileInfo.sourceFile.getFilePath(),
        version,
        edits.map((t) => ({ range: t.range, text: t.newText })),
        fileInfo.sourceFile.getIPythonMode(),
        fileInfo.sourceFile.getRealFilePath()
    );
}

export function generateWorkspaceEdits(base: AnalyzerService, target: AnalyzerService, filesChanged: Set<string>) {
    // For now, we won't do text diff to find out minimal text changes. instead, we will
    // consider whole text of the files are changed. In future, we could consider
    // doing minimal changes using vscode's differ (https://github.com/microsoft/vscode/blob/main/src/vs/base/common/diff/diff.ts)
    // to support annotation.
    const edits: WorkspaceEdit = { changes: {} };

    for (const filePath of filesChanged) {
        const original = base.backgroundAnalysisProgram.program.getBoundSourceFile(filePath);
        const final = target.backgroundAnalysisProgram.program.getBoundSourceFile(filePath);
        if (!original || !final) {
            // Both must exist.
            continue;
        }

        const parseResults = original.getParseResults();
        if (!parseResults) {
            continue;
        }

        edits.changes![convertPathToUri(base.fs, filePath)] = [
            {
                range: convertTextRangeToRange(parseResults.parseTree, parseResults.tokenizerOutput.lines),
                newText: final.getFileContent() ?? '',
            },
        ];
    }

    return edits;
}
