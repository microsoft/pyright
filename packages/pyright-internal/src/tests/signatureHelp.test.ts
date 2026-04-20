/*
 * signatureHelp.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for signature help.
 */

import assert from 'assert';
import { CancellationToken, MarkupKind, SignatureHelp } from 'vscode-languageserver';
import { SignatureHelpProvider } from '../languageService/signatureHelpProvider';
import { parseAndGetTestState, TestState } from './harness/fourslash/testState';
import { PyrightDocStringService } from '../common/docStringService';

test('invalid position in format string segment', () => {
    const code = `
// @filename: test.py
//// f'{"(".capit[|/*marker*/|]alize()}'
    `;

    checkSignatureHelp(code, false);
});

test('valid position in format string segment', () => {
    const code = `
// @filename: test.py
//// f'{"(".capitalize([|/*marker*/|])}'
    `;

    checkSignatureHelp(code, true);
});

test('valid position in the second format string segment', () => {
    const code = `
// @filename: test.py
//// f'{print("hello")} {"(".capitalize([|/*marker*/|])}'
    `;

    checkSignatureHelp(code, true);
});

test('invalid position in the second format string segment', () => {
    const code = `
// @filename: test.py
//// f'{print("hello")} {"(".capitalize [|/*marker*/|]  ()}'
    `;

    checkSignatureHelp(code, false);
});

test('nested call in format string segment', () => {
    const code = `
// @filename: test.py
//// def foo():
////     pass
////
//// f'{"(".capitalize(foo([|/*marker*/|]))}'
    `;

    checkSignatureHelp(code, true);
});

test('signature help shows source default values for stub ellipsis defaults', () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// import mylib
////
//// mylib.f([|/*marker*/|]

// @filename: mylib.pyi
//// def f(a: int, b: str = ...) -> None: ...

// @filename: mylib.py
//// def f(a: int, b: int = 3) -> None:
////     ...
    `;

    const state = parseAndGetTestState(code).state;
    const actual = getSignatureHelpForMarker(state, 'marker');

    assert(actual, 'Expected signature help result');
    assert.strictEqual(actual.signatures.length, 1, 'Expected one signature');
    assert.strictEqual(actual.signatures[0].label, '(a: int, b: str = 3) -> None');
});

test('signature help substitutes multiple stub ellipsis defaults from source', () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// import mylib
////
//// mylib.f([|/*marker*/|]

// @filename: mylib.pyi
//// def f(a: int = ..., b: str = ...) -> None: ...

// @filename: mylib.py
//// def f(a: int = 3, b: str = "hello") -> None:
////     ...
    `;

    const state = parseAndGetTestState(code).state;
    const actual = getSignatureHelpForMarker(state, 'marker');

    assert(actual, 'Expected signature help result');
    assert.strictEqual(actual.signatures.length, 1, 'Expected one signature');

    assert.strictEqual(actual.signatures[0].label, '(a: int = 3, b: str = "hello") -> None');
});

test('signature help shows concrete default values when provided by stub', () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// import mylib
////
//// mylib.f([|/*marker*/|]

// @filename: mylib.pyi
//// def f(a: int = 3, b: str = "hello") -> None: ...
    `;

    const state = parseAndGetTestState(code).state;
    const actual = getSignatureHelpForMarker(state, 'marker');

    assert(actual, 'Expected signature help result');
    assert.strictEqual(actual.signatures.length, 1, 'Expected one signature');

    assert.strictEqual(actual.signatures[0].label, '(a: int = 3, b: str = "hello") -> None');
});

test('signature help substitutes stub ellipsis defaults for all overloads', () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// import mylib
////
//// mylib.f(1, [|/*marker*/|])

// @filename: mylib.pyi
//// from typing import overload
////
//// @overload
//// def f(a: int = ..., b: str = ...) -> None: ...
////
//// @overload
//// def f(a: str = ..., b: str = ...) -> None: ...
////
//// def f(*args, **kwargs) -> None: ...

// @filename: mylib.py
//// def f(a: int = 3, b: str = "hello") -> None:
////     ...
    `;

    const state = parseAndGetTestState(code).state;
    const actual = getSignatureHelpForMarker(state, 'marker');

    assert(actual, 'Expected signature help result');

    // Python runtime has a single implementation, so source defaults apply to all overloads.
    assert.strictEqual(actual.activeSignature, 0);
    assert.strictEqual(actual.signatures.length, 2);
    assert.strictEqual(actual.signatures[0].label, '(a: int = 3, b: str = "hello") -> None');
    assert.strictEqual(actual.signatures[1].label, '(a: str = 3, b: str = "hello") -> None');
});

