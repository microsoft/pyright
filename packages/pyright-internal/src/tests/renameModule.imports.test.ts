/*
 * renameModule.imports.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Tests Program.RenameModule
 */

import { combinePaths, getDirectoryPath } from '../common/pathUtils';
import { parseAndGetTestState } from './harness/fourslash/testState';
import { testRenameModule } from './renameModuleTestUtils';

test('rename just file name', () => {
    const code = `
// @filename: empty.py
//// # empty

// @filename: pathUtils.py
//// def getFilename(path):
////     [|/*marker*/pass|]

// @filename: test1.py
//// import [|pathUtils|] as p
////
//// p.getFilename("c")

// @filename: test2.py
//// import [|pathUtils|]
////
//// [|pathUtils|].getFilename("c")

// @filename: test3.py
//// import [|pathUtils|] as [|pathUtils|], empty
////
//// [|pathUtils|].getFilename("c")
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(
        state,
        fileName,
        `${combinePaths(getDirectoryPath(fileName), 'renamedModule.py')}`,
        'pathUtils',
        'renamedModule'
    );
});

test('import - move file to nested folder', () => {
    const code = `
// @filename: common/__init__.py
//// def foo():
////     pass

// @filename: module.py
//// [|/*marker*/|]
//// # empty

// @filename: test.py
//// import [|{|"r":"common.moduleRenamed as moduleRenamed"|}module|]
////
//// [|{|"r":"moduleRenamed"|}module|].foo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'common', 'moduleRenamed.py')}`);
});

test('import - move file to parent folder', () => {
    const code = `
// @filename: common/__init__.py
//// # empty

// @filename: common/module.py
//// [|/*marker*/|]
//// def foo():
////     pass

// @filename: test.py
//// import [|common.module|]
////
//// [|common.module|].foo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(
        state,
        fileName,
        `${combinePaths(getDirectoryPath(fileName), '..', 'moduleRenamed.py')}`,
        'common.module',
        'moduleRenamed'
    );
});

test('import - move file to sibling folder', () => {
    const code = `
// @filename: common/__init__.py
//// # empty

// @filename: common/module.py
//// [|/*marker*/|]
//// def foo():
////     pass

// @filename: common1/__init__.py
//// # empty

// @filename: test.py
//// import [|common.module|]
////
//// [|common.module|].foo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(
        state,
        fileName,
        `${combinePaths(getDirectoryPath(fileName), '..', 'common1', 'moduleRenamed.py')}`,
        'common.module',
        'common1.moduleRenamed'
    );
});

test('import alias move up file', () => {
    const code = `
// @filename: common/__init__.py
//// def foo():
////     pass

// @filename: module.py
//// [|/*marker*/|]
//// # empty

// @filename: test.py
//// import [|{|"r":"common.moduleRenamed"|}module|] as [|{|"r":"moduleRenamed"|}module|]
////
//// [|{|"r":"moduleRenamed"|}module|].foo()

// @filename: test1.py
//// import [|{|"r":"common.moduleRenamed"|}module|] as m
////
//// m.foo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(
        state,
        fileName,
        `${combinePaths(getDirectoryPath(fileName), 'common', 'moduleRenamed.py')}`,
        'module'
    );
});

test('import alias move down file', () => {
    const code = `
// @filename: common/__init__.py
//// def foo():
////     pass

// @filename: common/module.py
//// [|/*marker*/|]
//// # empty

// @filename: test.py
//// import [|{|"r":"moduleRenamed"|}common.module|] as [|{|"r":"moduleRenamed"|}module|]
////
//// [|{|"r":"moduleRenamed"|}module|].foo()

// @filename: test1.py
//// import [|{|"r":"moduleRenamed"|}common.module|] as m
////
//// m.foo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), '..', 'moduleRenamed.py')}`);
});

test('import alias rename file', () => {
    const code = `
// @filename: module.py
//// [|/*marker*/|]
//// # empty

// @filename: test.py
//// import [|{|"r":"moduleRenamed"|}module|] as [|{|"r":"moduleRenamed"|}module|]
////
//// [|{|"r":"moduleRenamed"|}module|].foo()

// @filename: test1.py
//// import [|{|"r":"moduleRenamed"|}module|] as m
////
//// m.foo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'moduleRenamed.py')}`, 'module');
});

