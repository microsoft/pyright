import { AssertionError } from 'assert';
import { Diagnostic } from '../common/diagnostic';
import { Uri } from '../common/uri/uri';
import { FileAnalysisResult, ExpectedResults, validateResultsButBased } from './testUtils';
import { DiagnosticRule } from '../common/diagnosticRules';

const fakeUri = {} as Uri;
const fakeDiagnostic = (line: number, code?: DiagnosticRule) =>
    ({ getRule: () => code, range: { start: { line } } } as Diagnostic);

test('validateResults pass 😀', () => {
    const expectedResults: ExpectedResults = {
        errors: [{ line: 1 }, { line: 2 }],
    };
    const actualResults: FileAnalysisResult[] = [
        {
            errors: [fakeDiagnostic(1), fakeDiagnostic(2)],
            fileUri: fakeUri,
            warnings: [],
            infos: [],
            unusedCodes: [],
            deprecateds: [],
            unreachableCodes: [],
        },
    ];
    validateResultsButBased(actualResults, expectedResults);
});

test('validateResults wrong number of errors', () => {
    const expectedResults: ExpectedResults = {
        errors: [{ line: 1 }, { line: 2 }],
    };
    const actualResults: FileAnalysisResult[] = [
        {
            errors: [fakeDiagnostic(1)],
            fileUri: fakeUri,
            warnings: [],
            infos: [],
            unusedCodes: [],
            deprecateds: [],
            unreachableCodes: [],
        },
    ];
    expect(() => validateResultsButBased(actualResults, expectedResults)).toThrow(AssertionError);
});

test('validateResults wrong line number', () => {
    const expectedResults: ExpectedResults = {
        errors: [{ line: 2 }],
    };
    const actualResults: FileAnalysisResult[] = [
        {
            errors: [fakeDiagnostic(1)],
            fileUri: fakeUri,
            warnings: [],
            infos: [],
            unusedCodes: [],
            deprecateds: [],
            unreachableCodes: [],
        },
    ];
    expect(() => validateResultsButBased(actualResults, expectedResults)).toThrow(AssertionError);
});

test('validateResults wrong code', () => {
    const expectedResults: ExpectedResults = {
        errors: [{ line: 1, code: DiagnosticRule.reportUnboundVariable }],
    };
    const actualResults: FileAnalysisResult[] = [
        {
            errors: [fakeDiagnostic(1, DiagnosticRule.analyzeUnannotatedFunctions)],
            fileUri: fakeUri,
            warnings: [],
            infos: [],
            unusedCodes: [],
            deprecateds: [],
            unreachableCodes: [],
        },
    ];
    expect(() => validateResultsButBased(actualResults, expectedResults)).toThrow(AssertionError);
});
