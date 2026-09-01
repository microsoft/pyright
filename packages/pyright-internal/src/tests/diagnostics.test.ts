/*
 * diagnostics.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for diagnostics
 */

import assert from 'assert';

import { DiagnosticRule } from '../common/diagnosticRules';
import { Range } from '../common/textRange';
import { parseAndGetTestState } from './harness/fourslash/testState';

// A range that spans the whole document so range intersection never filters diagnostics out.
const wholeFileRange: Range = {
    start: { line: 0, character: 0 },
    end: { line: 1_000_000, character: 0 },
};

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

test('getDiagnosticsForRangeWithoutFileIgnore analyzes the file on demand when its cache is empty', () => {
    // Regression for the foreground/background Program split: in the product the published
    // diagnostics are produced by the background-analysis Program, so the foreground Program
    // that serves code-action requests may never have checked the file, leaving its pre-ignore
    // diagnostics cache empty. The getter must populate that cache on demand.
    const code = `
// @filename: pyrightconfig.json
//// {
////   "ignore": ["**/test.py"]
//// }

// @filename: test.py
//// /*marker*/undefinedSymbol
    `;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');
    state.openFile(marker.fileName);

    // Intentionally do NOT analyze: this mirrors a foreground Program that has not checked the
    // file. The file is ignored, so its published diagnostics are empty regardless.
    assert.strictEqual(state.program.getDiagnosticsForRange(marker.fileUri, wholeFileRange).length, 0);

    // The pre-ignore getter should still surface the unknown-symbol diagnostic by analyzing the
    // file on demand. Without the on-demand analysis this returns [] and the quick fixes vanish.
    const preIgnoreDiagnostics = state.program.getDiagnosticsForRangeWithoutFileIgnore(marker.fileUri, wholeFileRange);
    assert(
        preIgnoreDiagnostics.some((diag) => diag.getRule() === DiagnosticRule.reportUndefinedVariable),
        `Expected a reportUndefinedVariable diagnostic, got ${JSON.stringify(
            preIgnoreDiagnostics.map((diag) => ({ rule: diag.getRule(), message: diag.message }))
        )}`
    );
});
