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

import { ConstraintSolution } from '../analyzer/constraintSolution';
import * as TupleComparison from '../analyzer/tupleComparison';
import { EvalFlags } from '../analyzer/typeEvaluatorTypes';
import {
    ClassType,
    combineTypes,
    FunctionType,
    getTypeAliasInfo,
    isClassInstance,
    isInstantiableClass,
    isNever,
    isTypeSame,
    isTypeVar,
    isTypeVarTuple,
    isUnion,
    isUnknown,
    maxSubtypesForInferredType,
    maxTypeRecursionCount,
    NeverType,
    retainInferredTupleLiterals,
    Type,
    TypeBase,
    TypeVarType,
    UnknownType,
} from '../analyzer/types';
import { applySolvedTypeVars, TypeVarTransformer } from '../analyzer/typeUtils';
import { ConfigOptions } from '../common/configOptions';
import { DiagnosticRule } from '../common/diagnosticRules';
import {
    pythonVersion3_10,
    pythonVersion3_11,
    pythonVersion3_8,
    pythonVersion3_12,
    pythonVersion3_13,
} from '../common/pythonVersion';
import { Uri } from '../common/uri/uri';
import { ParseNodeType } from '../parser/parseNodes';
import { OperatorType } from '../parser/tokenizerTypes';
import { getNodeAtMarker, parseAndGetTestState } from './harness/fourslash/testState';
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

test('CodeFlow10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['codeFlow10.py']);

    TestUtils.validateResults(analysisResults, 0, 0, 2); /* 2 reveal_type infos */
});

