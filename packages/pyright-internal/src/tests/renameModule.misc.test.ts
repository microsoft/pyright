/*
 * renameModule.misc.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Tests Program.RenameModule
 */

import { CancellationToken } from 'vscode-languageserver';

import { assert } from '../common/debug';
import { combinePaths, getDirectoryPath } from '../common/pathUtils';
import { parseAndGetTestState } from './harness/fourslash/testState';
import { testRenameModule } from './renameModuleTestUtils';

test('from import with paren', () => {
    const code = `
// @filename: module.py
//// def getFilename(path):
////     [|/*marker*/pass|]

// @filename: test1.py
//// from . import ([|module|])
////
//// [|module|].getFilename("c")
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(
        state,
        fileName,
        `${combinePaths(getDirectoryPath(fileName), 'renamedModule.py')}`,
        'module',
        'renamedModule'
    );
});

test('from import with paren with alias', () => {
    const code = `
// @filename: module.py
//// def getFilename(path):
////     [|/*marker*/pass|]

// @filename: test1.py
//// from . import ([|module|] as [|module|])
////
//// [|module|].getFilename("c")
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(
        state,
        fileName,
        `${combinePaths(getDirectoryPath(fileName), 'renamedModule.py')}`,
        'module',
        'renamedModule'
    );
});

test('from import with paren multiple import names', () => {
    const code = `
// @filename: common/__init__.py
//// # empty

// @filename: module.py
//// def getFilename(path):
////     [|/*marker*/pass|]

// @filename: module2.py
//// # empty

// @filename: test1.py
//// [|{|"r":"from .common import renamedModule as renamedModule!n!"|}|]from . import ([|{|"r":""|}module as module, |]module2)
////
//// [|{|"r":"renamedModule"|}module|].getFilename("c")
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'common', 'renamedModule.py')}`);
});

test('rename - circular references', () => {
    const code = `
// @filename: module1.py
//// from . import [|mySelf|] as [|mySelf|]

// @filename: mySelf.py
//// from module1 import *
//// [|/*marker*/mySelf|].foo()
//// 
//// def foo():
////     pass
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(
        state,
        fileName,
        `${combinePaths(getDirectoryPath(fileName), 'renamedModule.py')}`,
        'mySelf',
        'renamedModule'
    );
});

test('move - circular references', () => {
    const code = `
// @filename: module1.py
//// from [|{|"r":".common"|}.|] import [|{|"r":"renamedModule"|}mySelf|] as [|{|"r":"renamedModule"|}mySelf|]

// @filename: common/__init__.py
//// # empty

// @filename: mySelf.py
//// [|/*marker*/|]
//// from module1 import *
//// [|{|"r":"renamedModule"|}mySelf|].foo()
//// def foo():
////     pass
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'common', 'renamedModule.py')}`);
});

test('py and pyi file update', () => {
    const code = `
// @filename: module.py
//// def getFilename(path):
////     pass

// @filename: module.pyi
//// [|/*marker*/|]
//// def getFilename(path): ...

// @filename: test1.py
//// from . import [|module|] as [|module|]
////
//// [|module|].getFilename("c")

// @filename: test1.pyi
//// from . import [|module|] as [|module|]
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(
        state,
        fileName,
        `${combinePaths(getDirectoryPath(fileName), 'renamedModule.pyi')}`,
        'module',
        'renamedModule'
    );
});

test('py and pyi file update from py', () => {
    // No reference. if both py and pyi exist, then given file must point to pyi not py.
    const code = `
// @filename: module.py
//// [|/*marker*/|]
//// def getFilename(path):
////     pass

// @filename: module.pyi
//// def getFilename(path): ...

// @filename: test1.py
//// from . import module
////
//// module.getFilename("c")
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'renamedModule.py')}`);
});

test('handle __all__ reference', () => {
    const code = `
// @filename: module.py
//// [|/*marker*/|]
//// def getFilename(path):
////     pass

// @filename: test1.py
//// from . import [|module|]
////
//// __all__ = [ "[|module|]" ]
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(
        state,
        fileName,
        `${combinePaths(getDirectoryPath(fileName), 'renamedModule.py')}`,
        'module',
        'renamedModule'
    );
});

test('handle __all__ re-export', () => {
    const code = `
// @filename: module.py
//// [|/*marker*/|]
//// def foo(path):
////     pass

// @filename: common/__init__.py
//// # empty

// @filename: test1.py
//// from [|{|"r":".common"|}.|] import [|{|"r":"renamedModule"|}module|]
////
//// __all__ = [ "[|{|"r":"renamedModule"|}module|]" ]

// @filename: test2.py
//// from test1 import [|{|"r":"renamedModule"|}module|]
////
//// [|renamedModule|].foo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'common', 'renamedModule.py')}`);
});

