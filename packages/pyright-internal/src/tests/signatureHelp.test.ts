/*
 * signatureHelp.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for signature help.
 */

import assert from 'assert';
import { CancellationToken, MarkupKind } from 'vscode-languageserver';

import { convertOffsetToPosition } from '../common/positionUtils';
import { parseAndGetTestState } from './harness/fourslash/testState';

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
    const marker = state.getMarkerByName('marker');

    const parseResults = state.workspace.serviceInstance.getParseResult(marker.fileName)!;
    const position = convertOffsetToPosition(marker.position, parseResults.tokenizerOutput.lines);

    const actual = state.workspace.serviceInstance.getSignatureHelpForPosition(
        marker.fileName,
        position,
        MarkupKind.Markdown,
        CancellationToken.None
    );

    assert.strictEqual(!!actual, expects);
}
