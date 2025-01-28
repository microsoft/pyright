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
import { pythonVersion3_11, pythonVersion3_12, pythonVersion3_13 } from '../common/pythonVersion';
import { Uri } from '../common/uri/uri';
import * as TestUtils from './testUtils';

test('TypeParams1', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.defaultPythonVersion = pythonVersion3_12;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeParams1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 6);
});

test('TypeParams2', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['typeParams2.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 2);

    configOptions.defaultPythonVersion = pythonVersion3_12;
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['typeParams2.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 0);
});

test('TypeParams3', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.defaultPythonVersion = pythonVersion3_12;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeParams3.py'], configOptions);
    TestUtils.validateResults(analysisResults, 8);
});

test('TypeParams4', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.defaultPythonVersion = pythonVersion3_12;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeParams4.py'], configOptions);
    TestUtils.validateResults(analysisResults, 2);
});

test('TypeParams5', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.defaultPythonVersion = pythonVersion3_12;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeParams5.py'], configOptions);
    TestUtils.validateResults(analysisResults, 9);
});

test('TypeParams6', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.defaultPythonVersion = pythonVersion3_12;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeParams6.py'], configOptions);
    TestUtils.validateResults(analysisResults, 3);
});

test('TypeParams7', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.defaultPythonVersion = pythonVersion3_12;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeParams7.py'], configOptions);
    TestUtils.validateResults(analysisResults, 4);
});

test('TypeParams8', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.defaultPythonVersion = pythonVersion3_12;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeParams8.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('AutoVariance1', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.defaultPythonVersion = pythonVersion3_12;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['autoVariance1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 16);
});

test('AutoVariance2', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.defaultPythonVersion = pythonVersion3_12;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['autoVariance2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('AutoVariance3', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.defaultPythonVersion = pythonVersion3_12;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['autoVariance3.py'], configOptions);
    TestUtils.validateResults(analysisResults, 18);
});

test('AutoVariance4', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.defaultPythonVersion = pythonVersion3_12;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['autoVariance4.py'], configOptions);
    TestUtils.validateResults(analysisResults, 4);
});

test('AutoVariance5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['autoVariance5.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('TypeAliasStatement1', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.defaultPythonVersion = pythonVersion3_12;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAliasStatement1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 10);
});

test('TypeAliasStatement2', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['typeAliasStatement2.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 1);

    configOptions.defaultPythonVersion = pythonVersion3_12;
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['typeAliasStatement2.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 0);
});

test('TypeAliasStatement3', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.defaultPythonVersion = pythonVersion3_12;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAliasStatement3.py'], configOptions);
    TestUtils.validateResults(analysisResults, 2);
});

test('TypeAliasStatement4', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.defaultPythonVersion = pythonVersion3_12;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAliasStatement4.py'], configOptions);
    TestUtils.validateResults(analysisResults, 5);
});

test('TypeAliasStatement5', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.defaultPythonVersion = pythonVersion3_12;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAliasStatement5.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('Hashability1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['hashability1.py']);
    TestUtils.validateResults(analysisResults, 10);
});

test('Hashability2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['hashability2.py']);
    TestUtils.validateResults(analysisResults, 6);
});

test('Hashability3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['hashability3.py']);
    TestUtils.validateResults(analysisResults, 1);
});

test('Override1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['override1.py']);
    TestUtils.validateResults(analysisResults, 5);
});

test('Override2', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['override2.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 0);

    configOptions.diagnosticRuleSet.reportImplicitOverride = 'error';
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['override2.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 2);
});

test('TypeVarDefault1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarDefault1.py']);
    TestUtils.validateResults(analysisResults, 14);
});

test('TypeVarDefault2', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.defaultPythonVersion = pythonVersion3_13;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarDefault2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 24);
});

test('TypeVarDefault3', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.defaultPythonVersion = pythonVersion3_13;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarDefault3.py'], configOptions);
    TestUtils.validateResults(analysisResults, 8);
});

test('TypeVarDefault4', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.defaultPythonVersion = pythonVersion3_13;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarDefault4.py'], configOptions);
    TestUtils.validateResults(analysisResults, 3);
});

test('TypeVarDefault5', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.defaultPythonVersion = pythonVersion3_13;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarDefault5.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('TypeVarDefaultClass1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarDefaultClass1.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('TypeVarDefaultClass2', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.defaultPythonVersion = pythonVersion3_13;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarDefaultClass2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 10);
});

