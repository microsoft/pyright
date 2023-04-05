/*
 * moveSymbol.trivia.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Tests around how moveSymbol handles whitespace/blank lines/comments around
 * symbol that is moved.
 */

import assert from 'assert';
import { CancellationToken } from 'vscode-languageserver';

import { ImportFormat } from '../languageService/autoImporter';
import { parseAndGetTestState } from './harness/fourslash/testState';
import { testMoveSymbolAtPosition } from './renameModuleTestUtils';

test('single symbol with trailing whitespace', () => {
    const code = `
// @filename: test.py
//// [|{|"r":""|}def [|/*marker*/foo|](): 
////     pass
//// |]
////

// @filename: moved.py
//// [|{|"r":"def foo():!n!    pass", "name": "dest"|}|]
        `;

    testFromCode(code);
});

test('begining of a file with other symbols below', () => {
    const code = `
// @filename: test.py
//// [|{|"r":""|}def [|/*marker*/foo|](): 
////     pass
////
//// |]def nextFoo():
////     pass

// @filename: moved.py
//// [|{|"r":"def foo():!n!    pass", "name": "dest"|}|]
        `;

    testFromCode(code);
});

test('at the end of a file with other symbols above', () => {
    const code = `
// @filename: test.py
//// def beforeFoo():
////     pass
//// 
//// [|{|"r":""|}def [|/*marker*/foo|](): 
////     pass|]

// @filename: moved.py
//// [|{|"r":"def foo():!n!    pass", "name": "dest"|}|]
        `;

    testFromCode(code);
});

test('between symbols', () => {
    const code = `
// @filename: test.py
//// def beforeFoo():
////     pass
//// 
//// [|{|"r":""|}def [|/*marker*/foo|](): 
////     pass
////
////
//// |]def afterFoo():
////     pass
//// 

// @filename: moved.py
//// [|{|"r":"def foo():!n!    pass", "name": "dest"|}|]
        `;

    testFromCode(code);
});

test('insert to empty file', () => {
    const code = `
// @filename: test.py
//// [|{|"r":""|}def [|/*marker*/foo|](): 
////     pass|]

// @filename: moved.py
//// [|{|"r":"def foo():!n!    pass", "name": "dest"|}|]
        `;

    testFromCode(code);
});

test('insert to empty file with blank lines', () => {
    const code = `
// @filename: test.py
//// [|{|"r":""|}def [|/*marker*/foo|](): 
////     pass|]

// @filename: moved.py
//// [|{|"r":"def foo():!n!    pass", "name": "dest"|}|]
////
////
        `;

    testFromCode(code);
});

test('insert to empty file with comments', () => {
    const code = `
// @filename: test.py
//// [|{|"r":""|}def [|/*marker*/foo|](): 
////     pass|]

// @filename: moved.py
//// # comment
//// [|{|"r":"!n!!n!!n!def foo():!n!    pass", "name": "dest"|}|]
        `;

    testFromCode(code);
});

test('insert to empty file with comments and blank lines', () => {
    const code = `
// @filename: test.py
//// [|{|"r":""|}def [|/*marker*/foo|](): 
////     pass|]

// @filename: moved.py
//// # comment
//// [|{|"r":"!n!!n!def foo():!n!    pass", "name": "dest"|}|]
//// 
        `;

    testFromCode(code);
});

test('insert after other symbol', () => {
    const code = `
// @filename: test.py
//// [|{|"r":""|}def [|/*marker*/foo|](): 
////     pass|]

// @filename: moved.py
//// def beforeFoo():
////     pass[|{|"r":"!n!!n!!n!def foo():!n!    pass", "name": "dest"|}|]
        `;

    testFromCode(code);
});

test('insert between symbols', () => {
    const code = `
// @filename: test.py
//// [|{|"r":""|}def [|/*marker*/foo|](): 
////     pass|]

// @filename: moved.py
//// def beforeFoo():
////     pass[|{|"r":"!n!!n!!n!def foo():!n!    pass", "name": "dest"|}|]
////
//// def __privateFunc():
////     pass
        `;

    testFromCode(code);
});

test('no insert with conflicting name', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): 
////     pass

// @filename: moved.py
//// # same name already exist
//// [|/*dest*/|]
//// def foo():
////     pass
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

test('insert to a file with same symbol imported without alias', () => {
    const code = `
// @filename: test.py
//// [|{|"r":""|}def [|/*marker*/foo|](): 
////     pass|]

// @filename: moved.py
//// [|{|"r":""|}from test import foo
//// |]import os[|{|"r":"!n!!n!!n!def foo():!n!    pass", "name": "dest"|}|]
        `;

    testFromCode(code);
});

test('insert to a file with same symbol imported with multiple symbol imports', () => {
    const code = `
// @filename: test.py
//// [|{|"r":""|}def [|/*marker*/foo|](): 
////     pass
//// 
//// |]def bar():
////     pass

// @filename: moved.py
//// from test import bar[|{|"r":""|}, foo|][|{|"r":"!n!!n!!n!def foo():!n!    pass", "name": "dest"|}|]
        `;

    testFromCode(code);
});

