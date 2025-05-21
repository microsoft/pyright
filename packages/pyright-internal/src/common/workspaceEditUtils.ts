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
import { createMapFromItems } from './collectionUtils';
import { isArray } from './core';
import { assertNever } from './debug';
import { EditableProgram, SourceFileInfo } from './extensibility';
import { ReadOnlyFileSystem } from './fileSystem';
import { convertRangeToTextRange, convertTextRangeToRange } from './positionUtils';
import { TextRange } from './textRange';
import { TextRangeCollection } from './textRangeCollection';
import { Uri } from './uri/uri';
import { convertUriToLspUriString } from './uri/uriUtils';

export function convertToTextEdits(editActions: TextEditAction[]): TextEdit[] {
    return editActions.map((editAction) => ({
        range: editAction.range,
        newText: editAction.replacementText,
    }));
}

export function convertToFileTextEdits(fileUri: Uri, editActions: TextEditAction[]): FileEditAction[] {
    return editActions.map((a) => ({ fileUri, ...a }));
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
        const uri = convertUriToLspUriString(fs, edit.fileUri);
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

export function applyWorkspaceEdit(program: EditableProgram, edits: WorkspaceEdit, filesChanged: Map<string, Uri>) {
    if (edits.changes) {
        for (const kv of Object.entries(edits.changes)) {
            const fileUri = Uri.parse(kv[0], program.serviceProvider);
            const fileInfo = program.getSourceFileInfo(fileUri);
            if (!fileInfo || !fileInfo.isTracked) {
                // We don't allow non user file being modified.
                continue;
            }

            applyDocumentChanges(program, fileInfo, kv[1]);
            filesChanged.set(fileUri.key, fileUri);
        }
    }

    // For now, we don't support annotations.
    if (edits.documentChanges) {
        for (const change of edits.documentChanges) {
            if (TextDocumentEdit.is(change)) {
                const fileUri = Uri.parse(change.textDocument.uri, program.serviceProvider);
                const fileInfo = program.getSourceFileInfo(fileUri);
                if (!fileInfo || !fileInfo.isTracked) {
                    // We don't allow non user file being modified.
                    continue;
                }

                applyDocumentChanges(program, fileInfo, change.edits.filter((e) => TextEdit.is(e)) as TextEdit[]);
                filesChanged.set(fileUri.key, fileUri);
            }

            // For now, we don't support other kinds of text changes.
            // But if we want to add support for those in future, we should add them here.
        }
    }
}

export function applyDocumentChanges(program: EditableProgram, fileInfo: SourceFileInfo, edits: TextEdit[]) {
    if (!fileInfo.isOpenByClient) {
        const fileContent = fileInfo.contents;
        program.setFileOpened(fileInfo.uri, 0, fileContent ?? '', {
            isTracked: fileInfo.isTracked,
            ipythonMode: fileInfo.ipythonMode,
            chainedFileUri: fileInfo.chainedSourceFile?.uri,
        });
    }

    const version = fileInfo.clientVersion ?? 0;
    const fileUri = fileInfo.uri;
    const filePath = fileUri.getFilePath();
    const sourceDoc = TextDocument.create(filePath, 'python', version, fileInfo.contents ?? '');

    program.setFileOpened(fileUri, version + 1, TextDocument.applyEdits(sourceDoc, edits), {
        isTracked: fileInfo.isTracked,
        ipythonMode: fileInfo.ipythonMode,
        chainedFileUri: fileInfo.chainedSourceFile?.uri,
    });
}

export function generateWorkspaceEdit(
    fs: ReadOnlyFileSystem,
    originalService: AnalyzerService,
    clonedService: AnalyzerService,
    filesChanged: Map<string, Uri>
) {
    // For now, we won't do text diff to find out minimal text changes. instead, we will
    // consider whole text of the files are changed. In future, we could consider
    // doing minimal changes using vscode's differ (https://github.com/microsoft/vscode/blob/main/src/vs/base/common/diff/diff.ts)
    // to support annotation.
    const edits: WorkspaceEdit = { changes: {} };

    for (const uri of filesChanged.values()) {
        const original = originalService.backgroundAnalysisProgram.program.getBoundSourceFile(uri);
        const final = clonedService.backgroundAnalysisProgram.program.getBoundSourceFile(uri);
        if (!original || !final) {
            // Both must exist.
            continue;
        }

        const parseResults = original.getParseResults();
        if (!parseResults) {
            continue;
        }

        edits.changes![convertUriToLspUriString(fs, uri)] = [
            {
                range: convertTextRangeToRange(parseResults.parserOutput.parseTree, parseResults.tokenizerOutput.lines),
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
                        convertUriToLspUriString(fs, operation.fileUri),
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
    const mapPerFile = createMapFromItems(editActions.edits, (e) => convertUriToLspUriString(fs, e.fileUri));
    for (const [uri, value] of mapPerFile) {
        workspaceEdit.documentChanges!.push(
            TextDocumentEdit.create(
                { uri: uri, version: null },
                Array.from(
                    value.map((v) => ({
                        range: v.range,
                        newText: v.replacementText,
                        annotationId: defaultAnnotationId,
                    }))
                )
            )
        );
    }

    for (const operation of editActions.fileOperations) {
        switch (operation.kind) {
            case 'create':
                break;
            case 'rename':
                workspaceEdit.documentChanges!.push(
                    RenameFile.create(
                        convertUriToLspUriString(fs, operation.oldFileUri),
                        convertUriToLspUriString(fs, operation.newFileUri),
                        /* options */ undefined,
                        defaultAnnotationId
                    )
                );
                break;
            case 'delete':
                workspaceEdit.documentChanges!.push(
                    DeleteFile.create(
                        convertUriToLspUriString(fs, operation.fileUri),
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
