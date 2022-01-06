/*
 * indentationUtils.ptvs.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for indentationUtils module. some tests ported from ptvs indentation tests.
 */

import assert from 'assert';

import { getIndentation } from '../languageService/indentationUtils';
import { parseAndGetTestState } from './harness/fourslash/testState';

test('top level statement - pass', () => {
    const code = `
//// pass
//// [|/*marker*/|]
    `;

    testIndentation(code, 0);
});

test('top level statement - function', () => {
    const code = `
//// def f():
////  [|/*marker*/|]
    `;

    testIndentation(code, 4);
});

test('function with open paren at end of file', () => {
    const code = `
//// def f(
//// [|/*marker*/|]
    `;

    // This is due to how our tokenizer associate new line at
    // end of stream.
    testIndentation(code, 0);
});

test('function with open paren between top level statement', () => {
    const code = `
//// def f(
//// [|/*marker*/|]
////
//// def bar(): pass
    `;

    testIndentation(code, 4);
});

test('function with open paren', () => {
    const code = `
//// def f(
//// [|/*marker*/|]
////
    `;

    testIndentation(code, 4);
});

test('function with parameter', () => {
    const code = `
//// def f(x,
//// [|/*marker*/|]
////
    `;

    testIndentation(code, 4);
});

test('call with open paren at end of file', () => {
    const code = `
//// f(
//// [|/*marker*/|]
    `;

    // This is due to how our tokenizer associate new line at
    // end of stream.
    testIndentation(code, 0);
});

test('call with open paren between top level statement', () => {
    const code = `
//// f(
//// [|/*marker*/|]
////
//// bar()
    `;

    testIndentation(code, 4);
});

test('class with open paren', () => {
    const code = `
//// f(
//// [|/*marker*/|]
////
    `;

    testIndentation(code, 4);
});

test('call with parameter', () => {
    const code = `
//// f(x,
//// [|/*marker*/|]
////
    `;

    testIndentation(code, 4);
});

test('list', () => {
    const code = `
//// [
//// [|/*marker*/|]
////
    `;

    testIndentation(code, 4);
});

test('list with spaces', () => {
    const code = `
////          [
//// [|/*marker*/|]
////
    `;

    testIndentation(code, 17);
});

test('list with nested', () => {
    const code = `
//// [[[[[[[
//// [|/*marker*/|]
////
    `;

    testIndentation(code, 4);
});

test('list with spaces and element', () => {
    const code = `
////          [x,
//// [|/*marker*/|]
////
    `;

    testIndentation(code, 17);
});

test('list with nested with element', () => {
    const code = `
//// [[[[[[[x,
//// [|/*marker*/|]
////
    `;

    testIndentation(code, 4);
});

test('set', () => {
    const code = `
//// {
//// [|/*marker*/|]
////
    `;

    testIndentation(code, 4);
});

test('function body', () => {
    const code = `
//// def f():
////     print('hi')
//// [|/*marker*/|]
////
    `;

    testIndentation(code, 4);
});

test('function body - pass', () => {
    const code = `
//// def f():
////     pass
//// [|/*marker*/|]
////
    `;

    testIndentation(code, 0);
});

test('list in dict', () => {
    const code = `
//// abc = {'x': [
//// [|/*marker*/|]
////
    `;

    testIndentation(code, 4);
});

test('nested list in dict', () => {
    const code = `
//// abc = {'x': [
////     ['''str''',
//// [|/*marker*/|]
////
    `;

    testIndentation(code, 4);
});

test('nested list in dict', () => {
    const code = `
//// abc = {'x': [
////     ['''str''',
////      '''str2''']], 
//// [|/*marker*/|]
////
    `;

    testIndentation(code, 5);
});

test('inner function', () => {
    const code = `
//// def f():
////     print 'hi'
////
////     def inner(): pass
//// [|/*marker*/|]
////
    `;

    testIndentation(code, 4);
});

test('dict keys with comment', () => {
    const code = `
//// x = {  #comment
//// [|/*marker*/|]
////
    `;

    testIndentation(code, 4);
});

test('dict first key with list', () => {
    const code = `
//// x = { #comment
////       'a': [
//// [|/*marker*/|]
////
    `;

    testIndentation(code, 6);
});

test('dict key list element on its own line', () => {
    const code = `
//// x = { #comment
////       'a': [
////           1,
//// [|/*marker*/|]
////
    `;

    testIndentation(code, 10);
});

test('dict second key', () => {
    const code = `
//// x = { #comment
////       'a': [
////           1,
////       ],
//// [|/*marker*/|]
////
    `;

    testIndentation(code, 6);
});

test('after dict', () => {
    const code = `
//// x = { #comment
////       'a': [
////           1,
////       ],
////       'b': 42
////     }
////  [|/*marker*/|]
////
    `;

    testIndentation(code, 0);
});

test('explicit multiline expression', () => {
    const code = `
//// def f():
////     assert False, \\
////       [|/*marker*/|]     
////     'A message"
////
    `;

    testIndentation(code, 8);
});

test('explicit multiline expression next statement', () => {
    const code = `
//// def f():
////     assert False, \\
////     'A message"
////     [|/*marker*/|]     
////
    `;

    testIndentation(code, 4);
});

test('nested block first', () => {
    const code = `
//// def a():
////    [|/*marker*/|]
////     if b():
////         if c():
////             d()
////             p
    `;

    testIndentation(code, 4);
});

test('nested block second', () => {
    const code = `
//// def a():
////     if b():
////    [|/*marker*/|]
////         if c():
////             d()
////             p
    `;

    testIndentation(code, 8);
});

test('nested block third', () => {
    const code = `
//// def a():
////     if b():
////         if c():
////    [|/*marker*/|]
////             d()
////             p
    `;

    testIndentation(code, 12);
});

test('nested block last', () => {
    const code = `
//// def a():
////     if b():
////         if c():
////             d()
////    [|/*marker*/|]
////             p
    `;

    testIndentation(code, 12);
});

function testIndentation(code: string, indentation: number, preferDedent?: boolean) {
    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');

    const parseResults = state.program.getBoundSourceFile(marker.fileName)!.getParseResults()!;
    const actual = getIndentation(parseResults, marker.position, preferDedent);
    assert.strictEqual(actual, indentation);
}
