/*
 * moveSymbolAtPosition.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Tests Program.moveSymbol
 */

import { parseAndGetTestState } from './harness/fourslash/testState';
import { testMoveSymbolAtPosition } from './renameModuleTestUtils';

test('move symbol to another file - simple from import', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// from [|{|"r":"moved"|}test|] import foo
        `;

    testFromCode(code);
});

test('move symbol to another file - nested file', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass

// @filename: nested/moved.py
//// [|/*dest*/|]

// @filename: used.py
//// from [|{|"r":"nested.moved"|}test|] import foo
        `;

    testFromCode(code);
});

test('move symbol to another file - parent file', () => {
    const code = `
// @filename: nested/test.py
//// def [|/*marker*/foo|](): pass

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// from [|{|"r":"moved"|}nested.test|] import foo
        `;

    testFromCode(code);
});

test('move symbol to another file - multiple import', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass
////
//// def stay(): pass

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// [|{|"r":"from moved import foo!n!"|}|]from test import [|{|"r":""|}foo, |]stay
        `;

    testFromCode(code);
});

test('move symbol to another file - multiple import with submodules', () => {
    const code = `
// @filename: nested/__init__.py
//// def [|/*marker*/foo|](): pass

// @filename: nested/test.py
//// # empty

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// [|{|"r":"from moved import foo!n!"|}|]from nested import [|{|"r":""|}foo, |]test
        `;

    testFromCode(code);
});

test('move symbol to another file - no merge with existing imports', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass

// @filename: moved.py
//// [|/*dest*/|]
//// def stay(): pass

// @filename: used.py
//// from [|{|"r":"moved"|}test|] import foo
//// from moved import stay
            `;

    testFromCode(code);
});

test('move symbol to another file - merge with existing imports', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass
//// def bar(): pass

// @filename: moved.py
//// [|/*dest*/|]
//// def stay(): pass

// @filename: used.py
//// from test import bar[|{|"r":""|}, foo|]
//// from moved import [|{|"r":"foo, "|}|]stay
            `;

    testFromCode(code);
});

test('move symbol to another file - multiple import - nested folder', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass
////
//// def stay(): pass

// @filename: nested/moved.py
//// [|/*dest*/|]

// @filename: used.py
//// [|{|"r":"from nested.moved import foo!n!"|}|]from test import [|{|"r":""|}foo, |]stay
        `;

    testFromCode(code);
});

test('move symbol to another file - multiple import with submodules - parent folder', () => {
    const code = `
// @filename: nested/__init__.py
//// def [|/*marker*/foo|](): pass

// @filename: nested/test.py
//// # empty

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// [|{|"r":"from moved import foo!n!"|}|]from nested import [|{|"r":""|}foo, |]test
        `;

    testFromCode(code);
});

test('move symbol to another file - no merge with existing imports - nested folder', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass

// @filename: nested/moved.py
//// [|/*dest*/|]
//// def stay(): pass

// @filename: used.py
//// from [|{|"r":"nested.moved"|}test|] import foo
//// from nested.moved import stay
            `;

    testFromCode(code);
});

test('move symbol to another file - merge with existing imports - nested folder', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass
//// def bar(): pass

// @filename: nested/moved.py
//// [|/*dest*/|]
//// def stay(): pass

// @filename: used.py
//// from test import bar[|{|"r":""|}, foo|]
//// from nested.moved import [|{|"r":"foo, "|}|]stay
            `;

    testFromCode(code);
});

test('move symbol to another file - multiple import - parent folder', () => {
    const code = `
// @filename: nested/test.py
//// def [|/*marker*/foo|](): pass
////
//// def stay(): pass

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// [|{|"r":"from moved import foo!n!"|}|]from nested.test import [|{|"r":""|}foo, |]stay
        `;

    testFromCode(code);
});

test('move symbol to another file - multiple import with submodules - sibling folder', () => {
    const code = `
// @filename: nested/__init__.py
//// def [|/*marker*/foo|](): pass

// @filename: nested/test.py
//// # empty

// @filename: nested/moved.py
//// [|/*dest*/|]

// @filename: used.py
//// from nested import [|{|"r":""|}foo, |]test[|{|"r":"!n!from nested.moved import foo"|}|]
        `;

    testFromCode(code);
});