test('CodeFlow11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['codeFlow11.py']);

    TestUtils.validateResults(analysisResults, 4, 0, 4);
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

test('Property19', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['property19.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Property20', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['property20.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 0, 0, 0, undefined, undefined, 1);

    configOptions.diagnosticRuleSet.reportDeprecated = 'error';
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['property20.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 1);
});

test('Property21', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['property21.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 0, 0, 0, undefined, undefined, 2);

    configOptions.diagnosticRuleSet.reportDeprecated = 'error';
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['property21.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 2);
});

test('Property22', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['property22.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Property23', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.diagnosticRuleSet.reportIncompatibleMethodOverride = 'error';

    // Override-compatibility checking is not yet performed for overloaded
    // property accessors, so the incompatible setter override in this sample
    // is intentionally not reported. Update this expectation when override
    // support for overloaded accessors is added.
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['property23.py'], configOptions);

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

    TestUtils.validateResults(analysisResults, 27);
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

    TestUtils.validateResults(analysisResults, 3);
});

test('Tuple12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuple12.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Tuple13', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tuple13.py']);

    TestUtils.validateResults(analysisResults, 9);
    analysisResults[0].errors.forEach((diagnostic) =>
        assert.strictEqual(diagnostic.getRule(), DiagnosticRule.reportArgumentType)
    );
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

test('NamedTupleReplace1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_12;
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['namedTupleReplace1.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 8);

    configOptions.defaultPythonVersion = pythonVersion3_13;
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['namedTupleReplace1.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 8);
});

test('NamedTupleReplace2', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.defaultPythonVersion = pythonVersion3_12;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['namedTupleReplace2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('NamedTupleReplace3', () => {
    for (const pythonVersion of [pythonVersion3_12, pythonVersion3_13]) {
        const configOptions = new ConfigOptions(Uri.empty());
        configOptions.defaultPythonVersion = pythonVersion;
        const analysisResults = TestUtils.typeAnalyzeSampleFiles(['namedTupleReplace3.py'], configOptions);
        TestUtils.validateResults(analysisResults, 2);
        assert.deepStrictEqual(
            analysisResults[0].errors.map((diagnostic) => [diagnostic.range.start.line + 1, diagnostic.getRule()]),
            [
                [15, DiagnosticRule.reportCallIssue],
                [54, DiagnosticRule.reportCallIssue],
            ]
        );
    }
});

test('NamedTupleReplace4', () => {
    for (const pythonVersion of [pythonVersion3_12, pythonVersion3_13]) {
        const configOptions = new ConfigOptions(Uri.empty());
        configOptions.defaultPythonVersion = pythonVersion;
        const analysisResults = TestUtils.typeAnalyzeSampleFiles(['namedTupleReplace4.py'], configOptions);
        const expectedErrors = [
            [25, DiagnosticRule.reportArgumentType],
            [28, DiagnosticRule.reportArgumentType],
        ];
        if (pythonVersion === pythonVersion3_13) {
            expectedErrors.push([35, DiagnosticRule.reportArgumentType], [38, DiagnosticRule.reportArgumentType]);
        }
        TestUtils.validateResults(analysisResults, expectedErrors.length);
        assert.deepStrictEqual(
            analysisResults[0].errors.map((diagnostic) => [diagnostic.range.start.line + 1, diagnostic.getRule()]),
            expectedErrors
        );
    }
});

test('NamedTupleReplace5', () => {
    for (const pythonVersion of [pythonVersion3_12, pythonVersion3_13]) {
        const configOptions = new ConfigOptions(Uri.empty());
        configOptions.defaultPythonVersion = pythonVersion;
        const analysisResults = TestUtils.typeAnalyzeSampleFiles(['namedTupleReplace5.py'], configOptions);
        TestUtils.validateResults(analysisResults, 2);
        assert.deepStrictEqual(
            analysisResults[0].errors.map((diagnostic) => [diagnostic.range.start.line + 1, diagnostic.getRule()]),
            [
                [19, DiagnosticRule.reportReturnType],
                [28, DiagnosticRule.reportReturnType],
            ]
        );
    }
});

test('NamedTuple12', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.defaultPythonVersion = pythonVersion3_12;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['matchNamedTupleGeneric1.py'], configOptions);

    TestUtils.validateResults(analysisResults, 0);
});

test('Slots1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['slots1.py']);

    TestUtils.validateResults(analysisResults, 4);
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

test('Self12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['self12.py']);

    TestUtils.validateResults(analysisResults, 2);
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

test('UnusedVariable2', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    const sampleLines = TestUtils.readSampleFile('unusedVariable2.py').split(/\r?\n/);

    const validateUnusedNames = (analysisResults: TestUtils.FileAnalysisResult[]) => {
        const unusedNames = analysisResults[0].unusedCodes.map((diagnostic) => {
            assert.strictEqual(diagnostic.range.start.line, diagnostic.range.end.line);
            const line = sampleLines[diagnostic.range.start.line];
            return line.slice(diagnostic.range.start.character, diagnostic.range.end.character);
        });

        assert.deepStrictEqual(unusedNames, ['arg', 'regular']);
    };

    configOptions.diagnosticRuleSet.reportUnusedVariable = 'none';
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['unusedVariable2.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 0, 0, 0, 2);
    validateUnusedNames(analysisResults1);

    configOptions.diagnosticRuleSet.reportUnusedVariable = 'error';
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['unusedVariable2.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 1, 0, 0, 2);
    validateUnusedNames(analysisResults2);
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

test('Descriptor4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['descriptor4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Descriptor5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['descriptor5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Descriptor6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['descriptor6.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Descriptor7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['descriptor7.py']);

    TestUtils.validateResults(analysisResults, 2);
    assert.deepStrictEqual(
        analysisResults[0].errors.map((diagnostic) => [diagnostic.range.start.line + 1, diagnostic.getRule()]),
        [
            [82, DiagnosticRule.reportOptionalOperand],
            [134, DiagnosticRule.reportAttributeAccessIssue],
        ]
    );
});

test('MethodDescriptor1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['methodDescriptor1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('MethodDescriptor2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['methodDescriptor2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('MethodDescriptor3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['methodDescriptor3.py']);

    TestUtils.validateResults(analysisResults, 4);
    const errors = [...analysisResults[0].errors].sort((a, b) => a.range.start.line - b.range.start.line);
    assert.deepStrictEqual(
        errors.map((diagnostic) => [diagnostic.range.start.line + 1, diagnostic.getRule()]),
        [
            [14, DiagnosticRule.reportCallIssue],
            [17, DiagnosticRule.reportArgumentType],
            [20, DiagnosticRule.reportAttributeAccessIssue],
            [24, DiagnosticRule.reportFunctionMemberAccess],
        ]
    );
    assert.match(errors[2].message, /Cannot assign to attribute "__func__"/);
});

test('MethodDescriptor4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['methodDescriptor4.py']);

    TestUtils.validateResults(analysisResults, 2);
    analysisResults[0].errors.forEach((diagnostic) =>
        assert.strictEqual(diagnostic.getRule(), DiagnosticRule.reportAssignmentType)
    );
});

test('MethodDescriptor5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['methodDescriptor5.py']);

    TestUtils.validateResults(analysisResults, 15);
    const errors = [...analysisResults[0].errors].sort((a, b) => a.range.start.line - b.range.start.line);
    assert.deepStrictEqual(
        errors.map((diagnostic) => [diagnostic.range.start.line + 1, diagnostic.getRule()]).sort(),
        [
            [31, DiagnosticRule.reportArgumentType],
            [40, DiagnosticRule.reportCallIssue],
            [49, DiagnosticRule.reportArgumentType],
            [50, DiagnosticRule.reportCallIssue],
            [61, DiagnosticRule.reportArgumentType],
            [73, DiagnosticRule.reportGeneralTypeIssues],
            [73, DiagnosticRule.reportGeneralTypeIssues],
            [74, DiagnosticRule.reportOptionalMemberAccess],
            [74, DiagnosticRule.reportAttributeAccessIssue],
            [74, DiagnosticRule.reportOptionalMemberAccess],
            [75, DiagnosticRule.reportOperatorIssue],
            [75, DiagnosticRule.reportOptionalMemberAccess],
            [83, DiagnosticRule.reportArgumentType],
            [94, DiagnosticRule.reportArgumentType],
            [104, DiagnosticRule.reportArgumentType],
        ].sort()
    );
});

test('MethodDescriptor6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['methodDescriptor6.py']);

    TestUtils.validateResults(analysisResults, 1);
    assert.strictEqual(analysisResults[0].errors[0].getRule(), DiagnosticRule.reportOperatorIssue);
});

test('MethodDescriptor7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['methodDescriptor7.py']);

    TestUtils.validateResults(analysisResults, 9);
    assert.deepStrictEqual(
        analysisResults[0].errors.map((diagnostic) => [diagnostic.range.start.line + 1, diagnostic.getRule()]).sort(),
        [
            [36, DiagnosticRule.reportArgumentType],
            [62, DiagnosticRule.reportArgumentType],
            [84, DiagnosticRule.reportCallIssue],
            [84, DiagnosticRule.reportArgumentType],
            [85, DiagnosticRule.reportArgumentType],
            [86, DiagnosticRule.reportCallIssue],
            [103, DiagnosticRule.reportCallIssue],
            [103, DiagnosticRule.reportArgumentType],
            [114, DiagnosticRule.reportInconsistentOverload],
        ].sort()
    );
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

test('Partial8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['partial8.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Partial9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['partial9.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('TotalOrdering1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['totalOrdering1.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('StructUnpack1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['structUnpack1.py']);

    TestUtils.validateResults(analysisResults, 0);
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
    TestUtils.validateResults(analysisResults1, 25);
});

test('TupleUnpack5', () => {
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['tupleUnpack5.py']);
    TestUtils.validateResults(analysisResults1, 0);
});

test('TupleUnpack6', () => {
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['tupleUnpack6.py']);
    TestUtils.validateResults(analysisResults1, 12);
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

test('StaticExpressionLiteral1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['staticExpressionLiteral1.py']);

    TestUtils.validateResults(analysisResults, 4);
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

// TypeForm support is enabled by default and no longer requires
// enableExperimentalFeatures, so these tests intentionally leave it off.

test('TypeFormCache', () => {
    const code = `
// @filename: test.py
//// from typing_extensions import TypeForm
//// value: TypeForm[int] = /*marker*/int
    `;
    const state = parseAndGetTestState(code).state;
    const node = getNodeAtMarker(state);
    assert.ok(node.nodeType === ParseNodeType.Name);

    const type = state.program.evaluator!.getType(node);
    assert.ok(type);
    assert.ok(isClassInstance(type));
    assert.ok(ClassType.isBuiltIn(type, 'TypeForm'));

    const typeArg = type.priv.typeArgs?.[0];
    assert.ok(typeArg);
    assert.ok(isClassInstance(typeArg));
    assert.ok(ClassType.isBuiltIn(typeArg, 'int'));

    const runtimeType = state.program.evaluator!.getTypeOfExpression(node).type;
    assert.ok(isInstantiableClass(runtimeType));
    assert.ok(ClassType.isBuiltIn(runtimeType, 'int'));

    const subnodeTypeResult = state.program.evaluator!.evaluateTypeForSubnode(node, () => {
        assert.fail('Runtime type is already cached');
    });
    assert.strictEqual(subnodeTypeResult?.type, runtimeType);

    const cachedType = state.program.evaluator!.getCachedType(node);
    assert.strictEqual(cachedType, runtimeType);
});

test('TypeFormCacheRuntimeFirst', () => {
    const code = `
// @filename: test.py
//// from typing_extensions import TypeForm
//// value: TypeForm[int] = /*marker*/int
    `;
    const state = parseAndGetTestState(code).state;
    const node = getNodeAtMarker(state);
    assert.ok(node.nodeType === ParseNodeType.Name);

    const runtimeType = state.program.evaluator!.getTypeOfExpression(node).type;
    assert.ok(isInstantiableClass(runtimeType));
    assert.ok(ClassType.isBuiltIn(runtimeType, 'int'));
    assert.strictEqual(state.program.evaluator!.getCachedType(node), runtimeType);

    state.program.evaluator!.evaluateTypesForStatement(node);

    const contextualType = state.program.evaluator!.getType(node);
    assert.ok(contextualType);
    assert.ok(isClassInstance(contextualType));
    assert.ok(ClassType.isBuiltIn(contextualType, 'TypeForm'));

    const typeArg = contextualType.priv.typeArgs?.[0];
    assert.ok(typeArg);
    assert.ok(isClassInstance(typeArg));
    assert.ok(ClassType.isBuiltIn(typeArg, 'int'));

    assert.strictEqual(state.program.evaluator!.getCachedType(node), runtimeType);
    assert.strictEqual(state.program.evaluator!.getCachedType(node), runtimeType);
});

test('TypeFormCacheNestedAliasRuntimeFirst', () => {
    const code = `
// @filename: test.py
//// # pyright: reportMissingModuleSource=false
//// from typing import assert_type
//// from typing_extensions import TypeForm
//// class Codec[T]: ...
//// def codec_for[T](schema: TypeForm[T]) -> Codec[T]: ...
//// type Foo = int | str
//// class Bar[T: Foo]: ...
//// bar_codec = codec_for(Bar[[|/*marker*/Foo|]])
//// assert_type(bar_codec, Codec[Bar[Foo]])
    `;
    const state = parseAndGetTestState(code).state;
    const node = getNodeAtMarker(state);
    assert.ok(node.nodeType === ParseNodeType.Name);

    const runtimeType = state.program.evaluator!.getTypeOfExpression(node).type;
    assert.strictEqual(state.program.evaluator!.getCachedType(node), runtimeType);

    state.verifyDiagnostics({
        marker: { category: 'none', message: '' },
    });
});

test('TypeFormCacheNestedGenericAliasRuntimeFirst', () => {
    const code = `
// @filename: test.py
//// # pyright: reportMissingModuleSource=false
//// from typing import assert_type
//// from typing_extensions import TypeForm
//// class Codec[T]: ...
//// def codec_for[T](schema: TypeForm[T]) -> Codec[T]: ...
//// type Foo = int | str
//// type Bar[T: Foo] = list[T]
//// bar_codec = codec_for(Bar[[|/*marker*/Foo|]])
//// assert_type(bar_codec, Codec[list[int | str]])
    `;
    const state = parseAndGetTestState(code).state;
    const node = getNodeAtMarker(state);
    assert.ok(node.nodeType === ParseNodeType.Name);

    const runtimeType = state.program.evaluator!.getTypeOfExpression(node).type;
    assert.strictEqual(state.program.evaluator!.getCachedType(node), runtimeType);

    state.verifyDiagnostics({
        marker: { category: 'none', message: '' },
    });
});

test('TypeFormCacheNestedVariadicRuntimeFirst', () => {
    const code = `
// @filename: test.py
//// # pyright: reportMissingModuleSource=false
//// from collections.abc import Callable
//// from typing import assert_type
//// from typing_extensions import TypeForm
//// class Codec[T]: ...
//// def codec_for[T](schema: TypeForm[T]) -> Codec[T]: ...
//// type Foo = int | str
//// class ParamSpecClass[**P]: ...
//// type ParamSpecAlias[**P] = Callable[P, None]
//// class VariadicClass[*Ts]: ...
//// type VariadicAlias[*Ts] = tuple[*Ts]
//// param_class_codec = codec_for(ParamSpecClass[[[|/*paramClass*/Foo|]]])
//// assert_type(param_class_codec, Codec[ParamSpecClass[[Foo]]])
//// param_alias_codec = codec_for(ParamSpecAlias[[[|/*paramAlias*/Foo|]]])
//// assert_type(param_alias_codec, Codec[Callable[[Foo], None]])
//// variadic_class_codec = codec_for(VariadicClass[[|/*variadicClass*/Foo|]])
//// assert_type(variadic_class_codec, Codec[VariadicClass[Foo]])
//// variadic_alias_codec = codec_for(VariadicAlias[[|/*variadicAlias*/Foo|]])
//// assert_type(variadic_alias_codec, Codec[tuple[Foo]])
    `;
    const state = parseAndGetTestState(code).state;
    const markerNames = ['paramClass', 'paramAlias', 'variadicClass', 'variadicAlias'];

    markerNames.forEach((markerName) => {
        const node = getNodeAtMarker(state, markerName);
        assert.ok(node.nodeType === ParseNodeType.Name);

        const runtimeType = state.program.evaluator!.getTypeOfExpression(node).type;
        assert.strictEqual(state.program.evaluator!.getCachedType(node), runtimeType);
    });

    state.verifyDiagnostics(
        Object.fromEntries(markerNames.map((markerName) => [markerName, { category: 'none', message: '' }]))
    );
});

test('TypeFormCacheRuntimeFirstReassignment', () => {
    const code = `
// @filename: test.py
//// from typing_extensions import TypeForm
//// value: TypeForm[int]
//// value = /*marker*/int
    `;
    const state = parseAndGetTestState(code).state;
    const node = getNodeAtMarker(state);
    assert.ok(node.nodeType === ParseNodeType.Name);

    const runtimeType = state.program.evaluator!.getTypeOfExpression(node).type;
    assert.ok(isInstantiableClass(runtimeType));
    assert.ok(ClassType.isBuiltIn(runtimeType, 'int'));

    state.program.evaluator!.evaluateTypesForStatement(node);

    const contextualType = state.program.evaluator!.getType(node);
    assert.ok(contextualType);
    assert.ok(isClassInstance(contextualType));
    assert.ok(ClassType.isBuiltIn(contextualType, 'TypeForm'));

    const typeArg = contextualType.priv.typeArgs?.[0];
    assert.ok(typeArg);
    assert.ok(isClassInstance(typeArg));
    assert.ok(ClassType.isBuiltIn(typeArg, 'int'));

    assert.strictEqual(state.program.evaluator!.getCachedType(node), runtimeType);
});

test('TypeFormCacheRuntimeFirstString', () => {
    const code = `
// @filename: test.py
//// from typing_extensions import TypeForm
//// value: TypeForm[int] = /*marker*/"int"
    `;
    const state = parseAndGetTestState(code).state;
    const markerNode = getNodeAtMarker(state);
    const node = markerNode.nodeType === ParseNodeType.String ? markerNode.parent : markerNode;
    assert.ok(node?.nodeType === ParseNodeType.StringList);

    const runtimeType = state.program.evaluator!.getTypeOfExpression(node).type;
    assert.ok(isClassInstance(runtimeType));
    assert.ok(ClassType.isBuiltIn(runtimeType, 'str'));
    assert.strictEqual(runtimeType.props?.typeForm, undefined);

    state.program.evaluator!.evaluateTypesForStatement(node);

    const contextualType = state.program.evaluator!.getType(node);
    assert.ok(contextualType);
    assert.ok(isClassInstance(contextualType));
    assert.ok(ClassType.isBuiltIn(contextualType, 'TypeForm'));

    const typeArg = contextualType.priv.typeArgs?.[0];
    assert.ok(typeArg);
    assert.ok(isClassInstance(typeArg));
    assert.ok(ClassType.isBuiltIn(typeArg, 'int'));

    assert.strictEqual(state.program.evaluator!.getCachedType(node), runtimeType);
});

test('TypeFormCacheRuntimeFirstMemberAssignment', () => {
    const code = `
// @filename: test.py
//// from typing_extensions import TypeForm
//// class Holder:
////     value: TypeForm[int]
//// holder = Holder()
//// holder.value = /*marker*/int
    `;
    const state = parseAndGetTestState(code).state;
    const node = getNodeAtMarker(state);
    assert.ok(node.nodeType === ParseNodeType.Name);

    const runtimeType = state.program.evaluator!.getTypeOfExpression(node).type;
    assert.ok(isInstantiableClass(runtimeType));
    assert.ok(ClassType.isBuiltIn(runtimeType, 'int'));

    state.program.evaluator!.evaluateTypesForStatement(node);

    const contextualType = state.program.evaluator!.getType(node);
    assert.ok(contextualType);
    assert.ok(isClassInstance(contextualType));
    assert.ok(ClassType.isBuiltIn(contextualType, 'TypeForm'));
    const typeArg = contextualType.priv.typeArgs?.[0];
    assert.ok(typeArg);
    assert.ok(isClassInstance(typeArg));
    assert.ok(ClassType.isBuiltIn(typeArg, 'int'));

    assert.strictEqual(state.program.evaluator!.getCachedType(node), runtimeType);
});

test('TypeFormCacheRuntimeFirstIndexAssignment', () => {
    const code = `
// @filename: test.py
//// from typing import TypedDict, cast
//// from typing_extensions import TypeForm
//// class Holder(TypedDict):
////     value: TypeForm[int]
//// holder = cast(Holder, {})
//// holder["value"] = /*marker*/int
    `;
    const state = parseAndGetTestState(code).state;
    const node = getNodeAtMarker(state);
    assert.ok(node.nodeType === ParseNodeType.Name);

    const runtimeType = state.program.evaluator!.getTypeOfExpression(node).type;
    assert.ok(isInstantiableClass(runtimeType));
    assert.ok(ClassType.isBuiltIn(runtimeType, 'int'));

    state.program.evaluator!.evaluateTypesForStatement(node);

    const contextualType = state.program.evaluator!.getType(node);
    assert.ok(contextualType);
    assert.ok(isClassInstance(contextualType));
    assert.ok(ClassType.isBuiltIn(contextualType, 'TypeForm'));
    const typeArg = contextualType.priv.typeArgs?.[0];
    assert.ok(typeArg);
    assert.ok(isClassInstance(typeArg));
    assert.ok(ClassType.isBuiltIn(typeArg, 'int'));

    assert.strictEqual(state.program.evaluator!.getCachedType(node), runtimeType);
});

test('TypeFormSpeculativeCacheDoesNotInvalidateIncompleteCache', () => {
    const code = `
// @filename: test.py
//// from typing_extensions import TypeForm
//// other = /*incomplete*/1
//// value: TypeForm[int] = /*typeForm*/int
    `;
    const state = parseAndGetTestState(code).state;
    const node = getNodeAtMarker(state, 'typeForm');
    const incompleteNode = getNodeAtMarker(state, 'incomplete');
    assert.ok(node.nodeType === ParseNodeType.Name);
    assert.ok(incompleteNode.nodeType === ParseNodeType.Number);

    const incompleteType = UnknownType.create();
    state.program.evaluator!.setTypeResultForNode(incompleteNode, {
        type: incompleteType,
        isIncomplete: true,
    });

    state.program.evaluator!.useSpeculativeMode(node, () => {
        state.program.evaluator!.setTypeResultForNode(node, { type: UnknownType.create() }, EvalFlags.TypeFormArg);
    });

    assert.strictEqual(state.program.evaluator!.getCachedType(node), undefined);
    const incompleteResult = state.program.evaluator!.getTypeOfExpression(incompleteNode);
    assert.ok(
        incompleteResult.type === incompleteType,
        'Speculative TypeForm write invalidated an unrelated incomplete cache entry'
    );
    assert.strictEqual(incompleteResult.isIncomplete, true);
});

test('TypeFormCacheDoesNotSkipRuntimeEvaluation', () => {
    const code = `
// @filename: test.py
//// from typing_extensions import TypeForm
//// def consume(value: TypeForm[int]): ...
//// consume(/*marker*/int)
    `;
    const state = parseAndGetTestState(code).state;
    const node = getNodeAtMarker(state);
    assert.ok(node.nodeType === ParseNodeType.Name);

    const type = state.program.evaluator!.getType(node);
    assert.ok(type);
    assert.ok(isClassInstance(type));
    assert.ok(ClassType.isBuiltIn(type, 'TypeForm'));

    assert.ok(node.parent?.nodeType === ParseNodeType.Argument);
    const callNode = node.parent.parent;
    assert.ok(callNode?.nodeType === ParseNodeType.Call);
    state.program.evaluator!.getTypeOfExpression(callNode);

    const cachedType = state.program.evaluator!.getCachedType(node);
    assert.ok(cachedType);
    assert.ok(isInstantiableClass(cachedType));
    assert.ok(ClassType.isBuiltIn(cachedType, 'int'));
});

test('TypeFormExplicitCache', () => {
    const code = `
// @filename: pyrightconfig.json
//// { "enableExperimentalFeatures": true }
// @filename: test.py
//// from typing import TypedDict
//// from typing_extensions import TypeForm
//// value = TypeForm(/*marker*/TypedDict[{"a": int}])
    `;
    const state = parseAndGetTestState(code).state;
    const node = getNodeAtMarker(state);
    assert.ok(node.nodeType === ParseNodeType.Name);
    assert.ok(node.parent?.nodeType === ParseNodeType.Index);

    const type = state.program.evaluator!.getType(node.parent);
    assert.ok(type);
    assert.ok(isClassInstance(type));
    assert.ok(ClassType.isBuiltIn(type, 'TypeForm'));

    const typeArg = type.priv.typeArgs?.[0];
    assert.ok(typeArg);
    assert.ok(isClassInstance(typeArg));
    assert.ok(ClassType.isTypedDictClass(typeArg));

    const runtimeTypeResult = state.program.evaluator!.getTypeOfExpression(node.parent);
    assert.ok(isInstantiableClass(runtimeTypeResult.type));
    assert.ok(ClassType.isTypedDictClass(runtimeTypeResult.type));

    const subnodeTypeResult = state.program.evaluator!.evaluateTypeForSubnode(node.parent, () => {
        assert.fail('Runtime type is already cached');
    });
    assert.strictEqual(subnodeTypeResult?.type, runtimeTypeResult.type);
});

test('TypeForm1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeForm1.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('TypeForm2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeForm2.py']);

    TestUtils.validateResults(analysisResults, 8);
});

test('TypeForm3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeForm3.py']);

    TestUtils.validateResults(analysisResults, 6);
});

test('TypeForm4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeForm4.py']);

    TestUtils.validateResults(analysisResults, 58);
});

