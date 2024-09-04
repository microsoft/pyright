/*
 * testState.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Tests and show how to use TestState in unit test
 */

import assert from 'assert';

import { combinePaths, getFileName, normalizeSlashes } from '../common/pathUtils';
import { compareStringsCaseSensitive } from '../common/stringUtils';
import { Uri } from '../common/uri/uri';
import { Range } from './harness/fourslash/fourSlashTypes';
import { runFourSlashTestContent } from './harness/fourslash/runner';
import { parseAndGetTestState } from './harness/fourslash/testState';
import * as factory from './harness/vfs/factory';

test('Create', () => {
    const code = `
// @filename: file1.py
////class A:
////    pass
    `;

    const { data, state } = parseAndGetTestState(code);
    assert(state.activeFile === data.files[0]);
});

test('Multiple files', () => {
    const code = `
// @filename: file1.py
////class A:
////    pass

// @filename: file2.py
////class B:
////    pass

// @filename: file3.py
////class C:
////    pass
    `;

    const state = parseAndGetTestState(code, factory.srcFolder).state;

    assert.equal(state.cwd(), normalizeSlashes('/'));
    assert(
        state.fs.existsSync(
            Uri.file(normalizeSlashes(combinePaths(factory.srcFolder, 'file1.py')), state.serviceProvider)
        )
    );
});

test('Configuration', () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "include": [
////     "src"
////   ],
////
////   "exclude": [
////     "**/node_modules",
////     "**/__pycache__",
////     "src/experimental",
////     "src/web/node_modules",
////     "src/typestubs"
////   ],
////
////   "ignore": [
////     "src/oldstuff"
////   ],
////
////   "typingsPath": "src/typestubs",
////   "venvPath": "/home/foo/.venvs",
////
////   "reportMissingImports": true,
////   "reportMissingTypeStubs": false,
////
////   "pythonVersion": "3.6",
////   "pythonPlatform": "Linux",
////
////   "executionEnvironments": [
////     {
////       "root": "src/web",
////       "pythonVersion": "3.5",
////       "pythonPlatform": "Windows",
////       "extraPaths": [
////         "src/service_libs"
////       ]
////     },
////     {
////       "root": "src/sdk",
////       "pythonVersion": "3.0",
////       "extraPaths": [
////         "src/backend"
////       ],
////       "venv": "venv_bar"
////     },
////     {
////       "root": "src/tests",
////       "extraPaths": [
////         "src/tests/e2e",
////         "src/sdk"
////       ]
////     },
////     {
////       "root": "src"
////     }
////   ]
//// }

// @filename: file1.py
////class A:
////    pass
    `;

    const state = parseAndGetTestState(code, factory.srcFolder).state;

    assert.equal(state.cwd(), normalizeSlashes('/'));
    assert(
        state.fs.existsSync(
            Uri.file(normalizeSlashes(combinePaths(factory.srcFolder, 'file1.py')), state.serviceProvider)
        )
    );

    assert.equal(state.configOptions.diagnosticRuleSet.reportMissingImports, 'error');
    assert.equal(state.configOptions.diagnosticRuleSet.reportMissingModuleSource, 'warning');
    assert.equal(state.configOptions.stubPath?.getFilePath(), normalizeSlashes('/src/typestubs'));
});

test('stubPath configuration', () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "stubPath": "src/typestubs"
//// }
    `;

    const state = parseAndGetTestState(code).state;
    assert.equal(state.configOptions.stubPath?.getFilePath(), normalizeSlashes('/src/typestubs'));
});

