/*
 * sourceFile.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for pyright sourceMapperUtils module.
 */
import * as assert from 'assert';

import { buildImportTree } from '../analyzer/sourceMapperUtils';

describe('BuildImportTree', () => {
    test('Simple', () => {
        const results = buildImportTree('A', 'C', (f) => {
            switch (f) {
                case 'C':
                    return ['B'];
                case 'B':
                    return ['A'];
                default:
                    break;
            }
            return [];
        });
        assert.deepEqual(results, ['C', 'B']);
    });

    test('Recursion', () => {
        const results = buildImportTree('A', 'E', (f) => {
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
        });
        assert.deepEqual(results, ['E', 'D', 'B']);
    });

    test('Multiple Paths', () => {
        const results = buildImportTree('A', 'G', (f) => {
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
        });
        assert.deepEqual(results, ['G', 'F', 'D', 'B']);
    });

    test('No paths', () => {
        const results = buildImportTree('A', 'G', (f) => {
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
        });
        assert.deepEqual(results, ['G']);
    });
});