test('TypeForm5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeForm5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeForm6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeForm6.py']);

    TestUtils.validateResults(analysisResults, 8);
});

test('TypeForm7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeForm7.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('TypeForm8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeForm8.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('TypeForm9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeForm9.py']);

    TestUtils.validateResults(analysisResults, 10);
});

test('TupleComparisonResults1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tupleComparisonResults1.py']);
    TestUtils.validateResults(analysisResults, 18);
});

test('TupleLiteralInference1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tupleLiteralInference1.py']);
    TestUtils.validateResults(analysisResults, 2);
});

test('TupleLiteralInference2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tupleLiteralInference2.py']);
    TestUtils.validateResults(analysisResults, 2);
    analysisResults[0].errors.forEach((diag) => assert.strictEqual(diag.getRule(), DiagnosticRule.reportArgumentType));
});

test('TupleLiteralInference3', () => {
    const comparisonSpy = jest.spyOn(TupleComparison, 'getTupleComparisonResult');
    try {
        const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tupleLiteralInference3.py']);
        TestUtils.validateResults(analysisResults, 0);
        assert.ok(comparisonSpy.mock.calls.length > 0);
        const callsByNode = new Map<number, number>();
        comparisonSpy.mock.calls.forEach(([, , , , node]) => {
            const calls = (callsByNode.get(node.id) ?? 0) + 1;
            callsByNode.set(node.id, calls);
            assert.ok(calls <= maxSubtypesForInferredType, 'Optional tuple precision exceeded the comparison budget');
        });
    } finally {
        comparisonSpy.mockRestore();
    }
});

test('TupleLiteralInference4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tupleLiteralInference4.py']);
    TestUtils.validateResults(analysisResults, 2);
    analysisResults[0].errors.forEach((diag) => assert.strictEqual(diag.getRule(), DiagnosticRule.reportArgumentType));
    assert.deepStrictEqual(
        analysisResults[0].errors.map((diag) => diag.range.start.line + 1).sort((left, right) => left - right),
        [114, 123]
    );
});

test('TupleLiteralInference5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tupleLiteralInference5.py']);
    TestUtils.validateResults(analysisResults, 2);
    analysisResults[0].errors.forEach((diag) => assert.strictEqual(diag.getRule(), DiagnosticRule.reportArgumentType));
    assert.deepStrictEqual(
        analysisResults[0].errors.map((diag) => diag.range.start.line + 1).sort((left, right) => left - right),
        [80, 89]
    );
});

test('TupleComparisonResults2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tupleComparisonResults2.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('TupleComparisonResults3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tupleComparisonResults3.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('TupleComparisonResults4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tupleComparisonResults4.py']);
    TestUtils.validateResults(analysisResults, 16);
});

test('TupleComparisonResults5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tupleComparisonResults5.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('TupleComparisonResults6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles([
        'tupleComparisonResource_hierarchy_64.py',
        'tupleComparisonResource_hierarchy_128.py',
        'tupleComparisonResource_hierarchy_256.py',
        'tupleComparisonResource_literal_union.py',
        'tupleComparisonResource_bool_union.py',
        'tupleComparisonResource_mixed_union.py',
        'tupleComparisonResource_mixed_union_consumer.py',
        'tupleComparisonResource_unsupported_union.py',
        'tupleComparisonResource_narrow_argument_union.py',
        'tupleComparisonResource_nested_tuple.py',
        'tupleComparisonResource_nested_list.py',
        'tupleComparisonResource_repeated_nested_types.py',
        'tupleComparisonResource_recursive_container.py',
        'tupleComparisonResource_recursive_nonbool.py',
        'tupleComparisonResource_recursive_bad_consumer.py',
        'tupleComparisonResource_long_alias_chain.py',
        'tupleComparisonResource_cyclic_source.py',
        'tupleComparisonResource_growing_alias_lt.py',
        'tupleComparisonResource_growing_alias_le.py',
        'tupleComparisonResource_growing_alias_gt.py',
        'tupleComparisonResource_growing_alias_ge.py',
        'tupleComparisonResource_growing_custom_bool.py',
        'tupleComparisonResource_growing_custom_str.py',
        'tupleComparisonResource_growing_two_parameters.py',
        'tupleComparisonResource_literal_boolean_result.py',
        'tupleComparisonResource_large_variadic_suffix.py',
        'tupleComparisonResource_large_variadic_custom.py',
        'tupleComparisonResource_large_variadic_nonbool.py',
        'tupleComparisonResource_one_sided_variadic.py',
        'tupleComparisonResource_deep_nonbool.py',
    ]);
    const expectedErrors = [0, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    analysisResults.forEach((result, index) => TestUtils.validateResults([result], expectedErrors[index]));
});

