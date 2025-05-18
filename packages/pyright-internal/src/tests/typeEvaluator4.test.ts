/*
 * typeEvaluator4.test.ts
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
    pythonVersion3_7,
    pythonVersion3_8,
    pythonVersion3_9,
} from '../common/pythonVersion';
import { Uri } from '../common/uri/uri';
import * as TestUtils from './testUtils';

test('Final1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['final1.py']);
    TestUtils.validateResults(analysisResults, 1);
});

test('Final2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['final2.py']);
    TestUtils.validateResults(analysisResults, 15);
});

test('Final3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['final3.py']);
    TestUtils.validateResults(analysisResults, 41);
});

test('Final4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['final4.pyi']);
    TestUtils.validateResults(analysisResults, 3);
});

test('Final5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['final5.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('Final6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['final6.pyi']);
    TestUtils.validateResults(analysisResults, 2);
});

test('Final8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['final8.py']);
    TestUtils.validateResults(analysisResults, 4);
});

test('InferredTypes1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['inferredTypes1.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('InferredTypes2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['inferredTypes2.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('InferredTypes3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['inferredTypes3.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('CallSite2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['callSite2.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('CallSite3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['callSite3.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('FString1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['fstring1.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 15, 1);

    configOptions.defaultPythonVersion = pythonVersion3_12;
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['fstring1.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 11, 1);
});

test('FString2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['fstring2.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('FString3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['fstring3.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('FString4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['fstring4.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('FString5', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    // Analyze with Python 3.7 settings. This will generate errors.
    configOptions.defaultPythonVersion = pythonVersion3_7;
    const analysisResults37 = TestUtils.typeAnalyzeSampleFiles(['fstring5.py'], configOptions);
    TestUtils.validateResults(analysisResults37, 6);

    // Analyze with Python 3.8 settings.
    configOptions.defaultPythonVersion = pythonVersion3_8;
    const analysisResults38 = TestUtils.typeAnalyzeSampleFiles(['fstring5.py'], configOptions);
    TestUtils.validateResults(analysisResults38, 0);
});

test('MemberAccess1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['memberAccess1.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('MemberAccess2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['memberAccess2.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('MemberAccess3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['memberAccess3.py']);
    TestUtils.validateResults(analysisResults, 3);
});

test('MemberAccess4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['memberAccess4.py']);
    TestUtils.validateResults(analysisResults, 5);
});

test('MemberAccess5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['memberAccess5.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('MemberAccess6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['memberAccess6.py']);
    TestUtils.validateResults(analysisResults, 2);
});

test('MemberAccess7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['memberAccess7.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('MemberAccess8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['memberAccess8.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('MemberAccess9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['memberAccess9.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('MemberAccess10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['memberAccess10.py']);
    TestUtils.validateResults(analysisResults, 2);
});

test('MemberAccess11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['memberAccess11.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('MemberAccess12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['memberAccess12.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('MemberAccess13', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['memberAccess13.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('MemberAccess14', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['memberAccess14.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('MemberAccess15', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['memberAccess15.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('MemberAccess16', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['memberAccess16.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('MemberAccess17', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['memberAccess17.py']);
    TestUtils.validateResults(analysisResults, 5);
});

test('MemberAccess18', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['memberAccess18.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('MemberAccess19', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['memberAccess19.py']);
    TestUtils.validateResults(analysisResults, 10);
});

test('MemberAccess20', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['memberAccess20.py']);
    TestUtils.validateResults(analysisResults, 1);
});

test('MemberAccess21', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['memberAccess21.py']);
    TestUtils.validateResults(analysisResults, 1);
});

test('MemberAccess22', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['memberAccess22.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('MemberAccess23', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['memberAccess23.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('MemberAccess24', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['memberAccess24.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('MemberAccess25', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['memberAccess25.py']);
    TestUtils.validateResults(analysisResults, 12);
});

test('MemberAccess26', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['memberAccess26.py']);
    TestUtils.validateResults(analysisResults, 3);
});

test('MemberAccess27', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['memberAccess27.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('MemberAccess28', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['memberAccess28.py']);
    TestUtils.validateResults(analysisResults, 1);
});

test('DataClassNamedTuple1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclassNamedTuple1.py']);

    TestUtils.validateResults(analysisResults, 6);
});

test('DataClassNamedTuple2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclassNamedTuple2.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('DataClass1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclass1.py']);

    TestUtils.validateResults(analysisResults, 11);
});

test('DataClass2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclass2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('DataClass3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclass3.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('DataClass4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclass4.py']);

    TestUtils.validateResults(analysisResults, 6);
});

test('DataClass5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclass5.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('DataClass6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclass6.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('DataClass7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclass7.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('DataClass8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclass8.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('DataClass9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclass9.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('DataClass10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclass10.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('DataClass11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclass11.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('DataClass12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclass12.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('DataClass13', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclass13.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('DataClass14', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclass14.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('DataClass15', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclass15.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('DataClass16', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclass16.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('DataClass17', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclass17.py']);

    TestUtils.validateResults(analysisResults, 6);
});

test('DataClass18', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclass18.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('DataClassReplace1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_12;
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['dataclassReplace1.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 10);

    configOptions.defaultPythonVersion = pythonVersion3_13;
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['dataclassReplace1.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 4);
});

test('DataClassFrozen1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclassFrozen1.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('DataClassKwOnly1', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclassKwOnly1.py'], configOptions);

    TestUtils.validateResults(analysisResults, 3);
});

test('DataClassSlots1', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclassSlots1.py'], configOptions);

    TestUtils.validateResults(analysisResults, 5);
});

test('DataClassHash1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclassHash1.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('DataClassDescriptors1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclassDescriptors1.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('DataClassDescriptors2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclassDescriptors2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('DataClassConverter1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclassConverter1.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('DataClassConverter2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclassConverter2.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('DataClassConverter3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclassConverter3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('DataClassPostInit1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclassPostInit1.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('InitVar1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['initVar1.py']);

    TestUtils.validateResults(analysisResults, 2, 1);
});

test('Callable1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['callable1.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Callable2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['callable2.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Callable3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['callable3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Callable4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['callable4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Callable5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['callable5.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Callable6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['callable6.py']);

    TestUtils.validateResults(analysisResults, 9);
});

test('Callable7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['callable7.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Generic1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generic1.py']);

    TestUtils.validateResults(analysisResults, 9);
});

test('Generic2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generic2.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Generic3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['generic3.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Unions1', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.diagnosticRuleSet.disableBytesTypePromotions = true;

    // Analyze with Python 3.9 settings. This will generate errors.
    configOptions.defaultPythonVersion = pythonVersion3_9;
    const analysisResults3_9 = TestUtils.typeAnalyzeSampleFiles(['unions1.py'], configOptions);
    TestUtils.validateResults(analysisResults3_9, 11);

    // Analyze with Python 3.10 settings.
    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults3_10 = TestUtils.typeAnalyzeSampleFiles(['unions1.py'], configOptions);
    TestUtils.validateResults(analysisResults3_10, 0);
});

test('Unions2', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    // Analyze with Python 3.8 settings.
    configOptions.defaultPythonVersion = pythonVersion3_8;
    const analysisResults38 = TestUtils.typeAnalyzeSampleFiles(['unions2.py'], configOptions);
    TestUtils.validateResults(analysisResults38, 0);
});

test('Unions3', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    // Analyze with Python 3.9 settings. This will generate errors.
    configOptions.defaultPythonVersion = pythonVersion3_9;
    const analysisResults3_9 = TestUtils.typeAnalyzeSampleFiles(['unions3.py'], configOptions);
    TestUtils.validateResults(analysisResults3_9, 1);

    // Analyze with Python 3.10 settings.
    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults3_10 = TestUtils.typeAnalyzeSampleFiles(['unions3.py'], configOptions);
    TestUtils.validateResults(analysisResults3_10, 0);
});

test('Unions4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['unions4.py']);

    TestUtils.validateResults(analysisResults, 7);
});

test('Unions5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['unions5.py']);

    TestUtils.validateResults(analysisResults, 6);
});

test('Unions6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['unions6.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('ParamSpec1', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec1.py']);
    TestUtils.validateResults(results, 9);
});

test('ParamSpec2', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_9;
    const analysisResults39 = TestUtils.typeAnalyzeSampleFiles(['paramSpec2.py'], configOptions);
    TestUtils.validateResults(analysisResults39, 9);

    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults310 = TestUtils.typeAnalyzeSampleFiles(['paramSpec2.py'], configOptions);
    TestUtils.validateResults(analysisResults310, 0);
});

test('ParamSpec3', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec3.py']);
    TestUtils.validateResults(results, 3);
});

test('ParamSpec4', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec4.py']);
    TestUtils.validateResults(results, 10);
});

test('ParamSpec5', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec5.py']);
    TestUtils.validateResults(results, 0);
});

test('ParamSpec6', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec6.py']);
    TestUtils.validateResults(results, 0);
});

test('ParamSpec7', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec7.py']);
    TestUtils.validateResults(results, 0);
});

test('ParamSpec8', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec8.py']);
    TestUtils.validateResults(results, 7);
});

test('ParamSpec9', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec9.py']);
    TestUtils.validateResults(results, 14);
});

test('ParamSpec10', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec10.py']);
    TestUtils.validateResults(results, 0);
});

test('ParamSpec11', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec11.py']);
    TestUtils.validateResults(results, 0);
});

test('ParamSpec12', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec12.py']);
    TestUtils.validateResults(results, 14);
});

test('ParamSpec13', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec13.py']);
    TestUtils.validateResults(results, 11);
});

test('ParamSpec14', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec14.py']);
    TestUtils.validateResults(results, 0);
});

test('ParamSpec15', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec15.py']);
    TestUtils.validateResults(results, 0);
});

test('ParamSpec16', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec16.py']);
    TestUtils.validateResults(results, 0);
});

test('ParamSpec17', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec17.py']);
    TestUtils.validateResults(results, 0);
});

test('ParamSpec18', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec18.py']);
    TestUtils.validateResults(results, 0);
});

test('ParamSpec19', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec19.py']);
    TestUtils.validateResults(results, 0);
});

test('ParamSpec20', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec20.py']);
    TestUtils.validateResults(results, 8);
});

test('ParamSpec21', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec21.py']);
    TestUtils.validateResults(results, 0);
});

test('ParamSpec22', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec22.py']);
    TestUtils.validateResults(results, 0);
});

test('ParamSpec23', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec23.py']);
    TestUtils.validateResults(results, 0);
});

test('ParamSpec24', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec24.py']);
    TestUtils.validateResults(results, 0);
});

test('ParamSpec25', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec25.py']);
    TestUtils.validateResults(results, 0);
});

test('ParamSpec26', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec26.py']);
    TestUtils.validateResults(results, 0);
});

test('ParamSpec27', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec27.py']);
    TestUtils.validateResults(results, 2);
});

test('ParamSpec28', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec28.py']);
    TestUtils.validateResults(results, 0);
});

test('ParamSpec29', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec29.py']);
    TestUtils.validateResults(results, 3);
});

test('ParamSpec30', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec30.py']);
    TestUtils.validateResults(results, 0);
});

test('ParamSpec31', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec31.py']);
    TestUtils.validateResults(results, 0);
});

test('ParamSpec32', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec32.py']);
    TestUtils.validateResults(results, 4);
});

test('ParamSpec33', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec33.py']);
    TestUtils.validateResults(results, 4);
});

test('ParamSpec34', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec34.py']);
    TestUtils.validateResults(results, 0);
});

test('ParamSpec35', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec35.py']);
    TestUtils.validateResults(results, 1);
});

test('ParamSpec36', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec36.py']);
    TestUtils.validateResults(results, 3);
});

test('ParamSpec37', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec37.py']);
    TestUtils.validateResults(results, 0);
});

test('ParamSpec38', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec38.py']);
    TestUtils.validateResults(results, 0);
});

test('ParamSpec39', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec39.py']);
    TestUtils.validateResults(results, 0);
});

test('ParamSpec40', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec40.py']);
    TestUtils.validateResults(results, 0);
});

test('ParamSpec41', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec41.py']);
    TestUtils.validateResults(results, 1);
});

test('ParamSpec42', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec42.py']);
    TestUtils.validateResults(results, 0);
});

test('ParamSpec43', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec43.py']);
    TestUtils.validateResults(results, 0);
});

test('ParamSpec44', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec44.py']);
    TestUtils.validateResults(results, 0);
});

test('ParamSpec45', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec45.py']);
    TestUtils.validateResults(results, 0);
});

test('ParamSpec46', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec46.py']);
    TestUtils.validateResults(results, 2);
});

test('ParamSpec47', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec47.py']);
    TestUtils.validateResults(results, 3);
});

test('ParamSpec48', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec48.py']);
    TestUtils.validateResults(results, 0);
});

test('ParamSpec49', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec49.py']);
    TestUtils.validateResults(results, 8);
});

test('ParamSpec50', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec50.py']);
    TestUtils.validateResults(results, 2);
});

test('ParamSpec51', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec51.py']);
    TestUtils.validateResults(results, 0);
});

test('ParamSpec52', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec52.py']);
    TestUtils.validateResults(results, 2);
});

test('ParamSpec53', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec53.py']);
    TestUtils.validateResults(results, 0);
});

test('ParamSpec54', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec54.py']);
    TestUtils.validateResults(results, 0);
});

test('ParamSpec55', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec55.py']);
    TestUtils.validateResults(results, 1);
});

test('Slice1', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['slice1.py']);
    TestUtils.validateResults(results, 0);
});