test('move symbol to another file - no merge with existing imports - parent folder', () => {
    const code = `
// @filename: nested/test.py
//// def [|/*marker*/foo|](): pass

// @filename: moved.py
//// [|/*dest*/|]
//// def stay(): pass

// @filename: used.py
//// from [|{|"r":"moved"|}nested.test|] import foo
//// from moved import stay
            `;

    testFromCode(code);
});

test('move symbol to another file - merge with existing imports - parent folder', () => {
    const code = `
// @filename: nested/test.py
//// def [|/*marker*/foo|](): pass
//// def bar(): pass

// @filename: moved.py
//// [|/*dest*/|]
//// def stay(): pass

// @filename: used.py
//// from nested.test import bar[|{|"r":""|}, foo|]
//// from moved import [|{|"r":"foo, "|}|]stay
            `;

    testFromCode(code);
});

test('move symbol to another file - simple from import - relative path', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// from [|{|"r":".moved"|}.test|] import foo
        `;

    testFromCode(code);
});

test('move symbol to another file - nested file - relative path', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass

// @filename: nested/moved.py
//// [|/*dest*/|]

// @filename: nested/used.py
//// from [|{|"r":".moved"|}..test|] import foo
        `;

    testFromCode(code);
});

test('move symbol to another file - parent file - relative path', () => {
    const code = `
// @filename: nested/test.py
//// def [|/*marker*/foo|](): pass

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// from [|{|"r":".moved"|}.nested.test|] import foo
        `;

    testFromCode(code);
});

test('move symbol to another file - multiple import - relative path', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass
////
//// def stay(): pass

// @filename: moved.py
//// [|/*dest*/|]

// @filename: nested/used.py
//// [|{|"r":"from ..moved import foo!n!"|}|]from ..test import [|{|"r":""|}foo, |]stay
        `;

    testFromCode(code);
});

test('move symbol to another file - multiple import with submodules - relative path', () => {
    const code = `
// @filename: nested/__init__.py
//// def [|/*marker*/foo|](): pass

// @filename: nested/test.py
//// # empty

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// [|{|"r":"from .moved import foo!n!"|}|]from .nested import [|{|"r":""|}foo, |]test
        `;

    testFromCode(code);
});

test('move symbol to another file - no merge with existing imports - relative path', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass

// @filename: moved.py
//// [|/*dest*/|]
//// def stay(): pass

// @filename: used.py
//// from [|{|"r":".moved"|}.test|] import foo
//// from moved import stay
            `;

    testFromCode(code);
});

test('move symbol to another file - merge with existing imports - relative path', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass
//// def bar(): pass

// @filename: moved.py
//// [|/*dest*/|]
//// def stay(): pass

// @filename: used.py
//// from .test import bar[|{|"r":""|}, foo|]
//// from .moved import [|{|"r":"foo, "|}|]stay
            `;

    testFromCode(code);
});

test('member off import', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// import [|{|"r":"moved"|}test|]
//// [|{|"r":"moved"|}test|].foo()
            `;

    testFromCode(code);
});

test('member off import with existing import', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// [|{|"r":""|}import test
//// |]import moved
//// [|{|"r":"moved"|}test|].foo()
            `;

    testFromCode(code);
});

test('member off import with existing import with alias', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// [|{|"r":""|}import test
//// |]import moved as m
//// [|{|"r":"m"|}test|].foo()
            `;

    testFromCode(code);
});

test('member off import with existing import - multiple imports', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// import moved[|{|"r":""|}, test|]
//// [|{|"r":"moved"|}test|].foo()
            `;

    testFromCode(code);
});

test('member off import with existing import - multiple imports with alias', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// import moved as m[|{|"r":""|}, test|]
//// [|{|"r":"m"|}test|].foo()
            `;

    testFromCode(code);
});

