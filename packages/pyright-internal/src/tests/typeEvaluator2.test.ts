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

    TestUtils.validateResults(analysisResults, 10);
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

test('CallbackProtocol10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['callbackProtocol10.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('CallbackProtocol11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['callbackProtocol11.py']);

    TestUtils.validateResults(analysisResults, 0);
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
    TestUtils.validateResults(analysisResults2, 3);
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

    TestUtils.validateResults(analysisResults, 0);
});

test('Super1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['super1.py']);

    TestUtils.validateResults(analysisResults, 6);
});

test('Super2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['super2.py']);

    TestUtils.validateResults(analysisResults, 0);
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

test('Super13', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['super13.py']);

    TestUtils.validateResults(analysisResults, 0);
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

    TestUtils.validateResults(analysisResults, 6);
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
    TestUtils.validateResults(analysisResults1, 7);

    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['isinstance3.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 7);
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

test('ConstrainedTypeVar20', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constrainedTypeVar20.py']);

    TestUtils.validateResults(analysisResults, 0);
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

    TestUtils.validateResults(analysisResults, 1);
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

test('Solver35', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver35.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('Solver36', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver36.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Solver37', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver37.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Solver38', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver38.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Solver39', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver39.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Solver40', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver40.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Solver41', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver41.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Solver42', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver42.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Solver43', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver43.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Solver44', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solver44.py']);

    TestUtils.validateResults(analysisResults, 0);
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

    TestUtils.validateResults(analysisResults, 1);
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

test('SolverHigherOrder12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solverHigherOrder12.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('SolverHigherOrder13', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solverHigherOrder13.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('SolverHigherOrder14', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['solverHigherOrder14.py']);

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
