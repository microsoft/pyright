/*
 * importStatementUtils.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for importStatementUtils module.
 */

import assert from 'assert';

import { ImportType } from '../analyzer/importResult';
import {
    getImportGroupFromModuleNameAndType,
    getRelativeModuleName,
    getTextEditsForAutoImportInsertion,
    getTextEditsForAutoImportSymbolAddition,
    getTopLevelImports,
    ImportNameInfo,
} from '../analyzer/importStatementUtils';
import { TextEditAction } from '../common/editAction';
import { convertOffsetToPosition } from '../common/positionUtils';
import { rangesAreEqual } from '../common/textRange';
import { Range } from './harness/fourslash/fourSlashTypes';
import { parseAndGetTestState, TestState } from './harness/fourslash/testState';

test('getTextEditsForAutoImportInsertion - import empty', () => {
    const code = `
//// import os[|/*marker1*/{|"r":"!n!import sys"|}|]
    `;

    testInsertion(code, 'marker1', [], 'sys', ImportType.BuiltIn);
});

test('getTextEditsForAutoImportInsertion - import', () => {
    const code = `
//// import os[|/*marker1*/{|"r":"!n!import sys"|}|]
    `;

    testInsertion(code, 'marker1', {}, 'sys', ImportType.BuiltIn);
});

test('getTextEditsForAutoImportInsertion - import alias', () => {
    const code = `
//// import os[|/*marker1*/{|"r":"!n!import sys as s"|}|]
    `;

    testInsertion(code, 'marker1', { alias: 's' }, 'sys', ImportType.BuiltIn);
});

test('getTextEditsForAutoImportInsertion - multiple imports', () => {
    const code = `
//// import os[|/*marker1*/{|"r":"!n!import sys"|}|]
    `;

    testInsertion(code, 'marker1', [{}, {}], 'sys', ImportType.BuiltIn);
});

test('getTextEditsForAutoImportInsertion - multiple imports alias', () => {
    const code = `
//// import os[|/*marker1*/{|"r":"!n!import sys as s, sys as y"|}|]
    `;

    testInsertion(code, 'marker1', [{ alias: 's' }, { alias: 'y' }], 'sys', ImportType.BuiltIn);
});

test('getTextEditsForAutoImportInsertion - multiple imports alias duplicated', () => {
    const code = `
//// import os[|/*marker1*/{|"r":"!n!import sys as s"|}|]
    `;

    testInsertion(code, 'marker1', [{ alias: 's' }, { alias: 's' }], 'sys', ImportType.BuiltIn);
});

test('getTextEditsForAutoImportInsertion - from import', () => {
    const code = `
//// import os[|/*marker1*/{|"r":"!n!from sys import path"|}|]
    `;

    testInsertion(code, 'marker1', { name: 'path' }, 'sys', ImportType.BuiltIn);
});

test('getTextEditsForAutoImportInsertion - from import alias', () => {
    const code = `
//// import os[|/*marker1*/{|"r":"!n!from sys import path as p"|}|]
    `;

    testInsertion(code, 'marker1', { name: 'path', alias: 'p' }, 'sys', ImportType.BuiltIn);
});

test('getTextEditsForAutoImportInsertion - multiple from imports', () => {
    const code = `
//// import os[|/*marker1*/{|"r":"!n!from sys import meta_path, path"|}|]
    `;

    testInsertion(code, 'marker1', [{ name: 'path' }, { name: 'meta_path' }], 'sys', ImportType.BuiltIn);
});

test('getTextEditsForAutoImportInsertion - multiple from imports with alias', () => {
    const code = `
//// import os[|/*marker1*/{|"r":"!n!from sys import meta_path as m, path as p"|}|]
    `;

    testInsertion(
        code,
        'marker1',
        [
            { name: 'path', alias: 'p' },
            { name: 'meta_path', alias: 'm' },
        ],
        'sys',
        ImportType.BuiltIn
    );
});

test('getTextEditsForAutoImportInsertion - multiple from imports with alias duplicated', () => {
    const code = `
//// import os[|/*marker1*/{|"r":"!n!from sys import meta_path as m, path as p"|}|]
    `;

    testInsertion(
        code,
        'marker1',
        [
            { name: 'path', alias: 'p' },
            { name: 'meta_path', alias: 'm' },
            { name: 'path', alias: 'p' },
        ],
        'sys',
        ImportType.BuiltIn
    );
});

