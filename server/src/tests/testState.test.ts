/*
* testState.test.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
*/

import * as assert from 'assert';
// import * as io from './harness/io';
// import * as vfs from "./harness/vfs/filesystem";
import * as factory from "./harness/vfs/factory"
import { normalizeSlashes, combinePaths, comparePathsCaseSensitive } from '../common/pathUtils';
import { parseTestData } from './harness/fourslash/fourSlashParser';
import { TestState } from './harness/fourslash/testState';
import { compareStringsCaseSensitive } from '../common/stringUtils';
import { Range } from './harness/fourslash/fourSlashTypes';

test('Create', () => {
    const code = `
// @filename: file1.py
////class A:
////    pass
    `

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
    `

    const state = parseAndGetTestState(code).state;

    assert.equal(state.fs.cwd(), normalizeSlashes("/"));
    assert(state.fs.existsSync(normalizeSlashes(combinePaths(factory.srcFolder, "file1.py"))));
});

test('Configuration', () => {
    const code = `
// @filename: python.json
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
////   "reportTypeshedErrors": false,
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
    `

    const state = parseAndGetTestState(code).state;

    assert.equal(state.fs.cwd(), normalizeSlashes("/"));
    assert(state.fs.existsSync(normalizeSlashes(combinePaths(factory.srcFolder, "file1.py"))));

    assert.equal(state.configOptions.diagnosticSettings.reportMissingImports, "error");
    assert.equal(state.configOptions.typingsPath, normalizeSlashes("src/typestubs"));
});

test('ProjectRoot', () => {
    const code = `
// global options
// @projectRoot: /root

// @filename: /root/file1.py
////class A:
////    pass
    `

    const state = parseAndGetTestState(code).state;

    assert.equal(state.fs.cwd(), normalizeSlashes("/"));
    assert(state.fs.existsSync(normalizeSlashes("/root/file1.py")));

    assert.equal(state.configOptions.projectRoot, normalizeSlashes("/root"));
});

test('IgnoreCase', () => {
    const code = `
// global options
// @ignoreCase: true

// @filename: file1.py
////class A:
////    pass
    `

    const state = parseAndGetTestState(code).state;

    assert(state.fs.existsSync(normalizeSlashes(combinePaths(factory.srcFolder, "FILE1.py"))));
});

test('GoToMarker', () => {
    const code = `
////class A:
////    /*marker1*/pass
    `

    const { data, state } = parseAndGetTestState(code);
    const marker = data.markerPositions.get("marker1");

    state.goToMarker("marker1");
    assert.equal(state.lastKnownMarker, "marker1");
    assert.equal(state.currentCaretPosition, marker!.position);

    state.goToMarker(marker);
    assert.equal(state.lastKnownMarker, "marker1");
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
    `

    const { data, state } = parseAndGetTestState(code);
    const marker1 = data.markerPositions.get("marker1");
    const marker2 = data.markerPositions.get("marker2");

    const results: number[] = [];
    state.goToEachMarker([marker1!, marker2!], m => {
        results.push(m.position);
    })

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
    `

    const { data, state } = parseAndGetTestState(code);
    const marker1 = data.markerPositions.get("marker1");

    assert.deepEqual(state.getMarkerName(marker1!), "marker1");
    assert.deepEqual(state.getMarkers().map(m => state.getMarkerName(m)).sort(compareStringsCaseSensitive), state.getMarkerNames().sort(comparePathsCaseSensitive));
});

test('GoToPosition', () => {
    const code = `
// @filename: file1.py
////class A:
////    /*marker1*/pass
    `

    const { data, state } = parseAndGetTestState(code);
    const marker1 = data.markerPositions.get("marker1");
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
    `

    const { data, state } = parseAndGetTestState(code);

    state.select("start", "end");

    assert.equal(state.currentCaretPosition, data.markerPositions.get("start")!.position);
    assert.equal(state.selectionEnd, data.markerPositions.get("end")!.position);
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
    `

    const { data, state } = parseAndGetTestState(code);
    state.selectAllInFile(data.files[0].fileName);

    assert.equal(state.currentCaretPosition, data.markerPositions.get("start")!.position);
    assert.equal(state.selectionEnd, data.markerPositions.get("end")!.position);
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
    `

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
    `

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
    `

    const { state } = parseAndGetTestState(code);

    const results: Range[] = [];
    state.goToEachRange(r => {
        assert.equal(state.activeFile.fileName, r.fileName);
        results.push(r);
    })

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
    `

    const { data, state } = parseAndGetTestState(code);
    
    assert.deepEqual(state.getRangesInFile(data.files[0].fileName), data.ranges.filter(r => r.fileName === data.files[0].fileName));
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
    `

    const { data, state } = parseAndGetTestState(code);
    const map = state.rangesByText();
    
    assert.deepEqual(map.get("def Test(self):"), [data.ranges[0]]);
    assert.deepEqual(map.get("pass"), [data.ranges[1]]);
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
    `

    const { data, state } = parseAndGetTestState(code);
    const marker = data.markerPositions.get("position")!;

    state.goToBOF();
    assert.equal(state.currentCaretPosition, 0);

    state.goToEOF();
    assert.equal(state.currentCaretPosition, data.files[0].content.length);

    state.goToPosition(marker.position);
    state.moveCaretRight("def".length);

    assert.equal(state.currentCaretPosition, marker.position + "def".length);
    assert.equal(state.selectionEnd, -1);
});

function parseAndGetTestState(code: string) {
    const data = parseTestData(factory.srcFolder, code, "test.py");
    const state = new TestState(normalizeSlashes("/"), data);

    return { data, state };
}