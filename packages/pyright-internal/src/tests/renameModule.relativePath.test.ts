/*
 * renameModule.misc.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Tests Program.RenameModule
 */

import { combinePaths, getDirectoryPath } from '../common/pathUtils';
import { parseAndGetTestState } from './harness/fourslash/testState';
import { testRenameModule } from './renameModuleTestUtils';

test('relative path for self', () => {
    const code = `
// @filename: self.py
//// from .self import foo
//// def foo():
////     [|/*marker*/pass|]
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'moved', 'self.py')}`);
});

test('relative path for self - different name', () => {
    const code = `
// @filename: self.py
//// from [|{|"r":".renamedModule"|}.self|] import foo
//// def foo():
////     [|/*marker*/pass|]
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'moved', 'renamedModule.py')}`);
});

test('relative path for self - __init__', () => {
    const code = `
// @filename: common/__init__.py
//// from . import foo
//// def foo():
////     [|/*marker*/pass|]
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'moved', '__init__.py')}`);
});

test('relative path for self - __init__ different name', () => {
    const code = `
// @filename: common/__init__.py
//// from [|{|"r":".renamedModule"|}.|] import foo
//// def foo():
////     [|/*marker*/pass|]
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'moved', 'renamedModule.py')}`);
});

test('relative path for self - __init__ folder name', () => {
    const code = `
// @filename: common/__init__.py
//// from [|{|"r":"."|}..common|] import foo
//// def foo():
////     [|/*marker*/pass|]
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'moved', '__init__.py')}`);
});

test('relative path for self - __init__ different folder name', () => {
    const code = `
// @filename: common/__init__.py
//// from [|{|"r":".renamedModule"|}..common|] import foo
//// def foo():
////     [|/*marker*/pass|]
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'moved', 'renamedModule.py')}`);
});

test('relative path for self - import name', () => {
    const code = `
// @filename: self.py
//// from . import self
//// [|/*marker*/|]
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'moved', 'self.py')}`);
});

test('relative path for modules', () => {
    const code = `
// @filename: self.py
//// from [|{|"r":".."|}.|] import module
//// [|/*marker*/|]

// @filename: module.py
//// # empty
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'moved', 'self.py')}`);
});

test('relative path to self with multiple import names', () => {
    const code = `
// @filename: common/self.py
//// [|{|"r":"from . import self!n!"|}|]from [|{|"r":".."|}.|] import [|{|"r":""|}self, |]module, foo
//// [|/*marker*/|]

// @filename: common/module.py
//// # empty

// @filename: common/__init__.py
//// def foo():
////     pass

    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'moved', 'self.py')}`);
});

test('relative path to module - move up', () => {
    const code = `
// @filename: common/test.py
//// from [|{|"r":"...sub.foo"|}..sub.foo|] import bar
//// [|/*marker*/|]

// @filename: sub/foo.py
//// def bar():
////     pass

// @filename: sub/__init__.py
//// # empty
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'moved', 'self.py')}`);
});

test('relative path to module - move down', () => {
    const code = `
// @filename: common/test.py
//// from [|{|"r":".sub.foo"|}..sub.foo|] import bar
//// [|/*marker*/|]

// @filename: sub/foo.py
//// def bar():
////     pass

// @filename: sub/__init__.py
//// # empty
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), '..', 'self.py')}`);
});

test('relative path to module - sibling', () => {
    const code = `
// @filename: common/test.py
//// from ..sub.foo import bar
//// [|/*marker*/|]

// @filename: sub/foo.py
//// def bar():
////     pass

// @filename: sub/__init__.py
//// # empty
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), '..', 'moved', 'self.py')}`);
});

test('relative path to self __init__ with sub modules and symbol with dots', () => {
    const code = `
// @filename: common/__init__.py
//// [|{|"r":"from .self import bar!n!"|}|]from [|{|"r":".."|}.|] import module[|{|"r":""|}, bar|]
//// [|/*marker*/|]
//// def bar():
////     pass

// @filename: common/module.py
//// # empty
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'moved', 'self.py')}`);
});

test('relative path to self __init__ with sub modules and symbol with dotted name', () => {
    const code = `
// @filename: common/__init__.py
//// [|{|"r":"from common.moved.self import bar!n!"|}|]from [|{|"r":".."|}..common|] import module[|{|"r":""|}, bar|]
//// [|/*marker*/|]
//// def bar():
////     pass

// @filename: common/module.py
//// # empty
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'moved', 'self.py')}`);
});

test('relative path to self __init__ with sub modules and symbol with dots to __init__', () => {
    const code = `
// @filename: common/__init__.py
//// [|{|"r":"from . import bar!n!"|}|]from [|{|"r":".."|}.|] import module[|{|"r":""|}, bar|]
//// [|/*marker*/|]
//// def bar():
////     pass

// @filename: common/module.py
//// # empty
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'moved', '__init__.py')}`);
});

test('relative path to self __init__ with sub modules and symbol with dotted name to __init__', () => {
    const code = `
// @filename: common/__init__.py
//// [|{|"r":"from common.moved import bar!n!"|}|]from [|{|"r":".."|}..common|] import module[|{|"r":""|}, bar|]
//// [|/*marker*/|]
//// def bar():
////     pass

// @filename: common/module.py
//// # empty
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'moved', '__init__.py')}`);
});