test('TupleComparisonResults7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tupleComparisonResults7.py']);
    TestUtils.validateResults(analysisResults, 28);
});

test('TupleComparisonResults8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tupleComparisonResults8.py']);
    TestUtils.validateResults(analysisResults, 1);
});

test('TupleComparisonResults9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tupleComparisonResults9.py']);
    TestUtils.validateResults(analysisResults, 12);
});

test('TupleComparisonResults10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tupleComparisonResults10.py']);
    TestUtils.validateResults(analysisResults, 7);
});

test('TupleComparisonResults11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tupleComparisonResults11.py']);
    TestUtils.validateResults(analysisResults, 7);
    assert.strictEqual(
        analysisResults[0].errors.filter((diag) => diag.getRule() === DiagnosticRule.reportReturnType).length,
        4
    );
    assert.strictEqual(
        analysisResults[0].errors.filter((diag) => diag.getRule() === DiagnosticRule.reportOperatorIssue).length,
        3
    );
});

test('TupleComparisonResults12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tupleComparisonResults12.py']);
    TestUtils.validateResults(analysisResults, 1);
    assert.strictEqual(analysisResults[0].errors[0].getRule(), DiagnosticRule.reportOperatorIssue);
    assert.strictEqual(analysisResults[0].errors[0].range.start.line + 1, 84);
});

test('TupleComparisonResults13', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tupleComparisonResults13.py']);
    TestUtils.validateResults(analysisResults, 10);
    analysisResults[0].errors.forEach((diag) => assert.strictEqual(diag.getRule(), DiagnosticRule.reportReturnType));
    assert.deepStrictEqual(
        analysisResults[0].errors.map((diag) => diag.range.start.line + 1).sort((left, right) => left - right),
        [49, 53, 57, 61, 65, 69, 73, 77, 81, 85]
    );
});

test('TupleLiteralInference6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tupleLiteralInference6.py']);
    TestUtils.validateResults(analysisResults, 2);
    analysisResults[0].errors.forEach((diag) => assert.strictEqual(diag.getRule(), DiagnosticRule.reportArgumentType));
    assert.deepStrictEqual(
        analysisResults[0].errors.map((diag) => diag.range.start.line + 1).sort((left, right) => left - right),
        [35, 44]
    );
});

test('TupleLiteralInferenceRetentionBudget', () => {
    const state = parseAndGetTestState('// @filename: test.py\n//// /*marker*/0').state;
    const evaluator = state.program.evaluator!;
    const node = getNodeAtMarker(state, 'marker');
    const intType = evaluator.getBuiltInObject(node, 'int');
    const tupleClass = evaluator.getTupleClassType();
    assert.ok(tupleClass && isInstantiableClass(tupleClass));

    const buildGraph = () => {
        const types: ClassType[] = [];
        let type = intType;
        for (let depth = 0; depth < 16; depth++) {
            const tuple = ClassType.cloneAsInstance(
                ClassType.specialize(tupleClass, [type], true, false, [
                    { type, isUnbounded: false },
                    { type, isUnbounded: false },
                ])
            );
            types.push(tuple);
            type = tuple;
        }
        return types;
    };
    const types = buildGraph();
    const baseTypes = buildGraph();
    const type = types[types.length - 1];
    const baseType = baseTypes[baseTypes.length - 1];
    let reads = 0;
    baseTypes.forEach((type) => {
        const args = type.priv.tupleTypeArgs;
        Object.defineProperty(type.priv, 'tupleTypeArgs', {
            get: () => {
                reads++;
                return args;
            },
        });
    });

    assert.strictEqual(retainInferredTupleLiterals(type, baseType), baseType);
    assert.strictEqual(reads, 0, 'Over-budget retention should fall back before comparing the base graph');
});

test('TupleComparisonResults14', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tupleComparisonResults14.py']);
    TestUtils.validateResults(analysisResults, 2);
    analysisResults[0].errors.forEach((diag) => assert.strictEqual(diag.getRule(), DiagnosticRule.reportArgumentType));
    assert.deepStrictEqual(
        analysisResults[0].errors.map((diag) => diag.range.start.line + 1).sort((left, right) => left - right),
        [118, 119]
    );
});

test('TupleComparisonResults15', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tupleComparisonResults15.py']);
    TestUtils.validateResults(analysisResults, 2);
    assert.strictEqual(
        analysisResults[0].errors.filter((diag) => diag.getRule() === DiagnosticRule.reportReturnType).length,
        1
    );
    assert.strictEqual(
        analysisResults[0].errors.filter((diag) => diag.getRule() === DiagnosticRule.reportOperatorIssue).length,
        1
    );
    assert.deepStrictEqual(
        analysisResults[0].errors
            .slice()
            .sort((left, right) => left.range.start.line - right.range.start.line)
            .map((diag) => [diag.range.start.line + 1, diag.getRule()]),
        [
            [41, DiagnosticRule.reportReturnType],
            [45, DiagnosticRule.reportOperatorIssue],
        ]
    );
});

test('TupleComparisonEqualityMemoization', () => {
    const code = `// @filename: test.py
//// /*marker*/0
`;
    const state = parseAndGetTestState(code).state;
    const evaluator = state.program.evaluator!;
    const node = getNodeAtMarker(state, 'marker');
    assert.ok(node.nodeType === ParseNodeType.Number);
    const intType = evaluator.getBuiltInObject(node, 'int');
    const boolType = evaluator.getBuiltInObject(node, 'bool');
    const tupleClass = evaluator.getTupleClassType();
    assert.ok(tupleClass && isInstantiableClass(tupleClass));

    let type = ClassType.cloneAsInstance(
        ClassType.specialize(tupleClass, [intType], true, false, [{ type: intType, isUnbounded: false }])
    );
    const types = [type];
    for (let depth = 1; depth <= 16; depth++) {
        type = ClassType.cloneAsInstance(
            ClassType.specialize(tupleClass, [type], true, false, [
                { type, isUnbounded: false },
                { type, isUnbounded: false },
            ])
        );
        types.push(type);
    }
    let reads = 0;
    types.forEach((type) => {
        const args = type.priv.tupleTypeArgs;
        Object.defineProperty(type.priv, 'tupleTypeArgs', {
            get: () => {
                reads++;
                return args;
            },
        });
    });

    const result = TupleComparison.getTupleComparisonResult(evaluator, type, type, OperatorType.LessThan, node);
    assert.ok(result && isTypeSame(result.type, boolType));
    assert.ok(reads < 1000, `Shared tuple graph was repeatedly expanded (${reads} tuple-argument reads)`);
});

test('TupleComparisonResults16', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tupleComparisonResults16.py']);
    TestUtils.validateResults(analysisResults, 6);
    analysisResults[0].errors.forEach((diag) => assert.strictEqual(diag.getRule(), DiagnosticRule.reportArgumentType));
    assert.deepStrictEqual(
        analysisResults[0].errors.map((diag) => diag.range.start.line + 1).sort((left, right) => left - right),
        [112, 113, 114, 115, 116, 117]
    );
});

test('TupleComparisonResults17', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tupleComparisonResults17.py']);
    TestUtils.validateResults(analysisResults, 8);
    analysisResults[0].errors.forEach((diag) => assert.strictEqual(diag.getRule(), DiagnosticRule.reportArgumentType));
    assert.deepStrictEqual(
        analysisResults[0].errors.map((diag) => diag.range.start.line + 1).sort((left, right) => left - right),
        [82, 83, 84, 85, 96, 97, 98, 99]
    );
});

test('TupleComparisonDistinctEqualityMemoization', () => {
    const lines = ['// @filename: test.py', '////type L0 = tuple[int]', '////type R0 = tuple[int]'];
    for (let depth = 1; depth <= 16; depth++) {
        lines.push(`////type L${depth} = tuple[L${depth - 1}, L${depth - 1}]`);
        lines.push(`////type R${depth} = tuple[R${depth - 1}, R${depth - 1}]`);
    }
    lines.push('////def compare(left: L16, right: R16) -> bool:');
    lines.push('////    return /*left*/left < /*right*/right');
    const state = parseAndGetTestState(lines.join('\n')).state;
    const evaluator = state.program.evaluator!;
    const leftNode = getNodeAtMarker(state, 'left');
    const rightNode = getNodeAtMarker(state, 'right');
    assert.ok(leftNode.nodeType === ParseNodeType.Name && rightNode.nodeType === ParseNodeType.Name);
    const left = evaluator.getTypeOfExpression(leftNode).type;
    const right = evaluator.getTypeOfExpression(rightNode).type;
    assert.ok(isClassInstance(left) && isClassInstance(right));
    assert.notStrictEqual(left, right);
    assert.notStrictEqual(left.priv.tupleTypeArgs?.[0].type, right.priv.tupleTypeArgs?.[0].type);

    const types = new Set<ClassType['priv']>();
    const visit = (type: Type) => {
        if (!isClassInstance(type) || !type.priv.tupleTypeArgs || types.has(type.priv)) return;
        types.add(type.priv);
        type.priv.tupleTypeArgs.forEach((arg) => visit(arg.type));
    };
    visit(left);
    visit(right);
    let reads = 0;
    types.forEach((priv) => {
        const args = priv.tupleTypeArgs;
        Object.defineProperty(priv, 'tupleTypeArgs', {
            get: () => {
                reads++;
                return args;
            },
        });
    });

    const node = leftNode.parent;
    assert.ok(node?.nodeType === ParseNodeType.BinaryOperation);
    const result = evaluator.getTypeOfExpression(node);
    assert.ok(isTypeSame(result.type, evaluator.getBuiltInObject(node, 'bool')));
    assert.ok(
        reads > 0 && reads < 1000,
        `Distinct tuple graphs were repeatedly expanded (${reads} tuple-argument reads)`
    );
});

test('TupleComparisonResults18', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tupleComparisonResults18.py']);
    TestUtils.validateResults(analysisResults, 6);
    analysisResults[0].errors.forEach((diag) => assert.strictEqual(diag.getRule(), DiagnosticRule.reportArgumentType));
    assert.deepStrictEqual(
        analysisResults[0].errors.map((diag) => diag.range.start.line + 1).sort((left, right) => left - right),
        [115, 116, 117, 118, 119, 120]
    );
});

test('TupleComparisonResults19', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tupleComparisonResults19.py']);
    TestUtils.validateResults(analysisResults, 4);
    analysisResults[0].errors.forEach((diag) => assert.strictEqual(diag.getRule(), DiagnosticRule.reportArgumentType));
    assert.deepStrictEqual(
        analysisResults[0].errors.map((diag) => diag.range.start.line + 1).sort((left, right) => left - right),
        [46, 47, 48, 49]
    );
});