test('signature help does not substitute when stub default is not ellipsis', () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// import mylib
////
//// mylib.f([|/*marker*/|]

// @filename: mylib.pyi
//// def f(a: int, b: str = 1) -> None: ...

// @filename: mylib.py
//// def f(a: int, b: int = 3) -> None:
////     ...
    `;

    const state = parseAndGetTestState(code).state;
    const actual = getSignatureHelpForMarker(state, 'marker');

    assert(actual, 'Expected signature help result');
    assert.strictEqual(actual.signatures.length, 1, 'Expected one signature');

    assert.strictEqual(actual.signatures[0].label, '(a: int, b: str = 1) -> None');
});

test('signature help does not substitute when source implementation is missing', () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// import mylib
////
//// mylib.f([|/*marker*/|]

// @filename: mylib.pyi
//// def f(a: int, b: str = ...) -> None: ...
    `;

    const state = parseAndGetTestState(code).state;
    const actual = getSignatureHelpForMarker(state, 'marker');

    assert(actual, 'Expected signature help result');
    assert.strictEqual(actual.signatures.length, 1, 'Expected one signature');
    assert.strictEqual(actual.signatures[0].label, '(a: int, b: str = ...) -> None');
});

test('signature help does not substitute unsafe long defaults for stub ellipsis defaults', () => {
    const longNumber = '9'.repeat(150);
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// import mylib
////
//// mylib.f([|/*marker*/|]

// @filename: mylib.pyi
//// def f(a: int, b: str = ...) -> None: ...

// @filename: mylib.py
//// def f(a: int, b: int = ${longNumber}) -> None:
////     ...
    `;

    const state = parseAndGetTestState(code).state;
    const actual = getSignatureHelpForMarker(state, 'marker');

    assert(actual, 'Expected signature help result');
    assert.strictEqual(actual.signatures.length, 1, 'Expected one signature');

    assert.strictEqual(actual.signatures[0].label, '(a: int, b: str = ...) -> None');
});

test('signature help does not substitute unsafe multiline defaults for stub ellipsis defaults', () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// import mylib
////
//// mylib.f([|/*marker*/|]

// @filename: mylib.pyi
//// def f(a: int, b: str = ...) -> None: ...

// @filename: mylib.py
//// def f(a: int, b: int = """hello
//// world""") -> None:
////     ...
    `;

    const state = parseAndGetTestState(code).state;
    const actual = getSignatureHelpForMarker(state, 'marker');

    assert(actual, 'Expected signature help result');
    assert.strictEqual(actual.signatures.length, 1, 'Expected one signature');

    assert.strictEqual(actual.signatures[0].label, '(a: int, b: str = ...) -> None');
});

test('signature help overloads: mixed ellipsis and concrete defaults', () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// import mylib
////
//// mylib.f([|/*marker*/|])

// @filename: mylib.pyi
//// from typing import overload
////
//// @overload
//// def f(a: int, b: str = ...) -> None: ...
////
//// @overload
//// def f(a: int, b: str = "default") -> None: ...
////
//// def f(*args, **kwargs) -> None: ...

// @filename: mylib.py
//// def f(a: int, b: str = "hello") -> None:
////     ...
    `;

    const state = parseAndGetTestState(code).state;
    const actual = getSignatureHelpForMarker(state, 'marker');

    assert(actual, 'Expected signature help result');
    assert.strictEqual(actual.signatures.length, 2);
    // First overload: ellipsis substituted from source
    assert.strictEqual(actual.signatures[0].label, '(a: int, b: str = "hello") -> None');
    // Second overload: concrete default kept as-is (not ellipsis, no substitution)
    assert.strictEqual(actual.signatures[1].label, '(a: int, b: str = "default") -> None');
});

test('signature help overloads: overload with no defaults stays unchanged', () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// import mylib
////
//// mylib.f([|/*marker*/|])

// @filename: mylib.pyi
//// from typing import overload
////
//// @overload
//// def f(a: int) -> None: ...
////
//// @overload
//// def f(a: int, b: str = ...) -> None: ...
////
//// def f(*args, **kwargs) -> None: ...

// @filename: mylib.py
//// def f(a: int, b: str = "hello") -> None:
////     ...
    `;

    const state = parseAndGetTestState(code).state;
    const actual = getSignatureHelpForMarker(state, 'marker');

    assert(actual, 'Expected signature help result');
    assert.strictEqual(actual.signatures.length, 2);
    // First overload: no default parameter, stays unchanged
    assert.strictEqual(actual.signatures[0].label, '(a: int) -> None');
    // Second overload: ellipsis substituted from source
    assert.strictEqual(actual.signatures[1].label, '(a: int, b: str = "hello") -> None');
});

