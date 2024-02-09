/*
 * runner.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Provide APIs to run fourslash tests from provided fourslash markup contents
 */

import * as ts from 'typescript';

import { combinePaths } from '../../../common/pathUtils';
import * as host from '../testHost';
import { parseTestData } from './fourSlashParser';
import { FourSlashData } from './fourSlashTypes';
import { HostSpecificFeatures, TestState } from './testState';
import { Consts } from './testState.Consts';

export type TestStateFactory = (
    basePath: string,
    testData: FourSlashData,
    mountPaths?: Map<string, string>,
    hostSpecificFeatures?: HostSpecificFeatures
) => TestState;

/**
 * run given fourslash test file
 *
 * @param basePath this is used as a base path of the virtual file system the test will run upon
 * @param fileName this is the file path where fourslash test file will be read from
 */
export function runFourSlashTest(
    basePath: string,
    fileName: string,
    cb?: jest.DoneCallback,
    mountPaths?: Map<string, string>,
    hostSpecificFeatures?: HostSpecificFeatures,
    testStateFactory?: TestStateFactory
) {
    const content = host.HOST.readFile(fileName)!;
    runFourSlashTestContent(basePath, fileName, content, cb, mountPaths, hostSpecificFeatures, testStateFactory);
}

/**
 * run given fourslash markup content
 *
 * @param basePath  this is used as a base path of the virtual file system the test will run upon
 * @param fileName this will be used as a filename of the given `content` in the virtual file system
 *                 if fourslash markup `content` doesn't have explicit `@filename` option
 * @param content  this is fourslash markup string
 */
export function runFourSlashTestContent(
    basePath: string,
    fileName: string,
    content: string,
    cb?: jest.DoneCallback,
    mountPaths?: Map<string, string>,
    hostSpecificFeatures?: HostSpecificFeatures,
    testStateFactory?: TestStateFactory
) {
    // give file paths an absolute path for the virtual file system
    const absoluteBasePath = combinePaths('/', basePath);
    const absoluteFileName = combinePaths('/', fileName);

    // parse out the files and their metadata
    const testData = parseTestData(absoluteBasePath, content, absoluteFileName);
    const state =
        testStateFactory !== undefined
            ? testStateFactory(absoluteBasePath, testData, mountPaths, hostSpecificFeatures)
            : new TestState(absoluteBasePath, testData, mountPaths, hostSpecificFeatures);
    const output = ts.transpileModule(content, {
        reportDiagnostics: true,
        compilerOptions: { target: ts.ScriptTarget.ES2019 },
    });
    if (output.diagnostics!.length > 0) {
        throw new Error(`Syntax error in ${absoluteBasePath}: ${output.diagnostics![0].messageText}`);
    }

    runCode(output.outputText, state, cb);
}

async function runCode(code: string, state: TestState, cb?: jest.DoneCallback) {
    // Compile and execute the test
    try {
        const wrappedCode = `(async function(helper, Consts) {
${code}
})`;
        const f = eval(wrappedCode); // CodeQL [SM01632] test code that doesn't need to be secure.
        await f(state, Consts);
        markDone();
    } catch (ex) {
        markDone(ex);
    }

    function markDone(...args: any[]) {
        if (cb) {
            cb(...args);
        }
        state.dispose();
    }
}
