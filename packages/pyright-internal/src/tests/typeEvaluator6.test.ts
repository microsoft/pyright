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
    TestUtils.validateResults(analysisResults, 1);
});

test('Overload2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overload2.py']);
    TestUtils.validateResults(analysisResults, 3);
});

test('Overload3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overload3.py']);
    TestUtils.validateResults(analysisResults, 3);
});

test('Overload4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overload4.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('Overload5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overload5.py']);
    TestUtils.validateResults(analysisResults, 6);
});

test('OverloadCall1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overloadCall1.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('OverloadCall2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overloadCall2.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('OverloadCall3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overloadCall3.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('OverloadCall4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overloadCall4.py']);
    TestUtils.validateResults(analysisResults, 4);
});

test('OverloadCall5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overloadCall5.py']);
    TestUtils.validateResults(analysisResults, 1);
});

test('OverloadCall6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overloadCall6.py']);
    TestUtils.validateResults(analysisResults, 2);
});

test('OverloadCall7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overloadCall7.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('OverloadCall8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overloadCall8.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('OverloadCall9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overloadCall9.py']);
    TestUtils.validateResults(analysisResults, 8);
});

test('OverloadCall10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overloadCall10.py']);
    TestUtils.validateResults(analysisResults, 2);
});

test('OverloadCall11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overloadCall11.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('OverloadOverride1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overloadOverride1.py']);
    TestUtils.validateResults(analysisResults, 1);
});

test('OverloadImpl1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overloadImpl1.py']);
    TestUtils.validateResults(analysisResults, 6);
});

test('OverloadImpl2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['overloadImpl2.py']);
    TestUtils.validateResults(analysisResults, 2);
});

test('OverloadOverlap1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.diagnosticRuleSet.reportOverlappingOverload = 'none';
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['overloadOverlap1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    configOptions.diagnosticRuleSet.reportOverlappingOverload = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['overloadOverlap1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 16);
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

test('TypeIs2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeIs2.py']);
    TestUtils.validateResults(analysisResults, 9);
});

test('TypeIs3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeIs3.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('TypeIs4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeIs4.py']);
    TestUtils.validateResults(analysisResults, 0);
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
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.diagnosticRuleSet.disableBytesTypePromotions = false;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typePromotions1.py'], configOptions);

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

test('TypeVarTuple1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarTuple1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 18);
});

test('TypeVarTuple2', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarTuple2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 16);
});

test('TypeVarTuple3', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarTuple3.py'], configOptions);
    TestUtils.validateResults(analysisResults, 6);
});

test('TypeVarTuple4', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarTuple4.py'], configOptions);
    TestUtils.validateResults(analysisResults, 4);
});

test('TypeVarTuple5', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarTuple5.py'], configOptions);
    TestUtils.validateResults(analysisResults, 9);
});

test('TypeVarTuple6', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarTuple6.py'], configOptions);
    TestUtils.validateResults(analysisResults, 10);
});

test('TypeVarTuple7', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarTuple7.py'], configOptions);
    TestUtils.validateResults(analysisResults, 6);
});

test('TypeVarTuple8', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarTuple8.py'], configOptions);
    TestUtils.validateResults(analysisResults, 3);
});

test('TypeVarTuple9', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarTuple9.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('TypeVarTuple10', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarTuple10.py'], configOptions);
    TestUtils.validateResults(analysisResults, 2);
});

test('TypeVarTuple11', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarTuple11.py'], configOptions);
    TestUtils.validateResults(analysisResults, 4);
});

test('TypeVarTuple12', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarTuple12.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('TypeVarTuple13', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarTuple13.py'], configOptions);
    TestUtils.validateResults(analysisResults, 1);
});

test('TypeVarTuple14', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarTuple14.py'], configOptions);
    TestUtils.validateResults(analysisResults, 14);
});

test('TypeVarTuple15', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarTuple15.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('TypeVarTuple16', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarTuple16.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('TypeVarTuple17', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarTuple17.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('TypeVarTuple18', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarTuple18.py'], configOptions);
    TestUtils.validateResults(analysisResults, 2);
});

test('TypeVarTuple19', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarTuple19.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('TypeVarTuple20', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarTuple20.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('TypeVarTuple21', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarTuple21.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('TypeVarTuple22', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarTuple22.py'], configOptions);
    TestUtils.validateResults(analysisResults, 3);
});

test('TypeVarTuple23', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarTuple23.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('TypeVarTuple24', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarTuple24.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('TypeVarTuple25', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarTuple25.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('TypeVarTuple26', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarTuple26.py'], configOptions);
    TestUtils.validateResults(analysisResults, 3);
});

test('TypeVarTuple27', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarTuple27.py'], configOptions);
    TestUtils.validateResults(analysisResults, 1);
});

test('TypeVarTuple28', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarTuple28.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('TypeVarTuple29', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_12;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarTuple29.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('TypeVarTuple30', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_12;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVarTuple30.py'], configOptions);
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

test('MatchSequence2', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_12;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['matchSequence2.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);
});

test('MatchClass1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['matchClass1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 6);
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

test('MatchClass7', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['matchClass7.py'], configOptions);
    TestUtils.validateResults(analysisResults, 1);
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
    TestUtils.validateResults(analysisResults2, 17);
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

test('InitSubclass3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['initsubclass3.py']);

    TestUtils.validateResults(analysisResults, 3);
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

test('Constructor30', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor30.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Constructor31', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor31.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Constructor32', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor32.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Constructor33', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructor33.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('ConstructorCallable1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructorCallable1.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('ConstructorCallable2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['constructorCallable2.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('InconsistentConstructor1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.diagnosticRuleSet.reportInconsistentConstructor = 'none';
    let analysisResults = TestUtils.typeAnalyzeSampleFiles(['inconsistentConstructor1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 0);

    // Enable it as an error.
    configOptions.diagnosticRuleSet.reportInconsistentConstructor = 'error';
    analysisResults = TestUtils.typeAnalyzeSampleFiles(['inconsistentConstructor1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 3);
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
    TestUtils.validateResults(analysisResults38, 14);

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
