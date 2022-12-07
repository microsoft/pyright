/*
 * indentationUtils.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for indentationUtils module.
 */

import assert from 'assert';

import { getIndentation } from '../languageService/indentationUtils';
import { parseAndGetTestState } from './harness/fourslash/testState';

test('top level indentation', () => {
    const code = `
//// [|/*marker*/|]def foo(): pass
    `;

    testIndentation(code, 0);
});

test('multiple top level indentation', () => {
    const code = `
//// def foo(): pass
//// def foo(): pass
//// [|/*marker*/|]
    `;

    testIndentation(code, 0);
});

test('sibling indentation', () => {
    const code = `
//// def foo():
////     i = 1
////     [|/*marker*/|]
    `;

    testIndentation(code, 4);
});

test('first child indentation', () => {
    const code = `
//// def foo():
////     [|/*marker*/|]
    `;

    testIndentation(code, 4);
});

test('nested first child indentation', () => {
    const code = `
//// class A:
////     def foo(self):
////         [|/*marker*/|]
    `;

    testIndentation(code, 8);
});

test('nested sibling indentation', () => {
    const code = `
//// class A:
////     def foo(self):
////         i = 1
////         [|/*marker*/|]
    `;

    testIndentation(code, 8);
});

test('sibling indentation next line', () => {
    const code = `
//// def foo():
////     i = 1
////     [|/*marker*/|]
    `;

    testIndentation(code, 4);
});

test('sibling indentation next line after indentation point', () => {
    const code = `
//// def foo():
////     i = 1
////            [|/*marker*/|]
    `;

    testIndentation(code, 4);
});

test('sibling indentation next line at 0 char position', () => {
    const code = `
//// def foo():
////     i = 1
//// [|/*marker*/|]
    `;

    testIndentation(code, 4);
});

test('sibling indentation after blank line', () => {
    const code = `
//// def foo():
////     i = 1
////
//// [|/*marker*/|]
    `;

    testIndentation(code, 4);
});

test('parent indentation after pass', () => {
    const code = `
//// def foo():
////     pass
////     [|/*marker*/|]
    `;

    testIndentation(code, 0);
});

test('parent indentation after return', () => {
    const code = `
//// def foo():
////     return
////     [|/*marker*/|]
    `;

    testIndentation(code, 0);
});

test('parent indentation after raise', () => {
    const code = `
//// def foo():
////     raise
////     [|/*marker*/|]
    `;

    testIndentation(code, 0);
});

test('parent indentation after continue', () => {
    const code = `
//// def foo():
////     while True:
////         continue
////         [|/*marker*/|]
    `;

    testIndentation(code, 4);
});

test('parent indentation after break', () => {
    const code = `
//// def foo():
////     while True:
////         break
////         [|/*marker*/|]
    `;

    testIndentation(code, 4);
});

test('between statements', () => {
    const code = `
//// def foo():
////     while True:
////         i = 10
////     [|/*marker*/|]
////     i = 10
    `;

    testIndentation(code, 8);
});

test('between statements with prefer dedent', () => {
    const code = `
//// def foo():
////     while True:
////         i = 10
////     [|/*marker*/|]
////     i = 10
    `;

    testIndentation(code, 4, /*preferDedent*/ true);
});

test('single line multiple statements', () => {
    const code = `
//// def foo():
////     import os; import sys
////     [|/*marker*/|]
    `;

    testIndentation(code, 4);
});

test('single line pass', () => {
    const code = `
//// def foo(): pass
////     [|/*marker*/|]
    `;

    testIndentation(code, 0);
});

test('single line return', () => {
    const code = `
//// def foo(): return
////     [|/*marker*/|]
    `;

    testIndentation(code, 0);
});

test('single line raise', () => {
    const code = `
//// def foo(): raise
////     [|/*marker*/|]
    `;

    testIndentation(code, 0);
});

