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

    const state = parseAndGetTestState(code).state;

    const actions = state.program.moveSymbolAtPosition(
        state.getMarkerByName('marker').fileName,
        state.getMarkerByName('dest').fileName,
        state.getPositionRange('marker').start,
        { importFormat: ImportFormat.Absolute },
        CancellationToken.None
    );
    assert(!actions);
});

test('source and destnation file can not be same', () => {
    const code = `
// @filename: test.py
//// [|/*dest*/|]def [|/*marker*/foo|](): pass
        `;

    const state = parseAndGetTestState(code).state;

    const actions = state.program.moveSymbolAtPosition(
        state.getMarkerByName('marker').fileName,
        state.getMarkerByName('dest').fileName,
        state.getPositionRange('marker').start,
        { importFormat: ImportFormat.Absolute },
        CancellationToken.None
    );
    assert(!actions);
});