test('member off from import with existing import', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// [|{|"r":""|}from . import test
//// |]import moved
//// [|{|"r":"moved"|}test|].foo()
            `;

    testFromCode(code);
});

test('member off from import with existing import with alias', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// [|{|"r":""|}from . import test
//// |]import moved as m
//// [|{|"r":"m"|}test|].foo()
            `;

    testFromCode(code);
});

test('member off from import with existing from import', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// [|{|"r":""|}from . import test
//// |]from . import moved
//// [|{|"r":"moved"|}test|].foo()
            `;

    testFromCode(code);
});

test('member off from import with existing from import with alias', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// [|{|"r":""|}from . import test
//// |]from . import moved as m
//// [|{|"r":"m"|}test|].foo()
            `;

    testFromCode(code);
});

test('member off from import with existing import - multiple imports', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// from . import moved[|{|"r":""|}, test|]
//// [|{|"r":"moved"|}test|].foo()
            `;

    testFromCode(code);
});

test('member off from import with existing import - multiple imports with alias', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// from . import moved as m[|{|"r":""|}, test|]
//// [|{|"r":"m"|}test|].foo()
            `;

    testFromCode(code);
});

test('member off submodule', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// from . import [|{|"r":"moved"|}test|]
//// [|{|"r":"moved"|}test|].foo()
            `;

    testFromCode(code);
});

test('member off import - dotted name', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass

// @filename: nested/moved.py
//// [|/*dest*/|]

// @filename: used.py
//// import [|{|"r":"nested.moved"|}test|]
//// [|{|"r":"nested.moved"|}test|].foo()
            `;

    testFromCode(code);
});

test('member off submodule - dotted name', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass

// @filename: nested/moved.py
//// [|/*dest*/|]

// @filename: used.py
//// from [|{|"r":".nested"|}.|] import [|{|"r":"moved"|}test|]
//// [|{|"r":"moved"|}test|].foo()
            `;

    testFromCode(code);
});

test('member off import with alias', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// import [|{|"r":"moved"|}test|] as t
//// t.foo()
            `;

    testFromCode(code);
});

test('member off submodule with alias', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// from . import [|{|"r":"moved"|}test|] as test
//// test.foo()
            `;

    testFromCode(code);
});

test('member off import with alias - dotted name', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass

// @filename: nested/moved.py
//// [|/*dest*/|]

// @filename: used.py
//// import [|{|"r":"nested.moved"|}test|] as t
//// t.foo()
            `;

    testFromCode(code);
});

test('member off submodule with alias - dotted name', () => {
    const code = `
// @filename: nested/test.py
//// def [|/*marker*/foo|](): pass

// @filename: sub/moved.py
//// [|/*dest*/|]

// @filename: used.py
//// from [|{|"r":"sub"|}nested|] import [|{|"r":"moved"|}test|] as test
//// test.foo()
            `;

    testFromCode(code);
});

test('member off import - multiple symbols', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass
//// def bar(): pass

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// [|{|"r":"import moved!n!"|}|]import test
//// [|{|"r":"moved"|}test|].foo()
//// test.bar()
            `;

    testFromCode(code);
});

test('member off import - multiple symbols - existing import', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass
//// def bar(): pass

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// import moved
//// import test
////
//// [|{|"r":"moved"|}test|].foo()
//// test.bar()
            `;

    testFromCode(code);
});

test('member off import - multiple symbols - existing import with alias', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass
//// def bar(): pass

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// import moved as m
//// import test
////
//// [|{|"r":"m"|}test|].foo()
//// test.bar()
            `;

    testFromCode(code);
});

test('member off import - multiple symbols with alias - existing import', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass
//// def bar(): pass

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// import moved
//// import test as t
////
//// [|{|"r":"moved"|}t|].foo()
//// t.bar()
            `;

    testFromCode(code);
});

test('member off import - multiple symbols with alias - new import', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass
//// def bar(): pass

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// [|{|"r":"import moved!n!"|}|]import test as t
////
//// [|{|"r":"moved"|}t|].foo()
//// t.bar()
            `;

    testFromCode(code);
});

test('member off import - multiple symbols with alias - existing import with alias', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass
//// def bar(): pass

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// import moved as m
//// import test as t
////
//// [|{|"r":"m"|}t|].foo()
//// t.bar()
            `;

    testFromCode(code);
});