test('signature help overloads: param name not in source keeps ellipsis', () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// import mylib
////
//// mylib.f([|/*marker*/|])

// @filename: mylib.pyi
//// from typing import overload
////
//// @overload
//// def f(a: int, b: str = ...) -> None: ...
////
//// @overload
//// def f(a: int, x: str = ...) -> None: ...
////
//// def f(*args, **kwargs) -> None: ...

// @filename: mylib.py
//// def f(a: int, b: str = "hello") -> None:
////     ...
    `;

    const state = parseAndGetTestState(code).state;
    const actual = getSignatureHelpForMarker(state, 'marker');

    assert(actual, 'Expected signature help result');
    assert.strictEqual(actual.signatures.length, 2);
    // First overload: 'b' found in source, substituted
    assert.strictEqual(actual.signatures[0].label, '(a: int, b: str = "hello") -> None');
    // Second overload: 'x' not in source, keeps ellipsis
    assert.strictEqual(actual.signatures[1].label, '(a: int, x: str = ...) -> None');
});

test('signature help overloads: source uses *args/**kwargs, no substitution', () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// import mylib
////
//// mylib.f([|/*marker*/|])

// @filename: mylib.pyi
//// from typing import overload
////
//// @overload
//// def f(a: int = ...) -> None: ...
////
//// @overload
//// def f(a: str = ...) -> None: ...
////
//// def f(*args, **kwargs) -> None: ...

// @filename: mylib.py
//// def f(*args, **kwargs) -> None:
////     ...
    `;

    const state = parseAndGetTestState(code).state;
    const actual = getSignatureHelpForMarker(state, 'marker');

    assert(actual, 'Expected signature help result');
    assert.strictEqual(actual.signatures.length, 2);
    // Source has no named params with defaults, so ellipsis stays
    assert.strictEqual(actual.signatures[0].label, '(a: int = ...) -> None');
    assert.strictEqual(actual.signatures[1].label, '(a: str = ...) -> None');
});

test('signature help overloads: different param counts, extra params keep ellipsis', () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// import mylib
////
//// mylib.f([|/*marker*/|])

// @filename: mylib.pyi
//// from typing import overload
////
//// @overload
//// def f(a: int = ..., b: str = ..., c: float = ...) -> None: ...
////
//// @overload
//// def f(a: int = ...) -> None: ...
////
//// def f(*args, **kwargs) -> None: ...

// @filename: mylib.py
//// def f(a: int = 1, b: str = "hi") -> None:
////     ...
    `;

    const state = parseAndGetTestState(code).state;
    const actual = getSignatureHelpForMarker(state, 'marker');

    assert(actual, 'Expected signature help result');
    assert.strictEqual(actual.signatures.length, 2);
    // First overload: a and b substituted, c not in source keeps ellipsis
    assert.strictEqual(actual.signatures[0].label, '(a: int = 1, b: str = "hi", c: float = ...) -> None');
    // Second overload: a substituted
    assert.strictEqual(actual.signatures[1].label, '(a: int = 1) -> None');
});

test('within arguments in format string segment', () => {
    const code = `
// @filename: test.py
//// def foo():
////     pass
////
//// f'{"(".capitalize(fo[|/*marker*/|]o())}'
    `;

    checkSignatureHelp(code, true);
});

function checkSignatureHelp(code: string, expects: boolean) {
    const state = parseAndGetTestState(code).state;
    const actual = getSignatureHelpForMarker(state, 'marker');

    assert.strictEqual(!!actual, expects);
}

function getSignatureHelpForMarker(state: TestState, markerName: string): SignatureHelp | undefined {
    const marker = state.getMarkerByName(markerName);
    const position = state.getPosition(markerName);

    return new SignatureHelpProvider(
        state.workspace.service.test_program,
        marker.fileUri,
        position,
        MarkupKind.Markdown,
        /*hasSignatureLabelOffsetCapability*/ true,
        /*hasActiveParameterCapability*/ true,
        /*context*/ undefined,
        new PyrightDocStringService(),
        CancellationToken.None
    ).getSignatureHelp();
}
