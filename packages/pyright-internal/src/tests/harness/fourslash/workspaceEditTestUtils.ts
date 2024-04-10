/*
 * workspaceEditTestUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Test Utils around workspace edits.
 */

import assert from 'assert';
import {
    AnnotatedTextEdit,
    ChangeAnnotation,
    CreateFile,
    DeleteFile,
    OptionalVersionedTextDocumentIdentifier,
    RenameFile,
    TextDocumentEdit,
    TextEdit,
    WorkspaceEdit,
} from 'vscode-languageserver';

import * as debug from '../../../common/debug';
import { rangesAreEqual } from '../../../common/textRange';

export function verifyWorkspaceEdit(expected: WorkspaceEdit, actual: WorkspaceEdit, marker?: string) {
    if (actual.changes) {
        verifyTextEditMap(expected.changes!, actual.changes, marker);
    } else {
        assert(!expected.changes);
    }

    if (actual.documentChanges) {
        verifyDocumentEdits(expected.documentChanges!, actual.documentChanges);
    } else {
        assert(!expected.documentChanges);
    }

    if (actual.changeAnnotations) {
        verifyChangeAnnotations(expected.changeAnnotations!, actual.changeAnnotations);
    } else {
        assert(!expected.changeAnnotations);
    }
}

export function verifyChangeAnnotations(
    expected: { [id: string]: ChangeAnnotation },
    actual: { [id: string]: ChangeAnnotation }
) {
    assert.strictEqual(Object.entries(expected).length, Object.entries(actual).length);

    for (const key of Object.keys(expected)) {
        const expectedAnnotation = expected[key];
        const actualAnnotation = actual[key];

        // We need to improve it to test localized strings.
        assert.strictEqual(expectedAnnotation.label, actualAnnotation.label);
        assert.strictEqual(expectedAnnotation.description, actualAnnotation.description);

        assert.strictEqual(expectedAnnotation.needsConfirmation, actualAnnotation.needsConfirmation);
    }
}

export function textDocumentAreSame(
    expected: OptionalVersionedTextDocumentIdentifier,
    actual: OptionalVersionedTextDocumentIdentifier
) {
    return expected.version === actual.version && expected.uri === actual.uri;
}

export function verifyDocumentEdits(
    expected: (TextDocumentEdit | CreateFile | RenameFile | DeleteFile)[],
    actual: (TextDocumentEdit | CreateFile | RenameFile | DeleteFile)[]
) {
    assert.strictEqual(expected.length, actual.length);

    for (const op of expected) {
        assert(
            actual.some((a) => {
                const expectedKind = TextDocumentEdit.is(op) ? 'edit' : op.kind;
                const actualKind = TextDocumentEdit.is(a) ? 'edit' : a.kind;
                if (expectedKind !== actualKind) {
                    return false;
                }

                switch (expectedKind) {
                    case 'edit': {
                        const expectedEdit = op as TextDocumentEdit;
                        const actualEdit = a as TextDocumentEdit;

                        if (!textDocumentAreSame(expectedEdit.textDocument, actualEdit.textDocument)) {
                            return false;
                        }

                        if (!actualEdit.textDocument.uri.includes(':')) {
                            // Not returning a URI, so fail.
                            return false;
                        }

                        return textEditsAreSame(
                            expectedEdit.edits.filter((e) => TextEdit.is(e)) as TextEdit[],
                            actualEdit.edits.filter((e) => TextEdit.is(e)) as TextEdit[]
                        );
                    }
                    case 'create': {
                        const expectedOp = op as CreateFile;
                        const actualOp = a as CreateFile;
                        return (
                            expectedOp.kind === actualOp.kind &&
                            expectedOp.annotationId === actualOp.annotationId &&
                            expectedOp.uri === actualOp.uri &&
                            expectedOp.options?.ignoreIfExists === actualOp.options?.ignoreIfExists &&
                            expectedOp.options?.overwrite === actualOp.options?.overwrite
                        );
                    }
                    case 'rename': {
                        const expectedOp = op as RenameFile;
                        const actualOp = a as RenameFile;
                        return (
                            expectedOp.kind === actualOp.kind &&
                            expectedOp.annotationId === actualOp.annotationId &&
                            expectedOp.oldUri === actualOp.oldUri &&
                            expectedOp.newUri === actualOp.newUri &&
                            expectedOp.options?.ignoreIfExists === actualOp.options?.ignoreIfExists &&
                            expectedOp.options?.overwrite === actualOp.options?.overwrite
                        );
                    }
                    case 'delete': {
                        const expectedOp = op as DeleteFile;
                        const actualOp = a as DeleteFile;
                        return (
                            expectedOp.annotationId === actualOp.annotationId &&
                            expectedOp.kind === actualOp.kind &&
                            expectedOp.uri === actualOp.uri &&
                            expectedOp.options?.ignoreIfNotExists === actualOp.options?.ignoreIfNotExists &&
                            expectedOp.options?.recursive === actualOp.options?.recursive
                        );
                    }
                    default:
                        debug.assertNever(expectedKind);
                }
            })
        );
    }
}

export function verifyTextEditMap(
    expected: { [uri: string]: TextEdit[] },
    actual: { [uri: string]: TextEdit[] },
    marker?: string
) {
    assert.strictEqual(
        Object.entries(expected).length,
        Object.entries(actual).length,
        marker === undefined ? '' : `${marker} has failed`
    );

    for (const key of Object.keys(expected)) {
        assert(textEditsAreSame(expected[key], actual[key]), marker === undefined ? '' : `${marker} has failed`);
    }
}

export function textEditsAreSame(
    expectedEdits: (TextEdit | AnnotatedTextEdit)[],
    actualEdits: (TextEdit | AnnotatedTextEdit)[]
) {
    if (expectedEdits.length !== actualEdits.length) {
        return false;
    }

    for (const edit of expectedEdits) {
        if (!actualEdits.some((a) => textEditAreSame(edit, a))) {
            return false;
        }
    }

    return true;
}

export function textEditAreSame(expected: TextEdit, actual: TextEdit) {
    if (!rangesAreEqual(expected.range, actual.range)) {
        return false;
    }

    if (expected.newText !== actual.newText) {
        return false;
    }

    const expectedAnnotation = AnnotatedTextEdit.is(expected) ? expected.annotationId : '';
    const actualAnnotation = AnnotatedTextEdit.is(actual) ? actual.annotationId : '';
    return expectedAnnotation === actualAnnotation;
}
