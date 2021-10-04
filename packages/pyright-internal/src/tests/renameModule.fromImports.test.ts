/*
 * renameModule.fromImports.test.ts
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
// @filename: common/__init__.py
//// from io2 import tools
//// from io2.tools import [|{|"r":"renamedModule"|}pathUtils|] as [|{|"r":"renamedModule"|}pathUtils|]

// @filename: io2/__init__.py
//// # empty

// @filename: io2/tools/__init__.py
//// # empty

// @filename: io2/tools/empty.py
//// # empty

// @filename: io2/tools/pathUtils.py
//// def getFilename(path):
////     [|/*marker*/pass|]

// @filename: test1.py
//// from common import *
////
//// [|{|"r":"renamedModule"|}pathUtils|].getFilename("c")

// @filename: test3.py
//// from .io2.tools import [|{|"r":"renamedModule"|}pathUtils|] as p
////
//// p.getFilename("c")

// @filename: test4.py
//// from common import tools, [|{|"r":"renamedModule"|}pathUtils|]
////
//// [|{|"r":"renamedModule"|}pathUtils|].getFilename("c")

// @filename: test5.py
//// from io2.tools import [|{|"r":""|}pathUtils as pathUtils, |]empty[|{|"r":", renamedModule as renamedModule"|}|]
////
//// [|{|"r":"renamedModule"|}pathUtils|].getFilename("c")
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'renamedModule.py')}`);
});

test('from module - move file to nested folder', () => {
    const code = `
// @filename: common/__init__.py
//// # empty

// @filename: module.py
//// def getFilename(path):
////     [|/*marker*/pass|]

// @filename: test1.py
//// from [|module|] import getFilename
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(
        state,
        fileName,
        `${combinePaths(getDirectoryPath(fileName), 'common', 'moduleRenamed.py')}`,
        'module',
        'common.moduleRenamed'
    );
});

test('from module - move file to parent folder', () => {
    const code = `
// @filename: common/__init__.py
//// # empty

// @filename: common/module.py
//// def getFilename(path):
////     [|/*marker*/pass|]

// @filename: test.py
//// from [|common.module|] import getFilename
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

test('from module - move file to sibling folder', () => {
    const code = `
// @filename: common/__init__.py
//// # empty

// @filename: common/module.py
//// def getFilename(path):
////     [|/*marker*/pass|]

// @filename: common1/__init__.py
//// # empty

// @filename: test.py
//// from [|common.module|] import getFilename
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

test('import name - move file to nested folder', () => {
    const code = `
// @filename: common/__init__.py
//// # empty

// @filename: common/sub/__init__.py
//// # empty

// @filename: common/module.py
//// def foo():
////     [|/*marker*/pass|]

// @filename: test1.py
//// from [|{|"r":"common.sub"|}common|] import [|{|"r":"moduleRenamed"|}module|]
//// [|{|"r":"moduleRenamed"|}module|].foo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'sub', 'moduleRenamed.py')}`);
});

test('import name - move file to parent folder', () => {
    const code = `
// @filename: common/__init__.py
//// # empty

// @filename: common/sub/__init__.py
//// # empty

// @filename: common/sub/module.py
//// def foo():
////     [|/*marker*/pass|]

// @filename: test1.py
//// from [|{|"r":"common"|}common.sub|] import [|{|"r":"moduleRenamed"|}module|]
//// [|{|"r":"moduleRenamed"|}module|].foo()
        `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), '..', 'moduleRenamed.py')}`);
});

test('import name - move file to sibling folder', () => {
    const code = `
// @filename: common/__init__.py
//// # empty

// @filename: common1/__init__.py
//// # empty

// @filename: common/module.py
//// def foo():
////     [|/*marker*/pass|]

// @filename: test1.py
//// from [|{|"r":"common1"|}common|] import [|{|"r":"moduleRenamed"|}module|]
//// [|{|"r":"moduleRenamed"|}module|].foo()
            `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(
        state,
        fileName,
        `${combinePaths(getDirectoryPath(fileName), '..', 'common1', 'moduleRenamed.py')}`
    );
});

test('import alias - different name', () => {
    const code = `
