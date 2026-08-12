/*
 * typeCache.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Tests for the type server cache.
 */

import * as AnalyzerNodeInfo from '../../analyzer/analyzerNodeInfo';
import { Uri } from '../../common/uri/uri';
import { TypeCache } from '../../typeServer/typeCache';
import { getNodeAtMarker, parseAndGetTestState } from '../harness/fourslash/testState';

test('bound owner URI wins over poisoned active and shared fallbacks', () => {
    const state = parseAndGetTestState(`
// @filename: main.py
//// [|/*value*/value|] = 1
// @filename: wrong.py
//// [|/*wrong*/wrong|] = 2
    `).state;
    while (state.program.analyze()) {
        // Continue until analysis completes.
    }

    const valueRange = state.getRangeByMarkerName('value')!;
    const wrongUri = state.getRangeByMarkerName('wrong')!.fileUri;
    const node = getNodeAtMarker(state, 'value');
    const root = state.program.getParseResults(valueRange.fileUri)!.parserOutput.parseTree;
    expect(AnalyzerNodeInfo.getFileInfoIfAvailable(node, state.program.analyzerNodeInfoContext)).toBeDefined();

    const cache = new TypeCache(state.program.serviceProvider, () => undefined);
    const parseTreeUris = Reflect.get(cache, '_parseTreeUris') as WeakMap<object, Uri>;
    parseTreeUris.set(root.a, wrongUri);
    const activeFallback = jest.fn(() => wrongUri);

    expect(cache.getUri(node, state.program.analyzerNodeInfoContext, activeFallback).toString()).toBe(
        valueRange.fileUri.toString()
    );
    expect(activeFallback).not.toHaveBeenCalled();
    expect(parseTreeUris.get(root.a)?.toString()).toBe(wrongUri.toString());
});
