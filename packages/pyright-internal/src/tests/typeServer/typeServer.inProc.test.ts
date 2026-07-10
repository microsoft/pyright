/*
 * typeServer.inProc.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * In-process protocol tests for the Pyright type server (TSP).
 *
 * These exercise the server-side request handlers end-to-end over a real JSON-RPC
 * connection (in-memory streams), including the `_onGetType` conversion path
 * (fromProtocolNode -> evaluate via the sync->async adapter -> ProtocolTypeFactory).
 *
 * Ported from Pylance's `typeServer.inProc.test.ts`. The Pylance round-trip tests that
 * reconstruct a Pyright `Type` from the protocol `Type` depend on the client-side consumer
 * stack (ExternalProgram / snapshotSync), which stays in Pylance, so they are intentionally
 * not ported here. Instead these tests assert on the protocol-level responses.
 */

import assert from 'assert';

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

describe('TypeServer in-proc protocol', () => {
    beforeAll(async () => {
        await initializeDependenciesForInProcTests();
    });

    test('initialize + get supported protocol version + snapshot', async () => {
        const code = `
// @filename: main.py
//// x = 1
`;

        await withInProcTypeServer(code, async (context) => {
            const version = await context.sendRequest(TypeServerProtocol.GetSupportedProtocolVersionRequest.type);
            assert(version.length > 0);
            const snapshot = await context.refreshSnapshot();
            assert(snapshot >= 0);
        });
    });

    test('resolveImport resolves a local module', async () => {
        const code = `
// @filename: main.py
//// # /*src*/
//// import foo
//// x = foo.value
// @filename: foo.py
//// value = 1
`;

        await withInProcTypeServer(code, async (context) => {
            const resolvedUri = await context.sendRequestWithSnapshot(TypeServerProtocol.ResolveImportRequest.type, {
                sourceUri: context.getFileUriForMarker('src').toString(),
                moduleDescriptor: { leadingDots: 0, nameParts: ['foo'] },
            });

            assert(resolvedUri !== undefined);
            assert(resolvedUri.endsWith('/src/foo.py'));
        });
    });

    test('getPythonSearchPaths returns an array', async () => {
        const code = `
// @filename: main.py
//// # /*src*/
//// x = 1
`;

        await withInProcTypeServer(code, async (context) => {
            const paths = await context.sendRequestWithSnapshot(TypeServerProtocol.GetPythonSearchPathsRequest.type, {
                fromUri: context.getFileUriForMarker('src').getDirectory().toString(),
            });

            assert(Array.isArray(paths));
            assert(paths.every((p) => typeof p === 'string'));
        });
    });

    test('resolveImport resolves a relative module', async () => {
        const code = `
// @filename: pkg/__init__.py
////
// @filename: pkg/main.py
//// # /*src*/
//// from . import foo
//// x = foo.value
// @filename: pkg/foo.py
//// value = 1
`;

        await withInProcTypeServer(code, async (context) => {
            const resolvedUri = await context.sendRequestWithSnapshot(TypeServerProtocol.ResolveImportRequest.type, {
                sourceUri: context.getFileUriForMarker('src').toString(),
                moduleDescriptor: { leadingDots: 1, nameParts: ['foo'] },
            });

            assert(resolvedUri !== undefined);
            assert(resolvedUri.endsWith('/src/pkg/foo.py'));
        });
    });

    test('resolveImport resolves stdlib module from typeshed-fallback', async () => {
        const code = `
// @filename: main.py
//// # /*src*/
//// import typing
//// x = typing.Any
`;

        await withInProcTypeServer(code, async (context) => {
            const resolvedUri = await context.sendRequestWithSnapshot(TypeServerProtocol.ResolveImportRequest.type, {
                sourceUri: context.getFileUriForMarker('src').toString(),
                moduleDescriptor: { leadingDots: 0, nameParts: ['typing'] },
            });

            assert(resolvedUri !== undefined);
            // The exact URI scheme can vary depending on FS mapping; the key is that this came from typeshed.
            assert(resolvedUri.includes('/typeshed-fallback/stdlib/typing.pyi'));
        });
    });

    test('resolveImport resolves builtins module from typeshed-fallback', async () => {
        const code = `
// @filename: main.py
//// # /*src*/
//// import builtins
//// x = builtins.int
`;

        await withInProcTypeServer(code, async (context) => {
            const resolvedUri = await context.sendRequestWithSnapshot(TypeServerProtocol.ResolveImportRequest.type, {
                sourceUri: context.getFileUriForMarker('src').toString(),
                moduleDescriptor: { leadingDots: 0, nameParts: ['builtins'] },
            });

            assert(resolvedUri !== undefined);
            assert(resolvedUri.includes('/typeshed-fallback/stdlib/builtins.pyi'));
        });
    });

    test('resolveImport resolves stdlib submodule from typeshed-fallback', async () => {
        const code = `
// @filename: main.py
//// # /*src*/
//// import collections.abc
//// x = collections.abc.Iterable
`;

        await withInProcTypeServer(code, async (context) => {
            const resolvedUri = await context.sendRequestWithSnapshot(TypeServerProtocol.ResolveImportRequest.type, {
                sourceUri: context.getFileUriForMarker('src').toString(),
                moduleDescriptor: { leadingDots: 0, nameParts: ['collections', 'abc'] },
            });

            assert(resolvedUri !== undefined);
            assert(resolvedUri.includes('/typeshed-fallback/stdlib/collections/abc.pyi'));
        });
    });

    test('getComputedType returns a type for a node', async () => {
        const code = `
// @filename: main.py
//// def takes_int(x: int) -> None:
////     pass
////
//// [|/*arg*/__arg__|] = 1
//// takes_int(__arg__)
`;

        await withInProcTypeServer(code, async (context) => {
            await context.openFileForMarker('arg');
            const arg: TypeServerProtocol.Node = context.getNodeForMarker('arg');

            await context.refreshSnapshot();
            const type = await context.sendRequestWithSnapshot(TypeServerProtocol.GetComputedTypeRequest.type, {
                arg,
            });

            assert(type !== undefined);
            assert(typeof type.id === 'number');
            assert.strictEqual(type.kind, TypeServerProtocol.TypeKind.Class);
            assert.strictEqual(getClassTypeName(type), 'int');
        });
    });

    test('getExpectedType returns a type for a node', async () => {
        const code = `
// @filename: main.py
//// class C:
////     pass
////
//// x: C = [|/*expr*/C()|]
`;

        await withInProcTypeServer(code, async (context) => {
            await context.openFileForMarker('expr');
            const arg: TypeServerProtocol.Node = context.getNodeForMarker('expr');

            await context.refreshSnapshot();
            const type = await context.sendRequestWithSnapshot(TypeServerProtocol.GetExpectedTypeRequest.type, {
                arg,
            });

            assert(type !== undefined);
            assert(typeof type.id === 'number');
            assert.strictEqual(type.kind, TypeServerProtocol.TypeKind.Class);
            assert.strictEqual(getClassTypeName(type), 'C');
        });
    });

    test('getDeclaredType returns a type for an annotated symbol', async () => {
        const code = `
// @filename: main.py
//// [|/*decl*/__declared__|]: str = 'x'
`;

        await withInProcTypeServer(code, async (context) => {
            await context.openFileForMarker('decl');
            const arg: TypeServerProtocol.Node = context.getNodeForMarker('decl');

            await context.refreshSnapshot();
            const type = await context.sendRequestWithSnapshot(TypeServerProtocol.GetDeclaredTypeRequest.type, {
                arg,
            });

            assert(type !== undefined);
            assert(typeof type.id === 'number');
            assert.strictEqual(type.kind, TypeServerProtocol.TypeKind.Class);
            assert.strictEqual(getClassTypeName(type), 'str');
        });
    });

    test('snapshotChanged notification is delivered', async () => {
        const code = `
// @filename: main.py
//// [|/*open*/|]x = 1
`;

        await withInProcTypeServer(code, async (context) => {
            const initialSnapshot = await context.refreshSnapshot();
            const received = new Promise<{ old: number; new: number }>((resolve) => {
                context.onNotification(TypeServerProtocol.SnapshotChangedNotification.type, (params) => {
                    resolve(params);
                });
            });

            await context.openFileForMarker('open');

            const params = await received;
            assert(params.new > params.old);
            assert(params.old >= initialSnapshot);
        });
    });
});