test('getTextEditsForAutoImportInsertion - multiple import statements', () => {
    const code = `
//// import os[|/*marker1*/{|"r":"!n!import sys as s!n!from sys import path as p"|}|]
    `;

    testInsertion(code, 'marker1', [{ alias: 's' }, { name: 'path', alias: 'p' }], 'sys', ImportType.BuiltIn);
});

test('getTextEditsForAutoImportInsertion - different group', () => {
    const code = `
//// import os[|/*marker1*/{|"r":"!n!!n!import sys as s!n!from sys import path as p"|}|]
    `;

    testInsertion(code, 'marker1', [{ alias: 's' }, { name: 'path', alias: 'p' }], 'sys', ImportType.Local);
});

test('getTextEditsForAutoImportInsertion - at the top', () => {
    const code = `
//// [|/*marker1*/{|"r":"import sys as s!n!from sys import path as p!n!!n!!n!"|}|]import os
    `;

    testInsertion(code, 'marker1', [{ alias: 's' }, { name: 'path', alias: 'p' }], 'sys', ImportType.BuiltIn);
});

test('getTextEditsForAutoImportInsertion - at the top after module doc string', () => {
    const code = `
//// ''' module doc string '''
//// __author__ = "Software Authors Name"
//// __copyright__ = "Copyright (C) 2004 Author Name"
//// __license__ = "Public Domain"
//// __version__ = "1.0"
//// [|/*marker1*/{|"r":"import sys as s!n!from sys import path as p!n!!n!!n!"|}|]import os
    `;

    testInsertion(code, 'marker1', [{ alias: 's' }, { name: 'path', alias: 'p' }], 'sys', ImportType.BuiltIn);
});

test('getTextEditsForAutoImportSymbolAddition', () => {
    const code = `
//// from sys import [|/*marker1*/{|"r":"meta_path, "|}|]path
    `;

    testAddition(code, 'marker1', { name: 'meta_path' }, 'sys');
});

test('getTextEditsForAutoImportSymbolAddition - already exist', () => {
    const code = `
//// from sys import path[|/*marker1*/|]
    `;

    testAddition(code, 'marker1', { name: 'path' }, 'sys');
});

test('getTextEditsForAutoImportSymbolAddition - with alias', () => {
    const code = `
//// from sys import path[|/*marker1*/{|"r":", path as p"|}|]
    `;

    testAddition(code, 'marker1', { name: 'path', alias: 'p' }, 'sys');
});

test('getTextEditsForAutoImportSymbolAddition - multiple names', () => {
    const code = `
//// from sys import [|/*marker1*/{|"r":"meta_path as m, "|}|]path[|{|"r":", zoom as z"|}|]
    `;

    testAddition(
        code,
        'marker1',
        [
            { name: 'meta_path', alias: 'm' },
            { name: 'zoom', alias: 'z' },
        ],
        'sys'
    );
});

test('getTextEditsForAutoImportSymbolAddition - multiple names at some spot', () => {
    const code = `
//// from sys import [|/*marker1*/{|"r":"meta_path as m, noon as n, "|}|]path
    `;

    testAddition(
        code,
        'marker1',
        [
            { name: 'meta_path', alias: 'm' },
            { name: 'noon', alias: 'n' },
        ],
        'sys'
    );
});

test('getTextEditsForAutoImportSymbolAddition - wildcard', () => {
    const code = `
//// from sys import *[|/*marker1*/|]
    `;

    testAddition(code, 'marker1', [{ name: 'path' }], 'sys');
});

test('getRelativeModuleName - same file', () => {
    const code = `
// @filename: source.py
//// [|/*src*/|] [|/*dest*/|]
    `;

    testRelativeModuleName(code, '.source');
});

test('getRelativeModuleName - same file __init__', () => {
    const code = `
// @filename: common/__init__.py
//// [|/*src*/|] [|/*dest*/|]
    `;

    testRelativeModuleName(code, '..common');
});