test('single line continue', () => {
    const code = `
//// def foo():
////     while True: continue
////         [|/*marker*/|]
    `;

    testIndentation(code, 4);
});

test('single line break', () => {
    const code = `
//// def foo():
////     while True: break
////         [|/*marker*/|]
    `;

    testIndentation(code, 4);
});

test('first member', () => {
    const code = `
//// def foo():
////     [|/*marker*/|]
////         i = 1
    `;

    testIndentation(code, 8);
});

test('inner first member', () => {
    const code = `
//// def foo():
////     def bar():
////         [|/*marker*/|]
////       i = 1
    `;

    testIndentation(code, 6);
});

test('single line comment', () => {
    const code = `
//// def foo():
////     # single line comment
////     [|/*marker*/|]

    `;

    testIndentation(code, 4);
});

test('multiline string literals top', () => {
    const code = `
//// def foo():
////     """
////     [|/*marker*/|]
    `;

    testIndentation(code, 4);
});

test('multiline string literals - multiple statements', () => {
    const code = `
//// def foo():
////     import os; a = """
////                    [|/*marker*/|]
    `;

    testIndentation(code, 4);
});

test('multiline string literals - blank lines', () => {
    const code = `
//// def foo():
////     """
////
////        [|/*marker*/|]
    `;

    testIndentation(code, 4);
});

test('multiline string literals - first non blank line', () => {
    const code = `
//// def foo():
////     i = \\
////        1; a = """
////            [|/*marker*/|]
////               """
    `;

    testIndentation(code, 7);
});

test('multiline string literals - align to content', () => {
    const code = `
//// def foo():
////     """
////         Hello
////            [|/*marker*/|]
////     """
    `;

    testIndentation(code, 8);
});

test('multiline string literals - align to content with multiple blank lines', () => {
    const code = `
//// def foo():
////     """
////         Title
////             1. Second
////         
////         
////         
////         
////            [|/*marker*/|]
////     """
    `;

    testIndentation(code, 12);
});

test('explicit multiline construct', () => {
    const code = `
//// def \\
////     [|/*marker*/|]
////
    `;

    testIndentation(code, 4);
});

test('multiple explicit multiline construct', () => {
    const code = `
//// def foo \\
////         \\
////     [|/*marker*/|]
////
    `;

    testIndentation(code, 8);
});

test('explicit multiline expression', () => {
    const code = `
//// def foo():
////     a = 1 +  \\
////            [|/*marker*/|]
////
    `;

    testIndentation(code, 8);
});

test('explicit multiline expression between lines', () => {
    const code = `
//// def foo():
////     a = 1 +  \\
////            [|/*marker*/|]
////     b = 1
    `;

    testIndentation(code, 8);
});

test('implicit multiline constructs', () => {
    const code = `
//// def foo(
////     [|/*marker*/|]
    `;

    testIndentation(code, 4);
});

test('multiple implicit multiline constructs', () => {
    const code = `
//// def foo(
////          a,
////        [|/*marker*/|]
    `;

    testIndentation(code, 9);
});

test('multiple implicit multiline constructs with multiple statements', () => {
    const code = `
//// b = 1
////
//// def foo(
////          a,
////        [|/*marker*/|]
    `;

    testIndentation(code, 9);
});

test('multiline list', () => {
    const code = `
//// a = [
////        1,
////        [|/*marker*/|]
////     ]
    `;

    testIndentation(code, 7);
});

test('unfinished block', () => {
    const code = `
//// def foo(a: Union[int, str]):
////     while True:
////     [|/*marker*/|]
//// 
//// def bar() -> int:
////     return 1
    `;

    testIndentation(code, 8);
});

function testIndentation(code: string, indentation: number, preferDedent?: boolean) {
    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');

    const parseResults = state.program.getBoundSourceFile(marker.fileName)!.getParseResults()!;
    const actual = getIndentation(parseResults, marker.position, preferDedent);
    assert.strictEqual(actual, indentation);
}