test('TupleComparisonResults20', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tupleComparisonResults20.py']);
    TestUtils.validateResults(analysisResults, 4);
    analysisResults[0].errors.forEach((diag) => assert.strictEqual(diag.getRule(), DiagnosticRule.reportArgumentType));
    assert.deepStrictEqual(
        analysisResults[0].errors.map((diag) => diag.range.start.line + 1).sort((left, right) => left - right),
        [49, 50, 51, 52]
    );
});

test('TupleComparisonResults24', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tupleComparisonResults24.py']);
    TestUtils.validateResults(analysisResults, 14);
    assert.deepStrictEqual(
        analysisResults[0].errors
            .slice()
            .sort((left, right) => left.range.start.line - right.range.start.line)
            .map((diag) => [diag.range.start.line + 1, diag.getRule()]),
        [
            [34, DiagnosticRule.reportArgumentType],
            [35, DiagnosticRule.reportArgumentType],
            [36, DiagnosticRule.reportArgumentType],
            [37, DiagnosticRule.reportArgumentType],
            [42, DiagnosticRule.reportReturnType],
            [47, DiagnosticRule.reportReturnType],
            [52, DiagnosticRule.reportReturnType],
            [57, DiagnosticRule.reportReturnType],
            [87, DiagnosticRule.reportArgumentType],
            [88, DiagnosticRule.reportArgumentType],
            [89, DiagnosticRule.reportArgumentType],
            [90, DiagnosticRule.reportArgumentType],
            [111, DiagnosticRule.reportReturnType],
            [117, DiagnosticRule.reportReturnType],
        ]
    );
});

for (const context of ['chained', 'parenthesized']) {
    for (const form of ['tuple', 'name']) {
        for (const operator of ['<', '<=', '>', '>=']) {
            test(`TupleComparisonChainedIdentity ${context} ${form} ${operator}`, () => {
                const left = form === 'tuple' ? '(/*middle*/value, 0)' : '/*middle*/pair';
                const right = form === 'tuple' ? '(value, 1)' : 'pair';
                const comparison = `${left} ${operator} ${right}`;
                const expression = context === 'chained' ? `(Rebind(),) < ${comparison}` : `0 < (${comparison})`;
                const lines = [
                    '// @filename: test.py',
                    '////class Value:',
                    ...['__lt__', '__le__', '__gt__', '__ge__'].flatMap((method) => [
                        `////    def ${method}(self, other: object) -> str:`,
                        '////        return "ordered"',
                    ]),
                    '////value = Value()',
                    '////pair: tuple[Value, int] = (value, 0)',
                    '////class Rebind:',
                    '////    def __lt__(self, other: object) -> bool:',
                    '////        global value, pair',
                    '////        value = Value()',
                    '////        pair = (value, 1)',
                    '////        return True',
                    '////def compare() -> None:',
                    `////    _ = ${expression}`,
                ];
                const state = parseAndGetTestState(lines.join('\n')).state;
                const evaluator = state.program.evaluator!;
                const marker = getNodeAtMarker(state, 'middle');
                assert.ok(marker.nodeType === ParseNodeType.Name);
                const node = form === 'tuple' ? marker.parent?.parent : marker.parent;
                assert.ok(node?.nodeType === ParseNodeType.BinaryOperation);
                // Whole-chain propagation can hide the child result; inspect the actual comparison node.
                const result = evaluator.getTypeOfExpression(node);
                const boolType = evaluator.getBuiltInObject(node, 'bool');
                const expected =
                    context === 'chained'
                        ? combineTypes([evaluator.getBuiltInObject(node, 'str'), boolType])
                        : boolType;
                assert.ok(isTypeSame(result.type, expected), 'The complete middle-comparison type must be preserved');
                assert.strictEqual(evaluator.assignType(boolType, result.type), context !== 'chained');
            });
        }
    }
}

test('TupleComparisonClosedResultWorkBound', () => {
    for (const shape of ['below', 'limit', 'over', 'open', 'depth', 'deep', 'never']) {
        const code = `// @filename: test.py
////class /*value*/Value[T]:
////    def __lt__(self, other: object) -> str:
////        return "ordered"
////type Tree[T] = tuple[Value[T], tuple[Tree[list[T]], ...]]
////def compare(left: Tree[int], right: Tree[int]) -> None:
////    /*compare*/left < right
`;
        const state = parseAndGetTestState(code).state;
        const evaluator = state.program.evaluator!;
        const node = getNodeAtMarker(state, 'compare').parent;
        assert.ok(node?.nodeType === ParseNodeType.BinaryOperation);
        const strType = evaluator.getBuiltInObject(node, 'str');
        const boolType = evaluator.getBuiltInObject(node, 'bool');
        const listType = evaluator.getBuiltInObject(node, 'list');
        const tupleClass = evaluator.getTupleClassType();
        assert.ok(isClassInstance(listType) && tupleClass && isInstantiableClass(tupleClass));
        let payload = strType;
        let reads = 0;
        if (shape === 'never') {
            payload = ClassType.specialize(listType, [NeverType.createNever()], true);
        } else if (shape === 'open') {
            const valueNode = getNodeAtMarker(state, 'value');
            assert.ok(valueNode.nodeType === ParseNodeType.Name);
            const valueClass = evaluator.getTypeOfExpression(valueNode).type;
            assert.ok(isInstantiableClass(valueClass) && valueClass.shared.typeParams.length === 1);
            payload = ClassType.specialize(listType, [valueClass.shared.typeParams[0]], true);
        } else if (shape === 'depth' || shape === 'deep') {
            const depth = maxTypeRecursionCount + (shape === 'deep' ? 1 : 0);
            for (let index = 0; index < depth; index++) {
                payload = ClassType.specialize(listType, [payload], true);
            }
        } else {
            const width = maxSubtypesForInferredType - (shape === 'below' ? 2 : shape === 'limit' ? 1 : 0);
            const args = Array.from({ length: width }, () => {
                const arg = { type: strType, isUnbounded: false };
                Object.defineProperty(arg, 'type', {
                    get: () => {
                        reads++;
                        return strType;
                    },
                });
                return arg;
            });
            payload = ClassType.cloneAsInstance(ClassType.specialize(tupleClass, [strType], true, false, args));
        }
        const originalCall = evaluator.getTypeOfMagicMethodCall;
        const originalExpand = evaluator.mapSubtypesExpandTypeVars;
        let expansions = 0;
        evaluator.getTypeOfMagicMethodCall = (...args) =>
            isClassInstance(args[0]) && args[0].shared.name === 'Value' ? { type: payload } : originalCall(...args);
        evaluator.mapSubtypesExpandTypeVars = (...args) => {
            assert.ok(++expansions <= 2 * (maxSubtypesForInferredType + 1), `Unbounded expansion (${shape})`);
            return originalExpand(...args);
        };
        try {
            reads = 0;
            const result = evaluator.getTypeOfExpression(node);
            assert.ok(expansions > 0);
            assert.ok(reads <= maxSubtypesForInferredType, `Unbounded result traversal (${shape}: ${reads})`);
            if (shape === 'over' || shape === 'open' || shape === 'deep') {
                assert.ok(
                    isTypeSame(result.type, boolType),
                    `Complex result should use the existing fallback (${shape})`
                );
            } else {
                if (shape !== 'depth' && shape !== 'never') assert.ok(reads > 0);
                assert.ok(
                    isTypeSame(result.type, combineTypes([payload, boolType])),
                    `Closed result should preserve exactly payload | bool (${shape})`
                );
            }
        } finally {
            evaluator.getTypeOfMagicMethodCall = originalCall;
            evaluator.mapSubtypesExpandTypeVars = originalExpand;
        }
    }
});

test('TupleComparisonGrowingWorkBound', () => {
    for (const parameters of ['T', 'T, T']) {
        const lines = [
            '// @filename: test.py',
            `////class Box[${parameters === 'T' ? 'T' : 'T, U'}]:`,
            ...['__lt__', '__le__', '__gt__', '__ge__'].flatMap((method) => [
                `////    def ${method}(self, other: object) -> str:`,
                '////        return "ordered"',
            ]),
            `////type Tree[T] = tuple[T, tuple[Tree[Box[${parameters}]], ...]]`,
            '////def compare(left: Tree[int], right: Tree[int]) -> None:',
            ...['<', '<=', '>', '>='].map((operator, index) => `////    /*op${index}*/left ${operator} right`),
        ];
        const state = parseAndGetTestState(lines.join('\n')).state;
        const evaluator = state.program.evaluator!;
        const original = evaluator.mapSubtypesExpandTypeVars;
        let visits = 0;
        evaluator.mapSubtypesExpandTypeVars = (...args) => {
            assert.ok(++visits <= 64, `Recursive tuple ordering exceeded 64 type-expansion visits (${parameters})`);
            return original(...args);
        };
        try {
            for (let index = 0; index < 4; index++) {
                visits = 0;
                const node = getNodeAtMarker(state, `op${index}`).parent;
                assert.ok(node?.nodeType === ParseNodeType.BinaryOperation);
                const result = evaluator.getTypeOfExpression(node);
                assert.ok(visits > 0);
                assert.ok(
                    isTypeSame(
                        result.type,
                        combineTypes([
                            evaluator.getBuiltInObject(node, 'str'),
                            evaluator.getBuiltInObject(node, 'bool'),
                        ])
                    )
                );
            }
        } finally {
            evaluator.mapSubtypesExpandTypeVars = original;
        }
    }
});

test('TupleComparisonAliasSpecializationBound', () => {
    const lines = [
        '// @filename: test.py',
        '////type Tree[T] = tuple[int, tuple[Tree[list[T]], ...]]',
        '////def compare(left: Tree[int], right: Tree[int]) -> None:',
        ...['<', '<=', '>', '>='].map((operator, index) => `////    /*op${index}*/left ${operator} right`),
    ];
    const state = parseAndGetTestState(lines.join('\n')).state;
    const evaluator = state.program.evaluator!;
    const original = evaluator.mapSubtypesExpandTypeVars;
    let visits = 0;
    evaluator.mapSubtypesExpandTypeVars = (...args) => {
        if (getTypeAliasInfo(args[0])?.shared.name === 'Tree') {
            assert.ok(
                ++visits <= 2 * (maxSubtypesForInferredType + 1),
                `Recursive aliases exceeded 64 specializations (${visits} operand expansions)`
            );
        }
        return original(...args);
    };
    try {
        for (let index = 0; index < 4; index++) {
            visits = 0;
            const node = getNodeAtMarker(state, `op${index}`).parent;
            assert.ok(node?.nodeType === ParseNodeType.BinaryOperation);
            const result = evaluator.getTypeOfExpression(node);
            assert.ok(visits > 0);
            assert.ok(isTypeSame(result.type, evaluator.getBuiltInObject(node, 'bool')));
        }
    } finally {
        evaluator.mapSubtypesExpandTypeVars = original;
    }
});

