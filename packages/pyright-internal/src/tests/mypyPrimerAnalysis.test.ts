/*
 * mypyPrimerAnalysis.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { isMap, isSeq, parseDocument } from 'yaml';

import {
    getStagedMode,
    loadSource,
    parseDiff,
    prepareAnalysis,
    publishAnalysis,
    renderReport,
    summarizeDiffs,
} from '../../../../build/ci/mypyPrimerAnalysis';

const repository = 'microsoft/pyright';
const headSha = 'a'.repeat(40);
const sample = [
    'example (https://github.com/example/project)',
    '- .../projects/example/test.py',
    '-   .../projects/example/test.py:1:1 - error: Old message',
    '-     Details (reportArgumentType)',
    '+   .../projects/example/test.py:1:1 - error: New message',
    '+     Details (reportArgumentType)',
].join('\n');

const expectedProject = {
    name: 'example',
    url: 'https://github.com/example/project',
    shard: 0,
    added: [
        {
            severity: 'error',
            rule: 'unspecified',
            text: '.../projects/example/test.py:1:1 - error: New message',
        },
    ],
    removed: [
        {
            severity: 'error',
            rule: 'unspecified',
            text: '.../projects/example/test.py:1:1 - error: Old message',
        },
    ],
    detailsAdded: [{ text: '     Details (reportArgumentType)', rule: 'reportArgumentType' }],
    detailsRemoved: [{ text: '     Details (reportArgumentType)', rule: 'reportArgumentType' }],
};

// Reduced forms of the headerless pip and xarray changes in PR #11601's primer artifacts.
const detailOnlySample = [
    'example (https://github.com/example/project)',
    '-   \u00a0\u00a0Return type mismatch: override returns "Match[str] | None"',
    '+   \u00a0\u00a0Return type mismatch: override returns "Unknown"',
    '-     Operator "+" not supported when expected type is "NDArray[Any]" (reportOperatorIssue)',
    '+     Operator "+" not supported when expected type is "ndarray[_AnyShape, dtype[Any]]" (reportOperatorIssue)',
].join('\n');
const expectedDetailOnlyProject = {
    ...expectedProject,
    added: [],
    removed: [],
    detailsAdded: [
        { text: '   \u00a0\u00a0Return type mismatch: override returns "Unknown"', rule: 'unspecified' },
        {
            text: '     Operator "+" not supported when expected type is "ndarray[_AnyShape, dtype[Any]]" (reportOperatorIssue)',
            rule: 'reportOperatorIssue',
        },
    ],
    detailsRemoved: [
        { text: '   \u00a0\u00a0Return type mismatch: override returns "Match[str] | None"', rule: 'unspecified' },
        {
            text: '     Operator "+" not supported when expected type is "NDArray[Any]" (reportOperatorIssue)',
            rule: 'reportOperatorIssue',
        },
    ],
};
const expectedDetailOnlySummary = {
    projects: [
        {
            name: 'example',
            url: 'https://github.com/example/project',
            shard: 0,
            added: 0,
            removed: 0,
            detailLinesAdded: 2,
            detailLinesRemoved: 2,
        },
    ],
    groups: { example: {} },
    detailGroups: {
        example: {
            unspecified: {
                added: 1,
                removed: 1,
                examplesAdded: ['   \u00a0\u00a0Return type mismatch: override returns "Unknown"'],
                examplesRemoved: ['   \u00a0\u00a0Return type mismatch: override returns "Match[str] | None"'],
            },
            reportOperatorIssue: {
                added: 1,
                removed: 1,
                examplesAdded: [
                    '     Operator "+" not supported when expected type is "ndarray[_AnyShape, dtype[Any]]" (reportOperatorIssue)',
                ],
                examplesRemoved: [
                    '     Operator "+" not supported when expected type is "NDArray[Any]" (reportOperatorIssue)',
                ],
            },
        },
    },
};

const expectedReportHeading = [
    `<!-- pyright-primer-analysis:${headSha}:42:1 -->`,
    '## mypy_primer analysis',
    '',
    'Advisory AI analysis of [primer run 42, attempt 1](https://github.com/microsoft/pyright/actions/runs/42)',
    `for commit \`${headSha}\`. This is not an approval or proof of correctness.`,
    '',
    'Added/removed counts are diagnostic headers; message rewrites can appear on both sides.',
    'Detail lines are counted separately, without assuming a location or association with nearby headers.',
    '',
    '| Project | Added | Removed | Detail lines + / - | Assessment | Confidence | Explanation |',
    '| --- | ---: | ---: | ---: | --- | --- | --- |',
];
const expectedReportRow =
    '| example | 1 | 1 | 1 / 1 | Needs human review | low | The argument error changed its wording. |';
const expectedReportDetails = [
    '### example',
    '',
    'The error remains at the same location. Its cause has not been established.',
    '',
    '**Unresolved / coverage limits:** Exact dependency revision unavailable.',
    '',
    '',
];
const expectedReportFooter = [
    '**Full evidence and limitations:** download `mypy-primer-analysis-report` from ' +
        '[this analysis run](https://github.com/microsoft/pyright/actions/runs/100).',
    'The original raw primer comment is unchanged. Treat uncertainty and possible regressions as requests for human review.',
];
const expectedReport = {
    body: [
        ...expectedReportHeading,
        expectedReportRow,
        '',
        '<details>',
        '<summary>Evidence and limitations by project</summary>',
        '',
        ...expectedReportDetails,
        '</details>',
        '',
        ...expectedReportFooter,
    ].join('\n'),
    fullReport: [...expectedReportHeading, expectedReportRow, '', ...expectedReportDetails].join('\n'),
};

function fixture(contents = sample, headRepository = repository) {
    const source = {
        runId: 42,
        runAttempt: 1,
        headSha,
        headRepository,
        headBranch: 'feature',
        pullRequests: headRepository === repository ? [7] : [],
    };
    const manifest = { repository, source, prNumber: 7, ...summarizeDiffs(parseDiff(contents, 0)) };
    const pr = {
        number: 7,
        state: 'open',
        base: { repo: { full_name: repository } },
        head: { sha: headSha, ref: 'feature', repo: { full_name: headRepository } },
    };
    const run = {
        id: 42,
        run_attempt: 1,
        event: 'pull_request',
        path: '.github/workflows/mypy_primer_pr.yaml',
        conclusion: 'success',
        repository: { full_name: repository },
        head_sha: headSha,
        head_repository: { full_name: headRepository },
        head_branch: 'feature',
        pull_requests: source.pullRequests.map((number) => ({ number })),
        run_started_at: '2026-09-10T00:00:00Z',
    };
    const artifacts = [
        'mypy_primer_diffs_pr_number',
        ...Array.from({ length: 8 }, (_, shard) => `mypy_primer_diffs_${shard}`),
    ].map((name) => ({ name, expired: false, size_in_bytes: 100, created_at: '2026-09-10T00:01:00Z' }));
    const comments: unknown[] = [];
    const associated: unknown[] = [pr];
    const request = jest.fn(
        async (route: string, parameters: Record<string, string | number>): Promise<{ data: unknown }> => {
            if (route === 'GET /repos/{owner}/{repo}/actions/runs/{run_id}') {
                return { data: run };
            }
            if (route.endsWith('/artifacts')) {
                return { data: { artifacts } };
            }
            if (route === 'GET /repos/{owner}/{repo}/pulls/{pull_number}') {
                return { data: pr };
            }
            if (route === 'GET /repos/{owner}/{repo}/commits/{commit_sha}/pulls') {
                return { data: [] };
            }
            if (route === 'GET /repos/{owner}/{repo}/pulls') {
                return { data: associated };
            }
            if (route === 'GET /repos/{owner}/{repo}/issues/{issue_number}/comments') {
                return { data: comments };
            }
            if (route.startsWith('POST ') || route.startsWith('PATCH ')) {
                return { data: { id: 123 } };
            }
            throw new Error(`Unexpected route: ${route}`);
        }
    );
    const report = {
        projects: [
            {
                name: 'example',
                assessment: 'needs-review',
                confidence: 'low',
                summary: 'The argument error changed its wording.',
                explanation: 'The error remains at the same location. Its cause has not been established.',
                unresolved: 'Exact dependency revision unavailable.',
                evidence: [],
            },
        ],
    };
    const output = () => ({ items: [{ type: 'publish_primer_analysis', report: JSON.stringify(report) }] });
    return { source, manifest, pr, run, artifacts, comments, associated, request, report, output };
}

describe('mypy_primer analysis', () => {
    let directory: string;

    beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), 'pyright-primer-analysis-'));
    });

    afterEach(() => {
        rmSync(directory, { recursive: true, force: true });
    });

    function writeShards(contents = sample) {
        for (let shard = 0; shard < 8; shard++) {
            const folder = join(directory, `mypy_primer_diffs_${shard}`);
            mkdirSync(folder);
            writeFileSync(join(folder, `diff_${shard}.txt`), shard === 0 ? contents : '');
        }
        mkdirSync(join(directory, 'mypy_primer_diffs_pr_number'));
        writeFileSync(join(directory, 'mypy_primer_diffs_pr_number', 'pr_number.txt'), '7\n');
    }

    test('counts diagnostic records, not file headings or continuation lines', () => {
        expect(parseDiff(sample.replace(/\n/g, '\r\n'), 3)).toStrictEqual([{ ...expectedProject, shard: 3 }]);
    });

    test('preserves headerless details and groups only explicitly present rules', () => {
        const projects = parseDiff(detailOnlySample, 0);
        expect(projects).toStrictEqual([expectedDetailOnlyProject]);
        expect(summarizeDiffs(projects)).toStrictEqual(expectedDetailOnlySummary);
    });

    test.each(['+', '-'])('accepts one-sided %s detail changes without inventing diagnostics', (sign) => {
        const contents = [
            'example (https://github.com/example/project)',
            `${sign}     Changed detail (reportArgumentType)`,
        ].join('\n');
        const detail = { text: '     Changed detail (reportArgumentType)', rule: 'reportArgumentType' };
        expect(parseDiff(contents, 0)).toStrictEqual([
            {
                ...expectedProject,
                added: [],
                removed: [],
                detailsAdded: sign === '+' ? [detail] : [],
                detailsRemoved: sign === '-' ? [detail] : [],
            },
        ]);
    });

    test('does not attach detail changes to nearby headers or leak them across projects', () => {
        const contents = [
            sample.replace(
                '- .../projects/example/test.py',
                '-     Earlier detail (reportGeneralTypeIssues)\n- .../projects/example/test.py'
            ),
            '+ .../projects/example/other.py',
            '+     other.py:3:4 - error: Nested description (reportOperatorIssue)',
            'second (https://github.com/example/second)',
            '-     Unlocated detail',
        ].join('\n');
        expect(parseDiff(contents, 0)).toStrictEqual([
            {
                ...expectedProject,
                detailsAdded: [
                    ...expectedProject.detailsAdded,
                    {
                        text: '     other.py:3:4 - error: Nested description (reportOperatorIssue)',
                        rule: 'reportOperatorIssue',
                    },
                ],
                detailsRemoved: [
                    { text: '     Earlier detail (reportGeneralTypeIssues)', rule: 'reportGeneralTypeIssues' },
                    ...expectedProject.detailsRemoved,
                ],
            },
            {
                name: 'second',
                url: 'https://github.com/example/second',
                shard: 0,
                added: [],
                removed: [],
                detailsAdded: [],
                detailsRemoved: [{ text: '     Unlocated detail', rule: 'unspecified' }],
            },
        ]);
    });

    test('keeps the complete project inventory before bounded diagnostic examples', () => {
        const diagnostics = parseDiff(sample, 0);
        diagnostics[0].added.push(...Array.from({ length: 20 }, () => diagnostics[0].added[0]));
        diagnostics[0].detailsAdded.push(...Array.from({ length: 20 }, () => diagnostics[0].detailsAdded[0]));
        const summary = summarizeDiffs(diagnostics);
        expect(summary).toStrictEqual({
            projects: [
                {
                    name: 'example',
                    url: 'https://github.com/example/project',
                    shard: 0,
                    added: 21,
                    removed: 1,
                    detailLinesAdded: 21,
                    detailLinesRemoved: 1,
                },
            ],
            groups: {
                example: {
                    unspecified: {
                        added: 21,
                        removed: 1,
                        examplesAdded: Array(3).fill('.../projects/example/test.py:1:1 - error: New message'),
                        examplesRemoved: ['.../projects/example/test.py:1:1 - error: Old message'],
                    },
                },
            },
            detailGroups: {
                example: {
                    reportArgumentType: {
                        added: 21,
                        removed: 1,
                        examplesAdded: Array(3).fill('     Details (reportArgumentType)'),
                        examplesRemoved: ['     Details (reportArgumentType)'],
                    },
                },
            },
        });
    });

    test('accepts empty shards and reconciles changed totals', () => {
        expect(parseDiff('', 0)).toEqual([]);
        const change =
            sample.replace(/^-.*\n/gm, '') +
            '\n- 0 errors, 0 warnings, 0 informations\n+ 1 error, 0 warnings, 0 informations';
        expect(parseDiff(change, 0)[0].added).toHaveLength(1);
        expect(() => parseDiff(change.replace('+ 1 error', '+ 2 errors'), 0)).toThrow('counts');
        expect(() => parseDiff(change.replace('- 0 errors, 0 warnings, 0 informations\n', ''), 0)).toThrow(
            'Incomplete'
        );
    });

    test('rejects malformed output instead of silently omitting projects', () => {
        expect(() => parseDiff('unexpected output', 0)).toThrow('Unrecognized');
        expect(() => parseDiff(sample.replace('Old message', 'Old message\nnot a diff line'), 0)).toThrow();
    });

    test.each(['+ unrecognized output', '-   not a diagnostic header', '+     '])(
        'rejects malformed signed output: %s',
        (line) => {
            expect(() => parseDiff(`${sample}\n${line}`, 0)).toThrow(new Error('Unrecognized diagnostic for example'));
        }
    );

    test('detail changes cannot account for missing diagnostic headers in the totals', () => {
        expect(() =>
            parseDiff(
                `${detailOnlySample}\n- 0 errors, 0 warnings, 0 informations\n+ 1 error, 0 warnings, 0 informations`,
                0
            )
        ).toThrow(new Error('Diagnostic counts do not match the totals for example'));
    });

    test('requires all artifacts from the exact successful PR run and attempt', async () => {
        const f = fixture();
        await expect(loadSource(f.request, repository, f.source)).resolves.toEqual(f.source);
        f.artifacts.pop();
        await expect(loadSource(f.request, repository, f.source)).rejects.toThrow('Missing');
        f.run.run_attempt = 2;
        await expect(loadSource(f.request, repository, f.source)).rejects.toThrow('matching');
    });

    test('rejects expired, duplicate, old-attempt, and oversized artifacts', async () => {
        for (const mutation of [
            (f: ReturnType<typeof fixture>) => (f.artifacts[0].expired = true),
            (f: ReturnType<typeof fixture>) => f.artifacts.push(f.artifacts[0]),
            (f: ReturnType<typeof fixture>) => (f.artifacts[0].created_at = '2026-09-09T00:00:00Z'),
            (f: ReturnType<typeof fixture>) => (f.artifacts[0].size_in_bytes = 9 * 1024 * 1024),
        ]) {
            const f = fixture();
            mutation(f);
            await expect(loadSource(f.request, repository, f.source)).rejects.toThrow('artifact');
        }
    });

    test('rejects another workflow or repository', async () => {
        const f = fixture();
        f.run.path = '.github/workflows/other.yml';
        await expect(loadSource(f.request, repository, f.source)).rejects.toThrow('matching');
        f.run.path = '.github/workflows/mypy_primer_pr.yaml';
        f.run.repository.full_name = 'someone/else';
        await expect(loadSource(f.request, repository, f.source)).rejects.toThrow('matching');
    });

    test('prepares all shards and skips a superseded head', async () => {
        writeShards();
        const f = fixture();
        await expect(prepareAnalysis(f.request, repository, f.source, directory)).resolves.toEqual(f.manifest);
        f.pr.head.sha = 'b'.repeat(40);
        await expect(prepareAnalysis(f.request, repository, f.source, directory)).resolves.toBeUndefined();
    });

    test('prepares and renders a detail-only project without treating zero headers as no changes', async () => {
        writeShards(detailOnlySample);
        const f = fixture(detailOnlySample);
        const manifest = await prepareAnalysis(f.request, repository, f.source, directory);
        expect(manifest).toStrictEqual({
            repository,
            source: f.source,
            prNumber: 7,
            ...expectedDetailOnlySummary,
        });
        if (!manifest) {
            throw new Error('Preparation unexpectedly skipped the detail-only project');
        }
        f.report.projects[0] = {
            name: 'example',
            assessment: 'needs-review',
            confidence: 'low',
            summary: 'Only diagnostic details changed.',
            explanation: 'The return type changed from Match[str] | None to Unknown.',
            unresolved: 'Diagnostic headers and locations are absent from the concise diff.',
            evidence: [],
        };
        const expectedDetails = [
            '### example',
            '',
            'The return type changed from Match\\[str\\] \\| None to Unknown.',
            '',
            '**Unresolved / coverage limits:** Diagnostic headers and locations are absent from the concise diff.',
            '',
            '',
        ];
        const expectedRow = '| example | 0 | 0 | 2 / 2 | Needs human review | low | Only diagnostic details changed. |';
        const expected = {
            body: [
                ...expectedReportHeading,
                expectedRow,
                '',
                '<details>',
                '<summary>Evidence and limitations by project</summary>',
                '',
                ...expectedDetails,
                '</details>',
                '',
                ...expectedReportFooter,
            ].join('\n'),
            fullReport: [...expectedReportHeading, expectedRow, '', ...expectedDetails].join('\n'),
        };
        expect(renderReport(manifest, f.report, 100)).toStrictEqual(expected);
        expect(() => renderReport(manifest, { projects: [] }, 100)).toThrow(
            new Error('The analysis must cover every changed project exactly once')
        );
        const path = join(directory, 'report.md');
        await expect(publishAnalysis(f.request, manifest, f.output(), 100, path, true)).resolves.toBe(
            'Staged: report saved without posting a comment'
        );
        expect(readFileSync(path, 'utf8')).toBe(expected.fullReport);
        expect(f.request.mock.calls.filter(([route]) => /^(POST|PATCH) /.test(route))).toStrictEqual([]);
    });

    test('does not trust the PR number artifact', async () => {
        writeShards();
        const f = fixture();
        f.source.pullRequests = [99];
        await expect(prepareAnalysis(f.request, repository, f.source, directory)).rejects.toThrow('not associated');
        writeFileSync(join(directory, 'mypy_primer_diffs_pr_number', 'pr_number.txt'), '7; echo unsafe');
        await expect(prepareAnalysis(f.request, repository, f.source, directory)).rejects.toThrow('Invalid PR number');
    });

    test('associates a fork by its head branch when GitHub omits commit and run PR associations', async () => {
        writeShards();
        const f = fixture(sample, 'contributor/pyright');
        f.source.headBranch = f.run.head_branch = f.pr.head.ref = 'fix/feature';
        const source = await loadSource(f.request, repository, f.source);
        expect(source).toStrictEqual(f.source);
        await expect(prepareAnalysis(f.request, repository, source, directory)).resolves.toStrictEqual(f.manifest);
        expect(f.request).toHaveBeenCalledWith('GET /repos/{owner}/{repo}/pulls', {
            owner: 'microsoft',
            repo: 'pyright',
            state: 'open',
            head: 'contributor:fix/feature',
            per_page: 100,
            page: 1,
        });
        expect(f.request.mock.calls.some(([route]) => route.includes('/commits/'))).toBe(false);
    });

    test('rejects missing or ambiguous fork associations', async () => {
        writeShards();
        const f = fixture(sample, 'contributor/pyright');
        f.associated.length = 0;
        await expect(prepareAnalysis(f.request, repository, f.source, directory)).rejects.toThrow('found 0');
        f.associated.push(f.pr);
        f.associated.push({ ...f.pr, number: 8 });
        await expect(prepareAnalysis(f.request, repository, f.source, directory)).rejects.toThrow('found 2');
    });

    test('filters fork candidates by state, head SHA, branch, head repository, and base repository', async () => {
        writeShards();
        const f = fixture(sample, 'contributor/pyright');
        const other = { ...f.pr, number: 8 };
        f.associated.push(
            { ...other, state: 'closed' },
            { ...other, head: { ...other.head, sha: 'b'.repeat(40) } },
            { ...other, head: { ...other.head, ref: 'different' } },
            { ...other, head: { ...other.head, repo: { full_name: 'someone/pyright' } } },
            { ...other, head: { ...other.head, repo: { full_name: 'contributor/other' } } },
            { ...other, base: { repo: { full_name: 'someone/else' } } }
        );
        await expect(prepareAnalysis(f.request, repository, f.source, directory)).resolves.toStrictEqual(f.manifest);
    });

    test('does not trust a fork PR number artifact without a matching branch association', async () => {
        writeShards();
        const f = fixture(sample, 'contributor/pyright');
        f.associated.splice(0, 1, { ...f.pr, number: 8 });
        await expect(prepareAnalysis(f.request, repository, f.source, directory)).rejects.toThrow('not associated');
    });

    test('paginates fork branch associations before requiring a unique match', async () => {
        writeShards();
        const f = fixture(sample, 'contributor/pyright');
        const original = f.request.getMockImplementation()!;
        f.request.mockImplementation(async (route, parameters) => {
            if (route === 'GET /repos/{owner}/{repo}/pulls' && parameters.page === 1) {
                return { data: Array.from({ length: 100 }, () => ({ ...f.pr, state: 'closed' })) };
            }
            return original(route, parameters);
        });
        await expect(prepareAnalysis(f.request, repository, f.source, directory)).resolves.toStrictEqual(f.manifest);
        expect(
            f.request.mock.calls
                .filter(([route]) => route === 'GET /repos/{owner}/{repo}/pulls')
                .map(([, parameters]) => parameters.page)
        ).toStrictEqual([1, 2]);
    });

    test.each(['closed', 'superseded'])('skips a %s fork PR without looking up associations', async (state) => {
        writeShards();
        const f = fixture(sample, 'contributor/pyright');
        if (state === 'closed') {
            f.pr.state = 'closed';
        } else {
            f.pr.head.sha = 'b'.repeat(40);
        }
        await expect(prepareAnalysis(f.request, repository, f.source, directory)).resolves.toBeUndefined();
        expect(f.request.mock.calls.map(([route]) => route)).toStrictEqual([
            'GET /repos/{owner}/{repo}/pulls/{pull_number}',
        ]);
    });

    test('revalidates fork branch associations before publishing', async () => {
        const f = fixture(sample, 'contributor/pyright');
        await expect(
            publishAnalysis(f.request, f.manifest, f.output(), 100, join(directory, 'report.md'), false)
        ).resolves.toBe('Published: advisory analysis of every changed project');
        expect(f.request.mock.calls.filter(([route]) => route === 'GET /repos/{owner}/{repo}/pulls')).toHaveLength(2);
        expect(f.request.mock.calls.filter(([route]) => /^(POST|PATCH) /.test(route))).toStrictEqual([
            [
                'POST /repos/{owner}/{repo}/issues/{issue_number}/comments',
                { owner: 'microsoft', repo: 'pyright', issue_number: 7, body: expectedReport.body },
            ],
        ]);
    });

    test('refuses to publish when a fork branch association becomes ambiguous', async () => {
        const f = fixture(sample, 'contributor/pyright');
        const original = f.request.getMockImplementation()!;
        f.request.mockImplementation(async (route, parameters) => {
            if (route === 'GET /repos/{owner}/{repo}/issues/{issue_number}/comments') {
                f.associated.push({ ...f.pr, number: 8 });
            }
            return original(route, parameters);
        });
        await expect(
            publishAnalysis(f.request, f.manifest, f.output(), 100, join(directory, 'report.md'), false)
        ).rejects.toThrow('found 2');
        expect(f.request.mock.calls.some(([route]) => /^(POST|PATCH) /.test(route))).toBe(false);
    });

    test('rejects duplicate project sections and unexpected shard files', async () => {
        writeShards(sample + '\n' + sample);
        const f = fixture();
        await expect(prepareAnalysis(f.request, repository, f.source, directory)).rejects.toThrow('duplicate project');
        writeFileSync(join(directory, 'mypy_primer_diffs_0', 'unexpected.js'), '');
        await expect(prepareAnalysis(f.request, repository, f.source, directory)).rejects.toThrow(
            'Unexpected contents'
        );
    });

    test('renders authoritative counts and preserves limitations in the full report', () => {
        const f = fixture();
        const result = renderReport(f.manifest, f.report, 100);
        expect(result).toStrictEqual(expectedReport);
    });

    test('large reports retain every project in the comment and full artifact', () => {
        const f = fixture();
        const names = Array.from({ length: 40 }, (_, index) => `project_${index}`);
        const manifest = {
            ...f.manifest,
            projects: names.map((name) => ({ ...f.manifest.projects[0], name })),
        };
        const report = {
            projects: names.map((name) => ({ ...f.report.projects[0], name, explanation: 'x'.repeat(1800) })),
        };
        const result = renderReport(manifest, report, 100);
        expect(result.body.length).toBeLessThan(60000);
        expect(result.fullReport.length).toBeGreaterThan(60000);
        const expectedRows = names.map(
            (_, index) =>
                `| project\\_${index} | 1 | 1 | 1 / 1 | Needs human review | low | The argument error changed its wording. |`
        );
        const expectedDetails = names.flatMap((_, index) => [
            `### project\\_${index}`,
            '',
            'x'.repeat(1800),
            '',
            '**Unresolved / coverage limits:** Exact dependency revision unavailable.',
            '',
            '',
        ]);
        expect(result).toStrictEqual({
            body: [...expectedReportHeading, ...expectedRows, '', ...expectedReportFooter].join('\n'),
            fullReport: [...expectedReportHeading, ...expectedRows, '', ...expectedDetails].join('\n'),
        });
    });

    test('rejects missing projects, unsupported classifications, and uncited certainty', () => {
        const f = fixture();
        expect(() => renderReport(f.manifest, { projects: [] }, 100)).toThrow('every changed project');
        f.report.projects.push(f.report.projects[0]);
        expect(() => renderReport(f.manifest, f.report, 100)).toThrow('every changed project');
        f.report.projects.pop();
        f.report.projects[0].assessment = 'definitely-safe';
        expect(() => renderReport(f.manifest, f.report, 100)).toThrow('Invalid assessment');
        f.report.projects[0].assessment = 'expected-improvement';
        expect(() => renderReport(f.manifest, f.report, 100)).toThrow('cited evidence');
    });

    test('escapes report text and rejects unsafe evidence links', () => {
        const f = fixture();
        f.report.projects[0].summary = '<script> @someone | injected row';
        const escapedSummary = '\\<script\\> &#64;someone \\| injected row';
        expect(renderReport(f.manifest, f.report, 100)).toStrictEqual({
            body: expectedReport.body.replace('The argument error changed its wording.', escapedSummary),
            fullReport: expectedReport.fullReport.replace('The argument error changed its wording.', escapedSummary),
        });
        const report = {
            projects: [
                { ...f.report.projects[0], evidence: [{ url: 'https://github.com@evil.example/', detail: 'Unsafe' }] },
            ],
        };
        expect(() => renderReport(f.manifest, report, 100)).toThrow('Unsupported evidence URL');
    });

    test('staged reports never mutate GitHub', async () => {
        const f = fixture();
        const path = join(directory, 'report.md');
        await expect(publishAnalysis(f.request, f.manifest, f.output(), 100, path, true)).resolves.toBe(
            'Staged: report saved without posting a comment'
        );
        expect(readFileSync(path, 'utf8')).toBe(expectedReport.fullReport);
        expect(f.request.mock.calls.some(([route]) => /^(POST|PATCH) /.test(route))).toBe(false);
    });

    test('requires a definitive staged flag from this attempt of the trusted activation job', () => {
        const activation = { repository, run_id: 100, run_attempt: '1', staged: true };
        expect(getStagedMode(activation, repository, 100, 1)).toBe(true);
        expect(getStagedMode({ ...activation, staged: false }, repository, 100, 1)).toBe(false);
        expect(() => getStagedMode({ ...activation, staged: undefined }, repository, 100, 1)).toThrow('metadata');
        expect(() => getStagedMode({ ...activation, staged: 'true' }, repository, 100, 1)).toThrow('metadata');
        expect(() => getStagedMode(activation, repository, 101, 1)).toThrow('metadata');
        expect(() => getStagedMode(activation, repository, 100, 2)).toThrow('metadata');
        expect(() => getStagedMode(activation, 'different/repository', 100, 1)).toThrow('metadata');
    });

    test('rechecks the head before posting', async () => {
        const f = fixture();
        f.pr.head.sha = 'b'.repeat(40);
        await expect(
            publishAnalysis(f.request, f.manifest, f.output(), 100, join(directory, 'report.md'), false)
        ).resolves.toBe('Skipped: the PR is closed or its head changed during analysis');
        expect(f.request.mock.calls.some(([route]) => /^(POST|PATCH) /.test(route))).toBe(false);
    });

    test('posts only to the verified PR and does not replace raw primer comments', async () => {
        const f = fixture();
        f.comments.push({ id: 55, user: { login: 'github-actions[bot]' }, body: 'Diff from mypy_primer' });
        await expect(
            publishAnalysis(f.request, f.manifest, f.output(), 100, join(directory, 'report.md'), false)
        ).resolves.toBe('Published: advisory analysis of every changed project');
        const calls = f.request.mock.calls.filter(([route]) => /^(POST|PATCH) /.test(route));
        expect(calls).toStrictEqual([
            [
                'POST /repos/{owner}/{repo}/issues/{issue_number}/comments',
                { owner: 'microsoft', repo: 'pyright', issue_number: 7, body: expectedReport.body },
            ],
        ]);
    });

    test('updates an existing report instead of duplicating it', async () => {
        const f = fixture();
        f.comments.push({
            id: 55,
            user: { login: 'github-actions[bot]' },
            body: `<!-- pyright-primer-analysis:${headSha}:42:1 -->`,
        });
        await expect(
            publishAnalysis(f.request, f.manifest, f.output(), 100, join(directory, 'report.md'), false)
        ).resolves.toBe('Published: advisory analysis of every changed project');
        const calls = f.request.mock.calls.filter(([route]) => /^(POST|PATCH) /.test(route));
        expect(calls).toStrictEqual([
            [
                'PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}',
                { owner: 'microsoft', repo: 'pyright', comment_id: 55, body: expectedReport.body },
            ],
        ]);
    });

    test('rechecks the head after listing existing comments', async () => {
        const f = fixture();
        const original = f.request.getMockImplementation()!;
        f.request.mockImplementation(async (route, parameters) => {
            if (route === 'GET /repos/{owner}/{repo}/issues/{issue_number}/comments') {
                f.pr.head.sha = 'b'.repeat(40);
            }
            return original(route, parameters);
        });
        await expect(
            publishAnalysis(f.request, f.manifest, f.output(), 100, join(directory, 'report.md'), false)
        ).resolves.toBe('Skipped: the PR changed while existing comments were being read');
        expect(f.request.mock.calls.some(([route]) => /^(POST|PATCH) /.test(route))).toBe(false);
    });

    test('does not overwrite a newer report for the same head', async () => {
        const f = fixture();
        f.comments.push({
            id: 55,
            user: { login: 'github-actions[bot]' },
            body: `<!-- pyright-primer-analysis:${headSha}:43:1 -->`,
        });
        await expect(
            publishAnalysis(f.request, f.manifest, f.output(), 100, join(directory, 'report.md'), false)
        ).resolves.toBe('Skipped: a newer primer analysis has already been posted for this commit');
        expect(f.request.mock.calls.some(([route]) => /^(POST|PATCH) /.test(route))).toBe(false);
    });

    test('compiled workflow runtime matches the compiler resolution lock', () => {
        const content = readFileSync(
            join(__dirname, '../../../../.github/workflows/mypy-primer-analysis.lock.yml'),
            'utf8'
        );
        const metadata = parseDocument(content.split('\n')[0].replace('# gh-aw-metadata: ', ''));
        const compilerVersion = metadata.get('compiler_version');
        expect(compilerVersion).toMatch(/^v\d+\.\d+\.\d+$/);
        const actionsLock = parseDocument(
            readFileSync(join(__dirname, '../../../../.github/aw/actions-lock.json'), 'utf8')
        );
        const runtimeActions = [...content.matchAll(/^\s+uses: (github\/gh-aw-actions\/[^@\s]+)@(\S+)/gm)];
        expect(runtimeActions.length).toBeGreaterThan(0);
        for (const [, repository, sha] of runtimeActions) {
            const key = `${repository}@${compilerVersion}`;
            const resolvedSha = actionsLock.getIn(['entries', key, 'sha']);
            expect(resolvedSha).toMatch(/^[a-f0-9]{40}$/);
            expect(actionsLock.getIn(['entries', key, 'repo'])).toBe(repository);
            expect(actionsLock.getIn(['entries', key, 'version'])).toBe(compilerVersion);
            expect(sha).toBe(resolvedSha);
        }
    });

    test('compiled workflow keeps the agent read-only and gates publication on threat detection', () => {
        const workflow = parseDocument(
            readFileSync(join(__dirname, '../../../../.github/workflows/mypy-primer-analysis.lock.yml'), 'utf8')
        );
        for (const job of ['agent', 'collect']) {
            expect(workflow.getIn(['jobs', job, 'permissions', 'pull-requests'])).toBe('read');
            expect(workflow.getIn(['jobs', job, 'permissions', 'contents'])).toBe('read');
        }
        expect(workflow.getIn(['jobs', 'safe_outputs', 'permissions', 'issues'])).not.toBe('write');
        expect(workflow.getIn(['jobs', 'conclusion', 'permissions', 'issues'])).not.toBe('write');
        const agentSteps = workflow.getIn(['jobs', 'agent', 'steps'], true);
        expect(String(agentSteps)).toContain('--deny-tool write');
        expect(String(agentSteps)).toContain('--deny-tool shell');
        const publishingSteps = workflow.getIn(['jobs', 'publish_primer_analysis', 'steps'], true);
        expect(String(publishingSteps)).toContain('Threat detection did not explicitly allow publication');
        expect(String(publishingSteps)).toContain('needs.detection.outputs.detection_conclusion');
        expect(String(publishingSteps)).toContain('getStagedMode(activation,');
        expect(String(publishingSteps)).toContain('primer-activation');
    });

    test('compiled workflow exposes GitHub and safe outputs through MCP without CLI-only instructions', () => {
        const source = parseDocument(
            readFileSync(join(__dirname, '../../../../.github/workflows/mypy-primer-analysis.md'), 'utf8').split(
                /^---\r?$/m
            )[1]
        );
        expect(source.getIn(['tools', 'cli-proxy'])).toBe(false);
        expect(source.getIn(['tools', 'bash'])).toBe(false);
        expect(source.getIn(['tools', 'edit'])).toBe(false);
        expect(source.getIn(['tools', 'github', 'read-only'])).toBe(true);
        expect(source.get('max-ai-credits')).toBe(25);
        expect(source.getIn(['engine', 'version'])).toBe('1.0.80');
        expect(source.getIn(['engine', 'harness'])).toBe('mypyPrimerCopilotHarness.cjs');

        const content = readFileSync(
            join(__dirname, '../../../../.github/workflows/mypy-primer-analysis.lock.yml'),
            'utf8'
        );
        const metadata = parseDocument(content.split('\n')[0].replace('# gh-aw-metadata: ', ''));
        expect(metadata.get('compiler_version')).toBe('v0.88.7');
        expect(metadata.getIn(['engine_versions', 'copilot'])).toBe('1.0.80');
        expect(content.includes('mcp_cli_tools')).toBe(false);
        expect(content.includes('GH_AW_MCP_CLI_SERVERS')).toBe(false);

        const workflow = parseDocument(content);
        const agentSteps = workflow.getIn(['jobs', 'agent', 'steps'], true);
        if (!isSeq(agentSteps)) {
            throw new Error('Missing agent steps');
        }
        const getStep = (id: string) => {
            const step = agentSteps.items.find((item) => isMap(item) && item.get('id') === id);
            if (!isMap(step)) {
                throw new Error(`Missing agent step: ${id}`);
            }
            return step;
        };
        const gateway = getStep('start-mcp-gateway').get('run');
        expect(gateway).toContain('export GH_AW_ENGINE="copilot"');
        expect(gateway).toContain('"github": {');
        expect(gateway).toContain('"safeoutputs": {');
        expect(gateway).toContain('"GITHUB_READ_ONLY": "1"');

        const install = agentSteps.items.find(
            (item) => isMap(item) && String(item.get('run')).includes('install_copilot_cli.sh')
        );
        if (!isMap(install)) {
            throw new Error('Missing Copilot installation step');
        }
        expect(install.get('run')).toContain('install_copilot_cli.sh" 1.0.80');
        const preflight = getStep('stage_mcp_preflight');
        expect(preflight.get('continue-on-error')).toBeUndefined();
        expect(preflight.get('if')).toBeUndefined();
        expect(preflight.getIn(['with', 'script'])).toContain("['mypyPrimerMcp.ts', 'mypyPrimerCopilotHarness.cjs']");
        expect(agentSteps.items.indexOf(preflight)).toBeLessThan(
            agentSteps.items.indexOf(getStep('agentic_execution'))
        );
        expect(getStep('agentic_execution').get('if')).toBeUndefined();
        expect(String(workflow.getIn(['jobs', 'collect', 'steps'], true))).toContain(
            "fs.copyFileSync('./build/ci/mypyPrimerMcp.ts'"
        );
        expect(String(workflow.getIn(['jobs', 'collect', 'steps'], true))).toContain(
            "fs.copyFileSync('./build/ci/mypyPrimerCopilotHarness.cjs'"
        );

        const execution = getStep('agentic_execution').get('run');
        expect(execution).toContain('/gh-aw/actions/mypyPrimerCopilotHarness.cjs"');
        expect(execution).toContain('export GH_AW_MCP_CONFIG="$HOME/.copilot/mcp-config.json"');
        expect(execution).toContain('--allow-tool github');
        expect(execution).toContain('--allow-tool safeoutputs');
        expect(execution).toContain('--deny-tool shell');
        expect(execution).toContain('--deny-tool write');
        expect(execution).not.toContain('--allow-tool shell');
        expect(execution).not.toContain('--allow-tool write');
    });
});
