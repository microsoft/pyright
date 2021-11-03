/*
 * parseTreeUtils.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for parseTreeUtils module.
 */

import assert from 'assert';

import {
    getDottedName,
    getDottedNameWithGivenNodeAsLastName,
    getFirstAncestorOrSelfOfKind,
    getFirstNameOfDottedName,
    getFullStatementRange,
    getStringNodeValueRange,
    isFirstNameOfDottedName,
    isFromImportAlias,
    isFromImportModuleName,
    isFromImportName,
    isImportAlias,
    isImportModuleName,
    isLastNameOfDottedName,
} from '../analyzer/parseTreeUtils';
import { rangesAreEqual, TextRange } from '../common/textRange';
import { MemberAccessNode, NameNode, ParseNodeType, StringNode } from '../parser/parseNodes';
import { getNodeAtMarker, getNodeForRange, parseAndGetTestState, TestState } from './harness/fourslash/testState';

test('isImportModuleName', () => {
    const code = `
//// import [|/*marker*/os|]
    `;

    assert(isImportModuleName(getNodeAtMarker(code)));
});

test('isImportAlias', () => {
    const code = `
//// import os as [|/*marker*/os|]
    `;

    assert(isImportAlias(getNodeAtMarker(code)));
});

test('isFromImportModuleName', () => {
    const code = `
//// from [|/*marker*/os|] import path
    `;

    assert(isFromImportModuleName(getNodeAtMarker(code)));
});

test('isFromImportName', () => {
    const code = `
//// from . import [|/*marker*/os|]
    `;

    assert(isFromImportName(getNodeAtMarker(code)));
});

test('isFromImportAlias', () => {
    const code = `
//// from . import os as [|/*marker*/os|]
    `;

    assert(isFromImportAlias(getNodeAtMarker(code)));
});

test('getFirstAncestorOrSelfOfKind', () => {
    const code = `
//// import a.b.c
//// a.b.c.function(
////     1 + 2 + 3,
////     [|/*result*/a.b.c.function2(
////         [|/*marker*/"name"|]
////     )|]
//// )
    `;

    const state = parseAndGetTestState(code).state;
    const node = getFirstAncestorOrSelfOfKind(getNodeAtMarker(state), ParseNodeType.Call);
    assert(node);

    const result = state.getRangeByMarkerName('result')!;
    assert(node.nodeType === ParseNodeType.Call);
    assert(node.start === result.pos);
    assert(TextRange.getEnd(node) === result.end);
});

test('getDottedNameWithGivenNodeAsLastName', () => {
    const code = `
//// [|/*result1*/[|/*marker1*/a|]|]
//// [|/*result2*/a.[|/*marker2*/b|]|]
//// [|/*result3*/a.b.[|/*marker3*/c|]|]
//// [|/*result4*/a.[|/*marker4*/b|]|].c
//// [|/*result5*/[|/*marker5*/a|]|].b.c
    `;

    const state = parseAndGetTestState(code).state;

    for (let i = 1; i <= 5; i++) {
        const markerName = 'marker' + i;
        const resultName = 'result' + i;
        const node = getDottedNameWithGivenNodeAsLastName(getNodeAtMarker(state, markerName) as NameNode);
        const result = state.getRangeByMarkerName(resultName)!;

        assert(node.nodeType === ParseNodeType.Name || node.nodeType === ParseNodeType.MemberAccess);
        assert(node.start === result.pos);
        assert(TextRange.getEnd(node) === result.end);
    }
});

test('getDottedName', () => {
    const code = `
//// [|/*marker1*/a|]
//// [|/*marker2*/a.b|]
//// [|/*marker3*/a.b.c|]
//// [|/*marker4*/a.b|].c
//// [|/*marker5*/a|].b.c
    `;

    const state = parseAndGetTestState(code).state;

    assert.strictEqual(getDottedNameString('marker1'), 'a');
    assert.strictEqual(getDottedNameString('marker2'), 'a.b');
    assert.strictEqual(getDottedNameString('marker3'), 'a.b.c');
    assert.strictEqual(getDottedNameString('marker4'), 'a.b');
    assert.strictEqual(getDottedNameString('marker5'), 'a');

    function getDottedNameString(marker: string) {
        const node = getNodeForRange(state, marker);
        return getDottedName(node as NameNode | MemberAccessNode)
            ?.map((n) => n.value)
            .join('.');
    }
});

