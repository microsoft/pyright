/*
 * fourSlashParser.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Tests and show how to use fourslash markup languages
 * and how to use parseTestData API itself for other unit tests
 */

import assert from 'assert';

import { getBaseFileName, normalizeSlashes } from '../common/pathUtils';
import { compareStringsCaseSensitive } from '../common/stringUtils';
import { parseTestData } from './harness/fourslash/fourSlashParser';
import { CompilerSettings } from './harness/fourslash/fourSlashTypes';
import * as host from './harness/testHost';
import * as factory from './harness/vfs/factory';
import { UriEx } from '../common/uri/uriUtils';

test('GlobalOptions', () => {
    const code = `
// global options
// @libpath: ../dist/lib
// @pythonversion: 3.7

////class A:
////    pass
    `;

    const content = `class A:
    pass`;

    const data = parseTestData('.', code, 'test.py');
    assertOptions(data.globalOptions, [
        ['libpath', '../dist/lib'],
        ['pythonversion', '3.7'],
    ]);

    assert.equal(data.files.length, 1);
    assert.equal(data.files[0].fileName, 'test.py');
    assert.equal(data.files[0].content, content);
});

test('Filename', () => {
    const code = `
// @filename: file1.py
////class A:
////    pass
    `;

    const content = `class A:
    pass`;

    const data = parseTestData('.', code, 'test.py');
    assertOptions(data.globalOptions, []);

    assert.equal(data.files.length, 1);
    assert.equal(data.files[0].fileName, normalizeSlashes('./file1.py'));
    assert.equal(data.files[0].content, content);
});

test('Extra file options', () => {
    // filename must be the first file options
    const code = `
// @filename: file1.py
// @library: false
////class A:
////    pass
    `;

    const data = parseTestData('.', code, 'test.py');

    assert.equal(data.files[0].fileName, normalizeSlashes('./file1.py'));

    assertOptions(data.globalOptions, []);
    assertOptions(data.files[0].fileOptions, [
        ['filename', 'file1.py'],
        ['library', 'false'],
    ]);
});

test('Library options', () => {
    // filename must be the first file options
    const code = `
// @filename: file1.py
// @library: true
////class A:
////    pass
    `;

    const data = parseTestData('.', code, 'test.py');

    assert.equal(data.files[0].fileName, factory.libFolder.combinePaths('file1.py').getFilePath());
});

test('Range', () => {
    const code = `
////class A:
////    [|pass|]
    `;

    const content = `class A:
    pass`;

    const data = parseTestData('.', code, 'test.py');
    assert.equal(data.files[0].content, content);

    assert.deepEqual(data.ranges, [
        { fileName: 'test.py', fileUri: UriEx.file('test.py'), pos: 13, end: 17, marker: undefined },
    ]);
});

test('Marker', () => {
    const code = `
////class A:
////    /*marker1*/pass
    `;

    const content = `class A:
    pass`;

    const data = parseTestData('.', code, 'test.py');
    assert.equal(data.files[0].content, content);

    const marker = { fileName: 'test.py', fileUri: UriEx.file('test.py'), position: 13 };
    assert.deepEqual(data.markers, [marker]);
    assert.deepEqual(data.markerPositions.get('marker1'), marker);
});

test('MarkerWithData', () => {
    // embedded json data
    const code = `
////class A:
////    {| "data1":"1", "data2":"2" |}pass
    `;

    const content = `class A:
    pass`;

    const data = parseTestData('.', code, 'test.py');
    assert.equal(data.files[0].content, content);

    assert.deepEqual(data.markers, [
        { fileName: 'test.py', fileUri: UriEx.file('test.py'), position: 13, data: { data1: '1', data2: '2' } },
    ]);
    assert.equal(data.markerPositions.size, 0);
});

test('MarkerWithDataAndName', () => {
    // embedded json data with "name"
    const code = `
////class A:
////    {| "name": "marker1", "data1":"1", "data2":"2" |}pass
    `;

    const content = `class A:
    pass`;

    const data = parseTestData('.', code, 'test.py');
    assert.equal(data.files[0].content, content);

    const marker = {
        fileName: 'test.py',
        fileUri: UriEx.file('test.py'),
        position: 13,
        data: { name: 'marker1', data1: '1', data2: '2' },
    };
    assert.deepEqual(data.markers, [marker]);
    assert.deepEqual(data.markerPositions.get(marker.data.name), marker);
});

test('RangeWithMarker', () => {
    // range can have 1 marker in it
    const code = `
////class A:
////    [|/*marker1*/pass|]
    `;

    const content = `class A:
    pass`;

    const data = parseTestData('.', code, 'test.py');
    assert.equal(data.files[0].content, content);

    const marker = { fileName: 'test.py', fileUri: UriEx.file('test.py'), position: 13 };
    assert.deepEqual(data.markers, [marker]);
    assert.deepEqual(data.markerPositions.get('marker1'), marker);

    assert.deepEqual(data.ranges, [{ fileName: 'test.py', fileUri: UriEx.file('test.py'), pos: 13, end: 17, marker }]);
});

