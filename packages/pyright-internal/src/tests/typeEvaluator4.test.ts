/*
 * typeEvaluator4.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Unit tests for pyright type evaluator. Tests are split
 * arbitrarily among multiple files so they can run in parallel.
 */

import * as assert from 'assert';

import { ConfigOptions } from '../common/configOptions';
import { PythonVersion } from '../common/pythonVersion';
import * as TestUtils from './testUtils';

test('Required1', () => {
    // Analyze with Python 3.10 settings.
    const configOptions = new ConfigOptions('.');
    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['required1.py'], configOptions);

    TestUtils.validateResults(analysisResults, 8);
});

test('Required2', () => {
    // Analyze with Python 3.10 settings.
    const configOptions = new ConfigOptions('.');
    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['required2.py'], configOptions);

    TestUtils.validateResults(analysisResults, 7);
});

test('Required3', () => {
    // Analyze with Python 3.10 settings.
    const configOptions = new ConfigOptions('.');
    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['required3.py'], configOptions);

    TestUtils.validateResults(analysisResults, 2);
});

test('Metaclass1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['metaclass1.py']);
    TestUtils.validateResults(analysisResults, 2);
});

test('Metaclass2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['metaclass2.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('Metaclass3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['metaclass3.py']);
    TestUtils.validateResults(analysisResults, 1);
});

test('Metaclass4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['metaclass4.py']);
    TestUtils.validateResults(analysisResults, 1);
});

test('Metaclass5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['metaclass5.py']);
    TestUtils.validateResults(analysisResults, 1);
});

test('Metaclass6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['metaclass6.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('Metaclass7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['metaclass7.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('Metaclass8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['metaclass8.py']);
    TestUtils.validateResults(analysisResults, 1);
});

test('Metaclass9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['metaclass9.py']);
    TestUtils.validateResults(analysisResults, 6);
});

test('Metaclass10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['metaclass10.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('AssignmentExpr1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignmentExpr1.py']);
    TestUtils.validateResults(analysisResults, 7);
});

test('AssignmentExpr2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignmentExpr2.py']);
    TestUtils.validateResults(analysisResults, 4);
});

test('AssignmentExpr3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignmentExpr3.py']);
    TestUtils.validateResults(analysisResults, 4);
});

test('AssignmentExpr4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignmentExpr4.py']);
    TestUtils.validateResults(analysisResults, 16);
});

test('AssignmentExpr5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignmentExpr5.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('AssignmentExpr6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignmentExpr6.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('AssignmentExpr7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignmentExpr7.py']);
    TestUtils.validateResults(analysisResults, 2);
});

test('AssignmentExpr8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignmentExpr8.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('AssignmentExpr9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignmentExpr9.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('Import1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['import1.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('Import2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['import2.py']);
    TestUtils.validateResults(analysisResults, 2);
});

test('Import4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['import4.py']);
    TestUtils.validateResults(analysisResults, 2);
});

test('Import6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['import6.py']);
    TestUtils.validateResults(analysisResults, 2);
});

test('Import7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['import7.py']);
    TestUtils.validateResults(analysisResults, 2);
});

test('Import9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['import9.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('Import10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['import10.py']);
    TestUtils.validateResults(analysisResults, 1);
});

test('Import11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['import11.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('Import12', () => {
    const configOptions = new ConfigOptions('.');

    // By default, optional diagnostics are ignored.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['import12.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0, 1);

    // Turn on error.
    configOptions.diagnosticRuleSet.reportWildcardImportFromLibrary = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['import12.py'], configOptions);
    TestUtils.validateResults(analysisResults, 1, 0);

    // Turn off diagnostic.
    configOptions.diagnosticRuleSet.reportWildcardImportFromLibrary = 'none';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['import12.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0, 0);
});

test('Import14', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['import14.py', 'import13.py']);

    assert.strictEqual(analysisResults.length, 2);
    assert.strictEqual(analysisResults[0].errors.length, 0);
    assert.strictEqual(analysisResults[1].errors.length, 0);
});