test('getFirstNameOfDottedName', () => {
    const code = `
//// [|/*marker1*/a|]
//// [|/*marker2*/a.b|]
//// [|/*marker3*/a.b.c|]
//// [|/*marker4*/a.b|].c
//// [|/*marker5*/a|].b.c
        `;

    const state = parseAndGetTestState(code).state;

    assert.strictEqual(getDottedNameString('marker1'), 'a');
    assert.strictEqual(getDottedNameString('marker2'), 'a');
    assert.strictEqual(getDottedNameString('marker3'), 'a');
    assert.strictEqual(getDottedNameString('marker4'), 'a');
    assert.strictEqual(getDottedNameString('marker5'), 'a');

    function getDottedNameString(marker: string) {
        const node = getNodeForRange(state, marker);
        return getFirstNameOfDottedName(node as NameNode | MemberAccessNode)?.value ?? '';
    }
});

test('isLastNameOfDottedName', () => {
    const code = `
//// [|/*marker1*/a|]
//// a.[|/*marker2*/b|]
//// a.b.[|/*marker3*/c|]
//// a.[|/*marker4*/b|].c
//// [|/*marker5*/a|].b.c
//// (a).[|/*marker6*/b|]
//// (a.b).[|/*marker7*/c|]
//// a().[|/*marker8*/b|]
//// a[0].[|/*marker9*/b|]
//// a.b([|/*marker10*/c|]).d
//// a.b.([|/*marker11*/c|])
//// a.[|/*marker12*/b|].c()
//// a.[|/*marker13*/b|]()
//// a.[|/*marker14*/b|][]
    `;

    const state = parseAndGetTestState(code).state;

    assert.strictEqual(isLastNameOfDottedName(getNodeAtMarker(state, 'marker1') as NameNode), true);
    assert.strictEqual(isLastNameOfDottedName(getNodeAtMarker(state, 'marker2') as NameNode), true);
    assert.strictEqual(isLastNameOfDottedName(getNodeAtMarker(state, 'marker3') as NameNode), true);
    assert.strictEqual(isLastNameOfDottedName(getNodeAtMarker(state, 'marker4') as NameNode), false);
    assert.strictEqual(isLastNameOfDottedName(getNodeAtMarker(state, 'marker5') as NameNode), false);
    assert.strictEqual(isLastNameOfDottedName(getNodeAtMarker(state, 'marker6') as NameNode), true);
    assert.strictEqual(isLastNameOfDottedName(getNodeAtMarker(state, 'marker7') as NameNode), true);
    assert.strictEqual(isLastNameOfDottedName(getNodeAtMarker(state, 'marker8') as NameNode), false);
    assert.strictEqual(isLastNameOfDottedName(getNodeAtMarker(state, 'marker9') as NameNode), false);
    assert.strictEqual(isLastNameOfDottedName(getNodeAtMarker(state, 'marker10') as NameNode), true);
    assert.strictEqual(isLastNameOfDottedName(getNodeAtMarker(state, 'marker11') as NameNode), true);
    assert.strictEqual(isLastNameOfDottedName(getNodeAtMarker(state, 'marker12') as NameNode), false);
    assert.strictEqual(isLastNameOfDottedName(getNodeAtMarker(state, 'marker13') as NameNode), true);
    assert.strictEqual(isLastNameOfDottedName(getNodeAtMarker(state, 'marker14') as NameNode), true);
});