test('RangeWithMarkerAndJsonData', () => {
    // range can have 1 marker in it
    const code = `
////class A:
////    [|{| "name": "marker1", "data1":"1", "data2":"2" |}pass|]
    `;

    const content = `class A:
    pass`;

    const data = parseTestData('.', code, 'test.py');
    assert.equal(data.files[0].content, content);

    const marker = {
        fileName: 'test.py',
        fileUri: UriEx.file('test.py'),
        position: 13,
        data: { name: 'marker1', data1: '1', data2: '2' },
    };
    assert.deepEqual(data.markers, [marker]);
    assert.deepEqual(data.markerPositions.get(marker.data.name), marker);

    assert.deepEqual(data.ranges, [{ fileName: 'test.py', fileUri: UriEx.file('test.py'), pos: 13, end: 17, marker }]);
});

test('Multiple Files', () => {
    // range can have 1 marker in it
    const code = `
// @filename: src/A.py
// @library: false
////class A:
////    pass

// @filename: src/B.py
// @library: true
////class B:
////    pass

// @filename: src/C.py
////class C:
////    pass
    `;

    const data = parseTestData('.', code, 'test.py');
    assert.equal(data.files.length, 3);

    assert.equal(data.files.filter((f) => f.fileName === normalizeSlashes('./src/A.py'))[0].content, getContent('A'));
    assert.equal(
        data.files.filter((f) => f.fileName === factory.libFolder.resolvePaths('src/B.py').getFilePath())[0].content,
        getContent('B')
    );
    assert.equal(data.files.filter((f) => f.fileName === normalizeSlashes('./src/C.py'))[0].content, getContent('C'));
});

test('Multiple Files with default name', () => {
    // only very first one can omit filename
    const code = `
////class A:
////    pass

// @filename: src/B.py
////class B:
////    pass

// @filename: src/C.py
////class C:
////    pass
    `;

    const data = parseTestData('.', code, './src/test.py');
    assert.equal(data.files.length, 3);

    assert.equal(
        data.files.filter((f) => f.fileName === normalizeSlashes('./src/test.py'))[0].content,
        getContent('A')
    );
    assert.equal(data.files.filter((f) => f.fileName === normalizeSlashes('./src/B.py'))[0].content, getContent('B'));
    assert.equal(data.files.filter((f) => f.fileName === normalizeSlashes('./src/C.py'))[0].content, getContent('C'));
});

test('Multiple Files with markers', () => {
    // range can have 1 marker in it
    const code = `
// @filename: src/A.py
////class A:
////    [|pass|]

// @filename: src/B.py
////class B:
////    [|/*marker1*/pass|]

// @filename: src/C.py
////class C:
////    [|{|"name":"marker2", "data":"2"|}pass|]
    `;

    const data = parseTestData('.', code, 'test.py');
    assert.equal(data.files.length, 3);

    assert.equal(data.files.filter((f) => f.fileName === normalizeSlashes('./src/A.py'))[0].content, getContent('A'));
    assert.equal(data.files.filter((f) => f.fileName === normalizeSlashes('./src/B.py'))[0].content, getContent('B'));
    assert.equal(data.files.filter((f) => f.fileName === normalizeSlashes('./src/C.py'))[0].content, getContent('C'));

    assert.equal(data.ranges.length, 3);

    assert(data.markerPositions.get('marker1'));
    assert(data.markerPositions.get('marker2'));

    assert.equal(data.ranges.filter((r) => r.marker).length, 2);
});

test('fourSlashWithFileSystem', () => {
    const code = `
// @filename: src/A.py
////class A:
////    pass

// @filename: src/B.py
////class B:
////    pass

// @filename: src/C.py
////class C:
////    pass
    `;

    const data = parseTestData('.', code, 'unused');
    const documents = data.files.map(
        (f) => new factory.TextDocument(f.fileName, f.content, new Map<string, string>(Object.entries(f.fileOptions)))
    );

    const fs = factory.createFromFileSystem(host.HOST, /* ignoreCase */ false, {
        documents,
        cwd: normalizeSlashes('/'),
    });

    for (const file of data.files) {
        assert.equal(fs.readFileSync(file.fileUri, 'utf8'), getContent(getBaseFileName(file.fileName, '.py', false)));
    }
});

function getContent(className: string) {
    return `class ${className}:
    pass`;
}

function assertOptions(actual: CompilerSettings, expected: [string, string][], message?: string | Error): void {
    assert.deepEqual(
        Object.entries(actual).sort((x, y) => compareStringsCaseSensitive(x[0], y[0])),
        expected,
        message
    );
}