test('__init__.py rename', () => {
    const code = `
// @filename: common/__init__.py
//// [|/*marker*/|]
//// def getFilename(path):
////     pass

// @filename: test1.py
//// from [|common|] import getFilename
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(
        state,
        fileName,
        `${combinePaths(getDirectoryPath(fileName), 'renamedModule.py')}`,
        'common',
        'common.renamedModule'
    );
});

test('__init__.py rename import', () => {
    const code = `
// @filename: common/__init__.py
//// [|/*marker*/|]

// @filename: test1.py
//// import [|common|]
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(
        state,
        fileName,
        `${combinePaths(getDirectoryPath(fileName), 'renamedModule.py')}`,
        'common',
        'common.renamedModule as renamedModule'
    );
});

test('__init__.py move to nested folder', () => {
    const code = `
// @filename: common/__init__.py
//// [|/*marker*/|]
//// def getFilename(path):
////     pass

// @filename: test1.py
//// from [|common|] import getFilename
        `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(
        state,
        fileName,
        `${combinePaths(getDirectoryPath(fileName), 'nested', 'renamedModule.py')}`,
        'common',
        'common.nested.renamedModule'
    );
});

test('__init__.py move to nested folder with same name', () => {
    const code = `
// @filename: common/__init__.py
//// [|/*marker*/|]
//// def getFilename(path):
////     pass

// @filename: test1.py
//// from [|common|] import getFilename
        `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(
        state,
        fileName,
        `${combinePaths(getDirectoryPath(fileName), 'nested', '__init__.py')}`,
        'common',
        'common.nested'
    );
});

test('__init__.py move to parent folder', () => {
    const code = `
// @filename: common/__init__.py
//// [|/*marker*/|]
//// def getFilename(path):
////     pass

// @filename: test1.py
//// from [|common|] import getFilename
        `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(
        state,
        fileName,
        `${combinePaths(getDirectoryPath(fileName), '..', 'renamedModule.py')}`,
        'common',
        'renamedModule'
    );
});

test('__init__.py move to parent folder with same name 1', () => {
    const code = `
// @filename: common/__init__.py
//// [|/*marker*/|]
//// def getFilename(path):
////     pass

// @filename: test1.py
//// from [|common|] import getFilename
        `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    const edits = state.program.renameModule(
        fileName,
        `${combinePaths(getDirectoryPath(fileName), '..', '__init__.py')}`,
        CancellationToken.None
    );
    assert(!edits);
});

test('__init__.py with alias', () => {
    const code = `
// @filename: common/__init__.py
//// [|/*marker*/|]
//// def getFilename(path):
////     pass

// @filename: test1.py
//// from [|{|"r":".common"|}.|] import [|{|"r":"renamedModule"|}common|] as [|{|"r":"renamedModule"|}common|]
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'renamedModule.py')}`);
});

test('__init__.py import with alias', () => {
    const code = `
// @filename: common/__init__.py
//// [|/*marker*/|]
//// def getFilename(path):
////     pass

// @filename: test1.py
//// import [|{|"r":"common.renamedModule"|}common|] as [|{|"r":"renamedModule"|}common|]
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'renamedModule.py')}`);
});

test('__init__.py rename complex', () => {
    const code = `
// @filename: common/__init__.py
//// import [|{|"r":"common.nested.renamedModule"|}common.nested.lib|] as [|{|"r":"renamedModule"|}lib|]
//// __all__ = ["[|{|"r":"renamedModule"|}lib|]"]

// @filename: reexport.py
//// from common import [|{|"r":"renamedModule"|}lib|] as [|{|"r":"renamedModule"|}lib|]

// @filename: common/nested/__init__.py
//// # empty

// @filename: common/nested/lib/__init__.py
//// [|/*marker*/|]
//// def foo():
////     pass

// @filename: test1.py
//// import common
//// common.[|{|"r":"renamedModule"|}lib|].foo()

// @filename: test2.py
//// from reexport import [|{|"r":"renamedModule"|}lib|]
//// [|{|"r":"renamedModule"|}lib|].foo()

// @filename: test3.py
//// from common import *
//// [|{|"r":"renamedModule"|}lib|].foo()

// @filename: test4.py
//// from reexport import *
//// [|{|"r":"renamedModule"|}lib|].foo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), '..', 'renamedModule.py')}`);
});

