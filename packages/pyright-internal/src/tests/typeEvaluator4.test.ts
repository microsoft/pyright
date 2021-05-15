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

test('Metaclass1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['metaclass1.py']);
    TestUtils.validateResults(analysisResults, 0);
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

test('AssignmentExpr1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignmentExpr1.py']);
    TestUtils.validateResults(analysisResults, 4);
});

test('AssignmentExpr2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignmentExpr2.py']);
    TestUtils.validateResults(analysisResults, 5);
});

test('AssignmentExpr3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignmentExpr3.py']);
    TestUtils.validateResults(analysisResults, 5);
});

test('AssignmentExpr4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignmentExpr4.py']);
    TestUtils.validateResults(analysisResults, 17);
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
    TestUtils.validateResults(analysisResults, 1);
});

test('AssignmentExpr8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignmentExpr8.py']);
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
    TestUtils.validateResults(analysisResults, 1);
});

test('Import6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['import6.py']);
    TestUtils.validateResults(analysisResults, 1);
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

test('DunderAll1', () => {
    const configOptions = new ConfigOptions('.');

    // By default, reportUnsupportedDunderAll is a warning.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['dunderAll1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0, 9);

    // Turn on error.
    configOptions.diagnosticRuleSet.reportUnsupportedDunderAll = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['dunderAll1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 9, 0);

    // Turn off diagnostic.
    configOptions.diagnosticRuleSet.reportUnsupportedDunderAll = 'none';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['dunderAll1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0, 0);
});

test('Overload1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overload1.py']);
    TestUtils.validateResults(analysisResults, 2);
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
    TestUtils.validateResults(analysisResults, 10);
});

test('Overload6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overload6.py']);
    TestUtils.validateResults(analysisResults, 1);
});

test('Overload7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overload7.py']);
    TestUtils.validateResults(analysisResults, 3);
});

test('Overload8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overload8.py']);
    TestUtils.validateResults(analysisResults, 2);
});

test('Final1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['final1.py']);
    TestUtils.validateResults(analysisResults, 1);
});

test('Final2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['final2.py']);
    TestUtils.validateResults(analysisResults, 3);
});

test('Final3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['final3.py']);
    TestUtils.validateResults(analysisResults, 16);
});

test('Final4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['final4.pyi']);
    TestUtils.validateResults(analysisResults, 3);
});

test('InferredTypes1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['inferredTypes1.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('CallSite2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['callSite2.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('FString1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['fstring1.py']);
    TestUtils.validateResults(analysisResults, 5, 1);
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

test('DataClass1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclass1.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('DataClass3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclass3.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('DataClass4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclass4.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('DataClass5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclass5.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('DataClass6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclass6.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('DataClass7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclass7.py']);

    TestUtils.validateResults(analysisResults, 2);
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

    TestUtils.validateResults(analysisResults, 1);
});

test('DataClass11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclass11.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('DataClass12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclass12.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('DataClass13', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclass13.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('DataClass14', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dataclass14.py']);

    TestUtils.validateResults(analysisResults, 2);
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

test('ThreePartVersion1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['threePartVersion1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Unions1', () => {
    const configOptions = new ConfigOptions('.');

    // Analyze with Python 3.9 settings. This will generate errors.
    configOptions.defaultPythonVersion = PythonVersion.V3_9;
    const analysisResults3_9 = TestUtils.typeAnalyzeSampleFiles(['unions1.py'], configOptions);
    TestUtils.validateResults(analysisResults3_9, 9);

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

test('ParamSpec1', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec1.py'], configOptions);
    TestUtils.validateResults(results, 6);
});

test('ParamSpec2', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_9;
    const analysisResults39 = TestUtils.typeAnalyzeSampleFiles(['paramSpec2.py'], configOptions);
    TestUtils.validateResults(analysisResults39, 5);

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults310 = TestUtils.typeAnalyzeSampleFiles(['paramSpec2.py'], configOptions);
    TestUtils.validateResults(analysisResults310, 0);
});

test('ParamSpec3', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec3.py'], configOptions);
    TestUtils.validateResults(results, 2);
});

test('ParamSpec4', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec4.py'], configOptions);
    TestUtils.validateResults(results, 5);
});

test('ParamSpec5', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec5.py'], configOptions);
    TestUtils.validateResults(results, 0);
});

test('ParamSpec6', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec6.py'], configOptions);
    TestUtils.validateResults(results, 0);
});

test('ParamSpec7', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec7.py'], configOptions);
    TestUtils.validateResults(results, 0);
});

test('ParamSpec8', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec8.py'], configOptions);
    TestUtils.validateResults(results, 5);
});

test('ParamSpec9', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec9.py'], configOptions);
    TestUtils.validateResults(results, 9);
});

test('ParamSpec10', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec10.py'], configOptions);
    TestUtils.validateResults(results, 0);
});

test('ParamSpec11', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec11.py'], configOptions);
    TestUtils.validateResults(results, 0);
});

test('ParamSpec12', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec12.py'], configOptions);
    TestUtils.validateResults(results, 11);
});

test('ParamSpec13', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec13.py'], configOptions);
    TestUtils.validateResults(results, 5);
});

test('ClassVar1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classVar1.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('ClassVar2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classVar2.py']);

    TestUtils.validateResults(analysisResults, 1);
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

    TestUtils.validateResults(analysisResults, 3);
});

test('TypeVar5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVar5.py']);

    TestUtils.validateResults(analysisResults, 18);
});

test('TypeVar6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVar6.py']);

    TestUtils.validateResults(analysisResults, 19);
});

test('TypeVar7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVar7.py']);

    TestUtils.validateResults(analysisResults, 22);
});

test('TypeVar8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVar8.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('TypeVar9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVar9.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('TypeVar10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVar10.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Annotated1', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_8;
    const analysisResults38 = TestUtils.typeAnalyzeSampleFiles(['annotated1.py'], configOptions);
    TestUtils.validateResults(analysisResults38, 1);

    configOptions.defaultPythonVersion = PythonVersion.V3_9;
    const analysisResults39 = TestUtils.typeAnalyzeSampleFiles(['annotated1.py'], configOptions);
    TestUtils.validateResults(analysisResults39, 2);
});

test('Circular1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['circular1.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('TryExcept1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tryExcept1.py']);

    TestUtils.validateResults(analysisResults, 2);
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