test('TupleComparisonHomogeneousVariadicWorkBound', () => {
    const methods = ['__lt__', '__le__', '__gt__', '__ge__'];
    const lines = [
        '// @filename: test.py',
        '////class Value:',
        ...methods.flatMap((method) => [
            `////    def ${method}(self, other: object) -> str:`,
            '////        return "ordered"',
        ]),
        `////type Values = tuple[*tuple[Value, ...], ${Array(32).fill('Value').join(', ')}]`,
        '////def compare(left: Values, right: Values) -> None:',
        ...['<', '<=', '>', '>='].map((operator, index) => `////    /*op${index}*/left ${operator} right`),
    ];
    const state = parseAndGetTestState(lines.join('\n')).state;
    const evaluator = state.program.evaluator!;
    const original = evaluator.getTypeOfMagicMethodCall;
    let calls = 0;
    evaluator.getTypeOfMagicMethodCall = (...args) => {
        calls++;
        return original(...args);
    };
    try {
        for (let index = 0; index < 4; index++) {
            calls = 0;
            const node = getNodeAtMarker(state, `op${index}`).parent;
            assert.ok(node?.nodeType === ParseNodeType.BinaryOperation);
            const result = evaluator.getTypeOfExpression(node);
            assert.ok(calls > 0 && calls <= maxSubtypesForInferredType, `Homogeneous pairs required ${calls} calls`);
            assert.ok(
                isTypeSame(
                    result.type,
                    combineTypes([evaluator.getBuiltInObject(node, 'str'), evaluator.getBuiltInObject(node, 'bool')])
                )
            );
        }
    } finally {
        evaluator.getTypeOfMagicMethodCall = original;
    }
});

test('TupleLiteralInferenceScalarOrderingWorkBound', () => {
    const lines = [
        '// @filename: test.py',
        '////def compare(index: int) -> None:',
        '////    choices = ((0, 1, 2, 3, 4, 5, 6, 7),)[0]',
        '////    left = choices[index]',
        '////    right = choices[index]',
        ...['<', '<=', '>', '>='].map((operator, index) => `////    /*op${index}*/left ${operator} right`),
    ];
    const state = parseAndGetTestState(lines.join('\n')).state;
    const evaluator = state.program.evaluator!;
    const original = evaluator.getTypeOfMagicMethodCall;
    for (let index = 0; index < 4; index++) {
        const node = getNodeAtMarker(state, `op${index}`).parent;
        assert.ok(node?.nodeType === ParseNodeType.BinaryOperation);
        const left = evaluator.getTypeOfExpression(node.d.leftExpr).type;
        evaluator.getTypeOfExpression(node.d.rightExpr);
        assert.strictEqual(left.props?.inferredTupleLiteral?.alternatives, 8);
        let calls = 0;
        evaluator.getTypeOfMagicMethodCall = (...args) => {
            calls++;
            return original(...args);
        };
        try {
            const result = evaluator.getTypeOfExpression(node);
            assert.ok(calls > 0 && calls <= 2, `Builtin scalar ordering expanded ${calls} magic calls`);
            assert.ok(isTypeSame(result.type, evaluator.getBuiltInObject(node, 'bool')));
        } finally {
            evaluator.getTypeOfMagicMethodCall = original;
        }
    }
});

test('TupleLiteralInferenceConstantIndexWorkBound', () => {
    const values = Array.from({ length: 32 }, (_, index) => index % 7).join(', ');
    const lines = [
        '// @filename: test.py',
        '////def index_row() -> None:',
        `////    nested = ((${values},),)`,
        '////    row = nested[0]',
        '////    value = /*row*/row[0]',
    ];
    const state = parseAndGetTestState(lines.join('\n')).state;
    const evaluator = state.program.evaluator!;
    const rowNode = getNodeAtMarker(state, 'row');
    assert.ok(rowNode.nodeType === ParseNodeType.Name);
    const node = rowNode.parent;
    assert.ok(node?.nodeType === ParseNodeType.Index);
    const row = evaluator.getTypeOfExpression(rowNode).type;
    assert.ok(isClassInstance(row) && row.priv.tupleTypeArgs?.length === 32);
    const intType = evaluator.getBuiltInObject(node, 'int');
    assert.ok(isClassInstance(intType));
    const expectedType = ClassType.cloneWithLiteral(intType, 0);
    const literals = new Set<ClassType['priv']>();
    const seen = new Set<Type>();
    const visit = (type: Type) => {
        if (seen.has(type)) return;
        seen.add(type);
        if (isUnion(type)) {
            type.priv.subtypes.forEach(visit);
        } else if (isClassInstance(type)) {
            if (type.priv.literalValue !== undefined) literals.add(type.priv);
            type.priv.typeArgs?.forEach(visit);
            type.priv.tupleTypeArgs?.forEach((arg) => visit(arg.type));
        }
    };
    visit(row);
    assert.ok(literals.size >= 7);
    let reads = 0;
    literals.forEach((priv) => {
        const value = priv.literalValue;
        Object.defineProperty(priv, 'literalValue', {
            get: () => {
                reads++;
                return value;
            },
        });
    });
    const result = evaluator.getTypeOfExpression(node);
    const indexReads = reads;
    assert.ok(isTypeSame(result.type, expectedType));
    assert.ok(indexReads < 8, `Constant tuple indexing reprocessed ${indexReads} literal payloads`);
});

test('TupleLiteralInferenceConstantIndexMethodContract', () => {
    const code = `// @filename: test.py
////class /*noncallable*/NonCallable:
////    __getitem__: None
////class /*constrained*/ConstrainedSelf:
////    def __getitem__(self: str, index: int) -> str:
////        return ""
////def index_row(value: tuple[int, str]) -> None:
////    result = /*row*/value[0]
`;
    for (const mode of ['missing', 'inherited', 'noncallable', 'constrained']) {
        const state = parseAndGetTestState(code).state;
        const evaluator = state.program.evaluator!;
        const rowNode = getNodeAtMarker(state, 'row');
        assert.ok(rowNode.nodeType === ParseNodeType.Name);
        const node = rowNode.parent;
        assert.ok(node?.nodeType === ParseNodeType.Index);
        const row = evaluator.getTypeOfExpression(rowNode).type;
        assert.ok(isClassInstance(row));
        const originalMembers = row.shared.mro.filter(isInstantiableClass).map((type) => ({
            fields: type.shared.fields,
            symbol: type.shared.fields.get('__getitem__'),
        }));
        assert.ok(row.shared.fields.has('__getitem__'));
        try {
            if (mode === 'missing') {
                originalMembers.forEach(({ fields }) => fields.delete('__getitem__'));
            } else if (mode === 'inherited') {
                row.shared.fields.delete('__getitem__');
            } else {
                const classNode = getNodeAtMarker(state, mode);
                assert.ok(classNode.nodeType === ParseNodeType.Name);
                const replacement = evaluator.getTypeOfExpression(classNode).type;
                assert.ok(isInstantiableClass(replacement));
                const symbol = replacement.shared.fields.get('__getitem__');
                assert.ok(symbol);
                row.shared.fields.set('__getitem__', symbol);
            }
            const method = evaluator.getBoundMagicMethod(row, '__getitem__');
            const result = evaluator.getTypeOfExpression(node).type;
            if (mode === 'inherited') {
                assert.ok(method);
                assert.ok(isTypeSame(result, evaluator.getBuiltInObject(node, 'int')));
            } else {
                assert.ok(!method, `Native tuple method should not bind (${mode})`);
                assert.ok(isUnknown(result));
            }
        } finally {
            originalMembers.forEach(({ fields, symbol }) => {
                if (symbol) {
                    fields.set('__getitem__', symbol);
                } else {
                    fields.delete('__getitem__');
                }
            });
        }
    }
});

test('TupleComparisonResults21', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tupleComparisonResults21.py']);
    TestUtils.validateResults(analysisResults, 13);
    assert.strictEqual(
        analysisResults[0].errors.filter((diag) => diag.getRule() === DiagnosticRule.reportArgumentType).length,
        11
    );
    assert.strictEqual(
        analysisResults[0].errors.filter((diag) => diag.getRule() === DiagnosticRule.reportIndexIssue).length,
        2
    );
});

test('TupleComparisonResults22', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tupleComparisonResults22.py']);
    TestUtils.validateResults(analysisResults, 8);
    assert.deepStrictEqual(
        analysisResults[0].errors.map((diag) => [diag.getRule(), diag.range.start.line + 1]),
        [
            [DiagnosticRule.reportAssertTypeFailure, 29],
            [DiagnosticRule.reportAssertTypeFailure, 41],
            [DiagnosticRule.reportAssertTypeFailure, 56],
            [DiagnosticRule.reportAssertTypeFailure, 63],
            [DiagnosticRule.reportAssertTypeFailure, 71],
            [DiagnosticRule.reportAssertTypeFailure, 80],
            [DiagnosticRule.reportReturnType, 142],
            [DiagnosticRule.reportReturnType, 146],
        ]
    );
});

test('TupleComparisonFreshEmptyListWorkBound', () => {
    for (const [width, exact] of [
        [maxSubtypesForInferredType, true],
        [maxSubtypesForInferredType + 1, true],
        [maxSubtypesForInferredType, false],
        [maxSubtypesForInferredType + 1, false],
    ] as const) {
        const left = Array.from({ length: width }, () => '[]').join(', ');
        const right = Array.from({ length: width }, () => (exact ? '[ReturnsText()]' : 'other')).join(', ');
        const state = parseAndGetTestState(
            `// @filename: test.py
////class ReturnsText:
////    def __lt__(self, other: object) -> str: ...
////def compare(other: list[ReturnsText]) -> None:
////    (/*empty*/${left}) < (${right})
`
        ).state;
        const evaluator = state.program.evaluator!;
        const emptyNode = getNodeAtMarker(state, 'empty');
        assert.ok(emptyNode.nodeType === ParseNodeType.List);
        const leftNode = emptyNode.parent;
        assert.ok(leftNode?.nodeType === ParseNodeType.Tuple);
        const comparison = leftNode.parent;
        assert.ok(comparison?.nodeType === ParseNodeType.BinaryOperation);
        const rightNode = comparison.d.rightExpr;
        assert.ok(rightNode.nodeType === ParseNodeType.Tuple);
        const leftType = evaluator.getTypeOfExpression(leftNode).type;
        const rightType = evaluator.getTypeOfExpression(rightNode).type;
        assert.ok(isClassInstance(leftType) && isClassInstance(rightType));
        const nodes = [...leftNode.d.items, ...rightNode.d.items];
        const descriptors = nodes.map((node) => Object.getOwnPropertyDescriptor(node, 'nodeType')!);
        let reads = 0;
        nodes.forEach((node, index) => {
            Object.defineProperty(node, 'nodeType', {
                get: () => {
                    reads++;
                    return descriptors[index].value;
                },
                configurable: true,
            });
        });
        let result: ReturnType<typeof TupleComparison.getTupleComparisonResult>;
        try {
            result = TupleComparison.getTupleComparisonResult(
                evaluator,
                leftType,
                rightType,
                OperatorType.LessThan,
                comparison
            );
        } finally {
            nodes.forEach((node, index) => Object.defineProperty(node, 'nodeType', descriptors[index]));
        }
        assert.ok(result);
        assert.strictEqual(
            evaluator.printType(result.type),
            exact && width === maxSubtypesForInferredType ? 'bool' : 'Unknown | bool'
        );
        assert.ok(reads <= 4 * width, `Empty-list proof repeated source scans (${reads} node-kind reads)`);
    }
});