test('Import15', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['import15.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('Import16', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['import16.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('DunderAll1', () => {
    const configOptions = new ConfigOptions('.');

    // By default, reportUnsupportedDunderAll is a warning.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['dunderAll1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0, 7);

    // Turn on error.
    configOptions.diagnosticRuleSet.reportUnsupportedDunderAll = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['dunderAll1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 7, 0);

    // Turn off diagnostic.
    configOptions.diagnosticRuleSet.reportUnsupportedDunderAll = 'none';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['dunderAll1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0, 0);
});

test('DunderAll2', () => {
    const configOptions = new ConfigOptions('.');

    // By default, reportUnsupportedDunderAll is a warning.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['dunderAll2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0, 3);

    // Turn on error.
    configOptions.diagnosticRuleSet.reportUnsupportedDunderAll = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['dunderAll2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 3, 0);

    // Turn off diagnostic.
    configOptions.diagnosticRuleSet.reportUnsupportedDunderAll = 'none';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['dunderAll2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0, 0);
});

test('DunderAll3', () => {
    const configOptions = new ConfigOptions('.');

    // Turn on error.
    configOptions.diagnosticRuleSet.reportUnsupportedDunderAll = 'error';
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dunderAll3.pyi'], configOptions);
    TestUtils.validateResults(analysisResults, 0, 0);
});

test('Overload1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overload1.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('Overload2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overload2.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('Overload3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overload3.py']);
    TestUtils.validateResults(analysisResults, 1);
});

test('Overload4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overload4.py']);
    TestUtils.validateResults(analysisResults, 3);
});

test('Overload5', () => {
    const configOptions = new ConfigOptions('.');

    // By default, reportOverlappingOverload is off.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['overload5.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    configOptions.diagnosticRuleSet.reportOverlappingOverload = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['overload5.py'], configOptions);
    TestUtils.validateResults(analysisResults, 11);
});

test('Overload6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overload6.py']);
    TestUtils.validateResults(analysisResults, 2);
});

test('Overload7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overload7.py']);
    TestUtils.validateResults(analysisResults, 6);
});

test('Overload8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overload8.py']);
    TestUtils.validateResults(analysisResults, 2);
});

test('Overload9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overload9.py']);
    TestUtils.validateResults(analysisResults, 1);
});

test('Overload10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overload10.py']);
    TestUtils.validateResults(analysisResults, 1);
});

test('Overload11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overload11.py']);
    TestUtils.validateResults(analysisResults, 1);
});

test('Overload12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overload12.py']);
    TestUtils.validateResults(analysisResults, 1);
});

test('Overload13', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overload13.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('Overload14', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overload14.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('Overload15', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overload15.py']);
    TestUtils.validateResults(analysisResults, 9, 1);
});

test('Final1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['final1.py']);
    TestUtils.validateResults(analysisResults, 1);
});

test('Final2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['final2.py']);
    TestUtils.validateResults(analysisResults, 7);
});

test('Final3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['final3.py']);
    TestUtils.validateResults(analysisResults, 28);
});

test('Final4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['final4.pyi']);
    TestUtils.validateResults(analysisResults, 3);
});

test('Final5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['final5.py']);
    TestUtils.validateResults(analysisResults, 0);
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

test('FString1', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_11;
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['fstring1.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 14, 1);

    configOptions.defaultPythonVersion = PythonVersion.V3_12;
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['fstring1.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 10, 1);
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
    const configOptions = new ConfigOptions('.');

    // Analyze with Python 3.7 settings. This will generate errors.
    configOptions.defaultPythonVersion = PythonVersion.V3_7;
    const analysisResults37 = TestUtils.typeAnalyzeSampleFiles(['fstring5.py'], configOptions);
    TestUtils.validateResults(analysisResults37, 6);

    // Analyze with Python 3.8 settings.
    configOptions.defaultPythonVersion = PythonVersion.V3_8;
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
    TestUtils.validateResults(analysisResults, 3);
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
    TestUtils.validateResults(analysisResults, 3);
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
    TestUtils.validateResults(analysisResults, 0);
});

test('MemberAccess18', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['memberAccess18.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('MemberAccess19', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['memberAccess19.py']);
    TestUtils.validateResults(analysisResults, 5);
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

test('DataClassNamedTuple1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclassNamedTuple1.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('DataClassNamedTuple2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclassNamedTuple2.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('DataClass1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclass1.py']);

    TestUtils.validateResults(analysisResults, 6);
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

    TestUtils.validateResults(analysisResults, 4);
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

test('DataClassFrozen1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclassFrozen1.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('DataClassKwOnly1', () => {
    const configOptions = new ConfigOptions('.');
    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclassKwOnly1.py'], configOptions);

    TestUtils.validateResults(analysisResults, 3);
});

test('DataClassSlots1', () => {
    const configOptions = new ConfigOptions('.');
    configOptions.defaultPythonVersion = PythonVersion.V3_10;
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

    TestUtils.validateResults(analysisResults, 17);
});

test('DataClassConverter2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclassConverter2.py']);

    TestUtils.validateResults(analysisResults, 4);
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

    TestUtils.validateResults(analysisResults, 2);
});

test('Callable6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['callable6.py']);

    TestUtils.validateResults(analysisResults, 9);
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
    const configOptions = new ConfigOptions('.');

    // Analyze with Python 3.9 settings. This will generate errors.
    configOptions.defaultPythonVersion = PythonVersion.V3_9;
    const analysisResults3_9 = TestUtils.typeAnalyzeSampleFiles(['unions1.py'], configOptions);
    TestUtils.validateResults(analysisResults3_9, 11);

    // Analyze with Python 3.10 settings.
    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults3_10 = TestUtils.typeAnalyzeSampleFiles(['unions1.py'], configOptions);
    TestUtils.validateResults(analysisResults3_10, 0);
});