test('member off import - multiple symbols - existing from import', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass
//// def bar(): pass

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// from . import moved
//// import test
////
//// [|{|"r":"moved"|}test|].foo()
//// test.bar()
            `;

    testFromCode(code);
});

test('member off import - multiple symbols - existing from import with alias', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass
//// def bar(): pass

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// from . import moved as m
//// import test
////
//// [|{|"r":"m"|}test|].foo()
//// test.bar()
            `;

    testFromCode(code);
});

test('member off import - multiple symbols - existing from import', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass
//// def bar(): pass

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// from . import moved
//// import test
////
//// [|{|"r":"moved"|}test|].foo()
//// test.bar()
            `;

    testFromCode(code);
});

test('member off import - multiple symbols - existing from import with alias', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass
//// def bar(): pass

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// from . import moved as m
//// import test
////
//// [|{|"r":"m"|}test|].foo()
//// test.bar()
            `;

    testFromCode(code);
});

test('member off from import - multiple symbols', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass
//// def bar(): pass

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// [|{|"r":"import moved!n!"|}|]from . import test
//// [|{|"r":"moved"|}test|].foo()
//// test.bar()
            `;

    testFromCode(code);
});

test('member off from import - multiple symbols - existing import', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass
//// def bar(): pass

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// import moved
//// from . import test
////
//// [|{|"r":"moved"|}test|].foo()
//// test.bar()
            `;

    testFromCode(code);
});

test('member off from import - multiple symbols - existing import with alias', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass
//// def bar(): pass

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// import moved as m
//// from . import test
////
//// [|{|"r":"m"|}test|].foo()
//// test.bar()
            `;

    testFromCode(code);
});

test('member off from import - multiple symbols with alias - existing import', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass
//// def bar(): pass

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// import moved
//// from . import test as t
////
//// [|{|"r":"moved"|}t|].foo()
//// t.bar()
            `;

    testFromCode(code);
});

test('member off from import - multiple symbols with alias - new import', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass
//// def bar(): pass

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// [|{|"r":"import moved!n!"|}|]from . import test as t
////
//// [|{|"r":"moved"|}t|].foo()
//// t.bar()
            `;

    testFromCode(code);
});

test('member off from import - multiple symbols with alias - existing import with alias', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass
//// def bar(): pass

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// import moved as m
//// from . import test as t
////
//// [|{|"r":"m"|}t|].foo()
//// t.bar()
            `;

    testFromCode(code);
});

test('member off from import - multiple symbols - existing from import', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass
//// def bar(): pass

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// from . import moved
//// from . import test
////
//// [|{|"r":"moved"|}test|].foo()
//// test.bar()
            `;

    testFromCode(code);
});

test('member off from import - multiple symbols - existing from import with alias', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass
//// def bar(): pass

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// from . import moved as m
//// from . import test
////
//// [|{|"r":"m"|}test|].foo()
//// test.bar()
            `;

    testFromCode(code);
});

test('member off import - error case that we dont touch - function return module', () => {
    // We could put import in test so test module still has symbol "foo" but
    // for now, we won't handle such corner case.
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass

// @filename: test2.py
//// def foo(): pass

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// from test
//// from test2
//// def getTestModule(a):
////     return test if a > 0 else test2
////
//// getTestModule(1).foo()
            `;

    testFromCode(code);
});

test('member off import - error case that we dont touch - field return module', () => {
    // We could put import in test so test module still has symbol "foo" but
    // for now, we won't handle such corner case.
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|](): pass

// @filename: test2.py
//// def foo(): pass

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// from test
//// from test2
//// module = test if a > 0 else test2
////
//// module.foo()
            `;

    testFromCode(code);
});

test('simple symbol reference', () => {
    const code = `
// @filename: test.py
//// def [|/*marker*/foo|]():
////     return 1

// @filename: moved.py
//// [|/*dest*/|]

// @filename: used.py
//// from [|{|"r":"moved"|}test|] import foo
////
//// foo()
//// b = foo().real
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
