/*
 * insertionPointUtils.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for insertionPointUtils module.
 */

import assert from 'assert';

import { normalizeSlashes } from '../common/pathUtils';
import { getInsertionPointForSymbolUnderModule, InsertionOptions } from '../languageService/insertionPointUtils';
import { parseAndGetTestState } from './harness/fourslash/testState';

test('insert symbol to module', () => {
    const code = `
//// def foo(): pass[|/*marker*/|]
    `;

    testInsertionPoint(code, 'bar');
});

test('insert symbol to module before private symbol', () => {
    const code = `
//// def foo(): pass[|/*marker*/|]
//// def __private(): pass
    `;

    testInsertionPoint(code, 'bar');
});

test('insert private symbol to module', () => {
    const code = `
//// def foo(): pass
//// def __private(): pass[|/*marker*/|]
    `;

    testInsertionPoint(code, '__another');
});

test('no insertion on existing symbol', () => {
    const code = `
//// [|/*marker*/|]def foo(): pass
//// def __private(): pass
    `;

    testNoInsertionPoint(code, 'foo');
});

test('no insertion symbol with imported symbol with same name', () => {
    const code = `
//// from os import path[|/*marker*/|]
//// def __private(): pass
    `;

    testNoInsertionPoint(code, 'path');
});

test('insert symbol with imported symbol with same name', () => {
    const code = `
//// from os import path[|/*marker*/|]
//// def __private(): pass
    `;

    testInsertionPoint(code, 'path', {
        symbolDeclToIgnore: normalizeSlashes('\\typeshed-fallback\\stdlib\\os\\__init__.pyi'),
    });
});

function testInsertionPoint(code: string, symbolName: string, options?: InsertionOptions) {
    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');

    const parseResults = state.program.getBoundSourceFile(marker.fileName)!.getParseResults()!;
    const actual = getInsertionPointForSymbolUnderModule(state.program.evaluator!, parseResults, symbolName, options);
    assert.strictEqual(actual, marker.position);
}

function testNoInsertionPoint(code: string, symbolName: string, options?: InsertionOptions) {
    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');

    const parseResults = state.program.getBoundSourceFile(marker.fileName)!.getParseResults()!;
    const actual = getInsertionPointForSymbolUnderModule(state.program.evaluator!, parseResults, symbolName, options);
    assert(!actual);
}
