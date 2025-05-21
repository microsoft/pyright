/*
 * typeEvaluator8.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Unit tests for pyright type evaluator. Tests are split
 * arbitrarily among multiple files so they can run in parallel.
 */

import * as assert from 'assert';

import { ConfigOptions } from '../common/configOptions';
import { pythonVersion3_10, pythonVersion3_11, pythonVersion3_8 } from '../common/pythonVersion';
import { Uri } from '../common/uri/uri';
import * as TestUtils from './testUtils';

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
    const configOptions = new ConfigOptions(Uri.empty());

    // By default, optional diagnostics are ignored.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['import12.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0, 2);

    // Turn on error.
    configOptions.diagnosticRuleSet.reportWildcardImportFromLibrary = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['import12.py'], configOptions);
    TestUtils.validateResults(analysisResults, 2, 0);

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

test('Import18', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['import18.py']);
    TestUtils.validateResults(analysisResults, 2);
});

test('DunderAll1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

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
    const configOptions = new ConfigOptions(Uri.empty());

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
    const configOptions = new ConfigOptions(Uri.empty());

    // Turn on error.
    configOptions.diagnosticRuleSet.reportUnsupportedDunderAll = 'error';
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dunderAll3.pyi'], configOptions);
    TestUtils.validateResults(analysisResults, 0, 0);
});

