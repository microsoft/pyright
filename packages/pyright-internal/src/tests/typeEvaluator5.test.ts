/*
 * typeEvaluator5.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Unit tests for pyright type evaluator. Tests are split
 * arbitrarily among multiple files so they can run in parallel.
 */

import { ConfigOptions } from '../common/configOptions';
import { PythonVersion } from '../common/pythonVersion';
import * as TestUtils from './testUtils';

test('TypeParams1', () => {
    const configOptions = new ConfigOptions('.');
    configOptions.defaultPythonVersion = PythonVersion.V3_12;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeParams1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 4);
});

test('TypeParams2', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_11;
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['typeParams2.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 2);

    configOptions.defaultPythonVersion = PythonVersion.V3_12;
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['typeParams2.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 0);
});

test('TypeParams3', () => {
    const configOptions = new ConfigOptions('.');
    configOptions.defaultPythonVersion = PythonVersion.V3_12;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeParams3.py'], configOptions);
    TestUtils.validateResults(analysisResults, 7);
});

test('TypeParams4', () => {
    const configOptions = new ConfigOptions('.');
    configOptions.defaultPythonVersion = PythonVersion.V3_12;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeParams4.py'], configOptions);
    TestUtils.validateResults(analysisResults, 2);
});

test('TypeParams5', () => {
    const configOptions = new ConfigOptions('.');
    configOptions.defaultPythonVersion = PythonVersion.V3_12;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeParams5.py'], configOptions);
    TestUtils.validateResults(analysisResults, 7);
});

test('TypeParams6', () => {
    const configOptions = new ConfigOptions('.');
    configOptions.defaultPythonVersion = PythonVersion.V3_12;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeParams6.py'], configOptions);
    TestUtils.validateResults(analysisResults, 2);
});

test('TypeParams7', () => {
    const configOptions = new ConfigOptions('.');
    configOptions.defaultPythonVersion = PythonVersion.V3_12;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeParams7.py'], configOptions);
    TestUtils.validateResults(analysisResults, 4);
});

test('AutoVariance1', () => {
    const configOptions = new ConfigOptions('.');
    configOptions.defaultPythonVersion = PythonVersion.V3_12;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['autoVariance1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 11);
});

test('AutoVariance2', () => {
    const configOptions = new ConfigOptions('.');
    configOptions.defaultPythonVersion = PythonVersion.V3_12;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['autoVariance2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('AutoVariance3', () => {
    const configOptions = new ConfigOptions('.');
    configOptions.defaultPythonVersion = PythonVersion.V3_12;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['autoVariance3.py'], configOptions);
    TestUtils.validateResults(analysisResults, 13);
});

test('TypeAliasStatement1', () => {
    const configOptions = new ConfigOptions('.');
    configOptions.defaultPythonVersion = PythonVersion.V3_12;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAliasStatement1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 1);
});

test('TypeAliasStatement2', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_11;
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['typeAliasStatement2.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 1);

    configOptions.defaultPythonVersion = PythonVersion.V3_12;
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['typeAliasStatement2.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 0);
});

test('TypeAliasStatement3', () => {
    const configOptions = new ConfigOptions('.');
    configOptions.defaultPythonVersion = PythonVersion.V3_12;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAliasStatement3.py'], configOptions);
    TestUtils.validateResults(analysisResults, 2);
});

test('TypeAliasStatement4', () => {
    const configOptions = new ConfigOptions('.');
    configOptions.defaultPythonVersion = PythonVersion.V3_12;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAliasStatement4.py'], configOptions);
    TestUtils.validateResults(analysisResults, 5);
});
