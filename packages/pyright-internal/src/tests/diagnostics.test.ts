/*
 * diagnostics.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for diagnostics
 */

import { parseAndGetTestState } from './harness/fourslash/testState';

test('unused import', async () => {
    const code = `
// @filename: test1.py
//// from test2 import [|/*marker*/foo|]

// @filename: test2.py
//// def foo(): pass
    `;

    const state = parseAndGetTestState(code).state;

    state.verifyDiagnostics({
        marker: { category: 'unused', message: '"foo" is not accessed' },
    });
});

test('pyright ignore unused import', async () => {
    const code = `
// @filename: test1.py
//// from test2 import [|/*marker*/foo|] # pyright: ignore

// @filename: test2.py
//// def foo(): pass
    `;

    const state = parseAndGetTestState(code).state;

    state.verifyDiagnostics({
        marker: { category: 'none', message: '' },
    });
});
