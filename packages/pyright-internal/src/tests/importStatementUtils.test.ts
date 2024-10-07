/*
 * importStatementUtils.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for importStatementUtils module.
 */

import assert from 'assert';

import { isFunctionDeclaration } from '../analyzer/declaration';
import { ImportType } from '../analyzer/importResult';
import {
    getRelativeModuleName,
    getTextEditsForAutoImportInsertions,
    getTextEditsForAutoImportSymbolAddition,
    getTopLevelImports,
    ImportNameInfo,
    ImportNameWithModuleInfo,
} from '../analyzer/importStatementUtils';
import { findNodeByOffset } from '../analyzer/parseTreeUtils';
import { isArray } from '../common/core';
import { TextEditAction } from '../common/editAction';
import { convertOffsetToPosition } from '../common/positionUtils';
import { rangesAreEqual } from '../common/textRange';
import { NameNode } from '../parser/parseNodes';
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

test('getTextEditsForAutoImportInsertion - at top of second group', () => {
    const code = `
//// import os
//// 
//// [|/*marker1*/{|"r":"from test.a import testa!n!"|}|]from test.b import testb
    `;

    testInsertion(code, 'marker1', [{ name: 'testa' }], 'test.a', ImportType.Local);
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

test('getTextEditsForAutoImportInsertions - mix of import and from import statements', () => {
    const code = `
//// [|/*marker1*/{|"r":"import sys as s!n!from sys import path as p!n!!n!!n!"|}|]import os
    `;

    const module = { moduleName: 'sys', importType: ImportType.BuiltIn, isLocalTypingsFile: false };
    testInsertions(code, 'marker1', [
        { module, alias: 's' },
        { module, name: 'path', alias: 'p' },
    ]);
});

test('getTextEditsForAutoImportInsertions - multiple modules with different group', () => {
    const code = `
//// [|/*marker1*/|][|{|"r":"from sys import path as p!n!!n!!n!"|}|][|{|"r":"import numpy!n!!n!!n!"|}|][|{|"r":"from test import join!n!!n!!n!"|}|]import os
    `;

    const module1 = { moduleName: 'sys', importType: ImportType.BuiltIn, isLocalTypingsFile: false };
    const module2 = { moduleName: 'numpy', importType: ImportType.ThirdParty, isLocalTypingsFile: false };
    const module3 = { moduleName: 'test', importType: ImportType.Local, isLocalTypingsFile: false };

    testInsertions(code, 'marker1', [
        { module: module1, name: 'path', alias: 'p' },
        { module: module2 },
        { module: module3, name: 'join' },
    ]);
});

test('getTextEditsForAutoImportInsertions - multiple modules with existing imports', () => {
    const code = `
//// import os[|/*marker1*/|][|{|"r":"!n!from sys import path as p"|}|][|{|"r":"!n!!n!import numpy"|}|][|{|"r":"!n!!n!from test import join"|}|]
    `;

    const module1 = { moduleName: 'sys', importType: ImportType.BuiltIn, isLocalTypingsFile: false };
    const module2 = { moduleName: 'numpy', importType: ImportType.ThirdParty, isLocalTypingsFile: false };
    const module3 = { moduleName: 'test', importType: ImportType.Local, isLocalTypingsFile: false };

    testInsertions(code, 'marker1', [
        { module: module1, name: 'path', alias: 'p' },
        { module: module2 },
        { module: module3, name: 'join' },
    ]);
});

test('getTextEditsForAutoImportInsertions - multiple modules with same group', () => {
    const code = `
//// import os[|/*marker1*/|][|{|"r":"!n!!n!import module2!n!from module1 import path as p!n!from module3 import join"|}|]
    `;

    const module1 = { moduleName: 'module1', importType: ImportType.Local, isLocalTypingsFile: false };
    const module2 = { moduleName: 'module2', importType: ImportType.Local, isLocalTypingsFile: false };
    const module3 = { moduleName: 'module3', importType: ImportType.Local, isLocalTypingsFile: false };

    testInsertions(code, 'marker1', [
        { module: module1, name: 'path', alias: 'p' },
        { module: module2 },
        { module: module3, name: 'join' },
    ]);
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

    testRelativeModuleName(code, '.');
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

test('getRelativeModuleName - folder move down __init__ parent folder', () => {
    const code = `
// @filename: nest1/nest2/source.py
//// [|/*src*/|]

// @filename: nest1/__init__.py
//// [|/*dest*/|]
    `;

    testRelativeModuleName(code, '..');
});

test('getRelativeModuleName - folder move down __init__ parent folder ignore folder structure', () => {
    const code = `
// @filename: nest1/nest2/source.py
//// [|/*src*/|]

// @filename: nest1/__init__.py
//// [|/*dest*/|]
    `;

    testRelativeModuleName(code, '...nest1', /*ignoreFolderStructure*/ true);
});

test('getRelativeModuleName - different folder move down __init__ sibling folder', () => {
    const code = `
// @filename: nest1/nest2/source.py
//// [|/*src*/|]

// @filename: different/__init__.py
//// [|/*dest*/|]
    `;

    testRelativeModuleName(code, '...different');
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

test('getRelativeModuleName over fake file', () => {
    const code = `
// @filename: target.py
//// [|/*dest*/|]
    `;

    const state = parseAndGetTestState(code).state;
    const dest = state.getMarkerByName('dest')!.fileUri;

    assert.strictEqual(
        getRelativeModuleName(
            state.fs,
            dest.getDirectory().combinePaths('source.py'),
            dest,
            state.configOptions,
            /*ignoreFolderStructure*/ false,
            /*sourceIsFile*/ true
        ),
        '.target'
    );
});

test('getRelativeModuleName - target in stub path', () => {
    const code = `
// @filename: source.py
//// [|/*src*/|]

// @filename: typings/library/__init__.py
//// [|/*dest*/|]
    `;

    testRelativeModuleName(code, undefined);
});

test('getRelativeModuleName - target in typeshed path', () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "typeshedPath": "my_typeshed"
//// }

// @filename: source.py
//// [|/*src*/|]

// @filename: my_typeshed/library/__init__.py
//// [|/*dest*/|]
    `;

    testRelativeModuleName(code, undefined);
});

test('resolve alias of not needed file', () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: myLib/__init__.py
// @library: true
//// from myLib.foo import [|/*marker*/foo|]

// @filename: myLib/foo.py
// @library: true
//// def foo(): pass
    `;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker')!;

    const evaluator = state.workspace.service.test_program.evaluator!;
    state.openFile(marker.fileName);

    const markerUri = marker.fileUri;
    const parseResults = state.workspace.service.getParseResults(markerUri)!;
    const nameNode = findNodeByOffset(parseResults.parserOutput.parseTree, marker.position) as NameNode;
    const aliasDecls = evaluator.getDeclInfoForNameNode(nameNode)!.decls;

    // Unroot the file. we can't explicitly close the file since it will unload the file from test program.
    state.workspace.service.test_program.getSourceFileInfo(markerUri)!.isOpenByClient = false;

    const unresolved = evaluator.resolveAliasDeclaration(aliasDecls[0], /*resolveLocalNames*/ false);
    assert(!unresolved);

    const resolved = evaluator.resolveAliasDeclaration(aliasDecls[0], /*resolveLocalNames*/ false, {
        skipFileNeededCheck: true,
    });

    assert(resolved);
    assert(isFunctionDeclaration(resolved));
});

function testRelativeModuleName(code: string, expected: string | undefined, ignoreFolderStructure = false) {
    const state = parseAndGetTestState(code).state;
    const src = state.getMarkerByName('src')!.fileUri;
    const dest = state.getMarkerByName('dest')!.fileUri;

    assert.strictEqual(
        getRelativeModuleName(state.fs, src, dest, state.configOptions, ignoreFolderStructure),
        expected
    );
}

function testAddition(
    code: string,
    markerName: string,
    importNameInfo: ImportNameInfo | ImportNameInfo[],
    moduleName: string
) {
    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName(markerName)!;
    const parseResults = state.program.getBoundSourceFile(marker!.fileUri)!.getParseResults()!;

    const importStatement = getTopLevelImports(parseResults.parserOutput.parseTree).orderedImports.find(
        (i) => i.moduleName === moduleName
    )!;
    const edits = getTextEditsForAutoImportSymbolAddition(importNameInfo, importStatement, parseResults);

    const ranges = [...state.getRanges().filter((r) => !!r.marker?.data)];
    assert.strictEqual(edits.length, ranges.length, `${markerName} expects ${ranges.length} but got ${edits.length}`);

    testTextEdits(state, edits, ranges);
}

function testInsertions(
    code: string,
    markerName: string,
    importNameInfo: ImportNameWithModuleInfo | ImportNameWithModuleInfo[]
) {
    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName(markerName)!;
    const parseResults = state.program.getBoundSourceFile(marker!.fileUri)!.getParseResults()!;

    const importStatements = getTopLevelImports(parseResults.parserOutput.parseTree);
    const edits = getTextEditsForAutoImportInsertions(
        importNameInfo,
        importStatements,
        parseResults,
        convertOffsetToPosition(marker.position, parseResults.tokenizerOutput.lines)
    );

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
    importNameInfo = isArray(importNameInfo) ? importNameInfo : [importNameInfo];
    if (importNameInfo.length === 0) {
        importNameInfo.push({});
    }

    testInsertions(
        code,
        markerName,
        importNameInfo.map((i) => {
            return {
                module: {
                    moduleName,
                    importType,
                    isLocalTypingsFile: false,
                },
                name: i.name,
                alias: i.alias,
            };
        })
    );
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