test('TypeVarDefaultClass3', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.defaultPythonVersion = pythonVersion3_13;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarDefaultClass3.py'], configOptions);
    TestUtils.validateResults(analysisResults, 9);
});

test('TypeVarDefaultClass4', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.defaultPythonVersion = pythonVersion3_13;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarDefaultClass4.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('TypeVarDefaultTypeAlias1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarDefaultTypeAlias1.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('TypeVarDefaultTypeAlias2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarDefaultTypeAlias2.py']);
    TestUtils.validateResults(analysisResults, 11);
});

test('TypeVarDefaultTypeAlias3', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.defaultPythonVersion = pythonVersion3_13;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarDefaultTypeAlias3.py'], configOptions);
    TestUtils.validateResults(analysisResults, 10);
});

test('TypeVarDefaultFunction1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarDefaultFunction1.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('TypeVarDefaultFunction2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarDefaultFunction2.py']);
    TestUtils.validateResults(analysisResults, 1);
});

test('TypeVarDefaultFunction3', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.defaultPythonVersion = pythonVersion3_13;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarDefaultFunction3.py'], configOptions);
    TestUtils.validateResults(analysisResults, 1);
});

test('FutureImport1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['futureImport1.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('FutureImport2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['futureImport2.py']);
    TestUtils.validateResults(analysisResults, 2);
});

test('FutureImport3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['futureImport3.py']);
    TestUtils.validateResults(analysisResults, 1);
});

test('Conditional1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['conditional1.py']);
    TestUtils.validateResults(analysisResults, 15);
});

test('TypePrinter1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typePrinter1.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('TypePrinter3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typePrinter3.py']);
    TestUtils.validateResults(analysisResults, 2);
});

test('TypeAliasType1', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.defaultPythonVersion = pythonVersion3_12;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAliasType1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 15);
});

test('TypeAliasType2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAliasType2.py']);
    TestUtils.validateResults(analysisResults, 6);
});

test('TypedDictReadOnly1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDictReadOnly1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 4);
});

test('TypedDictReadOnly2', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDictReadOnly2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 17);
});

test('TypedDictClosed1', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.diagnosticRuleSet.enableExperimentalFeatures = true;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDictClosed1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 6);
});

test('TypedDictClosed2', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.diagnosticRuleSet.enableExperimentalFeatures = true;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDictClosed2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 4);
});

test('TypedDictClosed3', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.diagnosticRuleSet.enableExperimentalFeatures = true;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDictClosed3.py'], configOptions);
    TestUtils.validateResults(analysisResults, 10);
});

test('TypedDictClosed4', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.diagnosticRuleSet.enableExperimentalFeatures = true;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDictClosed4.py'], configOptions);
    TestUtils.validateResults(analysisResults, 5);
});

test('TypedDictClosed5', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.diagnosticRuleSet.enableExperimentalFeatures = true;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDictClosed5.py'], configOptions);
    TestUtils.validateResults(analysisResults, 1);
});

test('TypedDictClosed6', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.diagnosticRuleSet.enableExperimentalFeatures = true;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDictClosed6.py'], configOptions);
    TestUtils.validateResults(analysisResults, 8);
});

test('TypedDictClosed7', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.diagnosticRuleSet.enableExperimentalFeatures = true;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDictClosed7.py'], configOptions);
    TestUtils.validateResults(analysisResults, 6);
});

test('TypedDictClosed8', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.diagnosticRuleSet.enableExperimentalFeatures = true;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDictClosed8.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('TypedDictClosed9', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.diagnosticRuleSet.enableExperimentalFeatures = true;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDictClosed9.py'], configOptions);
    TestUtils.validateResults(analysisResults, 1);
});

test('DataclassTransform1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclassTransform1.py']);

    TestUtils.validateResults(analysisResults, 6);
});

test('DataclassTransform2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclassTransform2.py']);

    TestUtils.validateResults(analysisResults, 6);
});

test('DataclassTransform3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclassTransform3.py']);

    TestUtils.validateResults(analysisResults, 6);
});

test('DataclassTransform4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclassTransform4.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Async1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['async1.py']);

    TestUtils.validateResults(analysisResults, 6);
});

test('TypeCheckOnly1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeCheckOnly1.py']);
    TestUtils.validateResults(analysisResults, 4);
});

test('NoTypeCheck1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['noTypeCheck1.py']);
    TestUtils.validateResults(analysisResults, 2);
});
