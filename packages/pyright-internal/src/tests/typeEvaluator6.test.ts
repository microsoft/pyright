/*
 * typeEvaluator6.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Unit tests for pyright type evaluator. Tests are split
 * arbitrarily among multiple files so they can run in parallel.
 */

import { ConfigOptions } from '../common/configOptions';
import {
    pythonVersion3_10,
    pythonVersion3_11,
    pythonVersion3_12,
    pythonVersion3_8,
    pythonVersion3_9,
} from '../common/pythonVersion';
import { Uri } from '../common/uri/uri';
import * as TestUtils from './testUtils';

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
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.diagnosticRuleSet.reportOverlappingOverload = 'none';
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['overload5.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    configOptions.diagnosticRuleSet.reportOverlappingOverload = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['overload5.py'], configOptions);
    TestUtils.validateResults(analysisResults, 12);
});

test('Overload6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overload6.py']);
    TestUtils.validateResults(analysisResults, 2);
});

test('Overload7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overload7.py']);
    TestUtils.validateResults(analysisResults, 7);
});

test('Overload8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overload8.py']);
    TestUtils.validateResults(analysisResults, 4);
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
    TestUtils.validateResults(analysisResults, 2);
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
    TestUtils.validateResults(analysisResults, 8);
});

test('Overload16', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overload16.py']);
    TestUtils.validateResults(analysisResults, 2);
});

test('Overload17', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overload17.py']);
    TestUtils.validateResults(analysisResults, 3);
});

test('TypeGuard1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeGuard1.py']);

    TestUtils.validateResults(analysisResults, 8);
});

test('TypeGuard2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeGuard2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeGuard3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeGuard3.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('TypeIs1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeIs1.py']);
    TestUtils.validateResults(analysisResults, 2);
});

test('Never1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['never1.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('Never2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['never2.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('TypePromotions1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typePromotions1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Index1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['index1.py']);

    TestUtils.validateResults(analysisResults, 10);
});

test('ProtocolModule2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocolModule2.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('ProtocolModule4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocolModule4.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('VariadicTypeVar1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 18);
});

test('VariadicTypeVar2', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 15);
});

test('VariadicTypeVar3', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar3.py'], configOptions);
    TestUtils.validateResults(analysisResults, 5);
});

test('VariadicTypeVar4', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar4.py'], configOptions);
    TestUtils.validateResults(analysisResults, 4);
});

test('VariadicTypeVar5', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar5.py'], configOptions);
    TestUtils.validateResults(analysisResults, 9);
});

test('VariadicTypeVar6', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar6.py'], configOptions);
    TestUtils.validateResults(analysisResults, 10);
});

test('VariadicTypeVar7', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar7.py'], configOptions);
    TestUtils.validateResults(analysisResults, 6);
});

test('VariadicTypeVar8', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar8.py'], configOptions);
    TestUtils.validateResults(analysisResults, 5);
});

test('VariadicTypeVar9', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar9.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('VariadicTypeVar10', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar10.py'], configOptions);
    TestUtils.validateResults(analysisResults, 2);
});

test('VariadicTypeVar11', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar11.py'], configOptions);
    TestUtils.validateResults(analysisResults, 4);
});

test('VariadicTypeVar12', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar12.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('VariadicTypeVar13', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar13.py'], configOptions);
    TestUtils.validateResults(analysisResults, 1);
});

test('VariadicTypeVar14', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar14.py'], configOptions);
    TestUtils.validateResults(analysisResults, 6);
});

