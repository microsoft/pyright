/*
 * mypyPrimerAnalysis.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseDocument } from 'yaml';

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

function fixture() {
    const source = {
        runId: 42,
        runAttempt: 1,
        headSha,
        headRepository: repository,
        headBranch: 'feature',
        pullRequests: [7],
    };
    const manifest = { repository, source, prNumber: 7, ...summarizeDiffs(parseDiff(sample, 0)) };
    const pr = {
        number: 7,
        state: 'open',
        base: { repo: { full_name: repository } },
        head: { sha: headSha, ref: 'feature', repo: { full_name: repository } },
    };
    const run = {
        id: 42,
        run_attempt: 1,
        event: 'pull_request',
        path: '.github/workflows/mypy_primer_pr.yaml',
        conclusion: 'success',
        repository: { full_name: repository },
        head_sha: headSha,
        head_repository: { full_name: repository },
        head_branch: 'feature',
        pull_requests: [{ number: 7 }],
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
        const [project] = parseDiff(sample.replace(/\n/g, '\r\n'), 3);
        expect(project.shard).toBe(3);
        expect(project.added).toHaveLength(1);
        expect(project.removed).toHaveLength(1);
        expect(project.added[0].rule).toBe('reportArgumentType');
        expect(project.added[0].text).toContain('Details');
    });

    test('keeps the complete project inventory before bounded diagnostic examples', () => {
        const diagnostics = parseDiff(sample, 0);
        diagnostics[0].added.push(...Array.from({ length: 20 }, () => diagnostics[0].added[0]));
        const summary = summarizeDiffs(diagnostics);
        expect(summary.projects[0].added).toBe(21);
        expect(summary.groups.example.reportArgumentType.added).toBe(21);
        expect(summary.groups.example.reportArgumentType.examplesAdded).toHaveLength(3);
        expect(summary.projects[0]).not.toHaveProperty('groups');
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

    test('does not trust the PR number artifact', async () => {
        writeShards();
        const f = fixture();
        f.source.pullRequests = [99];
        await expect(prepareAnalysis(f.request, repository, f.source, directory)).rejects.toThrow('not associated');
        writeFileSync(join(directory, 'mypy_primer_diffs_pr_number', 'pr_number.txt'), '7; echo unsafe');
        await expect(prepareAnalysis(f.request, repository, f.source, directory)).rejects.toThrow('Invalid PR number');
    });

    test('accepts a uniquely associated fork but rejects ambiguous associations', async () => {
        writeShards();
        const f = fixture();
        f.source.pullRequests = [];
        f.source.headRepository = 'contributor/pyright';
        f.pr.head.repo.full_name = 'contributor/pyright';
        await expect(prepareAnalysis(f.request, repository, f.source, directory)).resolves.toBeDefined();
        f.associated.push({ ...f.pr, number: 8 });
        await expect(prepareAnalysis(f.request, repository, f.source, directory)).rejects.toThrow('unique');
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
        expect(result.body).toContain('| example | 1 | 1 | Needs human review | low |');
        expect(result.body).toContain(headSha);
        expect(result.body).toContain('actions/runs/42');
        expect(result.body).toContain('<summary>Evidence and limitations by project</summary>');
        expect(result.fullReport).toContain('Exact dependency revision unavailable');
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
        expect(result.body).not.toContain('<details>');
        expect(result.fullReport.length).toBeGreaterThan(60000);
        for (const name of names) {
            expect(result.body).toContain(`| ${name.replace('_', '\\_')} |`);
            expect(result.fullReport).toContain(`### ${name.replace('_', '\\_')}`);
        }
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
        expect(renderReport(f.manifest, f.report, 100).body).toContain('\\<script\\> &#64;someone \\| injected row');
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
        await expect(publishAnalysis(f.request, f.manifest, f.output(), 100, path, true)).resolves.toContain('Staged');
        expect(readFileSync(path, 'utf8')).toContain('Unresolved / coverage limits');
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
        ).resolves.toContain('head changed');
        expect(f.request.mock.calls.some(([route]) => /^(POST|PATCH) /.test(route))).toBe(false);
    });

    test('posts only to the verified PR and does not replace raw primer comments', async () => {
        const f = fixture();
        f.comments.push({ id: 55, user: { login: 'github-actions[bot]' }, body: 'Diff from mypy_primer' });
        await publishAnalysis(f.request, f.manifest, f.output(), 100, join(directory, 'report.md'), false);
        const calls = f.request.mock.calls.filter(([route]) => /^(POST|PATCH) /.test(route));
        expect(calls).toHaveLength(1);
        expect(calls[0][0]).toMatch(/^POST /);
        expect(calls[0][1]).toMatchObject({ owner: 'microsoft', repo: 'pyright', issue_number: 7 });
    });

    test('updates an existing report instead of duplicating it', async () => {
        const f = fixture();
        f.comments.push({
            id: 55,
            user: { login: 'github-actions[bot]' },
            body: `<!-- pyright-primer-analysis:${headSha}:42:1 -->`,
        });
        await publishAnalysis(f.request, f.manifest, f.output(), 100, join(directory, 'report.md'), false);
        const calls = f.request.mock.calls.filter(([route]) => /^(POST|PATCH) /.test(route));
        expect(calls).toHaveLength(1);
        expect(calls[0][0]).toMatch(/^PATCH /);
        expect(calls[0][1]).toMatchObject({ owner: 'microsoft', repo: 'pyright', comment_id: 55 });
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
        ).resolves.toContain('while existing comments');
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
        ).resolves.toContain('newer');
        expect(f.request.mock.calls.some(([route]) => /^(POST|PATCH) /.test(route))).toBe(false);
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
});
