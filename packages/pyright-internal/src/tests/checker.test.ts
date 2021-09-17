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
import { PythonVersion } from '../common/pythonVersion';
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
    const configOptions = new ConfigOptions('.');

    // By default, optional diagnostics are ignored.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['private1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    // Turn on errors.
    configOptions.diagnosticRuleSet.reportPrivateUsage = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['private1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 4);
});

test('Constant1', () => {
    const configOptions = new ConfigOptions('.');

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

    TestUtils.validateResults(analysisResults, 2);
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

test('Constants1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constants1.py']);

    TestUtils.validateResults(analysisResults, 20);
});

test('NoReturn1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['noreturn1.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('NoReturn2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['noreturn2.py']);

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

    TestUtils.validateResults(analysisResults, 1);
});

test('With4', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_8;
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['with4.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 4);

    configOptions.defaultPythonVersion = PythonVersion.V3_9;
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['with4.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 0);
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

test('DefaultInitializer1', () => {
    const configOptions = new ConfigOptions('.');

    // By default, the reportCallInDefaultInitializer is disabled.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['defaultInitializer1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    // Turn on errors.
    configOptions.diagnosticRuleSet.reportCallInDefaultInitializer = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['defaultInitializer1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 5);
});

test('UnnecessaryIsInstance1', () => {
    const configOptions = new ConfigOptions('.');

    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['unnecessaryIsInstance1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 1);

    // Turn on errors.
    configOptions.diagnosticRuleSet.reportUnnecessaryIsInstance = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['unnecessaryIsInstance1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 4);
});

test('UnnecessaryIsSubclass1', () => {
    const configOptions = new ConfigOptions('.');

    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['unnecessaryIsSubclass1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    // Turn on errors.
    configOptions.diagnosticRuleSet.reportUnnecessaryIsInstance = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['unnecessaryIsSubclass1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 2);
});

test('UnnecessaryCast', () => {
    const configOptions = new ConfigOptions('.');

    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['unnecessaryCast1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    // Turn on errors.
    configOptions.diagnosticRuleSet.reportUnnecessaryCast = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['unnecessaryCast1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 1);
});

test('TypeIgnore1', () => {
    const configOptions = new ConfigOptions('.');

    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeIgnore1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    // Disable type ignore
    configOptions.diagnosticRuleSet.enableTypeIgnoreComments = false;
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeIgnore1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 3);
});

test('TypeIgnore2', () => {
    const configOptions = new ConfigOptions('.');

    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeIgnore2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    // Disable type ignore
    configOptions.diagnosticRuleSet.enableTypeIgnoreComments = false;
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeIgnore2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 4);
});

test('TypeIgnore3', () => {
    const configOptions = new ConfigOptions('.');

    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeIgnore3.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    // Disable type ignore
    configOptions.diagnosticRuleSet.enableTypeIgnoreComments = false;
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeIgnore3.py'], configOptions);
    TestUtils.validateResults(analysisResults, 4);
});

test('DuplicateImports1', () => {
    const configOptions = new ConfigOptions('.');

    // By default, optional diagnostics are ignored.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['duplicateImports1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    // Turn on errors.
    configOptions.diagnosticRuleSet.reportDuplicateImport = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['duplicateImports1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 2);
});

test('ParamName1', () => {
    const configOptions = new ConfigOptions('.');

    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['paramNames1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0, 4);

    configOptions.diagnosticRuleSet.reportSelfClsParameterName = 'none';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['paramNames1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0, 0);

    configOptions.diagnosticRuleSet.reportSelfClsParameterName = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['paramNames1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 4, 0);
});

test('ParamType1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['paramType1.py']);
    TestUtils.validateResults(analysisResults, 7);
});

test('Python2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['python2.py']);

    TestUtils.validateResults(analysisResults, 6);
});

test('InconsistentSpaceTab', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['inconsistentSpaceTab.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('DuplicateDeclaration1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['duplicateDeclaration1.py']);

    TestUtils.validateResults(analysisResults, 6);
});

test('DuplicateDeclaration2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['duplicateDeclaration2.py']);

    TestUtils.validateResults(analysisResults, 4);
});