test('__init__.py moved to parent folder with same name 2', () => {
    const code = `
// @filename: common/__init__.py
//// import [|{|"r":"common.nested"|}common.nested.lib|] as [|{|"r":"nested"|}lib|]
//// __all__ = ["[|{|"r":"nested"|}lib|]"]

// @filename: reexport.py
//// from common import [|{|"r":"nested"|}lib|] as [|{|"r":"nested"|}lib|]

// @filename: common/nested/lib/__init__.py
//// [|/*marker*/|]
//// def foo():
////     pass

// @filename: test1.py
//// import common
//// common.[|{|"r":"nested"|}lib|].foo()

// @filename: test2.py
//// from reexport import [|{|"r":"nested"|}lib|]
//// [|{|"r":"nested"|}lib|].foo()

// @filename: test3.py
//// from common import *
//// [|{|"r":"nested"|}lib|].foo()

// @filename: test4.py
//// from reexport import *
//// [|{|"r":"nested"|}lib|].foo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), '..', '__init__.py')}`);
});

test('__init__.py changes middle of dotted name', () => {
    const code = `
// @filename: common/__init__.py
//// # empty [|/*marker*/|]
//// from common.nested import lib as lib

// @filename: common/nested/lib.py
//// def libFoo():
////    pass

// @filename: common/nested/__init__.py
//// def nestedFoo():
////     pass

// @filename: test1.py
//// import common.nested.lib
//// common.nested.lib.libFoo()

// @filename: test2.py
//// from common import nested
//// nested.nestedFoo()

// @filename: test3.py
//// from [|{|"r":"common.renamedModule"|}common|] import *
//// lib.libFoo()

// @filename: test4.py
//// from [|{|"r":"common.renamedModule"|}common|] import lib
//// lib.libFoo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'renamedModule.py')}`);
});

test('__init__.py - split from import statement', () => {
    const code = `
// @filename: common/__init__.py
//// # empty [|/*marker*/|]
//// from common.nested import lib as lib

// @filename: common/nested/lib.py
//// def libFoo():
////    pass

// @filename: common/nested/__init__.py
//// def nestedFoo():
////     pass

// @filename: test1.py
//// from common import nested[|{|"r":""|}, lib|][|{|"r":"!n!from common.renamedModule import lib"|}|]
//// nested.nestedFoo()
//// lib.libFoo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'renamedModule.py')}`);
});

test('__init__.py - split from import statement with multiple names', () => {
    const code = `
// @filename: common/__init__.py
//// # empty [|/*marker*/|]
//// from common.nested import lib as lib
//// def commonFoo():
////     pass

// @filename: common/nested/lib.py
//// def libFoo():
////    pass

// @filename: common/nested/__init__.py
//// def nestedFoo():
////     pass

// @filename: test1.py
//// from common import nested[|{|"r":""|}, lib, commonFoo|][|{|"r":"!n!from common.renamedModule import commonFoo, lib"|}|]
//// nested.nestedFoo()
//// lib.libFoo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'renamedModule.py')}`);
});

test('__init__.py - merge from import statement with multiple names', () => {
    const code = `
// @filename: common/nested/__init__.py
//// # empty [|/*marker*/|]
//// from common.nested2 import lib as lib
//// def commonFoo():
////     pass

// @filename: common/nested/sub.py
//// # empty

// @filename: common/empty.py
//// # empty

// @filename: common/nested2/lib.py
//// def libFoo():
////    pass

// @filename: test1.py
//// from common.nested import [|{|"r":""|}commonFoo, lib, |]sub
//// from common import [|{|"r":"commonFoo, "|}|]empty[|{|"r":", lib"|}|]
////
//// nested.commonFoo()
//// lib.libFoo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), '..', '__init__.py')}`);
});