test('TupleComparisonResults23', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tupleComparisonResults23.py']);
    TestUtils.validateResults(analysisResults, 9);
    assert.deepStrictEqual(
        analysisResults[0].errors.map((diag) => [diag.getRule(), diag.range.start.line + 1]),
        [
            [DiagnosticRule.reportAssertTypeFailure, 35],
            [DiagnosticRule.reportAssertTypeFailure, 36],
            [DiagnosticRule.reportAssertTypeFailure, 37],
            [DiagnosticRule.reportAssertTypeFailure, 38],
            [DiagnosticRule.reportAssertTypeFailure, 50],
            [DiagnosticRule.reportAssertTypeFailure, 51],
            [DiagnosticRule.reportAssertTypeFailure, 52],
            [DiagnosticRule.reportAssertTypeFailure, 53],
            [DiagnosticRule.reportReturnType, 83],
        ]
    );
});

test('TupleComparisonFreshEmptyListChainedComparison', () => {
    for (const [operator, token] of [
        [OperatorType.LessThan, '<'],
        [OperatorType.LessThanOrEqual, '<='],
        [OperatorType.GreaterThan, '>'],
        [OperatorType.GreaterThanOrEqual, '>='],
    ] as const) {
        for (const parenthesized of [false, true]) {
            const state = parseAndGetTestState(
                `// @filename: test.py
////class ReturnsText:
////    def __lt__(self, other: object) -> str: ...
////class MutatesTuple:
////    def __lt__(self, other: tuple[list[ReturnsText]] | bool) -> bool:
////        if isinstance(other, tuple):
////            other[0].append(ReturnsText())
////        return True
////def compare(prefix: MutatesTuple) -> None:
////    prefix < ${parenthesized ? '(' : ''}(/*empty*/[],) ${token} ([ReturnsText()],)${parenthesized ? ')' : ''}
`
            ).state;
            const evaluator = state.program.evaluator!;
            const emptyNode = getNodeAtMarker(state, 'empty');
            assert.ok(emptyNode.nodeType === ParseNodeType.List);
            const leftNode = emptyNode.parent;
            assert.ok(leftNode?.nodeType === ParseNodeType.Tuple);
            const comparison = leftNode.parent;
            assert.ok(comparison?.nodeType === ParseNodeType.BinaryOperation);
            assert.strictEqual(!!comparison.d.hasParens, parenthesized);
            const rightNode = comparison.d.rightExpr;
            assert.ok(rightNode.nodeType === ParseNodeType.Tuple);
            const leftType = evaluator.getTypeOfExpression(leftNode).type;
            const rightType = evaluator.getTypeOfExpression(rightNode).type;
            assert.ok(isClassInstance(leftType) && isClassInstance(rightType));
            const result = TupleComparison.getTupleComparisonResult(
                evaluator,
                leftType,
                rightType,
                operator,
                comparison
            );
            assert.ok(result);
            assert.strictEqual(evaluator.printType(result.type), parenthesized ? 'bool' : 'Unknown | bool');
        }
    }
});

test('TupleLiteralInferenceUnionRetentionWorkBound', () => {
    for (const width of [8, 9]) {
        const alternatives = Array.from({ length: width }, (_, index) => `tuple[Literal[${index}]]`).join(' | ');
        const state = parseAndGetTestState(
            `// @filename: test.py
////from typing import Literal
////def retain(value: ${alternatives}, fallback: tuple[int]) -> None:
////    /*value*/value
////    /*fallback*/fallback
`
        ).state;
        const evaluator = state.program.evaluator!;
        const nameNode = getNodeAtMarker(state, 'value');
        const fallbackNode = getNodeAtMarker(state, 'fallback');
        assert.ok(nameNode.nodeType === ParseNodeType.Name && fallbackNode.nodeType === ParseNodeType.Name);
        const type = retainInferredTupleLiterals(
            evaluator.getTypeOfExpression(nameNode).type,
            evaluator.getTypeOfExpression(fallbackNode).type
        );
        assert.ok(isUnion(type) && type.priv.subtypes.length === width);
        const info = type.props?.inferredTupleLiteral;
        assert.ok(info && info.alternatives === width);
        const tuples = type.priv.subtypes.filter(isClassInstance);
        assert.strictEqual(tuples.length, width);
        const values = tuples.map((tuple) => {
            const args = tuple.priv.tupleTypeArgs;
            assert.ok(args?.length === 1);
            const value = args[0].type;
            assert.ok(isClassInstance(value) && typeof value.priv.literalValue === 'number');
            return value.priv.literalValue;
        });
        assert.deepStrictEqual(
            values.sort((left, right) => left - right),
            Array.from({ length: width }, (_, index) => index)
        );

        let reads = 0;
        tuples.forEach((tuple) => {
            const args = tuple.priv.tupleTypeArgs;
            Object.defineProperty(tuple.priv, 'tupleTypeArgs', {
                get: () => {
                    reads++;
                    return args;
                },
            });
        });
        const retained = retainInferredTupleLiterals(type, info.baseType);
        const retentionReads = reads;
        assert.ok(
            retentionReads > 0 && retentionReads <= maxSubtypesForInferredType,
            `Unchanged ${width}-way tuple union required ${retentionReads} tuple-argument reads`
        );
        assert.ok(isUnion(retained) && retained.priv.subtypes === type.priv.subtypes);
        assert.ok(retained.props?.inferredTupleLiteral?.baseType === info.baseType);
        assert.strictEqual(retained.props?.inferredTupleLiteral?.alternatives, width);
        assert.strictEqual(evaluator.printType(retained), evaluator.printType(type));
    }
});

test('TupleLiteralInferenceRetentionSubtypeNormalization', () => {
    const state = parseAndGetTestState(
        `// @filename: test.py
////from typing import Literal
////def retain(value: Literal[0] | tuple[Literal[1]], fallback: int | tuple[int]) -> None:
////    /*value*/value
////    /*fallback*/fallback
`
    ).state;
    const evaluator = state.program.evaluator!;
    const valueNode = getNodeAtMarker(state, 'value');
    const fallbackNode = getNodeAtMarker(state, 'fallback');
    assert.ok(valueNode.nodeType === ParseNodeType.Name && fallbackNode.nodeType === ParseNodeType.Name);
    const type = evaluator.getTypeOfExpression(valueNode).type;
    const baseType = evaluator.getTypeOfExpression(fallbackNode).type;
    assert.ok(isUnion(type) && type.priv.subtypes.length === 2);
    const literal = type.priv.subtypes.find((subtype) => isClassInstance(subtype) && subtype.priv.literalValue === 0);
    const tuple = type.priv.subtypes.find((subtype) => isClassInstance(subtype) && !!subtype.priv.tupleTypeArgs);
    assert.ok(literal && tuple && !literal.props?.inferredTupleLiteral);

    const retained = retainInferredTupleLiterals(type, baseType);
    assert.ok(isUnion(retained) && retained.priv.subtypes.length === 2);
    const retainedLiteral = retained.priv.subtypes.find(
        (subtype) => isClassInstance(subtype) && subtype.priv.literalValue === 0
    );
    assert.ok(retainedLiteral && retainedLiteral !== literal);
    assert.ok(retainedLiteral.props?.inferredTupleLiteral);
    assert.ok(isClassInstance(retainedLiteral.props.inferredTupleLiteral.baseType));
    assert.strictEqual(retainedLiteral.props.inferredTupleLiteral.baseType.priv.literalValue, undefined);
    assert.ok(retained.priv.subtypes.includes(tuple));
    assert.ok(retained.props?.inferredTupleLiteral?.baseType === baseType);
    assert.strictEqual(literal.props?.inferredTupleLiteral, undefined);
    assert.strictEqual(evaluator.printType(retained), evaluator.printType(type));
});

test('TupleLiteralInferenceUnchangedSpecializationWorkBound', () => {
    for (const width of [8, 9]) {
        const choices = Array.from({ length: width }, (_, index) => `(${index},)`).join(', ');
        const state = parseAndGetTestState(
            `// @filename: test.py
////def select() -> None:
////    choices = (${choices})
////    /*choices*/choices
`
        ).state;
        const evaluator = state.program.evaluator!;
        const node = getNodeAtMarker(state, 'choices');
        assert.ok(node.nodeType === ParseNodeType.Name);
        const type = evaluator.getTypeOfExpression(node).type;
        assert.ok(isClassInstance(type) && ClassType.isTupleClass(type));
        const originalArgs = type.priv.tupleTypeArgs;
        assert.ok(originalArgs && originalArgs.length === width);
        const info = type.props?.inferredTupleLiteral;
        assert.ok(info && info.alternatives === 1);

        let reads = 0;
        originalArgs.forEach((arg, index) => {
            const tuple = arg.type;
            assert.ok(isClassInstance(tuple));
            const args = tuple.priv.tupleTypeArgs;
            assert.ok(args?.length === 1);
            const value = args[0].type;
            assert.ok(isClassInstance(value) && value.priv.literalValue === index);
            Object.defineProperty(tuple.priv, 'tupleTypeArgs', {
                get: () => {
                    reads++;
                    return args;
                },
            });
        });

        const transformedArgs: Type[] = [];
        let readsAtLastTransform = 0;
        class IdentityTransformer extends TypeVarTransformer {
            override apply(arg: Type): Type {
                transformedArgs.push(arg);
                readsAtLastTransform = reads;
                return arg;
            }
        }
        const transformed = new IdentityTransformer().transformTypeVarsInClassType(type, 0);
        const recombinationReads = reads - readsAtLastTransform;
        assert.strictEqual(transformedArgs.length, width);
        originalArgs.forEach((arg, index) => assert.strictEqual(transformedArgs[index], arg.type));
        assert.strictEqual(
            recombinationReads,
            0,
            `Unchanged ${width}-element tuple required ${recombinationReads} tuple-argument reads after transformation`
        );
        assert.strictEqual(transformed, type);
        assert.strictEqual(type.priv.tupleTypeArgs, originalArgs);
        assert.strictEqual(type.props?.inferredTupleLiteral, info);
    }
});