test('Unions2', () => {
    const configOptions = new ConfigOptions('.');

    // Analyze with Python 3.8 settings.
    configOptions.defaultPythonVersion = PythonVersion.V3_8;
    const analysisResults38 = TestUtils.typeAnalyzeSampleFiles(['unions2.py'], configOptions);
    TestUtils.validateResults(analysisResults38, 0);
});

test('Unions3', () => {
    const configOptions = new ConfigOptions('.');

    // Analyze with Python 3.9 settings. This will generate errors.
    configOptions.defaultPythonVersion = PythonVersion.V3_9;
    const analysisResults3_9 = TestUtils.typeAnalyzeSampleFiles(['unions3.py'], configOptions);
    TestUtils.validateResults(analysisResults3_9, 1);

    // Analyze with Python 3.10 settings.
    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults3_10 = TestUtils.typeAnalyzeSampleFiles(['unions3.py'], configOptions);
    TestUtils.validateResults(analysisResults3_10, 0);
});

test('Unions4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['unions4.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Unions5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['unions5.py']);

    TestUtils.validateResults(analysisResults, 8);
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
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_9;
    const analysisResults39 = TestUtils.typeAnalyzeSampleFiles(['paramSpec2.py'], configOptions);
    TestUtils.validateResults(analysisResults39, 9);

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults310 = TestUtils.typeAnalyzeSampleFiles(['paramSpec2.py'], configOptions);
    TestUtils.validateResults(analysisResults310, 0);
});

test('ParamSpec3', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec3.py']);
    TestUtils.validateResults(results, 1);
});

test('ParamSpec4', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec4.py']);
    TestUtils.validateResults(results, 7);
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
    TestUtils.validateResults(results, 5);
});

test('ParamSpec9', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec9.py']);
    TestUtils.validateResults(results, 13);
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
    TestUtils.validateResults(results, 16);
});

test('ParamSpec13', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec13.py']);
    TestUtils.validateResults(results, 6);
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
    TestUtils.validateResults(results, 2);
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

test('ClassVar1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classVar1.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('ClassVar2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classVar2.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('ClassVar3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classVar3.py']);

    TestUtils.validateResults(analysisResults, 10);
});

test('ClassVar4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classVar4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeVar1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVar1.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('TypeVar2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVar2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeVar3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVar3.py']);

    TestUtils.validateResults(analysisResults, 11);
});

test('TypeVar4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVar4.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('TypeVar5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVar5.py']);

    TestUtils.validateResults(analysisResults, 18);
});

test('TypeVar6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVar6.py']);

    TestUtils.validateResults(analysisResults, 20);
});

test('TypeVar7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVar7.py']);

    TestUtils.validateResults(analysisResults, 26);
});

test('TypeVar8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVar8.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('TypeVar9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVar9.py']);

    TestUtils.validateResults(analysisResults, 11);
});

test('TypeVar10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVar10.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeVar11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVar11.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeVar12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVar12.py']);

    TestUtils.validateResults(analysisResults, 6);
});

test('Annotated1', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_8;
    const analysisResults38 = TestUtils.typeAnalyzeSampleFiles(['annotated1.py'], configOptions);
    TestUtils.validateResults(analysisResults38, 4);

    configOptions.defaultPythonVersion = PythonVersion.V3_9;
    const analysisResults39 = TestUtils.typeAnalyzeSampleFiles(['annotated1.py'], configOptions);
    TestUtils.validateResults(analysisResults39, 3);
});

test('Annotated2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['annotated2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Circular1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['circular1.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Circular2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['circular2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TryExcept1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tryExcept1.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('TryExcept2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tryExcept2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TryExcept3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tryExcept3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TryExcept4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tryExcept4.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('TryExcept5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tryExcept5.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('TryExcept6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tryExcept6.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('TryExcept7', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['tryExcept7.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 3);

    configOptions.defaultPythonVersion = PythonVersion.V3_11;
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['tryExcept7.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 0);
});

test('TryExcept8', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tryExcept8.py'], configOptions);
    TestUtils.validateResults(analysisResults, 3);
});

test('TryExcept9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tryExcept9.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('TryExcept10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tryExcept10.py']);
    TestUtils.validateResults(analysisResults, 1);
});

test('Del1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['del1.py']);
    TestUtils.validateResults(analysisResults, 6);
});

test('Del2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['del2.py']);

    TestUtils.validateResults(analysisResults, 2);
});
