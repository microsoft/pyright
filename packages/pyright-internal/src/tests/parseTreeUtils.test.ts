/*
 * parseTreeUtils.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for parseTreeUtils module.
 */

import assert from 'assert';

import {
    getDottedNameWithGivenNodeAsLastName,
    getFirstAncestorOrSelfOfKind,
    getFullStatementRange,
    getStringNodeValueRange,
    isFromImportAlias,
    isFromImportModuleName,
    isFromImportName,
    isImportAlias,
    isImportModuleName,
} from '../analyzer/parseTreeUtils';
import { rangesAreEqual, TextRange } from '../common/textRange';
import { NameNode, ParseNodeType, StringNode } from '../parser/parseNodes';
import { getNodeAtMarker, parseAndGetTestState, TestState } from './harness/fourslash/testState';

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
