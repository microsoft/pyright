/*
 * typeStubOutput.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Tests for generated type stub output adapters.
 */

import assert from 'assert';
import { CreateFile, TextDocumentEdit } from 'vscode-languageserver-types';

import { GeneratedTypeStubFile } from '../analyzer/typeStubGeneration';
import { convertGeneratedTypeStubFilesToWorkspaceEdit, writeGeneratedTypeStubFiles } from '../analyzer/typeStubOutput';
import { Uri } from '../common/uri/uri';
import { TestFileSystem } from './harness/vfs/filesystem';

test('writes generated type stub files and replaces existing contents', () => {
    const fs = new TestFileSystem(/* ignoreCase */ false, { cwd: '/' });
    const existingUri = Uri.file('/typings/sample-stubs/py.typed', fs);
    const stubUri = Uri.file('/typings/sample-stubs/sample/core.pyi', fs);
    fs.mkdirSync(existingUri.getDirectory(), { recursive: true });
    fs.writeFileSync(existingUri, 'old marker', 'utf8');
    const files: GeneratedTypeStubFile[] = [
        { uri: stubUri, contents: 'def answer() -> int: ...\n', kind: 'stub' },
        { uri: existingUri, contents: 'partial\n', kind: 'partialMarker' },
    ];

    writeGeneratedTypeStubFiles(fs, files);

    assert.strictEqual(fs.readFileSync(stubUri, 'utf8'), 'def answer() -> int: ...\n');
    assert.strictEqual(fs.readFileSync(existingUri, 'utf8'), 'partial\n');
});

test('converts generated type stub files to ordered create and replacement edits', () => {
    const fs = new TestFileSystem(/* ignoreCase */ false, { cwd: '/' });
    const existingUri = Uri.file('/typings/sample-stubs/py.typed', fs);
    const stubUri = Uri.file('/typings/sample-stubs/sample/core.pyi', fs);
    fs.mkdirSync(existingUri.getDirectory(), { recursive: true });
    fs.writeFileSync(existingUri, 'old marker\ncontent\n', 'utf8');
    const files: GeneratedTypeStubFile[] = [
        { uri: stubUri, contents: 'def answer() -> int: ...\n', kind: 'stub' },
        { uri: existingUri, contents: 'partial\n', kind: 'partialMarker' },
    ];

    const edit = convertGeneratedTypeStubFilesToWorkspaceEdit(fs, files);

    assert.ok(edit.documentChanges);
    assert.strictEqual(edit.documentChanges.length, 3);
    assert.ok(CreateFile.is(edit.documentChanges[0]));
    assert.deepStrictEqual(edit.documentChanges[0], {
        kind: 'create',
        uri: stubUri.toString(),
        options: { overwrite: false },
    });
    assert.ok(TextDocumentEdit.is(edit.documentChanges[1]));
    assert.deepStrictEqual(edit.documentChanges[1], {
        textDocument: { uri: stubUri.toString(), version: null },
        edits: [
            {
                range: {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 0 },
                },
                newText: 'def answer() -> int: ...\n',
            },
        ],
    });
    assert.ok(TextDocumentEdit.is(edit.documentChanges[2]));
    assert.deepStrictEqual(edit.documentChanges[2], {
        textDocument: { uri: existingUri.toString(), version: null },
        edits: [
            {
                range: {
                    start: { line: 0, character: 0 },
                    end: { line: 2, character: 0 },
                },
                newText: 'partial\n',
            },
        ],
    });
    assert.strictEqual(fs.existsSync(stubUri), false);
    assert.strictEqual(fs.readFileSync(existingUri, 'utf8'), 'old marker\ncontent\n');
});

test('direct output surfaces a later write failure after preserving completed writes', () => {
    const fs = new TestFileSystem(/* ignoreCase */ false, { cwd: '/' });
    const firstUri = Uri.file('/typings/pkg/a.pyi', fs);
    const secondUri = Uri.file('/typings/pkg/b.pyi', fs);
    const writeFileSync = fs.writeFileSync.bind(fs);
    jest.spyOn(fs, 'writeFileSync').mockImplementation((uri, data, encoding) => {
        if (uri.equals(secondUri)) {
            throw new Error('second write failed');
        }
        writeFileSync(uri, data, encoding);
    });

    assert.throws(
        () =>
            writeGeneratedTypeStubFiles(fs, [
                { uri: firstUri, contents: 'value: int\n', kind: 'stub' },
                { uri: secondUri, contents: 'name: str\n', kind: 'stub' },
            ]),
        /second write failed/
    );
    assert.strictEqual(fs.readFileSync(firstUri, 'utf8'), 'value: int\n');
    assert.strictEqual(fs.existsSync(secondUri), false);
});

test('uses the client version when replacing an open generated stub', () => {
    const fs = new TestFileSystem(/* ignoreCase */ false, { cwd: '/' });
    const stubUri = Uri.file('/typings/sample.pyi', fs);
    const existingContents = 'value: int\n';
    fs.mkdirSync(stubUri.getDirectory(), { recursive: true });
    fs.writeFileSync(stubUri, existingContents, 'utf8');

    const edit = convertGeneratedTypeStubFilesToWorkspaceEdit(
        fs,
        [{ uri: stubUri, contents: 'value: str\n', kind: 'stub' }],
        (uri) => (uri.equals(stubUri) ? { version: 7, contents: existingContents } : undefined)
    );

    assert.deepStrictEqual(edit.documentChanges, [
        {
            textDocument: { uri: stubUri.toString(), version: 7 },
            edits: [
                {
                    range: {
                        start: { line: 0, character: 0 },
                        end: { line: 1, character: 0 },
                    },
                    newText: 'value: str\n',
                },
            ],
        },
    ]);
});

test('refuses to replace an open generated stub with unsaved changes', () => {
    const fs = new TestFileSystem(/* ignoreCase */ false, { cwd: '/' });
    const stubUri = Uri.file('/typings/sample.pyi', fs);
    fs.mkdirSync(stubUri.getDirectory(), { recursive: true });
    fs.writeFileSync(stubUri, 'value: int\n', 'utf8');

    assert.throws(
        () =>
            convertGeneratedTypeStubFilesToWorkspaceEdit(
                fs,
                [{ uri: stubUri, contents: 'value: str\n', kind: 'stub' }],
                (uri) => (uri.equals(stubUri) ? { version: 8, contents: 'value: float\n' } : undefined)
            ),
        {
            message: `Cannot update generated type stub '${stubUri.toUserVisibleString()}' because it has unsaved changes`,
        }
    );
});

test('refuses to create a generated stub over an open unsaved document', () => {
    const fs = new TestFileSystem(/* ignoreCase */ false, { cwd: '/' });
    const stubUri = Uri.file('/typings/sample.pyi', fs);

    assert.throws(
        () =>
            convertGeneratedTypeStubFilesToWorkspaceEdit(
                fs,
                [{ uri: stubUri, contents: 'value: str\n', kind: 'stub' }],
                (uri) => (uri.equals(stubUri) ? { version: 1, contents: 'value: float\n' } : undefined)
            ),
        {
            message: `Cannot update generated type stub '${stubUri.toUserVisibleString()}' because it has unsaved changes`,
        }
    );
});