test('import alias move sibling file', () => {
    const code = `
// @filename: common1/__init__.py
//// def foo():
////     pass

// @filename: common2/__init__.py
//// def foo():
////     pass

// @filename: common1/module.py
//// [|/*marker*/|]
//// # empty

// @filename: test.py
//// import [|{|"r":"common2.moduleRenamed"|}common1.module|] as [|{|"r":"moduleRenamed"|}module|]
////
//// [|{|"r":"moduleRenamed"|}module|].foo()

// @filename: test1.py
//// import [|{|"r":"common2.moduleRenamed"|}common1.module|] as m
////
//// m.foo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(
        state,
        fileName,
        `${combinePaths(getDirectoryPath(fileName), '..', 'common2', 'moduleRenamed.py')}`
    );
});

test('re-export import alias through __all__', () => {
    const code = `
// @filename: common1/__init__.py
//// import [|{|"r":"common2.moduleRenamed as moduleRenamed"|}module|]
//// __all__ = ["[|{|"r":"moduleRenamed"|}module|]"]

// @filename: common2/__init__.py
//// def foo():
////     pass

// @filename: module.py
//// [|/*marker*/|]
//// # empty

// @filename: test.py
//// from common1 import [|{|"r":"moduleRenamed"|}module|] as [|{|"r":"moduleRenamed"|}module|]
////
//// [|{|"r":"moduleRenamed"|}module|].foo()

// @filename: test1.py
//// import [|{|"r":"common2.moduleRenamed"|}module|] as m
////
//// m.foo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'common2', 'moduleRenamed.py')}`);
});

test('re-export import alias', () => {
    const code = `
// @filename: common1/__init__.py
//// import [|{|"r":"common2.moduleRenamed"|}module|] as [|{|"r":"moduleRenamed"|}module|]

// @filename: common2/__init__.py
//// def foo():
////     pass

// @filename: module.py
//// [|/*marker*/|]
//// # empty

// @filename: test.py
//// from common1 import [|{|"r":"moduleRenamed"|}module|] as [|{|"r":"moduleRenamed"|}module|]
////
//// [|{|"r":"moduleRenamed"|}module|].foo()

// @filename: test1.py
//// import [|{|"r":"common2.moduleRenamed"|}module|] as m
////
//// m.foo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'common2', 'moduleRenamed.py')}`);
});

test('update module symbol exposed through call 1', () => {
    const code = `
// @filename: lib.py
//// import reexport
////
//// def foo():
////    return reexport

// @filename: reexport.py
//// import [|{|"r":"moduleRenamed"|}module|] as [|{|"r":"moduleRenamed"|}module|]

// @filename: module.py
//// [|/*marker*/|]
//// def foo():
////    pass

// @filename: test.py
//// from lib import foo
////
//// foo().[|{|"r":"moduleRenamed"|}module|].foo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'moduleRenamed.py')}`);
});

test('update module symbol exposed through call 2', () => {
    const code = `
// @filename: lib.py
//// import reexport
////
//// def foo():
////    return reexport

// @filename: reexport.py
//// import [|{|"r":"common.moduleRenamed"|}module|] as [|{|"r":"moduleRenamed"|}module|]

// @filename: module.py
//// [|/*marker*/|]
//// def foo():
////    pass

// @filename: test.py
//// from lib import foo
////
//// foo().[|{|"r":"moduleRenamed"|}module|].foo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'common', 'moduleRenamed.py')}`);
});

test('update module symbol exposed through __all__ 1', () => {
    const code = `
// @filename: lib.py
//// import reexport
////
//// def foo():
////    return reexport

// @filename: reexport.py
//// import [|{|"r":"moduleRenamed"|}module|]
//// __all__ = ["[|{|"r":"moduleRenamed"|}module|]"]

// @filename: module.py
//// [|/*marker*/|]
//// def foo():
////    pass

// @filename: test.py
//// from lib import foo
////
//// foo().[|{|"r":"moduleRenamed"|}module|].foo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'moduleRenamed.py')}`);
});

test('update module symbol exposed through __all__ 2', () => {
    const code = `
// @filename: lib.py
//// import reexport
////
//// def foo():
////    return reexport

// @filename: reexport.py
//// import [|{|"r":"common.moduleRenamed as moduleRenamed"|}module|]
//// __all__ = ["[|{|"r":"moduleRenamed"|}module|]"]

// @filename: module.py
//// [|/*marker*/|]
//// def foo():
////    pass

// @filename: test.py
//// from lib import foo
////
//// foo().[|{|"r":"moduleRenamed"|}module|].foo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'common', 'moduleRenamed.py')}`);
});

test('update module symbol exposed through __all__ 3', () => {
    const code = `
// @filename: lib.py
//// import reexport
////
//// def foo():
////    return reexport

// @filename: reexport.py
//// import [|{|"r":"moduleRenamed"|}common.module|] as [|{|"r":"moduleRenamed"|}module|]
//// __all__ = ["[|{|"r":"moduleRenamed"|}module|]"]

// @filename: common/module.py
//// [|/*marker*/|]
//// def foo():
////    pass

// @filename: test.py
//// from lib import foo
////
//// foo().[|{|"r":"moduleRenamed"|}module|].foo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), '..', 'moduleRenamed.py')}`);
});
