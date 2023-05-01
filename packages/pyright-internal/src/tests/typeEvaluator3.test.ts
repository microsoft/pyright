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

test('Generators1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generators1.py']);

    TestUtils.validateResults(analysisResults, 9);
});

test('Generators2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generators2.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Generators3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generators3.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Generators4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generators4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Generators5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generators5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Generators6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generators6.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Generators7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generators7.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Generators8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generators8.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Generators9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generators9.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Generators10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generators10.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Generators11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generators11.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Generators12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generators12.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Generators13', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generators13.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Generators14', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generators14.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Generators15', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generators15.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Generators16', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generators16.py']);

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

test('Loops1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops1.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Loops2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loops3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loops4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loops5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loops6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops6.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loops7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops7.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loops8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops8.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loops9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops9.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loops10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops10.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loops11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops11.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Loops12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops12.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Loops13', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops13.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loops14', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops14.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loops15', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops15.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loops16', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops16.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loops17', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops17.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loops18', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops18.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loops19', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops19.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loops20', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops20.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loops21', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops21.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loops22', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops22.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loops23', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops23.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loops24', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops24.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loops25', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops25.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loops26', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops26.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loops27', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops27.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loops28', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops28.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loops29', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops29.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loops30', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops30.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loops31', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops31.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Loops32', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops32.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loops33', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops33.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loops34', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops34.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loops35', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops35.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loops36', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops36.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Loops37', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['loops37.py']);

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

test('ListComprehension1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['listComprehension1.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('ListComprehension2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['listComprehension2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('ListComprehension3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['listComprehension3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('ListComprehension4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['listComprehension4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('ListComprehension5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['listComprehension5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('ListComprehension6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['listComprehension6.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('ListComprehension7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['listComprehension7.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('ListComprehension8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['listComprehension8.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('ListComprehension9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['listComprehension9.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('SetComprehension1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['setComprehension1.py']);

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

    TestUtils.validateResults(analysisResults, 4);
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
    TestUtils.validateResults(analysisResults2, 8);
});

test('TypeAlias18', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAlias18.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('TypeAlias20', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeAlias20.py']);

    TestUtils.validateResults(analysisResults, 0);
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

test('Classes1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classes1.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Classes3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classes3.py']);

    TestUtils.validateResults(analysisResults, 4);
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
    TestUtils.validateResults(analysisResults, 32);
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
    TestUtils.validateResults(analysisResults, 5);
});

test('MethodOverride3', () => {
    const configOptions = new ConfigOptions('.');

    // By default, optional diagnostics are ignored.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['methodOverride3.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    // Turn on errors.
    configOptions.diagnosticRuleSet.reportIncompatibleMethodOverride = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['methodOverride3.py'], configOptions);
    TestUtils.validateResults(analysisResults, 3);
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

test('Enums1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['enums1.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Enums2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['enums2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Enums3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['enums3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Enums4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['enums4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Enums5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['enums5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Enums6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['enums6.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Enums7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['enums7.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('Enums8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['enums8.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Enums9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['enums9.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Enums10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['enums10.py']);

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
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeGuard3.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('TypeGuard4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeGuard4.py']);

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

    TestUtils.validateResults(analysisResults, 7);
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
    TestUtils.validateResults(analysisResults, 2);
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
    TestUtils.validateResults(analysisResults, 2);
});

test('Match1', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['match1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 18);
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
    TestUtils.validateResults(analysisResults, 4);
});

test('Match4', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['match4.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('Match5', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['match5.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('Match6', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['match6.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('Match7', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['match7.py'], configOptions);
    TestUtils.validateResults(analysisResults, 2);
});

test('Match8', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['match8.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('Match9', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['match9.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('Match10', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    configOptions.diagnosticRuleSet.reportMatchNotExhaustive = 'none';
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['match10.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 0);

    configOptions.diagnosticRuleSet.reportMatchNotExhaustive = 'error';
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['match10.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 4);
});

test('Match11', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['match11.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 0);

    configOptions.diagnosticRuleSet.reportUnnecessaryComparison = 'error';
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['match11.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 7);
});

test('Match12', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['match12.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
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
    TestUtils.validateResults(analysisResults2, 10);
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
    TestUtils.validateResults(analysisResults, 5);
});

test('Subscript3', () => {
    const configOptions = new ConfigOptions('.');

    // Analyze with Python 3.9 settings.
    configOptions.defaultPythonVersion = PythonVersion.V3_9;
    const analysisResults39 = TestUtils.typeAnalyzeSampleFiles(['subscript3.py'], configOptions);
    TestUtils.validateResults(analysisResults39, 30);

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

    TestUtils.validateResults(analysisResults, 1);
});

test('Async1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['async1.py']);

    TestUtils.validateResults(analysisResults, 6);
});