// @filename: common/__init__.py
//// # empty

// @filename: common/sub/__init__.py
//// # empty

// @filename: common/module.py
//// def foo():
////     [|/*marker*/pass|]

// @filename: test1.py
//// from [|{|"r":"common.sub"|}common|] import [|{|"r":"moduleRenamed"|}module|] as m
//// m.foo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'sub', 'moduleRenamed.py')}`);
});

test('import alias - same name', () => {
    const code = `
// @filename: common/__init__.py
//// # empty

// @filename: common/sub/__init__.py
//// # empty

// @filename: common/sub/module.py
//// def foo():
////     [|/*marker*/pass|]

// @filename: test1.py
//// from [|{|"r":"common"|}common.sub|] import [|{|"r":"moduleRenamed"|}module|] as [|{|"r":"moduleRenamed"|}module|]
//// [|{|"r":"moduleRenamed"|}module|].foo()
        `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), '..', 'moduleRenamed.py')}`);
});

test('import multiple names', () => {
    const code = `
// @filename: common/__init__.py
//// # empty

// @filename: common/sub/__init__.py
//// # empty

// @filename: common/module.py
//// def foo():
////     [|/*marker*/pass|]

// @filename: test1.py
//// from common import [|{|"r":""|}module, |]sub[|{|"r":"!n!from common.sub import moduleRenamed"|}|]
//// [|{|"r":"moduleRenamed"|}module|].foo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'sub', 'moduleRenamed.py')}`);
});

test('import multiple names with multiple deletions - edge case', () => {
    const code = `
// @filename: common/__init__.py
//// # empty

// @filename: common/sub/__init__.py
//// # empty

// @filename: common/module.py
//// def foo():
////     [|/*marker*/pass|]

// @filename: test1.py
//// from common import sub[|{|"r":""|}, module, module|][|{|"r":"!n!from common.sub import moduleRenamed"|}|]
//// [|{|"r":"moduleRenamed"|}module|].foo()

// @filename: test2.py
//// from common import [|{|"r":""|}module, |]sub[|{|"r":""|}, module|][|{|"r":"!n!from common.sub import moduleRenamed"|}|]
//// [|{|"r":"moduleRenamed"|}module|].foo()

// @filename: test3.py
//// [|{|"r":""|}from common import module, module[|{|"r":"!n!from common.sub import moduleRenamed"|}|]
//// |][|{|"r":"moduleRenamed"|}module|].foo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'sub', 'moduleRenamed.py')}`);
});

test('import multiple names with alias 1', () => {
    const code = `
// @filename: common/__init__.py
//// # empty

// @filename: common/sub/__init__.py
//// # empty

// @filename: common/module.py
//// def foo():
////     [|/*marker*/pass|]

// @filename: test1.py
//// from common import [|{|"r":""|}module as m, |]sub[|{|"r":"!n!from common.sub import moduleRenamed as m"|}|]
//// m.foo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'sub', 'moduleRenamed.py')}`);
});

test('import multiple names with alias 2', () => {
    const code = `
// @filename: common/__init__.py
//// # empty

// @filename: common/sub/__init__.py
//// # empty

// @filename: common/module.py
//// def foo():
////     [|/*marker*/pass|]

// @filename: test1.py
//// from common import [|{|"r":""|}module as module, |]sub[|{|"r":"!n!from common.sub import moduleRenamed as moduleRenamed"|}|]
//// [|{|"r":"moduleRenamed"|}module|].foo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'sub', 'moduleRenamed.py')}`);
});

test('import multiple names with existing from import statement', () => {
    const code = `
// @filename: common/__init__.py
//// # empty

// @filename: common/sub/__init__.py
//// # empty

// @filename: common/sub/existing.py
//// # empty

// @filename: common/module.py
//// def foo():
////     [|/*marker*/pass|]

// @filename: test1.py
//// from common import [|{|"r":""|}module, |]sub
//// from common.sub import existing[|{|"r":", moduleRenamed"|}|]
////
//// [|{|"r":"moduleRenamed"|}module|].foo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'sub', 'moduleRenamed.py')}`);
});

