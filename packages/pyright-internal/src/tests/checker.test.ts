/*
 * checker.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Unit tests for pyright type checker. These tests also
 * exercise the type evaluator (which the checker relies
 * heavily upon).
 */

import { ConfigOptions } from '../common/configOptions';
import { pythonVersion3_10, pythonVersion3_8, pythonVersion3_9 } from '../common/pythonVersion';
import { Uri } from '../common/uri/uri';
import * as TestUtils from './testUtils';

test('BadToken1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['badToken1.py']);

    // We include this in the checker test rather than the tokenizer or
    // parser test suite because it has cascading effects that potentially
    // affect the type checker logic.
    TestUtils.validateResults(analysisResults, 1);
});

test('Unicode1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['unicode1.py']);
    TestUtils.validateResults(analysisResults, 1);
});

test('CircularBaseClass', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['circularBaseClass.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Private1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    // By default, optional diagnostics are ignored.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['private1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    // Turn on errors.
    configOptions.diagnosticRuleSet.reportPrivateUsage = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['private1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 4);
});

test('Constant1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    // By default, optional diagnostics are ignored.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['constant1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    // Turn on errors.
    configOptions.diagnosticRuleSet.reportConstantRedefinition = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['constant1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 5);
});

test('AbstractClass1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['abstractClass1.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('AbstractClass2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['abstractClass2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('AbstractClass3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['abstractClass3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('AbstractClass4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['abstractClass4.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('AbstractClass5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['abstractClass5.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('AbstractClass6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['abstractClass6.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('AbstractClass7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['abstractClass7.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('AbstractClass8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['abstractClass8.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('AbstractClass9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['abstractClass9.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('AbstractClass10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['abstractClass10.py']);

    TestUtils.validateResults(analysisResults, 6);
});

test('AbstractClass11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['abstractClass11.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Constants1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constants1.py']);

    TestUtils.validateResults(analysisResults, 20);
});

test('NoReturn1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['noreturn1.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('NoReturn2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['noreturn2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('NoReturn3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['noreturn3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('NoReturn4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['noreturn4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('With1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['with1.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('With2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['with2.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('With3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['with3.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('With4', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_8;
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['with4.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 4);

    configOptions.defaultPythonVersion = pythonVersion3_9;
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['with4.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 0);
});

test('With5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['with5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('With6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['with6.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Mro1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['mro1.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Mro2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['mro2.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Mro3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['mro3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Mro4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['mro4.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('DefaultInitializer1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    // By default, the reportCallInDefaultInitializer is disabled.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['defaultInitializer1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    // Turn on errors.
    configOptions.diagnosticRuleSet.reportCallInDefaultInitializer = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['defaultInitializer1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 5);
});

test('UnnecessaryIsInstance1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['unnecessaryIsInstance1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 1);

    // Turn on errors.
    configOptions.diagnosticRuleSet.reportUnnecessaryIsInstance = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['unnecessaryIsInstance1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 5);
});

test('UnnecessaryIsInstance2', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['unnecessaryIsInstance2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    // Turn on errors.
    configOptions.diagnosticRuleSet.reportUnnecessaryIsInstance = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['unnecessaryIsInstance2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 2);
});

test('UnnecessaryIsSubclass1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['unnecessaryIsSubclass1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    // Turn on errors.
    configOptions.diagnosticRuleSet.reportUnnecessaryIsInstance = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['unnecessaryIsSubclass1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 2);
});

test('UnnecessaryCast1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['unnecessaryCast1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    // Turn on errors.
    configOptions.diagnosticRuleSet.reportUnnecessaryCast = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['unnecessaryCast1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 6);
});

test('UnnecessaryContains1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['unnecessaryContains1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    // Turn on errors.
    configOptions.diagnosticRuleSet.reportUnnecessaryContains = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['unnecessaryContains1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 5);
});

test('TypeIgnore1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeIgnore1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    // Disable type ignore
    configOptions.diagnosticRuleSet.enableTypeIgnoreComments = false;
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeIgnore1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 3);
});

test('TypeIgnore2', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeIgnore2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    // Disable type ignore
    configOptions.diagnosticRuleSet.enableTypeIgnoreComments = false;
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeIgnore2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 4);
});

test('TypeIgnore3', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeIgnore3.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    // Disable type ignore
    configOptions.diagnosticRuleSet.enableTypeIgnoreComments = false;
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeIgnore3.py'], configOptions);
    TestUtils.validateResults(analysisResults, 4);
});

test('TypeIgnore4', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeIgnore4.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    configOptions.diagnosticRuleSet.reportUnnecessaryTypeIgnoreComment = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeIgnore4.py'], configOptions);
    TestUtils.validateResults(analysisResults, 2);
});

test('TypeIgnore5', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeIgnore5.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    configOptions.diagnosticRuleSet.reportUnnecessaryTypeIgnoreComment = 'warning';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeIgnore5.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0, 1);
});

test('PyrightIgnore1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['pyrightIgnore1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 1);
});

test('PyrightIgnore2', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['pyrightIgnore2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 2);

    configOptions.diagnosticRuleSet.reportUnnecessaryTypeIgnoreComment = 'warning';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['pyrightIgnore2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 2, 3);
});

test('PyrightComment1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['pyrightComment1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 9);
});

test('DuplicateImports1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    // By default, optional diagnostics are ignored.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['duplicateImports1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    // Turn on errors.
    configOptions.diagnosticRuleSet.reportDuplicateImport = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['duplicateImports1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 2);
});

test('ParamNames1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['paramNames1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0, 11);

    configOptions.diagnosticRuleSet.reportSelfClsParameterName = 'none';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['paramNames1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0, 0);

    configOptions.diagnosticRuleSet.reportSelfClsParameterName = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['paramNames1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 11, 0);
});

test('ParamType1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['paramType1.py']);
    TestUtils.validateResults(analysisResults, 9);
});

test('Python2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['python2.py']);

    TestUtils.validateResults(analysisResults, 7);
});

test('InconsistentSpaceTab1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['inconsistentSpaceTab1.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('InconsistentSpaceTab2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['inconsistentSpaceTab2.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('DuplicateDeclaration1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['duplicateDeclaration1.py']);

    TestUtils.validateResults(analysisResults, 10);
});

test('DuplicateDeclaration2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['duplicateDeclaration2.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('Strings1', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['strings1.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 0);

    configOptions.diagnosticRuleSet.reportImplicitStringConcatenation = 'error';
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['strings1.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 2);
});

test('UnusedExpression1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    // By default, this is a warning.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['unusedExpression1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0, 14);

    // Disable it.
    configOptions.diagnosticRuleSet.reportUnusedExpression = 'none';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['unusedExpression1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    // Enable it as an error.
    configOptions.diagnosticRuleSet.reportUnusedExpression = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['unusedExpression1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 14);
});

test('UnusedImport1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    // Enabled it
    configOptions.diagnosticRuleSet.reportUnusedImport = 'warning';
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['unusedImport1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0, 2);

    // Disable it.
    configOptions.diagnosticRuleSet.reportUnusedImport = 'none';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['unusedImport1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    // Enable it as an error.
    configOptions.diagnosticRuleSet.reportUnusedImport = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['unusedImport1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 2);
});

test('UnusedImport2', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    // Disable it.
    configOptions.diagnosticRuleSet.reportUnusedImport = 'none';
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['unusedImport2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    // Enable it as an error.
    configOptions.diagnosticRuleSet.reportUnusedImport = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['unusedImport2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 2);
});

test('UninitializedVariable1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    // By default, this is off.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['uninitializedVariable1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    // Enable it as an error.
    configOptions.diagnosticRuleSet.reportUninitializedInstanceVariable = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['uninitializedVariable1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 3);
});

test('UninitializedVariable2', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    // By default, this is off.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['uninitializedVariable2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    // Enable it as an error.
    configOptions.diagnosticRuleSet.reportUninitializedInstanceVariable = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['uninitializedVariable2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 3);
});

test('DeprecatedAlias1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_8;
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['deprecatedAlias1.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 0, 0, 0, undefined, undefined, 0);

    configOptions.defaultPythonVersion = pythonVersion3_9;
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['deprecatedAlias1.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 0, 0, 0, undefined, undefined, 0);

    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults3 = TestUtils.typeAnalyzeSampleFiles(['deprecatedAlias1.py'], configOptions);
    TestUtils.validateResults(analysisResults3, 0, 0, 0, undefined, undefined, 0);

    // Now enable the deprecateTypingAliases setting.
    configOptions.diagnosticRuleSet.deprecateTypingAliases = true;

    configOptions.defaultPythonVersion = pythonVersion3_8;
    const analysisResults4 = TestUtils.typeAnalyzeSampleFiles(['deprecatedAlias1.py'], configOptions);
    TestUtils.validateResults(analysisResults4, 0, 0, 0, undefined, undefined, 0);

    configOptions.defaultPythonVersion = pythonVersion3_9;
    const analysisResults5 = TestUtils.typeAnalyzeSampleFiles(['deprecatedAlias1.py'], configOptions);
    TestUtils.validateResults(analysisResults5, 0, 0, 0, undefined, undefined, 45);

    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults6 = TestUtils.typeAnalyzeSampleFiles(['deprecatedAlias1.py'], configOptions);
    TestUtils.validateResults(analysisResults6, 0, 0, 0, undefined, undefined, 49);

    // Now change reportDeprecated to emit an error.
    configOptions.diagnosticRuleSet.reportDeprecated = 'error';

    configOptions.defaultPythonVersion = pythonVersion3_8;
    const analysisResults7 = TestUtils.typeAnalyzeSampleFiles(['deprecatedAlias1.py'], configOptions);
    TestUtils.validateResults(analysisResults7, 0, 0, 0, undefined, undefined, 0);

    configOptions.defaultPythonVersion = pythonVersion3_9;
    const analysisResults8 = TestUtils.typeAnalyzeSampleFiles(['deprecatedAlias1.py'], configOptions);
    TestUtils.validateResults(analysisResults8, 45, 0, 0, undefined, undefined, 0);

    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults9 = TestUtils.typeAnalyzeSampleFiles(['deprecatedAlias1.py'], configOptions);
    TestUtils.validateResults(analysisResults9, 49, 0, 0, undefined, undefined, 0);
});

test('DeprecatedAlias2', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_8;
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['deprecatedAlias2.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 0, 0, 0, undefined, undefined, 0);

    configOptions.defaultPythonVersion = pythonVersion3_9;
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['deprecatedAlias2.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 0, 0, 0, undefined, undefined, 0);

    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults3 = TestUtils.typeAnalyzeSampleFiles(['deprecatedAlias2.py'], configOptions);
    TestUtils.validateResults(analysisResults3, 0, 0, 0, undefined, undefined, 0);

    // Now enable the deprecateTypingAliases setting.
    configOptions.diagnosticRuleSet.deprecateTypingAliases = true;

    configOptions.defaultPythonVersion = pythonVersion3_8;
    const analysisResults4 = TestUtils.typeAnalyzeSampleFiles(['deprecatedAlias2.py'], configOptions);
    TestUtils.validateResults(analysisResults4, 0, 0, 0, undefined, undefined, 0);

    configOptions.defaultPythonVersion = pythonVersion3_9;
    const analysisResults5 = TestUtils.typeAnalyzeSampleFiles(['deprecatedAlias2.py'], configOptions);
    TestUtils.validateResults(analysisResults5, 0, 0, 0, undefined, undefined, 42);

    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults6 = TestUtils.typeAnalyzeSampleFiles(['deprecatedAlias2.py'], configOptions);
    TestUtils.validateResults(analysisResults6, 0, 0, 0, undefined, undefined, 46);

    // Now change reportDeprecated to emit an error.
    configOptions.diagnosticRuleSet.reportDeprecated = 'error';

    configOptions.defaultPythonVersion = pythonVersion3_8;
    const analysisResults7 = TestUtils.typeAnalyzeSampleFiles(['deprecatedAlias2.py'], configOptions);
    TestUtils.validateResults(analysisResults7, 0, 0, 0, undefined, undefined, 0);

    configOptions.defaultPythonVersion = pythonVersion3_9;
    const analysisResults8 = TestUtils.typeAnalyzeSampleFiles(['deprecatedAlias2.py'], configOptions);
    TestUtils.validateResults(analysisResults8, 42, 0, 0, undefined, undefined, 0);

    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults9 = TestUtils.typeAnalyzeSampleFiles(['deprecatedAlias2.py'], configOptions);
    TestUtils.validateResults(analysisResults9, 46, 0, 0, undefined, undefined, 0);
});

test('Deprecated2', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['deprecated2.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 0, 0, 0, undefined, undefined, 14);

    configOptions.diagnosticRuleSet.reportDeprecated = 'error';
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['deprecated2.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 14);
});

test('Deprecated3', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['deprecated3.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 0, 0, 0, undefined, undefined, 5);

    configOptions.diagnosticRuleSet.reportDeprecated = 'error';
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['deprecated3.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 5);
});

test('Deprecated4', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['deprecated4.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 0, 0, 0, undefined, undefined, 7);

    configOptions.diagnosticRuleSet.reportDeprecated = 'error';
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['deprecated4.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 7);
});

test('Deprecated5', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['deprecated5.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 0, 0, 0, undefined, undefined, 2);

    configOptions.diagnosticRuleSet.reportDeprecated = 'error';
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['deprecated5.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 2);
});

test('Deprecated6', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['deprecated6.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 0, 0, 0, undefined, undefined, 3);

    configOptions.diagnosticRuleSet.reportDeprecated = 'error';
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['deprecated6.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 3);
});

test('Deprecated7', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['deprecated7.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 0, 0, 0, undefined, undefined, 2);

    configOptions.diagnosticRuleSet.reportDeprecated = 'error';
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['deprecated7.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 2);
});

test('Deprecated8', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['deprecated8.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 0, 0, 0, undefined, undefined, 4);

    configOptions.diagnosticRuleSet.reportDeprecated = 'error';
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['deprecated8.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 4);
});
