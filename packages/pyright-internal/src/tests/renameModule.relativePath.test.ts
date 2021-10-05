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
//// [|{|"r":"from common.moved import self"|}|]from [|{|"r":".."|}.|] import [|{|"r":""|}self, |]module, foo
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
