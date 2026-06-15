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

test('callable assignment positional parameter count', async () => {
    const code = `
// @filename: test.py
//// from typing import Callable
////
//// def decorator(func: Callable[[int], int]) -> Callable[[int], int]:
////     return func
////
//// def decorator0(func: Callable[[], int]) -> Callable[[], int]:
////     return func
////
//// @[|/*marker*/decorator|]
//// def foo() -> int:
////     return 1
////
//// @[|/*marker2*/decorator0|]
//// def bar(value: int, /) -> int:
////     return value
    `;

    const state = parseAndGetTestState(code).state;

    state.verifyDiagnostics({
        marker: {
            category: 'error',
            message:
                'Argument of type "() -> int" cannot be assigned to parameter "func" of type "(int) -> int" in function "decorator"\n' +
                '  Type "() -> int" is not assignable to type "(int) -> int"\n' +
                '    Function accepts too few positional parameters; expected 1 but received 0',
        },
        marker2: {
            category: 'error',
            message:
                'Argument of type "(value: int, /) -> int" cannot be assigned to parameter "func" of type "() -> int" in function "decorator0"\n' +
                '  Type "(value: int, /) -> int" is not assignable to type "() -> int"\n' +
                '    Position-only parameter mismatch; expected 1 but received 0\n' +
                '    Function accepts too many positional parameters; expected 0 but received 1',
        },
    });
});
