/*
 * typeEvaluator2.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Unit tests for pyright type evaluator. Tests are split
 * arbitrarily among multiple files so they can run in parallel.
 */

import { ConfigOptions } from '../common/configOptions';
import { pythonVersion3_10, pythonVersion3_9 } from '../common/pythonVersion';
import { Uri } from '../common/uri/uri';
import * as TestUtils from './testUtils';

test('CallbackProtocol1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['callbackProtocol1.py']);

    TestUtils.validateResults(analysisResults, 9);
});

test('CallbackProtocol2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['callbackProtocol2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('CallbackProtocol3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['callbackProtocol3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('CallbackProtocol4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['callbackProtocol4.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('CallbackProtocol5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['callbackProtocol5.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('CallbackProtocol6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['callbackProtocol6.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('CallbackProtocol7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['callbackProtocol7.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('CallbackProtocol8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['callbackProtocol8.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('CallbackProtocol9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['callbackProtocol9.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Assignment1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignment1.py']);

    TestUtils.validateResults(analysisResults, 8);
});

test('Assignment2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignment2.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Assignment3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignment3.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('Assignment4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignment4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Assignment5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignment5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Assignment6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignment6.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Assignment7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignment7.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Assignment8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignment8.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Assignment9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignment9.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Assignment10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignment10.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Assignment11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignment11.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Assignment12', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['assignment12.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 0);

    configOptions.diagnosticRuleSet.reportUnknownVariableType = 'error';
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['assignment12.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 2);
});

test('AugmentedAssignment1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['augmentedAssignment1.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('AugmentedAssignment2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['augmentedAssignment2.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('AugmentedAssignment3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['augmentedAssignment3.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Super1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['super1.py']);

    TestUtils.validateResults(analysisResults, 6);
});

test('Super2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['super2.py']);

    TestUtils.validateResults(analysisResults, 0, 0, 3);
});

test('Super3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['super3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Super4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['super4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Super5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['super5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Super6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['super6.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Super7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['super7.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Super8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['super8.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Super9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['super9.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Super10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['super10.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Super11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['super11.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Super12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['super12.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('MissingSuper1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['missingSuper1.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 0);

    configOptions.diagnosticRuleSet.reportMissingSuperCall = 'error';
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['missingSuper1.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 4);
});

test('NewType1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['newType1.py']);

    TestUtils.validateResults(analysisResults, 11);
});

test('NewType2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['newType2.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('NewType3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['newType3.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('NewType4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['newType4.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('NewType5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['newType5.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('NewType6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['newType6.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('isInstance1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['isinstance1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('isInstance2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['isinstance2.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('isInstance3', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_9;
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['isinstance3.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 4);

    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['isinstance3.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 4);
});

test('isInstance4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['isinstance4.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('isInstance5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['isinstance5.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('isInstance6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['isinstance6.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Unbound1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['unbound1.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Unbound2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['unbound2.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Unbound3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['unbound3.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Unbound4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['unbound4.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Unbound5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['unbound5.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Unbound6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['unbound6.py']);

    TestUtils.validateResults(analysisResults, 8);
});

test('Assert1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    // By default, this is reported as a warning.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['assert1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0, 2);

    // Enable it as an error.
    configOptions.diagnosticRuleSet.reportAssertAlwaysTrue = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['assert1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 2, 0);

    // Turn off the diagnostic.
    configOptions.diagnosticRuleSet.reportAssertAlwaysTrue = 'none';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['assert1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0, 0);
});

test('RevealedType1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['revealedType1.py']);

    TestUtils.validateResults(analysisResults, 2, 0, 7);
});

test('AssertType1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assertType1.py']);

    TestUtils.validateResults(analysisResults, 11);
});

test('NameBinding1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['nameBinding1.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('NameBinding2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['nameBinding2.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('NameBinding3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['nameBinding3.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('NameBinding4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['nameBinding4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('NameBinding5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['nameBinding5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('ConstrainedTypeVar1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constrainedTypeVar1.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('ConstrainedTypeVar2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constrainedTypeVar2.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('ConstrainedTypeVar3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constrainedTypeVar3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('ConstrainedTypeVar4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constrainedTypeVar4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('ConstrainedTypeVar5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constrainedTypeVar5.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('ConstrainedTypeVar6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constrainedTypeVar6.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('ConstrainedTypeVar7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constrainedTypeVar7.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('ConstrainedTypeVar8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constrainedTypeVar8.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('ConstrainedTypeVar9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constrainedTypeVar9.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('ConstrainedTypeVar10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constrainedTypeVar10.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('ConstrainedTypeVar11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constrainedTypeVar11.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('ConstrainedTypeVar12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constrainedTypeVar12.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('ConstrainedTypeVar13', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constrainedTypeVar13.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('ConstrainedTypeVar14', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constrainedTypeVar14.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('ConstrainedTypeVar15', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.diagnosticRuleSet.disableBytesTypePromotions = true;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constrainedTypeVar15.py'], configOptions);

    TestUtils.validateResults(analysisResults, 0);
});

test('ConstrainedTypeVar16', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constrainedTypeVar16.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('ConstrainedTypeVar17', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constrainedTypeVar17.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('ConstrainedTypeVar18', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constrainedTypeVar18.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('ConstrainedTypeVar19', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constrainedTypeVar19.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('MissingTypeArg1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    // By default, reportMissingTypeArgument is disabled.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['missingTypeArg1.py']);
    TestUtils.validateResults(analysisResults, 1);

    // Turn on errors.
    configOptions.diagnosticRuleSet.reportMissingTypeArgument = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['missingTypeArg1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 6);
});

test('Solver1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Solver2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Solver3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver3.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Solver4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Solver5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Solver6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver6.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Solver7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver7.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Solver8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver8.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Solver9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver9.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Solver10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver10.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Solver11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver11.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Solver12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver12.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Solver13', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver13.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Solver14', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver14.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Solver15', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver15.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Solver16', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver16.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Solver17', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver17.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Solver18', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver18.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Solver19', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver19.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Solver20', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver20.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Solver21', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver21.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Solver22', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver22.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Solver23', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver23.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Solver24', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver24.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Solver25', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver25.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Solver26', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver26.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Solver27', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver27.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Solver28', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver28.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Solver29', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver29.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Solver30', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver30.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Solver31', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver31.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Solver32', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver32.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Solver33', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver33.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Solver34', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver34.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('SolverScoring1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solverScoring1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('SolverScoring2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solverScoring2.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('SolverScoring3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solverScoring3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('SolverScoring4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solverScoring4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('SolverHigherOrder1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solverHigherOrder1.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('SolverHigherOrder2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solverHigherOrder2.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('SolverHigherOrder3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solverHigherOrder3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('SolverHigherOrder4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solverHigherOrder4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('SolverHigherOrder5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solverHigherOrder5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('SolverHigherOrder6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solverHigherOrder6.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('SolverHigherOrder7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solverHigherOrder7.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('SolverHigherOrder8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solverHigherOrder8.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('SolverHigherOrder9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solverHigherOrder9.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('SolverHigherOrder10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solverHigherOrder10.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('SolverHigherOrder11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solverHigherOrder11.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('SolverLiteral1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solverLiteral1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('SolverLiteral2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solverLiteral2.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('SolverUnknown1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solverUnknown1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType1.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('GenericType2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType3.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('GenericType4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType4.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('GenericType5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType5.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('GenericType6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType6.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('GenericType7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType7.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('GenericType8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType8.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('GenericType9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType9.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('GenericType10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType10.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType11.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType12.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType13', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType13.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType14', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType14.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType15', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType15.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType16', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType16.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType17', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType17.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType18', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType18.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('GenericType19', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType19.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType20', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType20.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('GenericType21', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType21.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType22', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType22.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('GenericType23', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType23.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType24', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType24.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType25', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType25.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('GenericType26', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType26.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('GenericType27', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType27.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType28', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType28.py']);

    TestUtils.validateResults(analysisResults, 18);
});

test('GenericType29', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType29.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType30', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType30.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType31', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType31.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('GenericType32', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType32.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType33', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType33.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('GenericType34', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType34.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType35', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType35.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('GenericType36', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType36.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType37', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType37.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType38', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType38.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType39', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType39.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType40', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType40.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType41', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType41.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType42', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType42.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType43', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType43.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType44', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType44.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType45', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType45.py']);

    TestUtils.validateResults(analysisResults, 6);
});

test('Protocol1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol1.py']);

    TestUtils.validateResults(analysisResults, 8);
});

test('Protocol2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol3.py']);

    TestUtils.validateResults(analysisResults, 12);
});

test('Protocol4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol4.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('Protocol5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol6.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('Protocol7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol7.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Protocol8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol8.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Protocol9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol9.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol10.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol11.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol12.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Protocol13', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol13.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol14', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol14.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol15', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol15.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol16', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol16.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Protocol17', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.diagnosticRuleSet.reportInvalidTypeVarUse = 'error';
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol17.py']);

    TestUtils.validateResults(analysisResults, 7);
});

test('Protocol18', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol18.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Protocol19', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol19.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Protocol20', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol20.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol21', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol21.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Protocol22', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.diagnosticRuleSet.reportInvalidTypeVarUse = 'error';
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol22.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol23', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol23.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Protocol24', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol24.py']);

    TestUtils.validateResults(analysisResults, 6);
});

test('Protocol25', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol25.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Protocol26', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol26.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol28', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol28.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol29', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol29.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol30', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol30.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Protocol31', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol31.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol32', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol32.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Protocol33', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol33.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol34', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol34.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Protocol35', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol35.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Protocol36', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol36.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol37', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol37.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol38', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol38.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol39', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol39.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol40', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol40.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol41', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol41.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol42', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol42.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol43', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol43.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol44', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol44.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol45', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol45.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol46', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol46.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol47', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol47.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol48', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol48.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('ProtocolExplicit1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocolExplicit1.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('ProtocolExplicit3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocolExplicit3.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('TypedDict1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict1.py']);

    TestUtils.validateResults(analysisResults, 11);
});

test('TypedDict2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict2.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('TypedDict3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict3.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('TypedDict4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict4.py']);

    TestUtils.validateResults(analysisResults, 7);
});

test('TypedDict5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict5.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('TypedDict6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict6.py']);

    TestUtils.validateResults(analysisResults, 13);
});

test('TypedDict7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict7.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypedDict8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict8.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('TypedDict9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict9.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('TypedDict10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict10.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('TypedDict11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict11.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypedDict12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict12.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('TypedDict13', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict13.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('TypedDict14', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict14.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('TypedDict15', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict15.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('TypedDict16', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict16.py']);

    TestUtils.validateResults(analysisResults, 9);
});

test('TypedDict17', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict17.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('TypedDict18', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict18.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('TypedDict19', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict19.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('TypedDict20', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict20.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypedDict21', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict21.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('TypedDict22', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict22.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypedDict23', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict23.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('TypedDict24', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict24.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('TypedDictInline1', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.diagnosticRuleSet.enableExperimentalFeatures = true;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDictInline1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 8);
});