test('TupleLiteralInferenceUnmarkedSpecializationWorkBound', () => {
    for (const width of [maxSubtypesForInferredType, 8, 16, 32]) {
        const entries = Array.from({ length: width }, () => 'int').join(', ');
        const state = parseAndGetTestState(
            `// @filename: test.py
////def specialize(value: tuple[${entries}]) -> None:
////    /*value*/value
`
        ).state;
        const evaluator = state.program.evaluator!;
        const node = getNodeAtMarker(state, 'value');
        assert.ok(node.nodeType === ParseNodeType.Name);
        const type = evaluator.getTypeOfExpression(node).type;
        assert.ok(isClassInstance(type) && ClassType.isTupleClass(type));
        assert.strictEqual(type.props?.inferredTupleLiteral, undefined);
        const args = type.priv.tupleTypeArgs;
        assert.ok(args?.length === width);
        const expectedType = evaluator.printType(type);
        const descriptors = args.map((arg) => Object.getOwnPropertyDescriptor(arg, 'type')!);
        let reads = 0;
        args.forEach((arg, index) => {
            const value = arg.type;
            assert.strictEqual(value.props?.inferredTupleLiteral, undefined);
            Object.defineProperty(arg, 'type', {
                configurable: true,
                get: () => {
                    reads++;
                    return value;
                },
            });
            assert.ok(descriptors[index]);
        });

        let specialized: ClassType;
        try {
            specialized = ClassType.specialize(
                type,
                type.priv.typeArgs,
                type.priv.isTypeArgExplicit,
                !!type.priv.includeSubclasses,
                args,
                type.priv.isEmptyContainer
            );
        } finally {
            args.forEach((arg, index) => Object.defineProperty(arg, 'type', descriptors[index]));
        }
        assert.ok(reads <= width, `Unmarked ${width}-element specialization required ${reads} tuple-entry reads`);
        assert.notStrictEqual(specialized, type);
        assert.notStrictEqual(specialized.priv.tupleTypeArgs, args);
        assert.deepStrictEqual(specialized.priv.tupleTypeArgs, args);
        assert.strictEqual(specialized.priv.typeArgs, type.priv.typeArgs);
        assert.strictEqual(specialized.props?.inferredTupleLiteral, undefined);
        assert.strictEqual(evaluator.printType(specialized), expectedType);
        assert.strictEqual(type.priv.tupleTypeArgs, args);
    }
});

test('TupleLiteralInferenceSingletonUnionWorkBound', () => {
    const state = parseAndGetTestState('// @filename: test.py\n//// /*value*/0').state;
    const evaluator = state.program.evaluator!;
    const node = getNodeAtMarker(state, 'value');
    const intType = evaluator.getBuiltInObject(node, 'int');
    const strType = evaluator.getBuiltInObject(node, 'str');
    assert.ok(isClassInstance(intType));
    const retained = retainInferredTupleLiterals(ClassType.cloneWithLiteral(intType, 1), intType);
    assert.ok(retained.props?.inferredTupleLiteral);
    for (const original of [
        intType,
        combineTypes([intType, strType]),
        retained,
        NeverType.createNever(),
        UnknownType.create(),
    ]) {
        const type = TypeBase.cloneType(original);
        const props = type.props;
        const descriptor = Object.getOwnPropertyDescriptor(type, 'props');
        let reads = 0;
        Object.defineProperty(type, 'props', {
            configurable: true,
            get: () => {
                reads++;
                return props;
            },
        });
        try {
            assert.strictEqual(combineTypes([type]), type);
            assert.strictEqual(combineTypes([type], { skipElideRedundantLiterals: true }), type);
            assert.strictEqual(combineTypes([type], { maxSubtypeCount: 0 }), type);
        } finally {
            if (descriptor) {
                Object.defineProperty(type, 'props', descriptor);
            } else {
                delete type.props;
            }
        }
        assert.strictEqual(reads, 0, 'A singleton union should not inspect optional inference metadata');
        assert.strictEqual(type.props, props);
    }
});

test('TupleSpecializationTypeVarSubstitution', () => {
    const state = parseAndGetTestState(
        `// @filename: test.py
////from typing import TypeVar, TypeVarTuple, Unpack
////T = TypeVar("T")
////Ts = TypeVarTuple("Ts")
////def /*function*/specialize(
////    bounded: tuple[T, int],
////    unbounded: tuple[T, ...],
////    unpacked: tuple[Unpack[Ts]],
////    scalar: str,
////    pair: tuple[str, int],
////) -> None:
////    /*boundBody*/bounded
`
    ).state;
    const evaluator = state.program.evaluator!;
    const functionNode = getNodeAtMarker(state, 'function').parent;
    assert.ok(functionNode?.nodeType === ParseNodeType.Function);
    const functionResult = evaluator.getTypeOfFunction(functionNode);
    assert.ok(functionResult);
    const typeAt = (index: number) => {
        const type = FunctionType.getParamType(functionResult.functionType, index);
        assert.ok(isClassInstance(type) && ClassType.isTupleClass(type));
        return type;
    };
    const scalar = FunctionType.getParamType(functionResult.functionType, 3);
    assert.ok(isClassInstance(scalar) && ClassType.isBuiltIn(scalar, 'str'));

    for (const index of [0, 1]) {
        const type = typeAt(index);
        const args = type.priv.tupleTypeArgs;
        assert.ok(args && isTypeVar(args[0].type) && !TypeVarType.isBound(args[0].type));
        const originalTypeVar = args[0].type;
        const solution = new ConstraintSolution();
        solution.setType(originalTypeVar, scalar);
        const specialized = applySolvedTypeVars(type, solution);
        assert.ok(isClassInstance(specialized) && specialized !== type);
        assert.strictEqual(evaluator.printType(specialized), index === 0 ? 'tuple[str, int]' : 'tuple[str, ...]');
        const effectiveArgs = specialized.priv.typeArgs;
        assert.ok(effectiveArgs?.length === 1);
        assert.strictEqual(evaluator.printType(effectiveArgs[0]), index === 0 ? 'str | int' : 'str');
        assert.strictEqual(type.priv.tupleTypeArgs, args);
        assert.strictEqual(args[0].type, originalTypeVar);

        if (index === 0) {
            const boundNode = getNodeAtMarker(state, 'boundBody');
            assert.ok(boundNode.nodeType === ParseNodeType.Name);
            const boundType = evaluator.getTypeOfExpression(boundNode).type;
            assert.ok(isClassInstance(boundType) && boundType.priv.tupleTypeArgs);
            const boundTypeVar = boundType.priv.tupleTypeArgs[0].type;
            assert.ok(isTypeVar(boundTypeVar) && TypeVarType.isBound(boundTypeVar));
            assert.strictEqual(applySolvedTypeVars(boundType, solution), boundType);
        } else {
            solution.setType(originalTypeVar, NeverType.createNever());
            const empty = applySolvedTypeVars(type, solution);
            assert.ok(isClassInstance(empty) && empty.priv.tupleTypeArgs?.length === 0);
            assert.strictEqual(evaluator.printType(empty), 'tuple[()]');
            assert.ok(empty.priv.typeArgs?.length === 1 && isNever(empty.priv.typeArgs[0]));
        }
    }

    const unpacked = typeAt(2);
    const args = unpacked.priv.tupleTypeArgs;
    assert.ok(args?.length === 1 && isTypeVarTuple(args[0].type));
    const solution = new ConstraintSolution();
    solution.setType(args[0].type, ClassType.cloneForUnpacked(typeAt(4)));
    const specialized = applySolvedTypeVars(unpacked, solution);
    assert.ok(isClassInstance(specialized) && specialized !== unpacked);
    assert.strictEqual(evaluator.printType(specialized), 'tuple[str, int]');
    const effectiveArgs = specialized.priv.typeArgs;
    assert.ok(effectiveArgs?.length === 1);
    assert.strictEqual(evaluator.printType(effectiveArgs[0]), 'str | int');
    assert.strictEqual(unpacked.priv.tupleTypeArgs, args);
    assert.ok(isTypeVarTuple(args[0].type));
});

test('TupleLiteralInference7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tupleLiteralInference7.py']);
    TestUtils.validateResults(analysisResults, 7);
    assert.deepStrictEqual(
        analysisResults[0].errors
            .filter((diag) => diag.getRule() === DiagnosticRule.reportArgumentType)
            .map((diag) => diag.range.start.line + 1),
        [24, 29, 51, 61, 75, 90]
    );
    assert.deepStrictEqual(
        analysisResults[0].errors
            .filter((diag) => diag.getRule() === DiagnosticRule.reportCallIssue)
            .map((diag) => diag.range.start.line + 1),
        [90]
    );
});

test('TupleLiteralInferenceDynamicIndexWorkBound', () => {
    for (const width of [8, 9, 2]) {
        const choices = Array.from({ length: width }, (_, index) => `(${index},)`).join(', ');
        const state = parseAndGetTestState(
            `// @filename: test.py
////def select(index: int) -> None:
////    choices = (${choices})
////    selected = /*selected*/choices[index]
`
        ).state;
        const evaluator = state.program.evaluator!;
        const nameNode = getNodeAtMarker(state, 'selected');
        assert.ok(nameNode.nodeType === ParseNodeType.Name);
        const node = nameNode.parent;
        assert.ok(node?.nodeType === ParseNodeType.Index);
        const type = evaluator.getTypeOfExpression(nameNode).type;
        assert.ok(isClassInstance(type) && type.priv.tupleTypeArgs?.length === width);
        const originalArgs = type.priv.tupleTypeArgs;
        const info = type.props?.inferredTupleLiteral;
        assert.ok(info && isClassInstance(info.baseType));
        const intType = evaluator.getBuiltInObject(node, 'int');

        let reads = 0;
        originalArgs.forEach((arg, index) => {
            const row = arg.type;
            assert.ok(isClassInstance(row));
            const args = row.priv.tupleTypeArgs;
            assert.ok(args?.length === 1);
            const value = args[0].type;
            assert.ok(isClassInstance(value) && value.priv.literalValue === index);
            Object.defineProperty(row.priv, 'tupleTypeArgs', {
                get: () => {
                    reads++;
                    return args;
                },
            });
        });

        const result = evaluator.getTypeOfExpression(node);
        const indexReads = reads;
        assert.ok(
            indexReads <= maxSubtypesForInferredType,
            `Dynamic ${width}-row indexing reprocessed ${indexReads} retained tuple arguments`
        );
        assert.ok(isClassInstance(result.type) && result.type.priv.tupleTypeArgs?.length === 1);
        assert.ok(isTypeSame(result.type.priv.tupleTypeArgs[0].type, intType));
        assert.strictEqual(result.type.props?.inferredTupleLiteral, undefined);
        assert.strictEqual(type.priv.tupleTypeArgs, originalArgs);
        assert.strictEqual(type.props?.inferredTupleLiteral, info);
    }
});
