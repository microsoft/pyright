/*
 * sourceFile.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for pyright sourceMapperUtils module.
 */
import * as assert from 'assert';
import { CancellationToken, CancellationTokenSource } from 'vscode-jsonrpc';

import { buildImportTree as buildImportTreeImpl } from '../analyzer/sourceMapperUtils';
import { Uri } from '../common/uri';

function buildImportTree(
    sourceFile: string,
    targetFile: string,
    importResolver: (f: string) => string[],
    token: CancellationToken
): string[] {
    return buildImportTreeImpl(
        Uri.file(sourceFile),
        Uri.file(targetFile),
        (from) => {
            const resolved = importResolver(from.getFilePath().slice(1));
            return resolved.map((f) => Uri.file(f));
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