test('import multiple names with existing from import statement with multiple deletion - edge case', () => {
    const code = `
// @filename: common/__init__.py
//// # empty

// @filename: common/sub/__init__.py
//// # empty

// @filename: common/sub/existing.py
//// # empty

// @filename: common/module.py
//// def foo():
////     [|/*marker*/pass|]

// @filename: test1.py
//// from common import [|{|"r":""|}module, module, |]sub
//// from common.sub import existing[|{|"r":", moduleRenamed"|}|]
////
//// [|{|"r":"moduleRenamed"|}module|].foo()

// @filename: test2.py
//// [|{|"r":""|}from common import module, module
//// |]from common.sub import existing[|{|"r":", moduleRenamed"|}|]
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'sub', 'moduleRenamed.py')}`);
});

test('import multiple names with existing from import statement with alias 1', () => {
    const code = `
// @filename: common/__init__.py
//// # empty

// @filename: common/sub/__init__.py
//// # empty

// @filename: common/sub/existing.py
//// # empty

// @filename: common/module.py
//// def foo():
////     [|/*marker*/pass|]

// @filename: test1.py
//// from common import [|{|"r":""|}module as m, |]sub
//// from common.sub import existing[|{|"r":", moduleRenamed as m"|}|]
////
//// m.foo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'sub', 'moduleRenamed.py')}`);
});

test('import multiple names with existing from import statement with alias 2', () => {
    const code = `
// @filename: common/__init__.py
//// # empty

// @filename: common/sub/__init__.py
//// # empty

// @filename: common/sub/existing.py
//// # empty

// @filename: common/module.py
//// def foo():
////     [|/*marker*/pass|]

// @filename: test1.py
//// from common import [|{|"r":""|}module as module, |]sub
//// from common.sub import existing[|{|"r":", moduleRenamed as moduleRenamed"|}|]
////
//// [|{|"r":"moduleRenamed"|}module|].foo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'sub', 'moduleRenamed.py')}`);
});

test('from module multiple import names', () => {
    const code = `
// @filename: common/__init__.py
//// # empty

// @filename: common/module.py
//// def getFilename(path):
////     [|/*marker*/pass|]
////
//// def foo():
////     pass

// @filename: test.py
//// from [|common.module|] import getFilename, foo
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

test('from module relative path - same folder', () => {
    const code = `
// @filename: module.py
//// def foo():
////     [|/*marker*/pass|]

// @filename: test.py
//// from . import [|{|"r":"moduleRenamed"|}module|]
//// [|{|"r":"moduleRenamed"|}module|].foo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'moduleRenamed.py')}`);
});

test('from module relative path - nested folder', () => {
    const code = `
// @filename: common/__init__.py
//// # empty

// @filename: module.py
//// def foo():
////     [|/*marker*/pass|]

// @filename: test.py
//// from [|{|"r":".common"|}.|] import [|{|"r":"moduleRenamed"|}module|]
//// [|{|"r":"moduleRenamed"|}module|].foo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'common', 'moduleRenamed.py')}`);
});

test('from module relative path - parent folder', () => {
    const code = `
// @filename: common/__init__.py
//// # empty

// @filename: common/module.py
//// def foo():
////     [|/*marker*/pass|]

// @filename: test.py
//// from [|{|"r":"."|}.common|] import [|{|"r":"moduleRenamed"|}module|]
//// [|{|"r":"moduleRenamed"|}module|].foo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), '..', 'moduleRenamed.py')}`);
});

test('from module relative path - sibling folder', () => {
    const code = `
// @filename: common/__init__.py
//// # empty

// @filename: common1/__init__.py
//// # empty

// @filename: common/module.py
//// def foo():
////     [|/*marker*/pass|]

// @filename: test.py
//// from [|{|"r":".common1"|}.common|] import [|{|"r":"moduleRenamed"|}module|]
//// [|{|"r":"moduleRenamed"|}module|].foo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(
        state,
        fileName,
        `${combinePaths(getDirectoryPath(fileName), '..', 'common1', 'moduleRenamed.py')}`
    );
});

test('from module relative path - more complex', () => {
    const code = `
// @filename: common/__init__.py
//// # empty

// @filename: common/sub/__init__.py
//// # empty

// @filename: base/nested/__init__.py
//// # empty

// @filename: common/module.py
//// def foo():
////     [|/*marker*/pass|]

// @filename: base/nested/test.py
//// from [|{|"r":"...common.sub"|}...common|] import [|{|"r":"moduleRenamed"|}module|]
//// [|{|"r":"moduleRenamed"|}module|].foo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'sub', 'moduleRenamed.py')}`);
});