test('isFirstNameOfDottedName', () => {
    const code = `
//// [|/*marker1*/a|]
//// a.[|/*marker2*/b|]
//// a.b.[|/*marker3*/c|]
//// a.[|/*marker4*/b|].c
//// [|/*marker5*/a|].b.c
//// ([|/*marker6*/a|]).b
//// (a.b).[|/*marker7*/c|]
//// [|/*marker8*/a|]().b
//// a[0].[|/*marker9*/b|]
//// a.b([|/*marker10*/c|]).d
//// a.b.([|/*marker11*/c|])
//// a.[|/*marker12*/b|].c()
//// [|/*marker13*/a|].b()
//// a.[|/*marker14*/b|][]
//// [|/*marker15*/a|][]
    `;

    const state = parseAndGetTestState(code).state;

    assert.strictEqual(isFirstNameOfDottedName(getNodeAtMarker(state, 'marker1') as NameNode), true);
    assert.strictEqual(isFirstNameOfDottedName(getNodeAtMarker(state, 'marker2') as NameNode), false);
    assert.strictEqual(isFirstNameOfDottedName(getNodeAtMarker(state, 'marker3') as NameNode), false);
    assert.strictEqual(isFirstNameOfDottedName(getNodeAtMarker(state, 'marker4') as NameNode), false);
    assert.strictEqual(isFirstNameOfDottedName(getNodeAtMarker(state, 'marker5') as NameNode), true);
    assert.strictEqual(isFirstNameOfDottedName(getNodeAtMarker(state, 'marker6') as NameNode), true);
    assert.strictEqual(isFirstNameOfDottedName(getNodeAtMarker(state, 'marker7') as NameNode), false);
    assert.strictEqual(isFirstNameOfDottedName(getNodeAtMarker(state, 'marker8') as NameNode), true);
    assert.strictEqual(isFirstNameOfDottedName(getNodeAtMarker(state, 'marker9') as NameNode), false);
    assert.strictEqual(isFirstNameOfDottedName(getNodeAtMarker(state, 'marker10') as NameNode), true);
    assert.strictEqual(isFirstNameOfDottedName(getNodeAtMarker(state, 'marker11') as NameNode), true);
    assert.strictEqual(isFirstNameOfDottedName(getNodeAtMarker(state, 'marker12') as NameNode), false);
    assert.strictEqual(isFirstNameOfDottedName(getNodeAtMarker(state, 'marker13') as NameNode), true);
    assert.strictEqual(isFirstNameOfDottedName(getNodeAtMarker(state, 'marker14') as NameNode), false);
    assert.strictEqual(isFirstNameOfDottedName(getNodeAtMarker(state, 'marker15') as NameNode), true);
});

test('getStringNodeValueRange', () => {
    const code = `
//// a = "[|/*marker1*/test|]"
//// b = '[|/*marker2*/test2|]'
//// c = '''[|/*marker3*/test3|]'''
    `;

    const state = parseAndGetTestState(code).state;

    for (let i = 1; i <= 3; i++) {
        const markerName = 'marker' + i;
        const range = getStringNodeValueRange(getNodeAtMarker(state, markerName) as StringNode);
        const result = state.getRangeByMarkerName(markerName)!;

        assert(range.start === result.pos);
        assert(TextRange.getEnd(range) === result.end);
    }
});

test('getFullStatementRange', () => {
    const code = `
//// [|/*marker1*/import a
//// |][|/*marker2*/a = 1; |][|/*marker3*/b = 2
//// |][|/*marker4*/if True:
////     pass|]
    `;

    const state = parseAndGetTestState(code).state;

    testRange(state, 'marker1', ParseNodeType.Import);
    testRange(state, 'marker2', ParseNodeType.Assignment);
    testRange(state, 'marker3', ParseNodeType.Assignment);
    testRange(state, 'marker4', ParseNodeType.If);

    function testRange(state: TestState, markerName: string, type: ParseNodeType) {
        const range = state.getRangeByMarkerName(markerName)!;
        const sourceFile = state.program.getBoundSourceFile(range.marker!.fileName)!;

        const statementNode = getFirstAncestorOrSelfOfKind(getNodeAtMarker(state, markerName), type)!;
        const statementRange = getFullStatementRange(statementNode, sourceFile.getParseResults()!.tokenizerOutput);

        const expectedRange = state.convertPositionRange(range);

        assert(rangesAreEqual(expectedRange, statementRange));
    }
});
