/*
 * typeEvaluator7.test.ts
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
    pythonVersion3_13,
    pythonVersion3_8,
} from '../common/pythonVersion';
import { Uri } from '../common/uri/uri';
import * as TestUtils from './testUtils';

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

test('GenericType46', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType46.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType47', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType47.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol1.py']);

    TestUtils.validateResults(analysisResults, 9);
});

test('Protocol2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol3.py']);

    TestUtils.validateResults(analysisResults, 13);
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

    TestUtils.validateResults(analysisResults, 2);
});

test('Protocol48', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol48.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol49', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol49.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol50', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol50.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol51', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol51.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol52', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol52.py']);

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
    TestUtils.validateResults(analysisResults, 6);
});

test('ClassVar1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classVar1.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('ClassVar2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classVar2.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('ClassVar3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classVar3.py']);

    TestUtils.validateResults(analysisResults, 13);
});

test('ClassVar4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classVar4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('ClassVar5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classVar5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('ClassVar6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classVar6.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('ClassVar7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classVar7.py']);

    TestUtils.validateResults(analysisResults, 2);
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

    TestUtils.validateResults(analysisResults, 12);
});

test('TypeVar4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVar4.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('TypeVar5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVar5.py']);

    TestUtils.validateResults(analysisResults, 18);
});

test('TypeVar6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVar6.py']);

    TestUtils.validateResults(analysisResults, 20);
});

test('TypeVar7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVar7.py']);

    TestUtils.validateResults(analysisResults, 26);
});

test('TypeVar8', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_12;
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['typeVar8.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 4);

    configOptions.defaultPythonVersion = pythonVersion3_13;
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['typeVar8.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 2);
});

test('TypeVar9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVar9.py']);

    TestUtils.validateResults(analysisResults, 13);
});

test('TypeVar10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVar10.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeVar11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVar11.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Annotated1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_8;
    const analysisResults38 = TestUtils.typeAnalyzeSampleFiles(['annotated1.py'], configOptions);
    TestUtils.validateResults(analysisResults38, 34);

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults39 = TestUtils.typeAnalyzeSampleFiles(['annotated1.py'], configOptions);
    TestUtils.validateResults(analysisResults39, 3);
});

test('Annotated2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['annotated2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Circular1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['circular1.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Circular2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['circular2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TryExcept1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tryExcept1.py']);

    TestUtils.validateResults(analysisResults, 4);
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

    TestUtils.validateResults(analysisResults, 4);
});

test('TryExcept5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tryExcept5.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('TryExcept6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tryExcept6.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('TryExcept8', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tryExcept8.py'], configOptions);
    TestUtils.validateResults(analysisResults, 3);
});

test('TryExcept9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tryExcept9.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('TryExcept10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tryExcept10.py']);
    TestUtils.validateResults(analysisResults, 1);
});

test('TryExcept11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tryExcept11.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('exceptionGroup1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['exceptionGroup1.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 34);

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['exceptionGroup1.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 10);
});

test('Del1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['del1.py']);
    TestUtils.validateResults(analysisResults, 6);
});

test('Del2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['del2.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Any1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['any1.py']);

    TestUtils.validateResults(analysisResults, 8);
});

test('Type1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['type1.py']);

    TestUtils.validateResults(analysisResults, 8);
});