test('insert to a file with same symbol used off import', () => {
    const code = `
// @filename: test.py
//// [|{|"r":""|}def [|/*marker*/foo|]():
////     pass|]

// @filename: moved.py
//// [|{|"r":""|}import test
//// |]import os[|{|"r":"!n!!n!!n!def foo():!n!    pass", "name": "dest"|}|]
////
//// [|{|"r":""|}test.|]foo()
        `;

    testFromCode(code);
});

test('insert to a file with same symbol used off import with edit merge', () => {
    const code = `
// @filename: test.py
//// [|{|"r":""|}def [|/*marker*/foo|]():
////     pass|]

// @filename: moved.py
//// [|{|"r":""|}import test[|{|"r":"!n!!n!!n!def foo():!n!    pass", "name": "dest"|}|]
//// |]
////
//// [|{|"r":""|}test.|]foo()
        `;

    testFromCode(code);
});

test('insert to a file with same symbol used off import with alias', () => {
    const code = `
// @filename: test.py
//// [|{|"r":""|}def [|/*marker*/foo|]():
////     pass|]

// @filename: moved.py
//// [|{|"r":""|}import test as t
//// |]import os[|{|"r":"!n!!n!!n!def foo():!n!    pass", "name": "dest"|}|]
////
//// [|{|"r":""|}t.|]foo()

        `;
    testFromCode(code);
});

test('insert to a file with same symbol used off import with other symbols', () => {
    const code = `
// @filename: test.py
//// [|{|"r":""|}def [|/*marker*/foo|]():
////     pass
////
//// |]def bar():
////     pass

// @filename: moved.py
//// import test[|{|"r":"!n!!n!!n!def foo():!n!    pass", "name": "dest"|}|]
////
//// [|{|"r":""|}test.|]foo()
//// test.bar()
        `;

    testFromCode(code);
});

test('insert to a file with same symbol used off from import', () => {
    const code = `
// @filename: test.py
//// [|{|"r":""|}def [|/*marker*/foo|]():
////     pass|]

// @filename: moved.py
//// [|{|"r":""|}from . import test
//// |]import os[|{|"r":"!n!!n!!n!def foo():!n!    pass", "name": "dest"|}|]
////
//// [|{|"r":""|}test.|]foo()
        `;

    testFromCode(code);
});

test('insert to a file with same symbol imported with alias', () => {
    const code = `
// @filename: test.py
//// [|{|"r":""|}def [|/*marker*/foo|]():
////     pass|]

// @filename: moved.py
//// [|{|"r":""|}from test import foo as aliasFoo
//// |]
//// aliasFoo()[|{|"r":"!n!!n!def foo():!n!    pass", "name": "dest"|}|]
        `;

    testFromCode(code);
});

test('insert to a file with same symbol imported and used', () => {
    const code = `
// @filename: test.py
//// [|{|"r":""|}def [|/*marker*/foo|]():
////     pass|]

// @filename: moved.py
//// [|{|"r":""|}from test import foo
//// |]import os[|{|"r":"!n!!n!!n!def foo():!n!    pass", "name": "dest"|}|]
////
//// foo()
        `;

    testFromCode(code);
});

test('insert to a file with same symbol used off import with alias and used', () => {
    const code = `
// @filename: test.py
//// [|{|"r":""|}def [|/*marker*/foo|]():
////     pass
//// |]def bar():
////     pass

// @filename: moved.py
//// import test as t[|{|"r":"!n!!n!!n!def foo():!n!    pass", "name": "dest"|}|]
////
//// [|{|"r":""|}t.|]foo()
//// t.bar()
        `;

    testFromCode(code);
});

test('insert import to original file for usage', () => {
    const code = `
// @filename: test.py
//// [|{|"r":"from moved import foo!n!!n!!n!"|}|][|{|"r":""|}def [|/*marker*/foo|]():
////     pass
//// |]foo()

// @filename: moved.py
//// [|{|"r":"def foo():!n!    pass", "name": "dest"|}|]
        `;

    testFromCode(code);
});

test('insert import name to the existing import in the original file for usage', () => {
    const code = `
// @filename: test.py
//// from moved import bar[|{|"r":", foo"|}|]
////
//// [|{|"r":""|}def [|/*marker*/foo|]():
////     pass
//// |]foo()

// @filename: moved.py
//// def bar():
////     pass[|{|"r":"!n!!n!!n!def foo():!n!    pass", "name": "dest"|}|]
        `;

    testFromCode(code);
});

test('original file has import for the symbol with alias', () => {
    const code = `
// @filename: test.py
//// from [|{|"r": "moved"|}test|] import foo as aliasFoo
////
//// aliasFoo()
////
//// [|{|"r":""|}def [|/*marker*/foo|]():
////     pass
//// |]

// @filename: moved.py
//// [|{|"r":"def foo():!n!    pass", "name": "dest"|}|]
        `;

    testFromCode(code);
});