test('__init__.py - split from import statement with multiple names with circular reference', () => {
    const code = `
// @filename: common/__init__.py
//// # empty
//// from common.nested import lib as lib
//// from common.nested import [|/*marker*/{|"r":"renamedModule"|}common|] as [|{|"r":"renamedModule"|}common|]
//// 
//// def commonFoo():
////     pass

// @filename: common/nested/lib.py
//// def libFoo():
////    pass

// @filename: common/nested/__init__.py
//// from [|{|"r":".."|}...|] import [|{|"r":"renamedModule"|}common|] as [|{|"r":"renamedModule"|}common|]

// @filename: test1.py
//// from common import nested[|{|"r":""|}, lib, common|][|{|"r":"!n!from common.renamedModule import lib, renamedModule"|}|]
//// nested.[|{|"r":"renamedModule"|}common|].commonFoo()
//// [|{|"r":"renamedModule"|}common|].commonFoo()
//// lib.libFoo()
    `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'renamedModule.py')}`);
});

test('__init__.py - merge from import statement with multiple names with circular reference', () => {
    const code = `
// @filename: common/nested/__init__.py
//// # empty
//// from common.nested2 import lib as lib
//// from common.nested2 import [|/*marker*/{|"r":"common"|}nested|] as [|{|"r":"common"|}nested|]
////
//// def commonFoo():
////     pass

// @filename: common/nested/sub.py
//// # empty

// @filename: common/empty.py
//// # empty

// @filename: common/nested2/__init__.py
//// from [|{|"r":"..."|}..|] import [|{|"r":"common"|}nested|] as [|{|"r":"common"|}nested|]

// @filename: common/nested2/lib.py
//// def libFoo():
////    pass

// @filename: test1.py
//// from common.nested import [|{|"r":""|}nested, lib, |]sub
//// from common import [|{|"r":"common, "|}|]empty[|{|"r":", lib"|}|]
////
//// [|{|"r":"common"|}nested|].commonFoo()
//// lib.libFoo()
        `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), '..', '__init__.py')}`);
});

test('__init__.py - merge from import statement with multiple names with circular reference with only name change', () => {
    const code = `
// @filename: common/nested/__init__.py
//// # empty
//// from common.nested2 import lib as lib
//// from common.nested2 import [|/*marker*/{|"r":"renamedModule"|}nested|] as [|{|"r":"renamedModule"|}nested|]
////
//// def commonFoo():
////     pass

// @filename: common/nested/sub.py
//// # empty

// @filename: common/empty.py
//// # empty

// @filename: common/nested2/__init__.py
//// from .. import [|{|"r":"renamedModule"|}nested|] as [|{|"r":"renamedModule"|}nested|]

// @filename: common/nested2/lib.py
//// def libFoo():
////    pass

// @filename: test1.py
//// from common.nested import [|{|"r":""|}nested, lib, |]sub[|{|"r":"!n!from common.renamedModule import lib, renamedModule"|}|]
////
//// [|{|"r":"renamedModule"|}nested|].commonFoo()
//// lib.libFoo()
        `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), '..', 'renamedModule.py')}`);
});

test('add and remove consecutive edits', () => {
    const code = `
// @filename: a1.py
//// # empty [|/*marker*/|]

// @filename: a3.py
//// # empty 

// @filename: test1.py
//// from . import [|{|"r":"a2"|}a1|], a3
        `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'a2.py')}`);
});

test('add and remove consecutive edits with alias 1', () => {
    const code = `
// @filename: a1.py
//// # empty [|/*marker*/|]

// @filename: a3.py
//// # empty 

// @filename: test1.py
//// from . import [|{|"r":"a2"|}a1|] as [|{|"r":"a2"|}a1|], a3
        `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'a2.py')}`);
});

test('add and remove consecutive edits with alias 2', () => {
    const code = `
// @filename: a1.py
//// # empty [|/*marker*/|]

// @filename: a3.py
//// # empty 

// @filename: test1.py
//// from . import [|{|"r":"a2"|}a1|] as a, a3
        `;

    const state = parseAndGetTestState(code).state;
    const fileName = state.getMarkerByName('marker').fileName;

    testRenameModule(state, fileName, `${combinePaths(getDirectoryPath(fileName), 'a2.py')}`);
});
