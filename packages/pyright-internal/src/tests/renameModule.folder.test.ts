/*
 * renameModule.folder.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Tests Program.RenameModule
 */

import assert from 'assert';
import { CancellationToken } from 'vscode-languageserver';

import { combinePaths, getDirectoryPath } from '../common/pathUtils';
import { parseAndGetTestState } from './harness/fourslash/testState';
import { testRenameModule } from './renameModuleTestUtils';

test('folder move up', () => {
    const code = `
// @filename: nested/__init__.py
//// [|/*marker*/|]

// @filename: test1.py
//// from . import ([|nested|])
    `;

    const state = parseAndGetTestState(code).state;
    const path = getDirectoryPath(state.getMarkerByName('marker').fileName);

    const edits = state.program.renameModule(path, combinePaths(path, 'sub'), CancellationToken.None);
    assert(!edits);
});

test('folder move down', () => {
    const code = `
// @filename: nested/__init__.py
//// [|/*marker*/|]

// @filename: test1.py
//// from . import ([|nested|])
    `;

    const state = parseAndGetTestState(code).state;
    const path = getDirectoryPath(state.getMarkerByName('marker').fileName);

    const edits = state.program.renameModule(path, combinePaths(path, '..'), CancellationToken.None);
    assert(!edits);
});

test('folder rename - from import', () => {
    const code = `
// @filename: nested/__init__.py
//// [|/*marker*/|]
//// def foo():
////    pass

// @filename: test1.py
//// from . import ([|nested|])
//// [|nested|].foo()
    `;

    const state = parseAndGetTestState(code).state;
    const path = getDirectoryPath(state.getMarkerByName('marker').fileName);

    testRenameModule(state, path, `${combinePaths(path, '..', 'sub')}`, 'nested', 'sub');
});

test('folder rename - from ', () => {
    const code = `
// @filename: nested/__init__.py
//// [|/*marker*/|]
//// def foo():
////    pass

// @filename: test1.py
//// from [|nested|] import foo
    `;

    const state = parseAndGetTestState(code).state;
    const path = getDirectoryPath(state.getMarkerByName('marker').fileName);

    testRenameModule(state, path, `${combinePaths(path, '..', 'sub')}`, 'nested', 'sub');
});

test('folder rename - import ', () => {
    const code = `
// @filename: nested/__init__.py
//// [|/*marker*/|]
//// def foo():
////    pass

// @filename: test1.py
//// import [|nested|]
//// [|nested|].foo()
    `;

    const state = parseAndGetTestState(code).state;
    const path = getDirectoryPath(state.getMarkerByName('marker').fileName);

    testRenameModule(state, path, `${combinePaths(path, '..', 'sub')}`, 'nested', 'sub');
});

test('folder rename - import dotted name', () => {
    const code = `
// @filename: nested1/__init__.py
//// # empty

// @filename: nested1/nested2/__init__.py
//// [|/*marker*/|]
//// def foo():
////    pass

// @filename: test1.py
//// import nested1.[|nested2|]
//// nested1.[|nested2|].foo()
    `;

    const state = parseAndGetTestState(code).state;
    const path = getDirectoryPath(state.getMarkerByName('marker').fileName);

    testRenameModule(state, path, `${combinePaths(path, '..', 'sub')}`, 'nested2', 'sub');
});

test('folder rename - multiple files', () => {
    const code = `
// @filename: nested/__init__.py
//// [|/*marker*/|]
//// def foo():
////    pass

// @filename: nested/module1.py
//// def foo1():
////    pass

// @filename: nested/module2.py
//// def foo2():
////    pass

// @filename: test1.py
//// from [|nested|] import foo, module1
//// from [|nested|].module2 import foo2
//// module1.foo()
        `;

    const state = parseAndGetTestState(code).state;
    const path = getDirectoryPath(state.getMarkerByName('marker').fileName);

    testRenameModule(state, path, `${combinePaths(path, '..', 'sub')}`, 'nested', 'sub');
});

test('folder rename - from alias', () => {
    const code = `
// @filename: nested/__init__.py
//// [|/*marker*/|]
//// def foo():
////    pass

// @filename: test1.py
//// from . import [|nested|] as [|nested|]
//// [|nested|].foo()
        `;

    const state = parseAndGetTestState(code).state;
    const path = getDirectoryPath(state.getMarkerByName('marker').fileName);

    testRenameModule(state, path, `${combinePaths(path, '..', 'sub')}`, 'nested', 'sub');
});

test('folder rename - import alias', () => {
    const code = `
// @filename: nested/__init__.py
//// [|/*marker*/|]
//// def foo():
////    pass

// @filename: test1.py
//// import [|nested|] as [|nested|]
//// [|nested|].foo()
        `;

    const state = parseAndGetTestState(code).state;
    const path = getDirectoryPath(state.getMarkerByName('marker').fileName);

    testRenameModule(state, path, `${combinePaths(path, '..', 'sub')}`, 'nested', 'sub');
});

test('folder rename - import dotted name alias', () => {
    const code = `
// @filename: nested/__init__.py
//// # empty

// @filename: nested/nested/__init__.py
//// [|/*marker*/|]
//// def foo():
////    pass

// @filename: test1.py
//// import nested.[|nested|] as [|nested|]
//// [|nested|].foo()
        `;

    const state = parseAndGetTestState(code).state;
    const path = getDirectoryPath(state.getMarkerByName('marker').fileName);

    testRenameModule(state, path, `${combinePaths(path, '..', 'sub')}`, 'nested', 'sub');
});

test('folder rename - reexport', () => {
    const code = `
// @filename: nested/__init__.py
//// from . import [|nested|]
//// [|nested|].foo()

// @filename: nested/nested/__init__.py
//// [|/*marker*/|]
//// def foo():
////    pass

// @filename: nested/nested/module.py
//// from ..[|nested|] import foo

// @filename: nested/nested/reexport.py
//// from .. import [|nested|] as [|nested|]

// @filename: test1.py
//// import nested.[|nested|] as [|nested|]
//// [|nested|].foo()

// @filename: test2.py
//// import nested.[|nested|].reexport
//// nested.[|nested|].reexport.[|nested|].foo()
        `;

    const state = parseAndGetTestState(code).state;
    const path = getDirectoryPath(state.getMarkerByName('marker').fileName);

    testRenameModule(state, path, `${combinePaths(path, '..', 'sub')}`, 'nested', 'sub');
});

test('folder rename - middle folder', () => {
    const code = `
// @filename: nested/__init__.py
//// # empty

// @filename: nested/nested/__init__.py
//// [|/*marker*/|]

// @filename: nested/nested/nested/__init__.py
//// # empty

// @filename: test1.py
//// import nested.[|nested|].nested as nested
//// nested.foo()

// @filename: test2.py
//// from nested.[|nested|] import nested
        `;

    const state = parseAndGetTestState(code).state;
    const path = getDirectoryPath(state.getMarkerByName('marker').fileName);

    testRenameModule(state, path, `${combinePaths(path, '..', 'sub')}`, 'nested', 'sub');
});
