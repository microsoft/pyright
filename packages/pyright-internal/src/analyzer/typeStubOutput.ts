/*
 * typeStubOutput.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Output adapters for generated type stub files.
 */

import { CreateFile, TextDocumentEdit, WorkspaceEdit } from 'vscode-languageserver-types';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { FileSystem, ReadOnlyFileSystem } from '../common/fileSystem';
import { convertUriToLspUriString } from '../common/uri/uriUtils';
import { GeneratedTypeStubFile } from './typeStubGeneration';

export function writeGeneratedTypeStubFiles(fs: FileSystem, files: readonly GeneratedTypeStubFile[]): void {
    for (const file of files) {
        fs.mkdirSync(file.uri.getDirectory(), { recursive: true });
        fs.writeFileSync(file.uri, file.contents, 'utf8');
    }
}

export function convertGeneratedTypeStubFilesToWorkspaceEdit(
    fs: ReadOnlyFileSystem,
    files: readonly GeneratedTypeStubFile[],
    getOpenDocument?: (uri: GeneratedTypeStubFile['uri']) => OpenDocumentSnapshot | undefined
): WorkspaceEdit {
    const documentChanges: NonNullable<WorkspaceEdit['documentChanges']> = [];

    for (const file of files) {
        const uri = convertUriToLspUriString(fs, file.uri);
        const openDocument = getOpenDocument?.(file.uri);
        const fileExists = fs.existsSync(file.uri);
        const existingContents = fileExists ? fs.readFileSync(file.uri, 'utf8') : undefined;
        if (openDocument && openDocument.contents !== existingContents) {
            throw new Error(
                `Cannot update generated type stub '${file.uri.toUserVisibleString()}' because it has unsaved changes`
            );
        }

        let range = {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        };

        if (existingContents !== undefined) {
            const document = TextDocument.create(uri, 'plaintext', openDocument?.version ?? 0, existingContents);
            range = {
                start: range.start,
                end: document.positionAt(existingContents.length),
            };
        } else {
            documentChanges.push(CreateFile.create(uri, { overwrite: false }));
        }

        documentChanges.push(
            TextDocumentEdit.create(
                {
                    uri,
                    version: openDocument?.version ?? null,
                },
                [{ range, newText: file.contents }]
            )
        );
    }

    return { documentChanges };
}

export interface OpenDocumentSnapshot {
    version: number;
    contents: string;
}
