import { ConfigOptions } from '../common/configOptions';
import { DiagnosticRule } from '../common/diagnosticRules';
import { Uri } from '../common/uri/uri';
import { LocMessage } from '../localization/localize';
import { typeAnalyzeSampleFiles, validateResultsButBased } from './testUtils';

test('reportAny', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.diagnosticRuleSet.reportAny = 'error';
    const analysisResults = typeAnalyzeSampleFiles(['reportAny.py'], configOptions);

    validateResultsButBased(analysisResults, {
        errors: [
            { line: 0, code: DiagnosticRule.reportAny, message: LocMessage.typeAny().format({ name: 'Any' }) },
            { line: 3, code: DiagnosticRule.reportAny, message: LocMessage.returnTypeAny() },
            {
                line: 3,
                code: DiagnosticRule.reportAny,
                message: LocMessage.paramTypeAny().format({ paramName: 'bar' }),
            },
            { line: 4, code: DiagnosticRule.reportAny },
            { line: 5, code: DiagnosticRule.reportAny, message: LocMessage.returnTypeAny() },
            { line: 7, code: DiagnosticRule.reportAny, message: LocMessage.typeAny().format({ name: 'bar' }) },
            {
                line: 9,
                code: DiagnosticRule.reportAny,
                message: LocMessage.classDecoratorTypeAny(),
            },
            {
                line: 10,
                code: DiagnosticRule.reportAny,
                message: LocMessage.baseClassAny(),
            },
            {
                line: 12,
                code: DiagnosticRule.reportAny,
                message: LocMessage.functionDecoratorTypeAny(),
            },
            {
                line: 15,
                code: DiagnosticRule.reportAny,
                message: LocMessage.lambdaReturnTypeAny(),
            },
            {
                line: 18,
                code: DiagnosticRule.reportAny,
                message: LocMessage.wildcardPatternTypeAny(),
            },
        ],
    });
});