test('move after class', () => {
    const code = `
// @filename: test.py
//// [|{|"r":""|}def [|/*marker*/foo|]():
////     pass
//// |]

// @filename: moved.py
//// class A:
////     def foo(self):
////         pass[|{|"r":"!n!!n!!n!def foo():!n!    pass", "name": "dest"|}|]
        `;

    testFromCode(code);
});

test('move variable', () => {
    const code = `
// @filename: test.py
//// [|{|"r":""|}[|/*marker*/A|] = 1|]

// @filename: moved.py
//// [|{|"r":"A = 1", "name": "dest"|}|]
        `;

    testFromCode(code);
});

test('move variable with doc string', () => {
    const code = `
// @filename: test.py
//// [|{|"r":""|}[|/*marker*/A|] = 1
//// '''
////     doc string
//// '''|]

// @filename: moved.py
//// [|{|"r":"A = 1!n!'''!n!    doc string!n!'''", "name": "dest"|}|]
        `;

    testFromCode(code);
});

test('move a variable with another variable next line', () => {
    const code = `
// @filename: test.py
//// [|{|"r":"!n!guess_word = 'c'"|}import random
//// 
//// [|/*marker*/answer_word|] = random.choice(['a','b','c','d'])
//// guess_word = 'c'|]

// @filename: moved.py
//// [|{|"r":"import random!n!!n!!n!answer_word = random.choice(['a','b','c','d'])", "name": "dest"|}|]
    `;

    testFromCode(code);
});

test('Handle comments at the begining better 1', () => {
    const code = `
// @filename: test.py
//// # this function doesn't do much
//// [|{|"r":""|}def [|/*marker*/myfunc|](a, b):
////     return a + b|]

// @filename: moved.py
//// [|{|"r":"def myfunc(a, b):!n!    return a + b", "name": "dest"|}|]
    `;

    testFromCode(code);
});

test('Handle comments at the begining better 2', () => {
    const code = `
// @filename: test.py
//// import os
////
//// [|{|"r":""|}# this function doesn't do much
//// def [|/*marker*/myfunc|](a, b):
////     return a + b|]

// @filename: moved.py
//// [|{|"r":"# this function doesn't do much!n!def myfunc(a, b):!n!    return a + b", "name": "dest"|}|]
    `;

    testFromCode(code);
});

test('variable with multiline expression', () => {
    const code = `
// @filename: test.py
//// [|{|"r":"!n!"|}from functools import partial
//// 
//// [|/*marker*/sum1_2|] = partial(sum, 
//// [1, 
//// 2]
//// )|]

// @filename: moved.py
//// [|{|"r":"from functools import partial!n!!n!!n!sum1_2 = partial(sum,!n![1,!n!2]!n!)", "name": "dest"|}|]
    `;

    testFromCode(code);
});

test('multiple variables in a single line 1', () => {
    const code = `
// @filename: test.py
//// [|{|"r":""|}[|/*marker*/a|] = 1; |]b = 1

// @filename: moved.py
//// [|{|"r":"a = 1;", "name": "dest"|}|]
    `;

    testFromCode(code);
});

test('multiple variables in a single line 2', () => {
    const code = `
// @filename: test.py
//// a = 1;[|{|"r":""|}[|/*marker*/b|] = 2|]

// @filename: moved.py
//// [|{|"r":"b = 2", "name": "dest"|}|]
    `;

    testFromCode(code);
});

test('multiple variables in multiple lines 1', () => {
    const code = `
// @filename: test.py
//// [|{|"r":""|}[|/*marker*/a|] = \\
////     1 + 2; |]b = 3 + \\
////                4 

// @filename: moved.py
//// [|{|"r":"a = \\\\!n!    1 + 2;", "name": "dest"|}|]
    `;

    testFromCode(code);
});

test('multiple variables in multiple lines 2', () => {
    const code = `
// @filename: test.py
//// a = \\
////     1 + 2; [|{|"r":""|}[|/*marker*/b|] = 3 + \\
////                4|]

// @filename: moved.py
//// [|{|"r":"b = 3 + \\\\!n!    4", "name": "dest"|}|]
    `;

    testFromCode(code);
});

test('insert after comment', () => {
    const code = `
// @filename: test.py
//// [|{|"r":""|}[|/*marker*/b|] = 3|]

// @filename: moved.py
//// a = 1 # type: ignore[|{|"r":"!n!!n!!n!b = 3", "name": "dest"|}|]
    `;

    testFromCode(code);
});

test('keep comments', () => {
    const code = `
// @filename: test.py
//// [|{|"r":""|}def [|/*marker*/test|]():
////     return # comment|]

// @filename: moved.py
//// [|{|"r":"def test():!n!    return # comment", "name": "dest"|}|]
    `;

    testFromCode(code);
});

function testFromCode(code: string) {
    const state = parseAndGetTestState(code).state;

    testMoveSymbolAtPosition(
        state,
        state.getMarkerByName('marker').fileName,
        state.getMarkerByName('dest').fileName,
        state.getPositionRange('marker').start
    );
}