test('CodeFlow1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['codeFlow1.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('CodeFlow2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['codeFlow2.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('CodeFlow3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['codeFlow3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('CodeFlow4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['codeFlow4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('CodeFlow5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['codeFlow5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('CodeFlow6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['codeFlow6.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('CodeFlow7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['codeFlow7.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('CodeFlow8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['codeFlow8.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('CodeFlow9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['codeFlow9.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('CapturedVariable1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['capturedVariable1.py']);

    TestUtils.validateResults(analysisResults, 6);
});

test('CapturedVariable2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['capturedVariable2.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Property1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['property1.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('Property2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['property2.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Property3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['property3.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('Property4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['property4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Property5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['property5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Property6', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    // Analyze with reportPropertyTypeMismatch enabled.
    configOptions.diagnosticRuleSet.reportPropertyTypeMismatch = 'error';
    const analysisResult1 = TestUtils.typeAnalyzeSampleFiles(['property6.py'], configOptions);
    TestUtils.validateResults(analysisResult1, 2);

    // Analyze with reportPropertyTypeMismatch disabled.
    configOptions.diagnosticRuleSet.reportPropertyTypeMismatch = 'none';
    const analysisResult2 = TestUtils.typeAnalyzeSampleFiles(['property6.py'], configOptions);
    TestUtils.validateResults(analysisResult2, 0);
});

test('Property7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['property7.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Property8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['property8.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('Property9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['property9.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Property10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['property10.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Property11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['property11.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Property12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['property12.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Property13', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['property13.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Property14', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['property14.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Property15', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['property15.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Property16', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['property16.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Property17', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['property17.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Property18', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['property18.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Operator1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['operator1.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('Operator2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['operator2.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Operator3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['operator3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Operator4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['operator4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Operator5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['operator5.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Operator6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['operator6.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Operator7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['operator7.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Operator8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['operator8.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Operator9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['operator9.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Operator10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['operator10.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Operator11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['operator11.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Operator12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['operator12.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Optional1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    // Disable diagnostics.
    configOptions.diagnosticRuleSet.reportOptionalSubscript = 'none';
    configOptions.diagnosticRuleSet.reportOptionalMemberAccess = 'none';
    configOptions.diagnosticRuleSet.reportOptionalCall = 'none';
    configOptions.diagnosticRuleSet.reportOptionalIterable = 'none';
    configOptions.diagnosticRuleSet.reportOptionalContextManager = 'none';
    configOptions.diagnosticRuleSet.reportOptionalOperand = 'none';
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['optional1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    // Turn on warnings.
    configOptions.diagnosticRuleSet.reportOptionalSubscript = 'warning';
    configOptions.diagnosticRuleSet.reportOptionalMemberAccess = 'warning';
    configOptions.diagnosticRuleSet.reportOptionalCall = 'warning';
    configOptions.diagnosticRuleSet.reportOptionalIterable = 'warning';
    configOptions.diagnosticRuleSet.reportOptionalContextManager = 'warning';
    configOptions.diagnosticRuleSet.reportOptionalOperand = 'warning';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['optional1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0, 8);

    // Turn on errors.
    configOptions.diagnosticRuleSet.reportOptionalSubscript = 'error';
    configOptions.diagnosticRuleSet.reportOptionalMemberAccess = 'error';
    configOptions.diagnosticRuleSet.reportOptionalCall = 'error';
    configOptions.diagnosticRuleSet.reportOptionalIterable = 'error';
    configOptions.diagnosticRuleSet.reportOptionalContextManager = 'error';
    configOptions.diagnosticRuleSet.reportOptionalOperand = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['optional1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 8);
});

test('Optional2', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    // Disable diagnostics.
    configOptions.diagnosticRuleSet.reportOptionalOperand = 'none';
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['optional2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    // Turn on errors.
    configOptions.diagnosticRuleSet.reportOptionalOperand = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['optional2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 1);
});

test('Tuple1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuple1.py']);

    TestUtils.validateResults(analysisResults, 26);
});

test('Tuple2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuple2.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('Tuple3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuple3.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('Tuple4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuple4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Tuple5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuple5.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Tuple6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuple6.py']);

    TestUtils.validateResults(analysisResults, 10);
});

test('Tuple7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuple7.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Tuple8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuple8.py']);

    TestUtils.validateResults(analysisResults, 11);
});

test('Tuple9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuple9.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Tuple10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuple10.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Tuple11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuple11.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Tuple12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuple12.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Tuple13', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuple13.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Tuple15', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuple15.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Tuple16', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuple16.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Tuple17', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuple17.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Tuple18', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuple18.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Tuple19', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuple19.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('NamedTuple1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['namedTuple1.py']);

    TestUtils.validateResults(analysisResults, 13);
});

test('NamedTuple2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['namedTuple2.py']);

    TestUtils.validateResults(analysisResults, 8);
});

test('NamedTuple3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['namedTuple3.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('NamedTuple4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['namedTuple4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('NamedTuple5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['namedTuple5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('NamedTuple6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['namedTuple6.py']);

    TestUtils.validateResults(analysisResults, 6);
});

test('NamedTuple7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['namedTuple7.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('NamedTuple8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['namedTuple8.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('NamedTuple9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['namedTuple9.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('NamedTuple10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['namedTuple10.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('NamedTuple11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['namedTuple11.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Slots1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['slots1.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Slots2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['slots2.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Slots3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['slots3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Slots4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['slots4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Parameters1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.diagnosticRuleSet.reportMissingParameterType = 'none';
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['parameters1.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 0);

    configOptions.diagnosticRuleSet.reportMissingParameterType = 'error';
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['parameters1.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 1);
});

test('Self1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['self1.py']);

    TestUtils.validateResults(analysisResults, 15);
});

test('Self2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['self2.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('Self3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['self3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Self4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['self4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Self5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['self5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Self6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['self6.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Self7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['self7.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Self8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['self8.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Self9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['self9.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Self10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['self10.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Self11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['self11.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('UnusedVariable1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.diagnosticRuleSet.reportUnusedVariable = 'none';
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['unusedVariable1.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 0);

    configOptions.diagnosticRuleSet.reportUnusedVariable = 'error';
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['unusedVariable1.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 3);
});

test('Descriptor1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['descriptor1.py']);

    TestUtils.validateResults(analysisResults, 6);
});

test('Descriptor2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['descriptor2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Descriptor3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['descriptor3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Partial1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['partial1.py']);

    TestUtils.validateResults(analysisResults, 18);
});

test('Partial2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['partial2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Partial3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['partial3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Partial4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['partial4.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Partial5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['partial5.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Partial6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['partial6.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Partial7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['partial7.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('TotalOrdering1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['totalOrdering1.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('TupleUnpack1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tupleUnpack1.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('TupleUnpack2', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['tupleUnpack2.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 18);

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['tupleUnpack2.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 4);
});

test('TupleUnpack3', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['tupleUnpack3.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 1);
});

test('TupleUnpack4', () => {
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['tupleUnpack4.py']);
    TestUtils.validateResults(analysisResults1, 2);
});

test('TupleUnpack5', () => {
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['tupleUnpack5.py']);
    TestUtils.validateResults(analysisResults1, 0);
});

test('PseudoGeneric1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['pseudoGeneric1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('PseudoGeneric2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['pseudoGeneric2.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('PseudoGeneric3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['pseudoGeneric3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Strings2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['strings2.py']);

    TestUtils.validateResults(analysisResults, 2, 1);
});

test('LiteralString1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['literalString1.py']);

    TestUtils.validateResults(analysisResults, 10);
});

test('LiteralString2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['literalString2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('LiteralString3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['literalString3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('ParamInference1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['paramInference1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('ParamInference2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['paramInference2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Dictionary1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dictionary1.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Dictionary2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dictionary2.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Dictionary3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dictionary3.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Dictionary4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['dictionary4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('StaticExpression1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_8;
    configOptions.defaultPythonPlatform = 'windows';

    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['staticExpression1.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 9);

    configOptions.defaultPythonVersion = pythonVersion3_11;
    configOptions.defaultPythonPlatform = 'Linux';

    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['staticExpression1.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 6);

    configOptions.defineConstant.set('DEFINED_TRUE', true);
    configOptions.defineConstant.set('DEFINED_FALSE', false);
    configOptions.defineConstant.set('DEFINED_STR', 'hi!');
    const analysisResults3 = TestUtils.typeAnalyzeSampleFiles(['staticExpression1.py'], configOptions);
    TestUtils.validateResults(analysisResults3, 0);
});

test('StaticExpression2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['staticExpression2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('SpecialForm1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['specialForm1.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('SpecialForm2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['specialForm2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('SpecialForm3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['specialForm3.py']);

    TestUtils.validateResults(analysisResults, 22);
});

test('SpecialForm4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['specialForm4.py']);

    TestUtils.validateResults(analysisResults, 72);
});

test('TypeForm1', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.diagnosticRuleSet.enableExperimentalFeatures = true;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeForm1.py'], configOptions);

    TestUtils.validateResults(analysisResults, 4);
});

test('TypeForm2', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.diagnosticRuleSet.enableExperimentalFeatures = true;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeForm2.py'], configOptions);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeForm3', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.diagnosticRuleSet.enableExperimentalFeatures = true;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeForm3.py'], configOptions);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeForm4', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.diagnosticRuleSet.enableExperimentalFeatures = true;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeForm4.py'], configOptions);

    TestUtils.validateResults(analysisResults, 27);
});

test('TypeForm5', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.diagnosticRuleSet.enableExperimentalFeatures = true;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeForm5.py'], configOptions);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeForm6', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.diagnosticRuleSet.enableExperimentalFeatures = true;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeForm6.py'], configOptions);

    TestUtils.validateResults(analysisResults, 8);
});

test('TypeForm7', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.diagnosticRuleSet.enableExperimentalFeatures = true;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeForm7.py'], configOptions);

    TestUtils.validateResults(analysisResults, 1);
});
