/*
 * typeServer.virtualFileRedirect.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Tests for the TspSupplemental virtual file redirect notifications in the TypeServer.
 * Verifies that the type server correctly handles setVirtualFileRedirect /
 * removeVirtualFileRedirect notifications, re-reads content, and triggers reanalysis,
 * including observable type changes.
 */
import assert from 'assert';

import { TspSupplemental } from '../../typeServer/protocol/tspSupplemental';
import { TypeServerProtocol } from '../../typeServer/protocol/typeServerProtocol';
import { initializeDependenciesForInProcTests, withInProcTypeServer } from './inProcTypeServerTestUtils';

jest.setTimeout(120000);

/** Extract the class name from a protocol Type, if it's a ClassType with a regular declaration. */
function getClassTypeName(type: TypeServerProtocol.Type | undefined): string | undefined {
    if (!type || type.kind !== TypeServerProtocol.TypeKind.Class) {
        return undefined;
    }
    const classType = type as TypeServerProtocol.ClassType;
    if (classType.declaration.kind === TypeServerProtocol.DeclarationKind.Regular) {
        return classType.declaration.name;
    }
    return undefined;
}

describe('TypeServer virtual file redirect (TspSupplemental)', () => {
    beforeAll(async () => {
        await initializeDependenciesForInProcTests();
    });

    test('setVirtualFileRedirect triggers reanalysis and changes inferred types', async () => {
        const code = `
// @filename: mymod.py
//// x: int = 1
//// # /*mod_marker*/

// @filename: virtual_mymod.py
//// x: str = "hello"

// @filename: test.py
//// from mymod import x
//// [|/*y*/y|] = x
//// # /*test_marker*/
`;

        await withInProcTypeServer(code, async (context) => {
            // Open the module file and test file in the type server.
            await context.openFileForMarker('test_marker');
            await context.openFileForMarker('mod_marker');

            // Get the node for y so we can query its computed type.
            const yNode: TypeServerProtocol.Node = context.getNodeForMarker('y');

            // Get the initial snapshot (ensures analysis has completed).
            const initialSnapshot = await context.refreshSnapshot();

            // Verify y's type is int before the redirect.
            const typeBefore = await context.sendRequestWithSnapshot(TypeServerProtocol.GetComputedTypeRequest.type, {
                arg: yNode,
            });
            assert(typeBefore, 'y should have a computed type before redirect');
            assert.strictEqual(getClassTypeName(typeBefore), 'int', 'y should be int before redirect');

            // Listen for snapshot change — this proves the type server re-analyzed.
            const snapshotChanged = new Promise<{ old: number; new: number }>((resolve) => {
                context.onNotification(TypeServerProtocol.SnapshotChangedNotification.type, (params) => {
                    resolve(params);
                });
            });

            // Get the file URIs from fourslash data.
            const mymodFile = context.fourslash.files.find((f) => f.fileUri.toString().endsWith('/mymod.py'));
            assert(mymodFile, 'mymod.py should exist in fourslash files');

            const virtualFile = context.fourslash.files.find((f) => f.fileUri.toString().endsWith('/virtual_mymod.py'));
            assert(virtualFile, 'virtual_mymod.py should exist in fourslash files');

            // Send the virtual file redirect notification to the type server.
            context.sendNotification(TspSupplemental.SetVirtualFileRedirectNotification.type, {
                realUri: mymodFile.fileUri.toString(),
                virtualUri: virtualFile.fileUri.toString(),
            });

            // Wait for the snapshot change (indicates type server processed the notification
            // and re-analyzed).
            const params = await snapshotChanged;

            assert(params.new > params.old, 'Snapshot should have incremented after redirect');
            assert(params.old >= initialSnapshot, 'Old snapshot should be >= initial');

            // Verify y's type changed to str after the redirect (mymod.py now serves virtual content).
            const typeAfter = await context.sendRequestWithSnapshot(TypeServerProtocol.GetComputedTypeRequest.type, {
                arg: yNode,
            });
            assert(typeAfter, 'y should have a computed type after redirect');
            assert.strictEqual(getClassTypeName(typeAfter), 'str', 'y should be str after redirect');
        });
    });

    test('removeVirtualFileRedirect triggers reanalysis and restores original types', async () => {
        const code = `
// @filename: mymod.py
//// x: int = 1
//// # /*mod_marker*/

// @filename: virtual_mymod.py
//// x: str = "hello"

// @filename: test.py
//// from mymod import x
//// [|/*y*/y|] = x
//// # /*test_marker*/
`;

        await withInProcTypeServer(code, async (context) => {
            // Open the module file and test file.
            await context.openFileForMarker('test_marker');
            await context.openFileForMarker('mod_marker');

            // Get the node for y so we can query its computed type.
            const yNode: TypeServerProtocol.Node = context.getNodeForMarker('y');

            const mymodFile = context.fourslash.files.find((f) => f.fileUri.toString().endsWith('/mymod.py'));
            assert(mymodFile, 'mymod.py should exist in fourslash files');

            const virtualFile = context.fourslash.files.find((f) => f.fileUri.toString().endsWith('/virtual_mymod.py'));
            assert(virtualFile, 'virtual_mymod.py should exist in fourslash files');

            // Verify y's type is int before any redirect.
            await context.refreshSnapshot();
            const typeOriginal = await context.sendRequestWithSnapshot(TypeServerProtocol.GetComputedTypeRequest.type, {
                arg: yNode,
            });
            assert.strictEqual(getClassTypeName(typeOriginal), 'int', 'y should be int before redirect');

            // Add the redirect (mymod.py → virtual_mymod.py).
            context.sendNotification(TspSupplemental.SetVirtualFileRedirectNotification.type, {
                realUri: mymodFile.fileUri.toString(),
                virtualUri: virtualFile.fileUri.toString(),
            });

            // Wait for the snapshot from the add.
            await context.refreshSnapshot();

            // Verify y's type is now str.
            const typeRedirected = await context.sendRequestWithSnapshot(
                TypeServerProtocol.GetComputedTypeRequest.type,
                { arg: yNode }
            );
            assert.strictEqual(getClassTypeName(typeRedirected), 'str', 'y should be str after redirect');

            // Now listen for the next snapshot change.
            const snapshotChanged = new Promise<{ old: number; new: number }>((resolve) => {
                context.onNotification(TypeServerProtocol.SnapshotChangedNotification.type, (params) => {
                    resolve(params);
                });
            });

            // Remove the redirect.
            context.sendNotification(TspSupplemental.RemoveVirtualFileRedirectNotification.type, {
                realUri: mymodFile.fileUri.toString(),
            });

            // Wait for the snapshot change from the removal.
            const params = await snapshotChanged;
            assert(params.new > params.old, 'Snapshot should have incremented after removing redirect');

            // Verify y's type is back to int after removal.
            const typeRestored = await context.sendRequestWithSnapshot(TypeServerProtocol.GetComputedTypeRequest.type, {
                arg: yNode,
            });
            assert.strictEqual(getClassTypeName(typeRestored), 'int', 'y should be int after redirect removal');
        });
    });

    test('redirect with annotated class fields updates field types', async () => {
        // Simulates what happens when the Django sidecar produces a virtual
        // file with type-annotated fields: the original has plain assignments,
        // the virtual file has annotations.
        const code = `
// @filename: models.py
//// class Author:
////     name = "default"
//// # /*mod_marker*/

// @filename: virtual_models.py
//// class Author:
////     name: str = "default"

// @filename: test.py
//// from models import Author
//// a = Author()
//// [|/*result*/result|] = a.name
//// # /*test_marker*/
`;

        await withInProcTypeServer(code, async (context) => {
            await context.openFileForMarker('test_marker');
            await context.openFileForMarker('mod_marker');

            const resultNode: TypeServerProtocol.Node = context.getNodeForMarker('result');
            await context.refreshSnapshot();

            // Before redirect: `name = "default"` is inferred as str.
            const typeBefore = await context.sendRequestWithSnapshot(TypeServerProtocol.GetComputedTypeRequest.type, {
                arg: resultNode,
            });
            assert(typeBefore, 'result should have a computed type before redirect');
            assert.strictEqual(getClassTypeName(typeBefore), 'str', 'result should be str before redirect');

            // Apply redirect to the annotated virtual file.
            const modelsFile = context.fourslash.files.find((f) => f.fileUri.toString().endsWith('/models.py'));
            assert(modelsFile, 'models.py should exist');
            const virtualFile = context.fourslash.files.find((f) =>
                f.fileUri.toString().endsWith('/virtual_models.py')
            );
            assert(virtualFile, 'virtual_models.py should exist');

            context.sendNotification(TspSupplemental.SetVirtualFileRedirectNotification.type, {
                realUri: modelsFile.fileUri.toString(),
                virtualUri: virtualFile.fileUri.toString(),
            });

            await context.refreshSnapshot();

            // After redirect: `name: str = "default"` — still str, but now explicitly annotated.
            const typeAfter = await context.sendRequestWithSnapshot(TypeServerProtocol.GetComputedTypeRequest.type, {
                arg: resultNode,
            });
            assert(typeAfter, 'result should have a computed type after redirect');
            assert.strictEqual(getClassTypeName(typeAfter), 'str', 'result should still be str after redirect');
        });
    });

    test('redirect changes field type when annotation differs from inferred', async () => {
        // Virtual file adds a type annotation that widens the field type,
        // simulating the sidecar annotating a field as Any.
        const code = `
// @filename: models.py
//// class Author:
////     name = "default"
//// # /*mod_marker*/

// @filename: virtual_models.py
//// from typing import Any
//// class Author:
////     name: Any = "default"

// @filename: test.py
//// from models import Author
//// a = Author()
//// [|/*result*/result|] = a.name
//// # /*test_marker*/
`;

        await withInProcTypeServer(code, async (context) => {
            await context.openFileForMarker('test_marker');
            await context.openFileForMarker('mod_marker');

            const resultNode: TypeServerProtocol.Node = context.getNodeForMarker('result');
            await context.refreshSnapshot();

            // Before redirect: inferred as str.
            const typeBefore = await context.sendRequestWithSnapshot(TypeServerProtocol.GetComputedTypeRequest.type, {
                arg: resultNode,
            });
            assert.strictEqual(getClassTypeName(typeBefore), 'str', 'result should be str before redirect');

            // Apply redirect to virtual file where name is annotated as Any.
            const modelsFile = context.fourslash.files.find((f) => f.fileUri.toString().endsWith('/models.py'));
            const virtualFile = context.fourslash.files.find((f) =>
                f.fileUri.toString().endsWith('/virtual_models.py')
            );
            assert(modelsFile && virtualFile, 'both files should exist');

            context.sendNotification(TspSupplemental.SetVirtualFileRedirectNotification.type, {
                realUri: modelsFile.fileUri.toString(),
                virtualUri: virtualFile.fileUri.toString(),
            });

            await context.refreshSnapshot();

            // After redirect: name is annotated as Any, so result should no longer be str.
            const typeAfter = await context.sendRequestWithSnapshot(TypeServerProtocol.GetComputedTypeRequest.type, {
                arg: resultNode,
            });
            assert(typeAfter, 'result should have a computed type after redirect');
            // Any is not a ClassType, it has its own kind.
            assert.notStrictEqual(getClassTypeName(typeAfter), 'str', 'result should no longer be str after redirect');
        });
    });

    test('redirect with synthetic members makes new fields visible', async () => {
        // Simulates the sidecar injecting synthetic members (id, pk)
        // into the virtual file.
        const code = `
// @filename: models.py
//// class Author:
////     name = "default"
//// # /*mod_marker*/

// @filename: virtual_models.py
//// class Author:
////     name: str = "default"
////     id: int
////     pk: int

// @filename: test.py
//// from models import Author
//// a = Author()
//// [|/*id_val*/id_val|] = a.id
//// # /*test_marker*/
`;

        await withInProcTypeServer(code, async (context) => {
            await context.openFileForMarker('test_marker');
            await context.openFileForMarker('mod_marker');

            const idNode: TypeServerProtocol.Node = context.getNodeForMarker('id_val');

            // Apply redirect before checking — `id` doesn't exist in the original.
            const modelsFile = context.fourslash.files.find((f) => f.fileUri.toString().endsWith('/models.py'));
            const virtualFile = context.fourslash.files.find((f) =>
                f.fileUri.toString().endsWith('/virtual_models.py')
            );
            assert(modelsFile && virtualFile, 'both files should exist');

            const snapshotChangedPromise = context.waitForSnapshotChanged();
            context.sendNotification(TspSupplemental.SetVirtualFileRedirectNotification.type, {
                realUri: modelsFile.fileUri.toString(),
                virtualUri: virtualFile.fileUri.toString(),
            });

            // Wait for the snapshot changed event. The redirect (models.py is open, so the
            // server reads the virtual content and updates the in-memory buffer) triggers a
            // reanalysis that makes the new `id` field visible.
            await snapshotChangedPromise;

            await context.refreshSnapshot();

            // After redirect: id should be int (from virtual file's `id: int` declaration).
            const typeAfter = await context.sendRequestWithSnapshot(TypeServerProtocol.GetComputedTypeRequest.type, {
                arg: idNode,
            });
            assert(typeAfter, 'id_val should have a computed type after redirect');
            assert.strictEqual(getClassTypeName(typeAfter), 'int', 'id_val should be int after redirect');
        });
    });
});