test('VariadicTypeVar15', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar15.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('VariadicTypeVar16', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar16.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('VariadicTypeVar17', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar17.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('VariadicTypeVar18', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar18.py'], configOptions);
    TestUtils.validateResults(analysisResults, 2);
});

test('VariadicTypeVar19', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar19.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('VariadicTypeVar20', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar20.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('VariadicTypeVar21', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar21.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('VariadicTypeVar22', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar22.py'], configOptions);
    TestUtils.validateResults(analysisResults, 3);
});

test('VariadicTypeVar23', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar23.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('VariadicTypeVar24', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar24.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('VariadicTypeVar25', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar25.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('VariadicTypeVar26', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar26.py'], configOptions);
    TestUtils.validateResults(analysisResults, 3);
});

test('VariadicTypeVar27', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar27.py'], configOptions);
    TestUtils.validateResults(analysisResults, 1);
});

test('VariadicTypeVar28', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar28.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('VariadicTypeVar29', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_12;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['variadicTypeVar29.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('Match1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['match1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 21);
});

test('Match2', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['match2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 2);
});

test('Match3', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['match3.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('MatchSequence1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['matchSequence1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 2);
});

test('MatchClass1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['matchClass1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 5);
});

test('MatchClass2', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['matchClass2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('MatchClass3', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['matchClass3.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('MatchClass4', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['matchClass4.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('MatchClass5', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['matchClass5.py'], configOptions);
    TestUtils.validateResults(analysisResults, 5);
});

test('MatchClass6', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['matchClass6.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('MatchValue1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['matchValue1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('MatchMapping1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['matchMapping1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 2);
});

test('MatchLiteral1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['matchLiteral1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('MatchLiteral2', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['matchLiteral2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('MatchExhaustion1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_10;
    configOptions.diagnosticRuleSet.reportMatchNotExhaustive = 'none';
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['matchExhaustion1.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 0);

    configOptions.diagnosticRuleSet.reportMatchNotExhaustive = 'error';
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['matchExhaustion1.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 4);
});

test('MatchUnnecessary1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['matchUnnecessary1.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 0);

    configOptions.diagnosticRuleSet.reportUnnecessaryComparison = 'error';
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['matchUnnecessary1.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 7);
});

test('List1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['list1.py']);
    TestUtils.validateResults(analysisResults, 3);
});

test('List2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['list2.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('List3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['list3.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('Comparison1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['comparison1.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 0);

    configOptions.diagnosticRuleSet.reportUnnecessaryComparison = 'error';
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['comparison1.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 7);
});

test('Comparison2', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['comparison2.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 0);

    configOptions.diagnosticRuleSet.reportUnnecessaryComparison = 'error';
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['comparison2.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 11);
});

test('EmptyContainers1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['emptyContainers1.py']);
    TestUtils.validateResults(analysisResults, 5);
});

test('InitSubclass1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['initsubclass1.py']);

    TestUtils.validateResults(analysisResults, 6);
});

test('InitSubclass2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['initsubclass2.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('None1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['none1.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('None2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['none2.py']);

    TestUtils.validateResults(analysisResults, 2);
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

    TestUtils.validateResults(analysisResults, 0, 1);
});

test('Constructor7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor7.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Constructor9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor9.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Constructor10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor10.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Constructor11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor11.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Constructor12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor12.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Constructor13', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor13.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Constructor14', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor14.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Constructor15', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor15.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Constructor16', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor16.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Constructor17', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor17.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Constructor18', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor18.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Constructor19', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor19.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Constructor20', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor20.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Constructor21', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor21.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Constructor22', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor22.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Constructor23', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor23.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Constructor24', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.diagnosticRuleSet.strictParameterNoneValue = false;
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor24.py'], configOptions);
    TestUtils.validateResults(analysisResults, 4);

    configOptions.diagnosticRuleSet.strictParameterNoneValue = true;
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor24.py'], configOptions);
    TestUtils.validateResults(analysisResults, 5);
});

test('Constructor25', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor25.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Constructor26', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor26.py']);

    TestUtils.validateResults(analysisResults, 8);
});

test('Constructor27', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor27.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Constructor28', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor28.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Constructor29', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor29.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('ConstructorCallable1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructorCallable1.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('ConstructorCallable2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructorCallable2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('InconsistentConstructor1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.diagnosticRuleSet.reportInconsistentConstructor = 'none';
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['inconsistentConstructor1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    // Enable it as an error.
    configOptions.diagnosticRuleSet.reportInconsistentConstructor = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['inconsistentConstructor1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 2);
});

test('ClassGetItem1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classGetItem1.py']);

    TestUtils.validateResults(analysisResults, 0, 1);
});

test('UnusedCallResult1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    // By default, this is disabled.
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['unusedCallResult1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    // Enable it as an error.
    configOptions.diagnosticRuleSet.reportUnusedCallResult = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['unusedCallResult1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 4);
});

test('UnusedCoroutine1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['unusedCoroutine1.py']);
    TestUtils.validateResults(analysisResults, 2);
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

test('FunctionAnnotation4', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['functionAnnotation4.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 0);

    configOptions.diagnosticRuleSet.reportTypeCommentUsage = 'error';
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['functionAnnotation4.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 3);
});

test('Subscript1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    // Analyze with Python 3.8 settings.
    configOptions.defaultPythonVersion = pythonVersion3_8;
    const analysisResults38 = TestUtils.typeAnalyzeSampleFiles(['subscript1.py'], configOptions);
    TestUtils.validateResults(analysisResults38, 18);

    // Analyze with Python 3.8 settings.
    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults39 = TestUtils.typeAnalyzeSampleFiles(['subscript1.py'], configOptions);
    TestUtils.validateResults(analysisResults39, 0);
});

test('Subscript2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['subscript2.py']);
    TestUtils.validateResults(analysisResults, 8);
});

test('Subscript3', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    // Analyze with Python 3.9 settings.
    configOptions.defaultPythonVersion = pythonVersion3_9;
    const analysisResults39 = TestUtils.typeAnalyzeSampleFiles(['subscript3.py'], configOptions);
    TestUtils.validateResults(analysisResults39, 37);

    // Analyze with Python 3.10 settings.
    // These are disabled because PEP 637 was rejected.
    // configOptions.defaultPythonVersion = pythonVersion3_10;
    // const analysisResults310 = TestUtils.typeAnalyzeSampleFiles(['subscript3.py'], configOptions);
    // TestUtils.validateResults(analysisResults310, 11);
});

test('Subscript4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['subscript4.py']);
    TestUtils.validateResults(analysisResults, 0);
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
    const configOptions = new ConfigOptions(Uri.empty());

    // Analyze with Python 3.8 settings.
    configOptions.defaultPythonVersion = pythonVersion3_8;
    const analysisResults38 = TestUtils.typeAnalyzeSampleFiles(['decorator3.py'], configOptions);
    TestUtils.validateResults(analysisResults38, 3);

    // Analyze with Python 3.8 settings.
    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults39 = TestUtils.typeAnalyzeSampleFiles(['decorator3.py'], configOptions);
    TestUtils.validateResults(analysisResults39, 0);
});

test('Decorator4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['decorator4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Decorator5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['decorator5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Decorator6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['decorator6.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Decorator7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['decorator7.py']);

    TestUtils.validateResults(analysisResults, 0);
});
