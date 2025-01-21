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
import {
    pythonVersion3_10,
    pythonVersion3_11,
    pythonVersion3_12,
    pythonVersion3_13,
    pythonVersion3_9,
} from '../common/pythonVersion';
import { Uri } from '../common/uri/uri';
import * as TestUtils from './testUtils';

test('Module1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['module1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Module2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['module2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Module3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['module3.py']);

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

test('Await3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['await3.py']);

    TestUtils.validateResults(analysisResults, 6);
});

test('Coroutines1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    // This functionality is deprecated in Python 3.11, so the type no longer
    // exists in typing.pyi after that point.
    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['coroutines1.py'], configOptions);

    TestUtils.validateResults(analysisResults, 5);
});

test('Coroutines2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['coroutines2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Coroutines3', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    // This functionality is deprecated in Python 3.11, so the type no longer
    // exists in typing.pyi after that point.
    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['coroutines3.py'], configOptions);

    TestUtils.validateResults(analysisResults, 0);
});

test('Coroutines4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['coroutines4.py']);

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

test('Loop41', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop41.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Loop42', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop42.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop43', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop43.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop44', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop44.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop45', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop45.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop46', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop46.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop47', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop47.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop48', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop48.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop49', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop49.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop50', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop50.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop51', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop51.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loop52', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loop52.py']);

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

test('Comprehension11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['comprehension11.py']);

    TestUtils.validateResults(analysisResults, 0);
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

    TestUtils.validateResults(analysisResults, 5);
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

    TestUtils.validateResults(analysisResults, 25);
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

    TestUtils.validateResults(analysisResults, 1);
});

test('TypeAlias4', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_9;
    const analysisResults3_9 = TestUtils.typeAnalyzeSampleFiles(['typeAlias4.py'], configOptions);
    TestUtils.validateResults(analysisResults3_9, 1);

    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults3_10 = TestUtils.typeAnalyzeSampleFiles(['typeAlias4.py'], configOptions);
    TestUtils.validateResults(analysisResults3_10, 12);
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
    const configOptions = new ConfigOptions(Uri.empty());

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
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_10;
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

test('RecursiveTypeAlias15', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_12;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['recursiveTypeAlias15.py'], configOptions);

    TestUtils.validateResults(analysisResults, 4);
});

test('RecursiveTypeAlias16', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_12;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['recursiveTypeAlias16.py'], configOptions);

    TestUtils.validateResults(analysisResults, 0);
});

test('Classes1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classes1.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Classes3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classes3.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Classes4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classes4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Classes5', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.diagnosticRuleSet.reportIncompatibleVariableOverride = 'none';
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['classes5.py'], configOptions);
    TestUtils.validateResults(analysisResults, 11);

    configOptions.diagnosticRuleSet.reportIncompatibleVariableOverride = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['classes5.py'], configOptions);
    TestUtils.validateResults(analysisResults, 35);
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

    TestUtils.validateResults(analysisResults, 2);
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
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.diagnosticRuleSet.reportIncompatibleMethodOverride = 'none';
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['methodOverride1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    configOptions.diagnosticRuleSet.reportIncompatibleMethodOverride = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['methodOverride1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 42);
});

test('MethodOverride2', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.diagnosticRuleSet.reportIncompatibleMethodOverride = 'none';
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['methodOverride2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    configOptions.diagnosticRuleSet.reportIncompatibleMethodOverride = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['methodOverride2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 6);
});

test('MethodOverride3', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.diagnosticRuleSet.reportIncompatibleMethodOverride = 'none';
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['methodOverride3.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    configOptions.diagnosticRuleSet.reportIncompatibleMethodOverride = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['methodOverride3.py'], configOptions);
    TestUtils.validateResults(analysisResults, 8);
});

test('MethodOverride4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['methodOverride4.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('MethodOverride5', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['methodOverride5.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('MethodOverride6', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.diagnosticRuleSet.reportIncompatibleMethodOverride = 'none';
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['methodOverride6.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 0);

    configOptions.diagnosticRuleSet.reportIncompatibleMethodOverride = 'error';
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['methodOverride6.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 3);
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

    TestUtils.validateResults(analysisResults, 0);
});

test('Enum8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['enum8.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Enum9', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['enum9.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 0);

    configOptions.defaultPythonVersion = pythonVersion3_13;
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['enum9.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 0);
});

test('Enum10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['enum10.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Enum11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['enum11.py']);

    TestUtils.validateResults(analysisResults, 8);
});

test('Enum12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['enum12.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Enum13', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['enum13.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('EnumAuto1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['enumAuto1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('EnumGenNextValue1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['enumGenNextValue1.py']);

    TestUtils.validateResults(analysisResults, 0);
});