test('from module relative path with multiple import names', () => {
    const code = `
// @filename: common/__init__.py
//// # empty

// @filename: common/sub/__init__.py
//// # empty

// @filename: base/nested/__init__.py
//// # empty

// @filename: common/module.py
//// def foo():
////     [|/*marker*/pass|]

// @filename: base/nested/test.py
//// [|{|"r":"from ...common.sub import moduleRenamed!n!"|}|]from ...common import [|{|"r":""|}module, |]sub
//// [|{|"r":"moduleRenamed"|}module|].foo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'sub', 'moduleRenamed.py')}`);
});

test('from module relative path with multiple import names and alias 1', () => {
    const code = `
// @filename: common/__init__.py
//// # empty

// @filename: common/sub/__init__.py
//// # empty

// @filename: base/nested/__init__.py
//// # empty

// @filename: common/module.py
//// def foo():
////     [|/*marker*/pass|]

// @filename: base/nested/test.py
//// [|{|"r":"from ...common.sub import moduleRenamed as m!n!"|}|]from ...common import [|{|"r":""|}module as m, |]sub
//// m.foo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'sub', 'moduleRenamed.py')}`);
});

test('from module relative path with multiple import names and alias 2', () => {
    const code = `
// @filename: common/__init__.py
//// # empty

// @filename: common/sub/__init__.py
//// # empty

// @filename: base/nested/__init__.py
//// # empty

// @filename: common/module.py
//// def foo():
////     [|/*marker*/pass|]

// @filename: base/nested/test.py
//// [|{|"r":"from ...common.sub import moduleRenamed as moduleRenamed!n!"|}|]from ...common import [|{|"r":""|}module as module, |]sub
//// [|{|"r":"moduleRenamed"|}module|].foo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'sub', 'moduleRenamed.py')}`);
});

test('from module relative path with merging with existing import', () => {
    const code = `
// @filename: common/__init__.py
//// # empty

// @filename: common/sub/__init__.py
//// # empty

// @filename: common/sub/existing.py
//// # empty

// @filename: base/nested/__init__.py
//// # empty

// @filename: common/module.py
//// def foo():
////     [|/*marker*/pass|]

// @filename: base/nested/test.py
//// from ...common import [|{|"r":""|}module, |]sub
//// from ...common.sub import existing[|{|"r":", moduleRenamed"|}|]
//// [|{|"r":"moduleRenamed"|}module|].foo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'sub', 'moduleRenamed.py')}`);
});

test('from module relative path with merging with existing import with alias 1', () => {
    const code = `
// @filename: common/__init__.py
//// # empty

// @filename: common/sub/__init__.py
//// # empty

// @filename: common/sub/existing.py
//// # empty

// @filename: base/nested/__init__.py
//// # empty

// @filename: common/module.py
//// def foo():
////     [|/*marker*/pass|]

// @filename: base/nested/test.py
//// from ...common import [|{|"r":""|}module as m, |]sub
//// from ...common.sub import existing[|{|"r":", moduleRenamed as m"|}|]
//// m.foo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'sub', 'moduleRenamed.py')}`);
});

test('from module relative path with merging with existing import with alias 2', () => {
    const code = `
// @filename: common/__init__.py
//// # empty

// @filename: common/sub/__init__.py
//// # empty

// @filename: common/sub/existing.py
//// # empty

// @filename: base/nested/__init__.py
//// # empty

// @filename: common/module.py
//// def foo():
////     [|/*marker*/pass|]

// @filename: base/nested/test.py
//// from ...common import [|{|"r":""|}module as module, |]sub
//// from ...common.sub import existing[|{|"r":", moduleRenamed as moduleRenamed"|}|]
//// [|{|"r":"moduleRenamed"|}module|].foo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'sub', 'moduleRenamed.py')}`);
});

