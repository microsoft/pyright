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

test('CallbackPrototype1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['callbackPrototype1.py']);

    TestUtils.validateResults(analysisResults, 6);
});

test('Assignment1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignment1.py']);

    TestUtils.validateResults(analysisResults, 7);
});

test('Assignment2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['assignment2.py']);

    TestUtils.validateResults(analysisResults, 2);
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

test('AugmentedAssignment1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['augmentedAssignment1.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('Super1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['super1.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('Super2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['super2.py']);

    TestUtils.validateResults(analysisResults, 0, 0, 3);
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
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['isinstance3.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('isInstance4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['isinstance4.py']);

    TestUtils.validateResults(analysisResults, 0);
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

    TestUtils.validateResults(analysisResults, 0, 0, 3);
});

test('NameBindings1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['nameBindings1.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('NameBindings2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['nameBindings2.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('NameBindings3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['nameBindings3.py']);

    TestUtils.validateResults(analysisResults, 3);
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

    TestUtils.validateResults(analysisResults, 1);
});

test('GenericTypes10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes10.py']);

    TestUtils.validateResults(analysisResults, 1);
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

    TestUtils.validateResults(analysisResults, 1);
});

test('GenericTypes20', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes20.py']);

    TestUtils.validateResults(analysisResults, 0);
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
    TestUtils.validateResults(analysisResults, 0);

    // Turn on errors.
    configOptions.diagnosticRuleSet.reportMissingTypeArgument = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes33.py'], configOptions);
    TestUtils.validateResults(analysisResults, 5);
});

test('GenericTypes34', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericTypes34.py']);

    TestUtils.validateResults(analysisResults, 0);
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

    TestUtils.validateResults(analysisResults, 3);
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

    TestUtils.validateResults(analysisResults, 1);
});

test('Protocol1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol1.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Protocol2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol3.py']);

    TestUtils.validateResults(analysisResults, 1);
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

    TestUtils.validateResults(analysisResults, 0);
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
    TestUtils.validateResults(analysisResults, 4);
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
    TestUtils.validateResults(analysisResults, 1);
});

test('Overload5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overload5.py']);
    TestUtils.validateResults(analysisResults, 5);
});

test('Overload6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overload6.py']);
    TestUtils.validateResults(analysisResults, 1);
});

test('Final1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['final1.py']);
    TestUtils.validateResults(analysisResults, 1);
});

test('Final2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['final2.py']);
    TestUtils.validateResults(analysisResults, 2);
});

test('Final3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['final3.py']);
    TestUtils.validateResults(analysisResults, 15);
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
    TestUtils.validateResults(analysisResults39, 6);

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const analysisResults310 = TestUtils.typeAnalyzeSampleFiles(['paramSpec2.py'], configOptions);
    TestUtils.validateResults(analysisResults310, 0);
});

test('ParamSpec3', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec3.py'], configOptions);
    TestUtils.validateResults(results, 1);
});

test('ParamSpec4', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec4.py'], configOptions);
    TestUtils.validateResults(results, 5, 2);
});

test('ParamSpec5', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_10;
    const results = TestUtils.typeAnalyzeSampleFiles(['paramSpec5.py'], configOptions);
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

    TestUtils.validateResults(analysisResults, 6);
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

    TestUtils.validateResults(analysisResults, 22, 2);
});

test('TypeVar8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVar8.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('TypeVar9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVar9.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('Annotated1', () => {
    const configOptions = new ConfigOptions('.');

    configOptions.defaultPythonVersion = PythonVersion.V3_8;
    const analysisResults38 = TestUtils.typeAnalyzeSampleFiles(['annotated1.py'], configOptions);
    TestUtils.validateResults(analysisResults38, 1);

    configOptions.defaultPythonVersion = PythonVersion.V3_9;
    const analysisResults39 = TestUtils.typeAnalyzeSampleFiles(['annotated1.py'], configOptions);
    TestUtils.validateResults(analysisResults39, 0);
});

test('Circular1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['circular1.py']);

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

test('Decorator1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['decorator1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Decorator2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['decorator2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Decorator3', () => {
    const configOptions = new ConfigOptions('.');

    // Analyze with Python 3.8 settings.
    configOptions.defaultPythonVersion = PythonVersion.V3_8;
    const analysisResults38 = TestUtils.typeAnalyzeSampleFiles(['decorator3.py'], configOptions);
    TestUtils.validateResults(analysisResults38, 3);

    // Analyze with Python 3.8 settings.
    configOptions.defaultPythonVersion = PythonVersion.V3_9;
    const analysisResults39 = TestUtils.typeAnalyzeSampleFiles(['decorator3.py'], configOptions);
    TestUtils.validateResults(analysisResults39, 0);
});

test('FunctionAnnotation1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['functionAnnotation1.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('FunctionAnnotation2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['functionAnnotation2.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('FunctionAnnotation3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['functionAnnotation3.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Subscript1', () => {
    const configOptions = new ConfigOptions('.');

    // Analyze with Python 3.8 settings.
    configOptions.defaultPythonVersion = PythonVersion.V3_8;
    const analysisResults38 = TestUtils.typeAnalyzeSampleFiles(['subscript1.py'], configOptions);
    TestUtils.validateResults(analysisResults38, 9);

    // Analyze with Python 3.8 settings.
    configOptions.defaultPythonVersion = PythonVersion.V3_9;
    const analysisResults39 = TestUtils.typeAnalyzeSampleFiles(['subscript1.py'], configOptions);
    TestUtils.validateResults(analysisResults39, 0);
});

test('InitSubclass1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['initsubclass1.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('None1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['none1.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Constructor1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Constructor2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Constructor3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Constructor4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor4.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Constructor5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Constructor6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor6.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('ClassGetItem1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classGetItem1.py']);

    TestUtils.validateResults(analysisResults, 0, 1);
});

test('UnusedCallResult1', () => {
    const configOptions = new ConfigOptions('.');

    // By default, this is disabled.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['unusedCallResult1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    // Enable it as an error.
    configOptions.diagnosticRuleSet.reportUnusedCallResult = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['unusedCallResult1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 3);
});