test('getRelativeModuleName - same folder', () => {
    const code = `
// @filename: source.py
//// [|/*src*/|]

// @filename: dest.py
//// [|/*dest*/|]
    `;

    testRelativeModuleName(code, '.dest');
});

test('getRelativeModuleName - different folder move down', () => {
    const code = `
// @filename: common/source.py
//// [|/*src*/|]

// @filename: dest.py
//// [|/*dest*/|]
    `;

    testRelativeModuleName(code, '..dest');
});

test('getRelativeModuleName - different folder move up', () => {
    const code = `
// @filename: source.py
//// [|/*src*/|]

// @filename: common/dest.py
//// [|/*dest*/|]
    `;

    testRelativeModuleName(code, '.common.dest');
});

test('getRelativeModuleName - different folder move down __init__', () => {
    const code = `
// @filename: nest1/nest2/source.py
//// [|/*src*/|]

// @filename: nest1/__init__.py
//// [|/*dest*/|]
    `;

    testRelativeModuleName(code, '...nest1');
});

test('getRelativeModuleName - different folder move up __init__', () => {
    const code = `
// @filename: source.py
//// [|/*src*/|]

// @filename: common/__init__.py
//// [|/*dest*/|]
    `;

    testRelativeModuleName(code, '.common');
});

test('getRelativeModuleName - root __init__', () => {
    const code = `
// @filename: source.py
//// [|/*src*/|]

// @filename: __init__.py
//// [|/*dest*/|]
    `;

    testRelativeModuleName(code, '.');
});

function testRelativeModuleName(code: string, expected: string) {
    const state = parseAndGetTestState(code).state;
    const src = state.getMarkerByName('src')!.fileName;
    const dest = state.getMarkerByName('dest')!.fileName;

    assert.strictEqual(getRelativeModuleName(state.fs, src, dest), expected);
}

function testAddition(
    code: string,
    markerName: string,
    importNameInfo: ImportNameInfo | ImportNameInfo[],
    moduleName: string
) {
    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName(markerName)!;
    const parseResults = state.program.getBoundSourceFile(marker!.fileName)!.getParseResults()!;

    const importStatement = getTopLevelImports(parseResults.parseTree).orderedImports.find(
        (i) => i.moduleName === moduleName
    )!;
    const edits = getTextEditsForAutoImportSymbolAddition(importNameInfo, importStatement, parseResults);

    const ranges = [...state.getRanges().filter((r) => !!r.marker?.data)];
    assert.strictEqual(edits.length, ranges.length, `${markerName} expects ${ranges.length} but got ${edits.length}`);

    testTextEdits(state, edits, ranges);
}

function testInsertion(
    code: string,
    markerName: string,
    importNameInfo: ImportNameInfo | ImportNameInfo[],
    moduleName: string,
    importType: ImportType
) {
    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName(markerName)!;
    const parseResults = state.program.getBoundSourceFile(marker!.fileName)!.getParseResults()!;

    const importStatements = getTopLevelImports(parseResults.parseTree);
    const edits = getTextEditsForAutoImportInsertion(
        importNameInfo,
        importStatements,
        moduleName,
        getImportGroupFromModuleNameAndType({
            moduleName,
            importType,
            isLocalTypingsFile: false,
        }),
        parseResults,
        convertOffsetToPosition(marker.position, parseResults.tokenizerOutput.lines)
    );

    const ranges = [...state.getRanges().filter((r) => !!r.marker?.data)];
    assert.strictEqual(edits.length, ranges.length, `${markerName} expects ${ranges.length} but got ${edits.length}`);

    testTextEdits(state, edits, ranges);
}

function testTextEdits(state: TestState, edits: TextEditAction[], ranges: Range[]) {
    for (const edit of edits) {
        assert(
            ranges.some((r) => {
                const data = r.marker!.data as { r: string };
                const expectedText = data.r;
                return (
                    rangesAreEqual(state.convertPositionRange(r), edit.range) &&
                    expectedText.replace(/!n!/g, '\n') === edit.replacementText
                );
            }),
            `can't find '${edit.replacementText}'@'${edit.range.start.line},${edit.range.start.character}'`
        );
    }
}