test('Duplicated stubPath configuration', () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "typingsPath": "src/typestubs1",
////   "stubPath": "src/typestubs2"
//// }
    `;

    const state = parseAndGetTestState(code).state;
    assert.equal(state.configOptions.stubPath?.getFilePath(), normalizeSlashes('/src/typestubs2'));
});

test('ProjectRoot', () => {
    const code = `
// global options
// @projectRoot: /root

// @filename: /root/file1.py
////class A:
////    pass
    `;

    const state = parseAndGetTestState(code).state;

    assert.equal(state.cwd(), normalizeSlashes('/root'));
    assert(state.fs.existsSync(Uri.file(normalizeSlashes('/root/file1.py'), state.serviceProvider)));

    assert.equal(state.configOptions.projectRoot.getFilePath(), normalizeSlashes('/root'));
});

test('CustomTypeshedFolder', () => {
    // use differnt physical folder as typeshed folder. this is different than
    // typeshed folder settings in config json file since that points to a path
    // in virtual file system. not physical one. this decides which physical folder
    // those virtual folder will mount to.
    const code = `
// global options
// @typeshed: ${__dirname}
    `;

    // mount the folder this file is in as typeshed folder and check whether
    // in typeshed folder in virtual file system, this file exists.
    const state = parseAndGetTestState(code).state;
    assert(state.fs.existsSync(factory.typeshedFolder.combinePaths(getFileName(__filename))));
});

test('IgnoreCase', () => {
    const code = `
// global options
// @ignoreCase: true

// @filename: file1.py
////class A:
////    pass
    `;

    const state = parseAndGetTestState(code, factory.srcFolder).state;

    assert(
        state.fs.existsSync(
            Uri.file(normalizeSlashes(combinePaths(factory.srcFolder, 'FILE1.py')), state.serviceProvider)
        )
    );
});

test('GoToMarker', () => {
    const code = `
////class A:
////    /*marker1*/pass
    `;

    const { data, state } = parseAndGetTestState(code);
    const marker = data.markerPositions.get('marker1');

    state.goToMarker('marker1');
    assert.equal(state.lastKnownMarker, 'marker1');
    assert.equal(state.currentCaretPosition, marker!.position);

    state.goToMarker(marker);
    assert.equal(state.lastKnownMarker, 'marker1');
    assert.equal(state.currentCaretPosition, marker!.position);
    assert.equal(state.selectionEnd, -1);
});

test('GoToEachMarker', () => {
    const code = `
// @filename: file1.py
////class A:
////    /*marker1*/pass

// @filename: file2.py
////class B:
////    /*marker2*/pass
    `;

    const { data, state } = parseAndGetTestState(code);
    const marker1 = data.markerPositions.get('marker1');
    const marker2 = data.markerPositions.get('marker2');

    const results: number[] = [];
    state.goToEachMarker([marker1!, marker2!], (m) => {
        results.push(m.position);
    });

    assert.deepEqual(results, [marker1!.position, marker2!.position]);

    assert.equal(state.activeFile.fileName, marker2!.fileName);
    assert.equal(state.currentCaretPosition, marker2!.position);
    assert.equal(state.selectionEnd, -1);
});

test('Markers', () => {
    const code = `
// @filename: file1.py
////class A:
////    /*marker1*/pass

// @filename: file2.py
////class B:
////    /*marker2*/pass
    `;

    const { data, state } = parseAndGetTestState(code);
    const marker1 = data.markerPositions.get('marker1');

    assert.deepEqual(state.getMarkerName(marker1!), 'marker1');
    assert.deepEqual(
        state
            .getMarkers()
            .map((m) => state.getMarkerName(m))
            .sort(compareStringsCaseSensitive),
        state.getMarkerNames().sort(compareStringsCaseSensitive)
    );
});

test('GoToPosition', () => {
    const code = `
// @filename: file1.py
////class A:
////    /*marker1*/pass
    `;

    const { data, state } = parseAndGetTestState(code);
    const marker1 = data.markerPositions.get('marker1');
    state.goToPosition(marker1!.position);

    assert.equal(state.currentCaretPosition, marker1!.position);
    assert.equal(state.selectionEnd, -1);
});

test('select', () => {
    const code = `
// @filename: file1.py
/////*start*/class A:
////    class B:
////        def Test(self):
////            pass
////
////    def Test2(self):
////        pass/*end*/
    `;

    const { data, state } = parseAndGetTestState(code);

    state.select('start', 'end');

    assert.equal(state.currentCaretPosition, data.markerPositions.get('start')!.position);
    assert.equal(state.selectionEnd, data.markerPositions.get('end')!.position);
});

test('selectAllInFile', () => {
    const code = `
// @filename: file1.py
/////*start*/class A:
////    class B:
////        def Test(self):
////            pass
////
////    def Test2(self):
////        pass/*end*/
    `;

    const { data, state } = parseAndGetTestState(code);
    state.selectAllInFile(data.files[0].fileName);

    assert.equal(state.currentCaretPosition, data.markerPositions.get('start')!.position);
    assert.equal(state.selectionEnd, data.markerPositions.get('end')!.position);
});

test('selectRange', () => {
    const code = `
// @filename: file1.py
/////class A:
////    class B:
////        [|def Test(self):
////            pass|]
////
////    def Test2(self):
////        pass
    `;

    const { data, state } = parseAndGetTestState(code);
    const range = data.ranges[0];

    state.selectRange(range);

    assert.equal(state.activeFile.fileName, range.fileName);
    assert.equal(state.currentCaretPosition, range.pos);
    assert.equal(state.selectionEnd, range.end);
});

test('selectLine', () => {
    const code = `
// @filename: file1.py
/////class A:
////    class B:
////[|        def Test(self):|]
////            pass
////
////    def Test2(self):
////        pass
    `;

    const { data, state } = parseAndGetTestState(code);
    const range = data.ranges[0];

    state.selectLine(2);

    assert.equal(state.currentCaretPosition, range.pos);
    assert.equal(state.selectionEnd, range.end);
});

test('goToEachRange', () => {
    const code = `
// @filename: file1.py
/////class A:
////    class B:
////        [|def Test(self):|]
////            pass
////
////    def Test2(self):
////        [|pass|]
    `;

    const { state } = parseAndGetTestState(code);

    const results: Range[] = [];
    state.goToEachRange((r) => {
        assert.equal(state.activeFile.fileName, r.fileName);
        results.push(r);
    });

    assert.deepEqual(results, [state.getRanges()[0], state.getRanges()[1]]);
});

test('getRangesInFile', () => {
    const code = `
// @filename: file1.py
/////class A:
////    class B:
////        [|def Test(self):|]
////            pass

// @filename: file2.py
////    def Test2(self):
////        [|pass|]
    `;

    const { data, state } = parseAndGetTestState(code);

    assert.deepEqual(
        state.getRangesInFile(data.files[0].fileName),
        data.ranges.filter((r) => r.fileName === data.files[0].fileName)
    );
});

test('rangesByText', () => {
    const code = `
// @filename: file1.py
/////class A:
////    class B:
////        [|def Test(self):|]
////            pass

// @filename: file2.py
////    def Test2(self):
////        [|pass|]
    `;

    const { data, state } = parseAndGetTestState(code);
    const map = state.getRangesByText();

    assert.deepEqual(map.get('def Test(self):'), [data.ranges[0]]);
    assert.deepEqual(map.get('pass'), [data.ranges[1]]);
});

test('moveCaretRight', () => {
    const code = `
// @filename: file1.py
/////class A:
////    class B:
////        /*position*/def Test(self):
////            pass
////
////    def Test2(self):
////        pass
    `;

    const { data, state } = parseAndGetTestState(code);
    const marker = data.markerPositions.get('position')!;

    state.goToBOF();
    assert.equal(state.currentCaretPosition, 0);

    state.goToEOF();
    assert.equal(state.currentCaretPosition, data.files[0].content.length);

    state.goToPosition(marker.position);
    state.moveCaretRight('def'.length);

    assert.equal(state.currentCaretPosition, marker.position + 'def'.length);
    assert.equal(state.selectionEnd, -1);
});

test('runFourSlashTestContent', () => {
    const code = `
/// <reference path="typings/fourslash.d.ts" />

// @filename: file1.py
//// class A:
////    class B:
////        /*position*/def Test(self):
////            pass
////
////    def Test2(self):
////        pass

helper.getMarkerByName("position");
    `;

    runFourSlashTestContent(normalizeSlashes('/'), 'unused.py', code);
});

test('VerifyDiagnosticsTest1', () => {
    const code = `
/// <reference path="typings/fourslash.d.ts" />

// @filename: dataclass1.py
//// # This sample validates the Python 3.7 data class feature.
////
//// from typing import NamedTuple, Optional
////
//// class Other:
////     pass
////
//// class DataTuple(NamedTuple):
////     def _m(self):
////         pass
////     id: int
////     aid: Other
////     valll: str = ''
////     name: Optional[str] = None
////
//// d1 = DataTuple(id=1, aid=Other())
//// d2 = DataTuple(id=1, aid=Other(), valll='v')
//// d3 = DataTuple(id=1, aid=Other(), name='hello')
//// d4 = DataTuple(id=1, aid=Other(), name=None)
//// id = d1.id
////
//// # This should generate an error because the name argument
//// # is the incorrect type.
//// d5 = DataTuple(id=1, aid=Other(), name=[|{|"category": "error"|}3|])
////
//// # This should generate an error because aid is a required
//// # parameter and is missing an argument here.
//// d6 = [|{|"category": "error"|}DataTuple(id=1, name=None|])

helper.verifyDiagnostics();
    `;

    runFourSlashTestContent(factory.srcFolder, 'unused.py', code);
});

test('VerifyDiagnosticsTest2', () => {
    const code = `


//// # This sample tests the handling of the @dataclass decorator.
////
//// from dataclasses import dataclass, InitVar
////
//// @dataclass
//// class Bar():
////     bbb: int
////     ccc: str
////     aaa = 'string'
////
//// bar1 = Bar(bbb=5, ccc='hello')
//// bar2 = Bar(5, 'hello')
//// bar3 = Bar(5, 'hello', 'hello2')
//// print(bar3.bbb)
//// print(bar3.ccc)
//// print(bar3.aaa)
////
//// # This should generate an error because ddd
//// # isn't a declared value.
//// bar = Bar(bbb=5, [|/*marker1*/ddd|]=5, ccc='hello')
////
//// # This should generate an error because the
//// # parameter types don't match.
//// bar = Bar([|/*marker2*/'hello'|], 'goodbye')
////
//// # This should generate an error because a parameter
//// # is missing.
//// bar = [|/*marker3*/Bar(2)|]
////
//// # This should generate an error because there are
//// # too many parameters.
//// bar = Bar(2, 'hello', 'hello', [|/*marker4*/4|])
////
////
//// @dataclass
//// class Baz1():
////     bbb: int
////     aaa = 'string'
////
////     # This should generate an error because variables
////     # with no default cannot come after those with
////     # defaults.
////     [|/*marker5*/ccc|]: str
////
//// @dataclass
//// class Baz2():
////     aaa: str
////     ddd: InitVar[int] = 3

helper.verifyDiagnostics({
    "marker1": { category: "error", message: "No parameter named 'ddd'" },
    "marker2": { category: "error", message: "Argument of type 'Literal['hello']' cannot be assigned to parameter 'bbb' of type 'int'\\n  'str' is incompatible with 'int'" },
    "marker3": { category: "error", message: "Argument missing for parameter 'ccc'" },
    "marker4": { category: "error", message: "Expected 3 positional arguments" },
    "marker5": { category: "error", message: "Data fields without default value cannot appear after data fields with default values" },
});
    `;

    runFourSlashTestContent(factory.srcFolder, 'unused.py', code);
});