test('from import move to current folder', () => {
    const code = `
// @filename: common/__init__.py
//// # empty

// @filename: common/module.py
//// def getFilename(path):
////     [|/*marker*/pass|]

// @filename: test1.py
//// from [|{|"r":"."|}common|] import ([|{|"r":"renamedModule"|}module|])
////
//// [|{|"r":"renamedModule"|}module|].getFilename("c")
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), '..', 'renamedModule.py')}`);
});

test('re-exported symbols', () => {
    const code = `
// @filename: common/__init__.py
//// from [|{|"r":"common"|}common.io.nest|] import [|{|"r":"renamedModule"|}module|] as [|{|"r":"renamedModule"|}module|]

// @filename: common/io/__init__.py
//// from [|{|"r":".."|}.nest|] import [|{|"r":"renamedModule"|}module|] as [|{|"r":"renamedModule"|}module|]

// @filename: common/io/nest/module.py
//// def foo():
////     [|/*marker*/pass|]

// @filename: reexport.py
//// from common import [|{|"r":"renamedModule"|}module|]
//// __all__ = ["[|{|"r":"renamedModule"|}module|]"]

// @filename: test1.py
//// from common import [|{|"r":"renamedModule"|}module|]
//// [|{|"r":"renamedModule"|}module|].foo()

// @filename: test2.py
//// from common.io import [|{|"r":"renamedModule"|}module|]
//// [|{|"r":"renamedModule"|}module|].foo()

// @filename: test3.py
//// from reexport import [|{|"r":"renamedModule"|}module|]
//// [|{|"r":"renamedModule"|}module|].foo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), '..', '..', 'renamedModule.py')}`);
});

test('new import with existing import with wildcard', () => {
    const code = `
// @filename: common/__init__.py
//// # empty

// @filename: common/sub/__init__.py
//// class A: ...
//// __all__ = ["A"]

// @filename: common/module.py
//// def foo():
////     [|/*marker*/pass|]

// @filename: test1.py
//// from common import [|{|"r":""|}module, |]sub
//// from common.sub import *[|{|"r":"!n!from common.sub import moduleRenamed"|}|]
////
//// [|{|"r":"moduleRenamed"|}module|].foo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'sub', 'moduleRenamed.py')}`);
});

test('simple rename of relative module', () => {
    const code = `
// @filename: common/__init__.py
//// # empty

// @filename: common/module.py
//// def foo():
////     [|/*marker*/pass|]

// @filename: common/test1.py
//// from [|.module|] import foo
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(
        state,
        fileName,
        `${combinePaths(getDirectoryPath(fileName), 'moduleRenamed.py')}`,
        '.module',
        '.moduleRenamed'
    );
});

test('relative module move', () => {
    const code = `
// @filename: common/__init__.py
//// # empty

// @filename: common/module.py
//// def foo():
////     [|/*marker*/pass|]

// @filename: common/test1.py
//// from [|.module|] import foo
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(
        state,
        fileName,
        `${combinePaths(getDirectoryPath(fileName), 'sub', 'moduleRenamed.py')}`,
        '.module',
        '.sub.moduleRenamed'
    );
});

test('__init__ relative module move', () => {
    const code = `
// @filename: common/__init__.py
//// def foo():
////     [|/*marker*/pass|]

// @filename: test1.py
//// from [|.common|] import foo
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(
        state,
        fileName,
        `${combinePaths(getDirectoryPath(fileName), 'moved', '__init__.py')}`,
        '.common',
        '.common.moved'
    );
});

test('__init__ relative module rename', () => {
    const code = `
// @filename: common/__init__.py
//// def foo():
////     [|/*marker*/pass|]

// @filename: test1.py
//// from [|.common|] import foo
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(
        state,
        fileName,
        `${combinePaths(getDirectoryPath(fileName), '..', 'moved', '__init__.py')}`,
        '.common',
        '.moved'
    );
});
