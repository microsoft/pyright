/*
 * moveSymbol.misc.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Misc tests around move symbol.
 */

import assert from 'assert';
import { CancellationToken } from 'vscode-languageserver';

import { ImportFormat } from '../languageService/autoImporter';
import { parseAndGetTestState } from './harness/fourslash/testState';

test('source and destnation file must have same ext', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass

// @filename: moved.pyi
//// [|/*dest*/|]
        `;

    testNoMoveFromCode(code);
});

test('source and destnation file can not be same', () => {
    const code = `
// @filename: test.py
//// [|/*dest*/|]def [|/*marker*/foo|](): pass
        `;

    testNoMoveFromCode(code);
});

test('Symbol must be module level symbol', () => {
    const code = `
// @filename: test.py
//// class A:
////     def [|/*marker*/foo|](self): pass

// @filename: moved.py
//// [|/*dest*/|]
    `;

    testNoMoveFromCode(code);
});

test('Import alias can not be moved', () => {
    const code = `
// @filename: test.py
//// import [|/*marker*/sys|]

// @filename: moved.py
//// [|/*dest*/|]
    `;

    testNoMoveFromCode(code);
});

test('Type alias can not be moved', () => {
    const code = `
// @filename: test.py
//// from typing import TypeAlias
//// [|/*marker*/TA|]: TypeAlias = int

// @filename: moved.py
//// [|/*dest*/|]
    `;

    testNoMoveFromCode(code);
});

test('TypeVar can not be moved', () => {
    const code = `
// @filename: test.py
//// from typing import TypeVar
//// [|/*marker*/T1|] = TypeVar("T1")

// @filename: moved.py
//// [|/*dest*/|]
    `;

    testNoMoveFromCode(code);
});

test('tuple unpacking not supported', () => {
    const code = `
// @filename: test.py
//// [|/*marker*/a|], b = 1, 2

// @filename: moved.py
//// [|/*dest*/|]
    `;

    testNoMoveFromCode(code);
});

test('tuple unpacking not supported 2', () => {
    const code = `
// @filename: test.py
//// a, [|/*marker*/b|] = 1, 2

// @filename: moved.py
//// [|/*dest*/|]
    `;

    testNoMoveFromCode(code);
});

test('chained assignment not supported', () => {
    const code = `
// @filename: test.py
//// [|/*marker*/a|] = b = 1

// @filename: moved.py
//// [|/*dest*/|]
    `;

    testNoMoveFromCode(code);
});

test('chained assignment not supported 2', () => {
    const code = `
// @filename: test.py
//// a = [|/*marker*/b|] = 1

// @filename: moved.py
//// [|/*dest*/|]
    `;

    testNoMoveFromCode(code);
});

test('augmented assignment', () => {
    const code = `
// @filename: test.py
//// [|/*marker*/a|] += 1

// @filename: moved.py
//// [|/*dest*/|]
    `;

    testNoMoveFromCode(code);
});

test('augmented assignment 2', () => {
    const code = `
// @filename: test.py
//// a = 1
//// [|/*marker*/a|] += 1

// @filename: moved.py
//// [|/*dest*/|]
    `;

    testNoMoveFromCode(code);
});

test('symbol must be from user files', () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }
    
// @filename: used.py
//// /*used*/
//// import lib
//// lib.a
    
// @filename: lib.py
// @library: true
//// a = 1
//// [|/*marker*/a|] += 1

// @filename: moved.py
// @library: true
//// [|/*dest*/|]
    `;

    const state = parseAndGetTestState(code).state;
    while (state.workspace.serviceInstance.test_program.analyze());

    const actions = state.program.moveSymbolAtPosition(
        state.getMarkerByName('marker').fileName,
        state.getMarkerByName('dest').fileName,
        state.getPositionRange('marker').start,
        { importFormat: ImportFormat.Absolute },
        CancellationToken.None
    );
    assert(!actions);
});

function testNoMoveFromCode(code: string) {
    const state = parseAndGetTestState(code).state;

    const actions = state.program.moveSymbolAtPosition(
        state.getMarkerByName('marker').fileName,
        state.getMarkerByName('dest').fileName,
        state.getPositionRange('marker').start,
        { importFormat: ImportFormat.Absolute },
        CancellationToken.None
    );
    assert(!actions);
}
