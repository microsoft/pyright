/*
 * analyzerNodeInfo.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

import assert from 'assert';

import { AnalyzerFileInfo } from '../analyzer/analyzerFileInfo';
import { AnalyzerNodeInfoContextImpl, AnalyzerNodeInfoStore } from '../analyzer/analyzerNodeInfo';
import { DiagnosticSink } from '../common/diagnosticSink';
import { ModuleNode } from '../parser/parseNodes';
import * as TestUtils from './testUtils';

test('store keeps node information independent across parse trees', () => {
    const firstRoot = parseModule('first = 1');
    const secondRoot = parseModule('second = 2');
    const store = new AnalyzerNodeInfoStore();

    store.getOrCreate(firstRoot).codeFlowComplexity = 1;
    store.getOrCreate(secondRoot).codeFlowComplexity = 2;

    assert.equal(store.get(firstRoot)?.codeFlowComplexity, 1);
    assert.equal(store.get(secondRoot)?.codeFlowComplexity, 2);
});

test('context preserves layered lookup behavior across overlay enter/discard', () => {
    const root = parseModule('value = 1');
    const context = new AnalyzerNodeInfoContextImpl();
    const baseStore = createStore(root, 1);
    const overlayStore = createStore(root, 2);

    context.registerStore(root, baseStore);
    context.enterOverlay();
    assert.equal(context.get(root)?.codeFlowComplexity, 1);

    context.registerStore(root, overlayStore);
    assert.equal(context.get(root)?.codeFlowComplexity, 2);

    context.discardOverlay();
    assert.equal(context.get(root)?.codeFlowComplexity, 1);

    context.enterOverlay();
    context.remove(root);
    assert.equal(context.get(root), undefined);
    context.discardOverlay();
    assert.equal(context.get(root)?.codeFlowComplexity, 1);
});

test('context fast path returns undefined after base-layer remove and recovers on reregister', () => {
    const root = parseModule('value = 1');
    const context = new AnalyzerNodeInfoContextImpl();

    // Only the base layer exists here, so these operations exercise the single-layer fast path.
    context.registerStore(root, createStore(root, 1));
    assert.equal(context.get(root)?.codeFlowComplexity, 1);

    context.remove(root);
    assert.equal(context.get(root), undefined);

    context.registerStore(root, createStore(root, 3));
    assert.equal(context.get(root)?.codeFlowComplexity, 3);
});

test('context getFileInfo fast path handles base-layer register/remove/reregister', () => {
    const root = parseModule('value = 1');
    const context = new AnalyzerNodeInfoContextImpl();

    // Only the base layer exists here, so these operations exercise the single-layer
    // fast path in getFileInfo (the removedKeys tombstone check is skipped).
    const firstFileInfo = {} as AnalyzerFileInfo;
    context.registerStore(root, createStoreWithFileInfo(root, firstFileInfo));
    assert.equal(context.getFileInfo(root), firstFileInfo);

    context.remove(root);
    assert.equal(context.getFileInfo(root), undefined);

    const secondFileInfo = {} as AnalyzerFileInfo;
    context.registerStore(root, createStoreWithFileInfo(root, secondFileInfo));
    assert.equal(context.getFileInfo(root), secondFileInfo);
});

test('context retains removed stores for one cache generation', () => {
    const firstRoot = parseModule('first = 1');
    const secondRoot = parseModule('second = 2');
    const context = new AnalyzerNodeInfoContextImpl();
    const firstFileInfo = {} as AnalyzerFileInfo;
    const secondFileInfo = {} as AnalyzerFileInfo;

    context.registerStore(firstRoot, createStoreWithFileInfo(firstRoot, firstFileInfo));
    context.retainRemovedStore(firstRoot);
    assert.equal(context.getFileInfo(firstRoot), firstFileInfo);

    context.clearRetainedStores();
    assert.equal(context.getFileInfo(firstRoot), undefined);

    context.registerStore(secondRoot, createStoreWithFileInfo(secondRoot, secondFileInfo));
    context.retainRemovedStore(secondRoot);
    assert.equal(context.getFileInfo(secondRoot), secondFileInfo);

    context.remove(secondRoot);
    assert.equal(context.getFileInfo(secondRoot), undefined);
});

function parseModule(code: string): ModuleNode {
    return TestUtils.parseText(code, new DiagnosticSink()).parserOutput.parseTree;
}

function createStore(root: ModuleNode, complexity: number) {
    const store = new AnalyzerNodeInfoStore();
    store.getOrCreate(root).codeFlowComplexity = complexity;
    return store;
}

function createStoreWithFileInfo(root: ModuleNode, fileInfo: AnalyzerFileInfo) {
    const store = new AnalyzerNodeInfoStore();
    store.setFileInfo(root, fileInfo);
    return store;
}
