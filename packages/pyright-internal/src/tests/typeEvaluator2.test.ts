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
import { PythonVersion } from '../common/pythonVersion';
import * as TestUtils from './testUtils';

test('CallbackProtocol1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['callbackProtocol1.py']);

    TestUtils.validateResults(analysisResults, 8);
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

    TestUtils.validateResults(analysisResults, 3);
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

    TestUtils.validateResults(analysisResults, 4);
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

test('MissingSuper1', () => {
    const configOptions = new ConfigOptions('.');

    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['missingSuper1.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 0);

    configOptions.diagnosticRuleSet.reportMissingSuperCall = 'error';
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['missingSuper1.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 4);
});

test('NewType1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['newType1.py']);

    TestUtils.validateResults(analysisResults, 1);
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

    TestUtils.validateResults(analysisResults, 3);
});

test('isInstance1', () => {
    // This test requires Python 3.10 because it uses PEP 604 notation for unions.
    const configOptions = new ConfigOptions('.');
    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['isinstance1.py'], configOptions);

    TestUtils.validateResults(analysisResults, 0);
});

test('isInstance2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['isinstance2.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('isInstance3', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_9;
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['isinstance3.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 4);

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['isinstance3.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 1);
});

test('isInstance4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['isinstance4.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('isInstance5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['isinstance5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('isInstance6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['isinstance6.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('isInstance7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['isinstance7.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('isInstance9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['isinstance9.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('isInstance10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['isinstance10.py']);

    TestUtils.validateResults(analysisResults, 0);
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

test('Assert1', () => {
    const configOptions = new ConfigOptions('.');

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

test('NameBindings1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['nameBindings1.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('NameBindings2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['nameBindings2.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('NameBindings3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['nameBindings3.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('NameBindings4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['nameBindings4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes1.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('GenericTypes2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes2.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('GenericTypes3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes4.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('GenericTypes5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes5.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('GenericTypes6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes6.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('GenericTypes7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes7.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes8.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes9.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('GenericTypes10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes10.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('GenericTypes11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes11.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes12.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('GenericTypes13', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes13.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes14', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes14.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('GenericTypes15', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes15.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes16', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes16.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes17', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes17.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('GenericTypes18', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes18.py']);

    TestUtils.validateResults(analysisResults, 6);
});

test('GenericTypes19', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes19.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes20', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes20.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('GenericTypes21', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes21.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('GenericTypes22', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes22.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes23', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes23.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('GenericTypes24', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes24.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('GenericTypes25', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes25.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes26', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes26.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes27', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes27.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes28', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes28.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('GenericTypes29', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes29.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('GenericTypes30', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes30.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('GenericTypes31', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes31.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes32', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes32.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes33', () => {
    const configOptions = new ConfigOptions('.');

    // By default, reportMissingTypeArgument is disabled.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes33.py']);
    TestUtils.validateResults(analysisResults, 1);

    // Turn on errors.
    configOptions.diagnosticRuleSet.reportMissingTypeArgument = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes33.py'], configOptions);
    TestUtils.validateResults(analysisResults, 5);
});

test('GenericTypes34', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes34.py']);

    TestUtils.validateResults(analysisResults, 1);
});

// This test is intentionally commented out for now. The functionality
// that it tests relied on the looser handling of TypeVars.

// test('GenericTypes35', () => {
//     const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes35.py']);

//     TestUtils.validateResults(analysisResults, 1);
// });

test('GenericTypes36', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes36.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes37', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes37.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('GenericTypes38', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes38.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes39', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes39.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('GenericTypes40', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes40.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes41', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes41.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes42', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes42.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('GenericTypes43', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes43.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('GenericTypes44', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes44.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes45', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes45.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('GenericTypes46', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes46.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('GenericTypes47', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes47.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes48', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes48.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes49', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes49.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes50', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes50.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes51', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes51.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes52', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes52.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes53', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes53.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes54', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes54.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes55', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes55.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes56', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes56.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes57', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes57.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes58', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes58.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes59', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes59.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('GenericTypes60', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes60.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes61', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes61.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes62', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes62.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes63', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes63.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('GenericTypes64', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes64.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes65', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes65.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes66', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes66.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('GenericTypes67', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes67.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('GenericTypes68', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes68.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes69', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes69.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes70', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes70.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes71', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.diagnosticRuleSet.strictParameterNoneValue = false;
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes71.py'], configOptions);
    TestUtils.validateResults(analysisResults, 4);

    configOptions.diagnosticRuleSet.strictParameterNoneValue = true;
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes71.py'], configOptions);
    TestUtils.validateResults(analysisResults, 5);
});

test('GenericTypes72', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes72.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes73', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes73.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes74', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes74.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes75', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes75.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('GenericTypes76', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes76.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('GenericTypes77', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes77.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('GenericTypes78', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes78.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('GenericTypes79', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes79.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes80', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes80.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes81', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes81.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericTypes82', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes82.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol1.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Protocol2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol3.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Protocol4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol4.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Protocol5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol6.py']);

    TestUtils.validateResults(analysisResults, 2);
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
    const configOptions = new ConfigOptions('.');
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
    const configOptions = new ConfigOptions('.');
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

    TestUtils.validateResults(analysisResults, 2);
});

test('Protocol25', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol25.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Protocol26', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol26.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol27', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol27.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('TypedDict1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict1.py']);

    TestUtils.validateResults(analysisResults, 6);
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

    TestUtils.validateResults(analysisResults, 3);
});

test('TypedDict6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict6.py']);

    TestUtils.validateResults(analysisResults, 12);
});

test('TypedDict7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict7.py']);

    TestUtils.validateResults(analysisResults, 2);
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

    TestUtils.validateResults(analysisResults, 3);
});

test('TypedDict13', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict13.py']);

    TestUtils.validateResults(analysisResults, 1);
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
