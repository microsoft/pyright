/*
 * sourceFile.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for pyright sourceMapperUtils module.
 */
import assert from 'assert';
import { CancellationToken, CancellationTokenSource } from 'vscode-jsonrpc';

import { VariableDeclaration, isVariableDeclaration } from '../analyzer/declaration';
import { buildImportTree as buildImportTreeImpl } from '../analyzer/sourceMapperUtils';
import { TypeCategory } from '../analyzer/types';
import { TextRange } from '../common/textRange';
import { UriEx } from '../common/uri/uriUtils';
import { ParseNodeType } from '../parser/parseNodes';
import { getNodeAtMarker, parseAndGetTestState } from './harness/fourslash/testState';

function buildImportTree(
    sourceFile: string,
    targetFile: string,
    importResolver: (f: string) => string[],
    token: CancellationToken
): string[] {
    return buildImportTreeImpl(
        UriEx.file(sourceFile),
        UriEx.file(targetFile),
        (from) => {
            const resolved = importResolver(from.getFilePath().slice(1));
            return resolved.map((f) => UriEx.file(f));
        },
        token
    ).map((u) => u.getFilePath().slice(1));
}

describe('BuildImportTree', () => {
    const tokenSource = new CancellationTokenSource();
    test('Simple', () => {
        const results = buildImportTree(
            'A',
            'C',
            (f) => {
                switch (f) {
                    case 'C':
                        return ['B'];
                    case 'B':
                        return ['A'];
                    default:
                        break;
                }
                return [];
            },
            tokenSource.token
        );
        assert.deepEqual(results, ['C', 'B']);
    });

    test('Recursion', () => {
        const results = buildImportTree(
            'A',
            'E',
            (f) => {
                switch (f) {
                    case 'E':
                        return ['D'];
                    case 'D':
                        return ['C', 'B'];
                    case 'C':
                        return ['D'];
                    case 'B':
                        return ['A'];
                    default:
                        break;
                }
                return [];
            },
            tokenSource.token
        );
        assert.deepEqual(results, ['E', 'D', 'B']);
    });

    test('Multiple Paths', () => {
        const results = buildImportTree(
            'A',
            'G',
            (f) => {
                switch (f) {
                    case 'G':
                        return ['F', 'H', 'I'];
                    case 'F':
                        return ['D', 'E'];
                    case 'D':
                        return ['C', 'B'];
                    case 'C':
                        return ['E'];
                    case 'B':
                        return ['A'];
                    default:
                        break;
                }
                return [];
            },
            tokenSource.token
        );
        assert.deepEqual(results, ['G', 'F', 'D', 'B']);
    });

    test('No paths', () => {
        const results = buildImportTree(
            'A',
            'G',
            (f) => {
                switch (f) {
                    case 'G':
                        return ['F', 'H', 'I'];
                    case 'F':
                        return ['D', 'E'];
                    case 'D':
                        return ['C', 'B'];
                    case 'C':
                        return ['E'];
                    default:
                        break;
                }
                return [];
            },
            tokenSource.token
        );
        assert.deepEqual(results, ['G']);
    });

    function genArray(start: number, end: number): string[] {
        return Array(end - start)
            .fill(0)
            .map(() => String.fromCharCode(start++));
    }

    test('Too deep', () => {
        const results = buildImportTree(
            'Z',
            'A',
            (f) => {
                const start = f.charCodeAt(0);
                const end = 'Y'.charCodeAt(0);
                return genArray(start, end);
            },
            tokenSource.token
        );
        assert.deepEqual(results, ['A']);
    });

    test('Canceled', () => {
        const canceled = new CancellationTokenSource();
        canceled.cancel();
        const results = buildImportTree(
            'A',
            'E',
            (f) => {
                switch (f) {
                    case 'E':
                        return ['D'];
                    case 'D':
                        return ['C', 'B'];
                    case 'C':
                        return ['D'];
                    case 'B':
                        return ['A'];
                    default:
                        break;
                }
                return [];
            },
            canceled.token
        );
        assert.deepEqual(results, ['E']);
    });
});

test('find type alias decl', () => {
    const code = `
// @filename: test.py
//// from typing import Mapping
//// [|/*decl*/M|] = Mapping
////
//// def foo(/*marker*/m: M): pass
    `;

    assertTypeAlias(code);
});

test('find type alias decl from inferred type', () => {
    const code = `
// @filename: test.py
//// from typing import Mapping
//// [|/*decl*/M|] = Mapping
////
//// def foo(m: M):
////     return m

// @filename: test1.py
//// from test import foo
//// a = { "hello": 10 }
////
//// /*marker*/b = foo(a)
    `;

    assertTypeAlias(code);
});

function assertTypeAlias(code: string) {
    const state = parseAndGetTestState(code).state;

    const node = getNodeAtMarker(state, 'marker');
    assert(node.nodeType === ParseNodeType.Name);

    const type = state.program.evaluator!.getType(node);
    assert(type?.category === TypeCategory.Class);

    assert.strictEqual(type.shared.name, 'Mapping');
    assert.strictEqual(type.props?.typeAliasInfo?.shared.name, 'M');
    assert.strictEqual(type.props?.typeAliasInfo.shared.moduleName, 'test');

    const marker = state.getMarkerByName('marker');
    const markerUri = marker.fileUri;
    const mapper = state.program.getSourceMapper(
        markerUri,
        CancellationToken.None,
        /* mapCompiled */ false,
        /* preferStubs */ true
    );

    const range = state.getRangeByMarkerName('decl')!;
    const decls = mapper.findDeclarationsByType(markerUri, type, /* userTypeAlias */ true);

    const decl = decls.find((d) => isVariableDeclaration(d) && d.typeAliasName && d.typeAliasName.d.value === 'M') as
        | VariableDeclaration
        | undefined;
    assert(decl);

    assert.deepEqual(TextRange.create(decl.node.start, decl.node.length), TextRange.fromBounds(range.pos, range.end));
}
