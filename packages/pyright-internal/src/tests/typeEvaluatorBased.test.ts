import { BasedConfigOptions, ConfigOptions } from '../common/configOptions';
import { DiagnosticRule } from '../common/diagnosticRules';
import { Uri } from '../common/uri/uri';
import { typeAnalyzeSampleFiles, validateResultsButBased } from './testUtils';

test('reportUnreachable', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.diagnosticRuleSet.reportUnreachable = 'error';
    const analysisResults = typeAnalyzeSampleFiles(['unreachable1.py'], configOptions);
    validateResultsButBased(analysisResults, {
        errors: [78, 89, 106, 110].map((line) => ({ code: DiagnosticRule.reportUnreachable, line })),
        infos: [{ line: 95 }, { line: 98 }],
        unusedCodes: [{ line: 102 }],
    });
});

test('reportUnreachable TYPE_CHECKING', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.diagnosticRuleSet.reportUnreachable = 'error';
    const analysisResults = typeAnalyzeSampleFiles(['unreachable2.py'], configOptions);

    validateResultsButBased(analysisResults, {
        unreachableCodes: [{ line: 3 }, { line: 8 }],
    });
});

test('default typeCheckingMode=all', () => {
    const configOptions = new BasedConfigOptions(Uri.empty());
    const analysisResults = typeAnalyzeSampleFiles(['unreachable1.py'], configOptions);
    validateResultsButBased(analysisResults, {
        errors: [
            ...[78, 89, 106, 110].map((line) => ({ code: DiagnosticRule.reportUnreachable, line })),
            { line: 16, code: DiagnosticRule.reportUninitializedInstanceVariable },
            { line: 19, code: DiagnosticRule.reportUnknownParameterType },
            { line: 33, code: DiagnosticRule.reportUnknownParameterType },
            { line: 94, code: DiagnosticRule.reportUnnecessaryComparison },
            { line: 102, code: DiagnosticRule.reportUnusedVariable },
        ],
        infos: [{ line: 95 }, { line: 98 }],
        unusedCodes: [{ line: 102 }],
    });
});
