/*
 * typeEvaluator3.test.ts
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

test('Module1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['module1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Module2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['module2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Ellipsis1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['ellipsis1.pyi']);

    TestUtils.validateResults(analysisResults, 10);
});

test('Generator1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generator1.py']);

    TestUtils.validateResults(analysisResults, 12);
});

test('Generator2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generator2.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Generator3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generator3.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Generator4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generator4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Generator5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generator5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Generator6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generator6.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Generator7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generator7.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Generator8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generator8.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Generator9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generator9.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Generator10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generator10.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Generator11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generator11.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Generator12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generator12.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Generator13', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generator13.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Generator14', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generator14.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Generator15', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generator15.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Generator16', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generator16.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Await1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['await1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Await2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['await2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Coroutines1', () => {
    const configOptions = new ConfigOptions('.');

    // This functionality is deprecated in Python 3.11, so the type no longer
    // exists in typing.pyi after that point.
    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['coroutines1.py'], configOptions);

    TestUtils.validateResults(analysisResults, 4);
});

test('Coroutines2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['coroutines2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Coroutines3', () => {
    const configOptions = new ConfigOptions('.');

    // This functionality is deprecated in Python 3.11, so the type no longer
    // exists in typing.pyi after that point.
    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['coroutines3.py'], configOptions);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop1.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Loop2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop6.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop7.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop8.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop9.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop10.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop11.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Loop12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop12.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Loop13', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop13.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop14', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop14.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop15', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop15.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop16', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop16.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop17', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop17.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop18', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop18.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop19', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop19.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop20', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop20.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop21', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop21.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop22', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop22.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop23', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop23.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop24', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop24.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop25', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop25.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop26', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop26.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop27', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop27.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop28', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop28.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop29', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop29.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop30', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop30.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop31', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop31.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Loop32', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop32.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop33', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop33.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop34', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop34.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop35', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop35.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop36', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop36.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop37', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop37.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop38', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop38.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop39', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop39.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop40', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop40.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('ForLoop1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['forLoop1.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('ForLoop2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['forLoop2.py']);

    TestUtils.validateResults(analysisResults, 7);
});

test('Comprehension1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['comprehension1.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Comprehension2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['comprehension2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Comprehension3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['comprehension3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Comprehension4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['comprehension4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Comprehension5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['comprehension5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Comprehension6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['comprehension6.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('Comprehension7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['comprehension7.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Comprehension8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['comprehension8.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Comprehension9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['comprehension9.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Comprehension10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['comprehension10.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Literals1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['literals1.py']);

    TestUtils.validateResults(analysisResults, 7);
});

test('Literals2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['literals2.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Literals3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['literals3.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('Literals4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['literals4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Literals5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['literals5.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Literals6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['literals6.py']);

    TestUtils.validateResults(analysisResults, 26);
});

test('Literals7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['literals7.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('TypeAlias1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAlias1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeAlias2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAlias2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeAlias3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAlias3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeAlias4', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_9;
    const analysisResults3_9 = TestUtils.typeAnalyzeSampleFiles(['typeAlias4.py'], configOptions);
    TestUtils.validateResults(analysisResults3_9, 1);

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults3_10 = TestUtils.typeAnalyzeSampleFiles(['typeAlias4.py'], configOptions);
    TestUtils.validateResults(analysisResults3_10, 11);
});

test('TypeAlias5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAlias5.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('TypeAlias6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAlias6.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('TypeAlias7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAlias7.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeAlias8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAlias8.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeAlias9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAlias9.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('TypeAlias10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAlias10.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('TypeAlias11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAlias11.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('TypeAlias12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAlias12.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeAlias13', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAlias13.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeAlias14', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAlias14.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeAlias15', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAlias15.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeAlias16', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAlias16.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeAlias17', () => {
    const configOptions = new ConfigOptions('.');

    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['typeAlias17.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 4);

    configOptions.diagnosticRuleSet.reportMissingTypeArgument = 'error';
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['typeAlias17.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 11);
});

test('TypeAlias18', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAlias18.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('TypeAlias20', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAlias20.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeAlias21', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAlias21.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeAlias22', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAlias22.py']);

    TestUtils.validateResults(analysisResults, 6);
});

test('RecursiveTypeAlias1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['recursiveTypeAlias1.py']);

    TestUtils.validateResults(analysisResults, 13);
});

test('RecursiveTypeAlias2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['recursiveTypeAlias2.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('RecursiveTypeAlias3', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['recursiveTypeAlias3.py'], configOptions);

    TestUtils.validateResults(analysisResults, 4);
});

test('RecursiveTypeAlias4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['recursiveTypeAlias4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('RecursiveTypeAlias5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['recursiveTypeAlias5.pyi']);

    TestUtils.validateResults(analysisResults, 0);
});

test('RecursiveTypeAlias6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['recursiveTypeAlias6.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('RecursiveTypeAlias7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['recursiveTypeAlias7.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('RecursiveTypeAlias8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['recursiveTypeAlias8.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('RecursiveTypeAlias9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['recursiveTypeAlias9.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('RecursiveTypeAlias10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['recursiveTypeAlias10.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('RecursiveTypeAlias11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['recursiveTypeAlias11.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('RecursiveTypeAlias12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['recursiveTypeAlias12.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('RecursiveTypeAlias13', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['recursiveTypeAlias13.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('RecursiveTypeAlias14', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['recursiveTypeAlias14.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Classes1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classes1.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Classes3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classes3.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Classes4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classes4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Classes5', () => {
    const configOptions = new ConfigOptions('.');

    // By default, optional diagnostics are ignored.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['classes5.py'], configOptions);
    TestUtils.validateResults(analysisResults, 11);

    // Turn on reportIncompatibleVariableOverride.
    configOptions.diagnosticRuleSet.reportIncompatibleVariableOverride = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['classes5.py'], configOptions);
    TestUtils.validateResults(analysisResults, 36);
});

test('Classes6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classes6.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Classes7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classes7.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Classes8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classes8.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Classes9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classes9.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Classes10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classes10.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Classes11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classes11.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('Methods1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['methods1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('MethodOverride1', () => {
    const configOptions = new ConfigOptions('.');

    // By default, optional diagnostics are ignored.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['methodOverride1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    // Turn on errors.
    configOptions.diagnosticRuleSet.reportIncompatibleMethodOverride = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['methodOverride1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 36);
});

test('MethodOverride2', () => {
    const configOptions = new ConfigOptions('.');

    // By default, optional diagnostics are ignored.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['methodOverride2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    // Turn on errors.
    configOptions.diagnosticRuleSet.reportIncompatibleMethodOverride = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['methodOverride2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 6);
});

test('MethodOverride3', () => {
    const configOptions = new ConfigOptions('.');

    // By default, optional diagnostics are ignored.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['methodOverride3.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    // Turn on errors.
    configOptions.diagnosticRuleSet.reportIncompatibleMethodOverride = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['methodOverride3.py'], configOptions);
    TestUtils.validateResults(analysisResults, 5);
});

test('MethodOverride4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['methodOverride4.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('MethodOverride5', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['methodOverride5.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('MethodOverride6', () => {
    const configOptions = new ConfigOptions('.');

    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['methodOverride6.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 0);

    configOptions.diagnosticRuleSet.reportIncompatibleMethodOverride = 'error';
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['methodOverride6.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 2);
});

test('Enum1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['enum1.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Enum2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['enum2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Enum3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['enum3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Enum4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['enum4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Enum5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['enum5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Enum6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['enum6.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('Enum7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['enum7.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Enum8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['enum8.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('EnumAuto1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['enumAuto1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('EnumGenNextValue1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['enumGenNextValue1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeGuard1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeGuard1.py']);

    TestUtils.validateResults(analysisResults, 7);
});

test('TypeGuard2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeGuard2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeGuard3', () => {
    const configOptions = new ConfigOptions('.');
    configOptions.diagnosticRuleSet.enableExperimentalFeatures = true;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeGuard3.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('TypeGuard4', () => {
    const configOptions = new ConfigOptions('.');
    configOptions.diagnosticRuleSet.enableExperimentalFeatures = true;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeGuard4.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('Never1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['never1.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('Never2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['never2.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('TypePromotions1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typePromotions1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Index1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['index1.py']);

    TestUtils.validateResults(analysisResults, 10);
});

test('ProtocolModule2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocolModule2.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('ProtocolModule4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocolModule4.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('VariadicTypeVar1', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 12);
});

test('VariadicTypeVar2', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 13);
});

test('VariadicTypeVar3', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar3.py'], configOptions);
    TestUtils.validateResults(analysisResults, 5);
});

test('VariadicTypeVar4', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar4.py'], configOptions);
    TestUtils.validateResults(analysisResults, 3);
});

test('VariadicTypeVar5', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar5.py'], configOptions);
    TestUtils.validateResults(analysisResults, 8);
});

test('VariadicTypeVar6', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar6.py'], configOptions);
    TestUtils.validateResults(analysisResults, 8);
});

test('VariadicTypeVar7', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar7.py'], configOptions);
    TestUtils.validateResults(analysisResults, 6);
});

test('VariadicTypeVar8', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar8.py'], configOptions);
    TestUtils.validateResults(analysisResults, 5);
});

test('VariadicTypeVar9', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar9.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('VariadicTypeVar10', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar10.py'], configOptions);
    TestUtils.validateResults(analysisResults, 3);
});

test('VariadicTypeVar11', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar11.py'], configOptions);
    TestUtils.validateResults(analysisResults, 3);
});

test('VariadicTypeVar12', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar12.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('VariadicTypeVar13', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar13.py'], configOptions);
    TestUtils.validateResults(analysisResults, 1);
});

test('VariadicTypeVar14', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar14.py'], configOptions);
    TestUtils.validateResults(analysisResults, 6);
});

test('VariadicTypeVar15', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar15.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('VariadicTypeVar16', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar16.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('VariadicTypeVar17', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar17.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('VariadicTypeVar18', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar18.py'], configOptions);
    TestUtils.validateResults(analysisResults, 2);
});

test('VariadicTypeVar19', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar19.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('VariadicTypeVar20', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar20.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('VariadicTypeVar21', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar21.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('VariadicTypeVar22', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar22.py'], configOptions);
    TestUtils.validateResults(analysisResults, 3);
});

test('VariadicTypeVar23', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar23.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('VariadicTypeVar24', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar24.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('VariadicTypeVar25', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar25.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('Match1', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['match1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 21);
});

test('Match2', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['match2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 2);
});

test('Match3', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['match3.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('MatchSequence1', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['matchSequence1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 2);
});

test('MatchClass1', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['matchClass1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 4);
});

test('MatchClass2', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['matchClass2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('MatchClass3', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['matchClass3.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('MatchClass4', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['matchClass4.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('MatchClass5', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['matchClass5.py'], configOptions);
    TestUtils.validateResults(analysisResults, 5);
});

test('MatchValue1', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['matchValue1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('MatchMapping1', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['matchMapping1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 2);
});

test('MatchLiteral1', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['matchLiteral1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('MatchExhaustion1', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    configOptions.diagnosticRuleSet.reportMatchNotExhaustive = 'none';
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['matchExhaustion1.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 0);

    configOptions.diagnosticRuleSet.reportMatchNotExhaustive = 'error';
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['matchExhaustion1.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 4);
});

test('MatchUnnecessary1', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['matchUnnecessary1.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 0);

    configOptions.diagnosticRuleSet.reportUnnecessaryComparison = 'error';
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['matchUnnecessary1.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 7);
});

test('List1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['list1.py']);
    TestUtils.validateResults(analysisResults, 3);
});

test('List2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['list2.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('List3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['list3.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('Comparison1', () => {
    const configOptions = new ConfigOptions('.');

    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['comparison1.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 0);

    configOptions.diagnosticRuleSet.reportUnnecessaryComparison = 'error';
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['comparison1.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 7);
});

test('Comparison2', () => {
    const configOptions = new ConfigOptions('.');

    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['comparison2.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 0);

    configOptions.diagnosticRuleSet.reportUnnecessaryComparison = 'error';
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['comparison2.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 11);
});

test('EmptyContainers1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['emptyContainers1.py']);
    TestUtils.validateResults(analysisResults, 3);
});

test('InitSubclass1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['initsubclass1.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('InitSubclass2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['initsubclass2.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('None1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['none1.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('None2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['none2.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Constructor1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Constructor2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Constructor3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Constructor4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor4.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Constructor5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Constructor6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor6.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Constructor7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor7.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Constructor8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor8.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('Constructor9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor9.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Constructor10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor10.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Constructor11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor11.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Constructor12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor12.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Constructor13', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor13.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Constructor14', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor14.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Constructor15', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor15.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Constructor16', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor16.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Constructor17', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor17.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Constructor18', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor18.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Constructor19', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor19.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Constructor20', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor20.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Constructor21', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor21.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Constructor22', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor22.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Constructor23', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor23.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Constructor24', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.diagnosticRuleSet.strictParameterNoneValue = false;
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor24.py'], configOptions);
    TestUtils.validateResults(analysisResults, 4);

    configOptions.diagnosticRuleSet.strictParameterNoneValue = true;
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor24.py'], configOptions);
    TestUtils.validateResults(analysisResults, 4);
});

test('Constructor25', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor25.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Constructor26', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor26.py']);

    TestUtils.validateResults(analysisResults, 8);
});

test('Constructor27', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor27.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Constructor28', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor28.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Constructor29', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor29.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('InconsistentConstructor1', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.diagnosticRuleSet.reportInconsistentConstructor = 'none';
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['inconsistentConstructor1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    // Enable it as an error.
    configOptions.diagnosticRuleSet.reportInconsistentConstructor = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['inconsistentConstructor1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 2);
});

test('ClassGetItem1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classGetItem1.py']);

    TestUtils.validateResults(analysisResults, 0, 1);
});

test('UnusedCallResult1', () => {
    const configOptions = new ConfigOptions('.');

    // By default, this is disabled.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['unusedCallResult1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    // Enable it as an error.
    configOptions.diagnosticRuleSet.reportUnusedCallResult = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['unusedCallResult1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 4);
});

test('UnusedCoroutine1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['unusedCoroutine1.py']);
    TestUtils.validateResults(analysisResults, 2);
});

test('FunctionAnnotation1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['functionAnnotation1.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('FunctionAnnotation2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['functionAnnotation2.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('FunctionAnnotation3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['functionAnnotation3.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('FunctionAnnotation4', () => {
    const configOptions = new ConfigOptions('.');

    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['functionAnnotation4.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 0);

    configOptions.diagnosticRuleSet.reportTypeCommentUsage = 'error';
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['functionAnnotation4.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 3);
});

test('Subscript1', () => {
    const configOptions = new ConfigOptions('.');

    // Analyze with Python 3.8 settings.
    configOptions.defaultPythonVersion = PythonVersion.V3_8;
    const analysisResults38 = TestUtils.typeAnalyzeSampleFiles(['subscript1.py'], configOptions);
    TestUtils.validateResults(analysisResults38, 18);

    // Analyze with Python 3.8 settings.
    configOptions.defaultPythonVersion = PythonVersion.V3_9;
    const analysisResults39 = TestUtils.typeAnalyzeSampleFiles(['subscript1.py'], configOptions);
    TestUtils.validateResults(analysisResults39, 0);
});

test('Subscript2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['subscript2.py']);
    TestUtils.validateResults(analysisResults, 8);
});

test('Subscript3', () => {
    const configOptions = new ConfigOptions('.');

    // Analyze with Python 3.9 settings.
    configOptions.defaultPythonVersion = PythonVersion.V3_9;
    const analysisResults39 = TestUtils.typeAnalyzeSampleFiles(['subscript3.py'], configOptions);
    TestUtils.validateResults(analysisResults39, 37);

    // Analyze with Python 3.10 settings.
    // These are disabled because PEP 637 was rejected.
    // configOptions.defaultPythonVersion = PythonVersion.V3_10;
    // const analysisResults310 = TestUtils.typeAnalyzeSampleFiles(['subscript3.py'], configOptions);
    // TestUtils.validateResults(analysisResults310, 11);
});

test('Subscript4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['subscript4.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('Decorator1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['decorator1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Decorator2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['decorator2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Decorator3', () => {
    const configOptions = new ConfigOptions('.');

    // Analyze with Python 3.8 settings.
    configOptions.defaultPythonVersion = PythonVersion.V3_8;
    const analysisResults38 = TestUtils.typeAnalyzeSampleFiles(['decorator3.py'], configOptions);
    TestUtils.validateResults(analysisResults38, 3);

    // Analyze with Python 3.8 settings.
    configOptions.defaultPythonVersion = PythonVersion.V3_9;
    const analysisResults39 = TestUtils.typeAnalyzeSampleFiles(['decorator3.py'], configOptions);
    TestUtils.validateResults(analysisResults39, 0);
});

test('Decorator4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['decorator4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Decorator5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['decorator5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Decorator6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['decorator6.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Decorator7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['decorator7.py']);

    TestUtils.validateResults(analysisResults, 0);
});
