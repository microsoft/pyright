/*
 * workspaceEditUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Convert pyright's FileEditActions to LanguageServer's WorkspaceEdits.
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

import { TextDocument } from 'vscode-languageserver-textdocument';
import { AnalyzerService } from '../analyzer/service';
import { FileEditAction, FileEditActions, TextEditAction } from '../common/editAction';
import { convertPathToUri, convertUriToPath } from '../common/pathUtils';
import { createMapFromItems } from './collectionUtils';
import { isArray } from './core';
import { assertNever } from './debug';
import { ReadOnlyFileSystem } from './fileSystem';
import { convertRangeToTextRange, convertTextRangeToRange } from './positionUtils';
import { TextRange } from './textRange';
import { TextRangeCollection } from './textRangeCollection';
import { ProgramMutator, ProgramView, SourceFileInfo } from './extensibility';

export function convertToTextEdits(editActions: TextEditAction[]): TextEdit[] {
    return editActions.map((editAction) => ({
        range: editAction.range,
        newText: editAction.replacementText,
    }));
}

export function convertToFileTextEdits(filePath: string, editActions: TextEditAction[]): FileEditAction[] {
    return editActions.map((a) => ({ filePath, ...a }));
}

export function convertToWorkspaceEdit(fs: ReadOnlyFileSystem, edits: FileEditAction[]): WorkspaceEdit;
export function convertToWorkspaceEdit(fs: ReadOnlyFileSystem, edits: FileEditActions): WorkspaceEdit;
export function convertToWorkspaceEdit(
    fs: ReadOnlyFileSystem,
    edits: FileEditActions,
    changeAnnotations: {
        [id: string]: ChangeAnnotation;
    },
    defaultAnnotationId: string
): WorkspaceEdit;
export function convertToWorkspaceEdit(
    fs: ReadOnlyFileSystem,
    edits: FileEditActions | FileEditAction[],
    changeAnnotations?: {
        [id: string]: ChangeAnnotation;
    },
    defaultAnnotationId = 'default'
): WorkspaceEdit {
    if (isArray(edits)) {
        return _convertToWorkspaceEditWithChanges(fs, edits);
    }

    return _convertToWorkspaceEditWithDocumentChanges(fs, edits, changeAnnotations, defaultAnnotationId);
}

export function appendToWorkspaceEdit(fs: ReadOnlyFileSystem, edits: FileEditAction[], workspaceEdit: WorkspaceEdit) {
    edits.forEach((edit) => {
        const uri = convertPathToUri(fs, edit.filePath);
        workspaceEdit.changes![uri] = workspaceEdit.changes![uri] || [];
        workspaceEdit.changes![uri].push({ range: edit.range, newText: edit.replacementText });
    });
}

export function applyTextEditsToString(
    edits: TextEditAction[],
    lines: TextRangeCollection<TextRange>,
    originalText: string
) {
    const editsWithOffset = edits
        .map((e) => ({
            range: convertRangeToTextRange(e.range, lines) ?? { start: originalText.length, length: 0 },
            text: e.replacementText,
        }))
        .sort((e1, e2) => {
            const result = e2.range.start - e1.range.start;
            if (result !== 0) {
                return result;
            }

            return TextRange.getEnd(e2.range) - TextRange.getEnd(e1.range);
        });

    // Apply change in reverse order.
    let current = originalText;
    for (const change of editsWithOffset) {
        current = current.substr(0, change.range.start) + change.text + current.substr(TextRange.getEnd(change.range));
    }

    return current;
}

export function applyWorkspaceEdit(
    view: ProgramView,
    mutator: ProgramMutator,
    edits: WorkspaceEdit,
    filesChanged: Set<string>
) {
    if (edits.changes) {
        for (const kv of Object.entries(edits.changes)) {
            const filePath = convertUriToPath(view.fileSystem, kv[0]);
            const fileInfo = view.getSourceFileInfo(filePath);
            if (!fileInfo || !fileInfo.isTracked) {
                // We don't allow non user file being modified.
                continue;
            }

            applyDocumentChanges(mutator, fileInfo, kv[1]);
            filesChanged.add(filePath);
        }
    }

    // For now, we don't support annotations.
    if (edits.documentChanges) {
        for (const change of edits.documentChanges) {
            if (TextDocumentEdit.is(change)) {
                const filePath = convertUriToPath(view.fileSystem, change.textDocument.uri);
                const fileInfo = view.getSourceFileInfo(filePath);
                if (!fileInfo || !fileInfo.isTracked) {
                    // We don't allow non user file being modified.
                    continue;
                }

                applyDocumentChanges(mutator, fileInfo, change.edits);
                filesChanged.add(filePath);
            }

            // For now, we don't support other kinds of text changes.
            // But if we want to add support for those in future, we should add them here.
        }
    }
}

export function applyDocumentChanges(mutator: ProgramMutator, fileInfo: SourceFileInfo, edits: TextEdit[]) {
    if (!fileInfo.isOpenByClient) {
        const fileContent = fileInfo.sourceFile.getFileContent();
        mutator.setFileOpened(
            fileInfo.sourceFile.getFilePath(),
            0,
            fileContent ?? '',
            fileInfo.sourceFile.getIPythonMode(),
            fileInfo.sourceFile.getRealFilePath()
        );
    }

    const version = fileInfo.sourceFile.getClientVersion() ?? 0;
    const filePath = fileInfo.sourceFile.getFilePath();
    const sourceDoc = TextDocument.create(filePath, 'python', version, fileInfo.sourceFile.getOpenFileContents() ?? '');

    mutator.updateOpenFileContents(
        filePath,
        version + 1,
        TextDocument.applyEdits(sourceDoc, edits),
        fileInfo.sourceFile.getIPythonMode(),
        fileInfo.sourceFile.getRealFilePath()
    );
}

export function generateWorkspaceEdit(
    originalService: AnalyzerService,
    clonedService: AnalyzerService,
    filesChanged: Set<string>
) {
    // For now, we won't do text diff to find out minimal text changes. instead, we will
    // consider whole text of the files are changed. In future, we could consider
    // doing minimal changes using vscode's differ (https://github.com/microsoft/vscode/blob/main/src/vs/base/common/diff/diff.ts)
    // to support annotation.
    const edits: WorkspaceEdit = { changes: {} };

    for (const filePath of filesChanged) {
        const original = originalService.backgroundAnalysisProgram.program.getBoundSourceFile(filePath);
        const final = clonedService.backgroundAnalysisProgram.program.getBoundSourceFile(filePath);
        if (!original || !final) {
            // Both must exist.
            continue;
        }

        const parseResults = original.getParseResults();
        if (!parseResults) {
            continue;
        }

        edits.changes![convertPathToUri(originalService.fs, filePath)] = [
            {
                range: convertTextRangeToRange(parseResults.parseTree, parseResults.tokenizerOutput.lines),
                newText: final.getFileContent() ?? '',
            },
        ];
    }

    return edits;
}

function _convertToWorkspaceEditWithChanges(fs: ReadOnlyFileSystem, edits: FileEditAction[]) {
    const workspaceEdit: WorkspaceEdit = {
        changes: {},
    };

    appendToWorkspaceEdit(fs, edits, workspaceEdit);
    return workspaceEdit;
}

function _convertToWorkspaceEditWithDocumentChanges(
    fs: ReadOnlyFileSystem,
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

    // Ordering of documentChanges are important.
    // Make sure create operation happens before edits.
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
            case 'delete':
                break;
            default:
                assertNever(operation);
        }
    }

    // Text edit's file path must refer to original file paths unless it is a new file just created.
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
