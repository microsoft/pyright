/*
 * mypyPrimerAnalysis.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Trusted preparation and publication for the advisory mypy_primer workflow.
 */

import { lstatSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { join } from 'path';

type Request = (route: string, parameters: Record<string, string | number>) => Promise<{ data: unknown }>;

interface SourceRun {
    runId: number;
    runAttempt: number;
    headSha: string;
    headRepository: string;
    headBranch: string;
    pullRequests: number[];
}

interface DiffLine {
    text: string;
    rule: string;
}

interface Diagnostic extends DiffLine {
    severity: string;
}

interface ProjectDiff {
    name: string;
    url: string;
    shard: number;
    added: Diagnostic[];
    removed: Diagnostic[];
    detailsAdded: DiffLine[];
    detailsRemoved: DiffLine[];
}

interface Manifest extends ReturnType<typeof summarizeDiffs> {
    repository: string;
    source: SourceRun;
    prNumber: number;
}

const shardCount = 8;
const maxFileBytes = 8 * 1024 * 1024;
const reportPrefix = '<!-- pyright-primer-analysis:';
const assessments = new Map([
    ['expected-improvement', 'Expected improvement'],
    ['exposed-typing-issue', 'Exposed typing issue'],
    ['possible-regression', 'Possible regression'],
    ['needs-review', 'Needs human review'],
]);

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function record(value: unknown): Record<string, unknown> {
    if (!isRecord(value)) {
        throw new Error('Expected a JSON object');
    }
    return value;
}

function array(value: unknown): unknown[] {
    if (!Array.isArray(value)) {
        throw new Error('Expected a JSON array');
    }
    return value;
}

function text(value: unknown, maxLength = 2000): string {
    if (typeof value !== 'string' || !value.trim() || value.length > maxLength) {
        throw new Error(`Expected nonempty text of at most ${maxLength} characters`);
    }
    return value;
}

function positiveInteger(value: unknown): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
        throw new Error('Expected a positive integer');
    }
    return value;
}

function repositoryParameters(repository: string) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) {
        throw new Error('Invalid repository name');
    }
    const [owner, repo] = repository.split('/');
    return { owner, repo };
}

function readInput(path: string): string {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxFileBytes) {
        throw new Error(`Not a bounded regular input file: ${path}`);
    }
    return readFileSync(path, 'utf8');
}

async function pages(request: Request, route: string, parameters: Record<string, string | number>, key?: string) {
    const result: unknown[] = [];
    for (let page = 1; page <= 10; page++) {
        const { data } = await request(route, { ...parameters, per_page: 100, page });
        const items = array(key ? record(data)[key] : data);
        result.push(...items);
        if (items.length < 100) {
            return result;
        }
    }
    throw new Error('GitHub pagination limit exceeded; refusing a partial result');
}

export async function loadSource(request: Request, repository: string, handoff: unknown): Promise<SourceRun> {
    const context = record(handoff);
    const runId = positiveInteger(context.runId);
    const runAttempt = positiveInteger(context.runAttempt);
    const parameters = { ...repositoryParameters(repository), run_id: runId };
    const run = record((await request('GET /repos/{owner}/{repo}/actions/runs/{run_id}', parameters)).data);
    const headSha = text(run.head_sha);
    if (
        run.id !== runId ||
        run.run_attempt !== runAttempt ||
        run.event !== 'pull_request' ||
        run.path !== '.github/workflows/mypy_primer_pr.yaml' ||
        run.conclusion !== 'success' ||
        record(run.repository).full_name !== repository ||
        !/^[a-f0-9]{40}$/.test(headSha)
    ) {
        throw new Error('The handoff does not identify a successful, matching primer run');
    }

    const artifacts = await pages(
        request,
        'GET /repos/{owner}/{repo}/actions/runs/{run_id}/artifacts',
        parameters,
        'artifacts'
    );
    const expected = new Set([
        'mypy_primer_diffs_pr_number',
        ...Array.from({ length: shardCount }, (_, index) => `mypy_primer_diffs_${index}`),
    ]);
    const startedAt = Date.parse(text(run.run_started_at));
    if (!Number.isFinite(startedAt)) {
        throw new Error('Invalid primer run start time');
    }
    for (const value of artifacts) {
        const artifact = record(value);
        const name = text(artifact.name);
        if (!name.startsWith('mypy_primer_diffs')) {
            continue;
        }
        const createdAt = Date.parse(text(artifact.created_at));
        if (
            !expected.delete(name) ||
            artifact.expired !== false ||
            positiveInteger(artifact.size_in_bytes) > maxFileBytes ||
            !Number.isFinite(createdAt) ||
            createdAt < startedAt
        ) {
            throw new Error(`Invalid, duplicate, oversized, or stale primer artifact: ${name}`);
        }
    }
    if (expected.size) {
        throw new Error(`Missing primer artifacts: ${[...expected].join(', ')}`);
    }

    return {
        runId,
        runAttempt,
        headSha,
        headRepository: text(record(run.head_repository).full_name),
        headBranch: text(run.head_branch),
        pullRequests: array(run.pull_requests).map((pr) => positiveInteger(record(pr).number)),
    };
}

async function isCurrentPullRequest(request: Request, repository: string, source: SourceRun, prNumber: number) {
    const parameters = { ...repositoryParameters(repository), pull_number: prNumber };
    const pr = record((await request('GET /repos/{owner}/{repo}/pulls/{pull_number}', parameters)).data);
    if (pr.number !== prNumber || record(record(pr.base).repo).full_name !== repository) {
        throw new Error('The PR does not belong to the source repository');
    }
    if (pr.state !== 'open') {
        return false;
    }
    const head = record(pr.head);
    if (record(head.repo).full_name !== source.headRepository || head.ref !== source.headBranch) {
        throw new Error('The PR does not belong to the source run');
    }
    if (head.sha !== source.headSha) {
        return false;
    }

    // Fork workflow_run events can omit pull_requests. Require an unambiguous
    // GitHub association rather than trusting the uploaded PR number by itself.
    let associated = source.pullRequests;
    if (!associated.length) {
        const prs = await pages(request, 'GET /repos/{owner}/{repo}/commits/{commit_sha}/pulls', {
            ...repositoryParameters(repository),
            commit_sha: source.headSha,
        });
        associated = prs
            .map(record)
            .filter((candidate) => {
                const candidateHead = record(candidate.head);
                return (
                    candidate.state === 'open' &&
                    candidateHead.sha === source.headSha &&
                    candidateHead.ref === source.headBranch &&
                    record(candidateHead.repo).full_name === source.headRepository
                );
            })
            .map((candidate) => positiveInteger(candidate.number));
        if (associated.length !== 1) {
            throw new Error('The fork run cannot be associated with a unique open PR');
        }
    }
    if (!associated.includes(prNumber)) {
        throw new Error('The uploaded PR number is not associated with the source run');
    }
    return true;
}

export function parseDiff(contents: string, shard: number): ProjectDiff[] {
    const projects: ProjectDiff[] = [];
    let project: ProjectDiff | undefined;
    let totals: Partial<Record<'+' | '-', number[]>> = {};
    const finishProject = () => {
        if (!project) {
            return;
        }
        const before = totals['-'];
        const after = totals['+'];
        if (!!before !== !!after) {
            throw new Error(`Incomplete diagnostic totals for ${project.name}`);
        }
        ['error', 'warning', 'information'].forEach((severity, index) => {
            const delta =
                project!.added.filter((d) => d.severity === severity).length -
                project!.removed.filter((d) => d.severity === severity).length;
            // Unchanged totals are omitted from the diff altogether.
            if (delta !== (after && before ? after[index] - before[index] : 0)) {
                throw new Error(`Diagnostic counts do not match the totals for ${project!.name}`);
            }
        });
    };

    for (const line of contents.replace(/\r\n/g, '\n').split('\n')) {
        if (!line.trim()) {
            continue;
        }
        const header = /^([\w.-]{1,80}) \((https:\/\/github\.com\/[\w.-]+\/[\w.-]+)\)$/.exec(line);
        if (header) {
            finishProject();
            project = {
                name: header[1],
                url: header[2],
                shard,
                added: [],
                removed: [],
                detailsAdded: [],
                detailsRemoved: [],
            };
            projects.push(project);
            totals = {};
            continue;
        }
        if (!project || (line[0] !== '+' && line[0] !== '-')) {
            throw new Error(`Unrecognized primer output: ${line.slice(0, 120)}`);
        }
        const sign = line[0];
        if (/^[+-] \S.*\.pyi?$/.test(line)) {
            continue;
        }
        const total = /^[+-] (\d+) errors?, (\d+) warnings?, (\d+) informations?$/.exec(line);
        if (total) {
            if (totals[sign]) {
                throw new Error(`Duplicate diagnostic totals for ${project.name}`);
            }
            totals[sign] = total.slice(1).map(Number);
            continue;
        }
        const rule = /\((report\w+)\)$/.exec(line)?.[1] ?? 'unspecified';
        const diagnostic = /^[+-] {3}(\S.*:\d+:\d+ - (error|warning|information): .+)$/.exec(line);
        if (diagnostic) {
            const entry = { severity: diagnostic[2], text: diagnostic[1], rule };
            (sign === '+' ? project.added : project.removed).push(entry);
        } else if (/^[+-] {3}[ \u00a0]{2,}\S/.test(line)) {
            // Concise diffs omit unchanged headers and context, so even a nearby
            // header cannot reliably identify the diagnostic owning this line.
            (sign === '+' ? project.detailsAdded : project.detailsRemoved).push({ text: line.slice(1), rule });
        } else {
            throw new Error(`Unrecognized diagnostic for ${project.name}`);
        }
    }
    finishProject();
    return projects;
}

function groupChanges(added: DiffLine[], removed: DiffLine[]) {
    const groups = new Map<
        string,
        { added: number; removed: number; examplesAdded: string[]; examplesRemoved: string[] }
    >();
    for (const [direction, entries] of [
        ['added', added],
        ['removed', removed],
    ] as const) {
        for (const entry of entries) {
            const group = groups.get(entry.rule) ?? {
                added: 0,
                removed: 0,
                examplesAdded: [],
                examplesRemoved: [],
            };
            group[direction]++;
            const examples = direction === 'added' ? group.examplesAdded : group.examplesRemoved;
            if (examples.length < 3) {
                examples.push(entry.text.slice(0, 400));
            }
            groups.set(entry.rule, group);
        }
    }
    return Object.fromEntries(groups);
}

export function summarizeDiffs(projects: ProjectDiff[]) {
    return {
        projects: projects.map((project) => ({
            name: project.name,
            url: project.url,
            shard: project.shard,
            added: project.added.length,
            removed: project.removed.length,
            detailLinesAdded: project.detailsAdded.length,
            detailLinesRemoved: project.detailsRemoved.length,
        })),
        groups: Object.fromEntries(
            projects.map((project) => [project.name, groupChanges(project.added, project.removed)] as const)
        ),
        detailGroups: Object.fromEntries(
            projects.map(
                (project) => [project.name, groupChanges(project.detailsAdded, project.detailsRemoved)] as const
            )
        ),
    };
}

export async function prepareAnalysis(
    request: Request,
    repository: string,
    source: SourceRun,
    directory: string
): Promise<Manifest | undefined> {
    const prText = readInput(join(directory, 'mypy_primer_diffs_pr_number', 'pr_number.txt')).trim();
    if (!/^[1-9]\d*$/.test(prText)) {
        throw new Error('Invalid PR number artifact');
    }
    const prNumber = positiveInteger(Number(prText));
    if (!(await isCurrentPullRequest(request, repository, source, prNumber))) {
        return undefined;
    }
    const projects: ProjectDiff[] = [];
    for (let shard = 0; shard < shardCount; shard++) {
        const folder = join(directory, `mypy_primer_diffs_${shard}`);
        const filename = `diff_${shard}.txt`;
        if (lstatSync(folder).isSymbolicLink() || readdirSync(folder).join() !== filename) {
            throw new Error(`Unexpected contents in shard ${shard}`);
        }
        projects.push(...parseDiff(readInput(join(folder, filename)), shard));
    }
    if (projects.length > 100 || new Set(projects.map((project) => project.name)).size !== projects.length) {
        throw new Error('Too many projects or duplicate project sections');
    }
    return { repository, source, prNumber, ...summarizeDiffs(projects) };
}

function escapeMarkdown(value: string): string {
    return value
        .replace(/[\r\n]+/g, ' ')
        .replace(/[\\`*_[\]<>#|]/g, '\\$&')
        .replace(/@/g, '&#64;');
}

export function renderReport(manifest: Manifest, report: unknown, analysisRunId: number) {
    const reports = array(record(report).projects).map(record);
    const names = reports.map((item) => text(item.name, 80));
    if (
        names.length !== manifest.projects.length ||
        new Set(names).size !== names.length ||
        !manifest.projects.every((project) => names.includes(project.name))
    ) {
        throw new Error('The analysis must cover every changed project exactly once');
    }
    const runUrl = `https://github.com/${manifest.repository}/actions/runs/${manifest.source.runId}`;
    const analysisUrl = `https://github.com/${manifest.repository}/actions/runs/${positiveInteger(analysisRunId)}`;
    const marker = `${reportPrefix}${manifest.source.headSha}:${manifest.source.runId}:${manifest.source.runAttempt} -->`;
    const heading = [
        marker,
        '## mypy_primer analysis',
        '',
        `Advisory AI analysis of [primer run ${manifest.source.runId}, attempt ${manifest.source.runAttempt}](${runUrl})`,
        `for commit \`${manifest.source.headSha}\`. This is not an approval or proof of correctness.`,
        '',
        'Added/removed counts are diagnostic headers; message rewrites can appear on both sides.',
        'Detail lines are counted separately, without assuming a location or association with nearby headers.',
        '',
    ];
    const rows = [
        '| Project | Added | Removed | Detail lines + / - | Assessment | Confidence | Explanation |',
        '| --- | ---: | ---: | ---: | --- | --- | --- |',
    ];
    const details: string[] = [];
    for (const project of manifest.projects) {
        const item = reports.find((candidate) => candidate.name === project.name)!;
        const assessment = assessments.get(text(item.assessment));
        const confidence = text(item.confidence);
        if (!assessment || !['low', 'medium', 'high'].includes(confidence)) {
            throw new Error(`Invalid assessment or confidence for ${project.name}`);
        }
        const summary = escapeMarkdown(text(item.summary, 240));
        const explanation = escapeMarkdown(text(item.explanation, 1800));
        const unresolved = escapeMarkdown(text(item.unresolved, 800));
        const evidence = array(item.evidence).map((entry) => {
            const source = record(entry);
            const url = new URL(text(source.url, 1000));
            if (
                url.protocol !== 'https:' ||
                url.username ||
                url.password ||
                url.port ||
                !['github.com', 'typing.python.org'].includes(url.hostname)
            ) {
                throw new Error(`Unsupported evidence URL for ${project.name}`);
            }
            return `- ${escapeMarkdown(text(source.detail, 400))}: <${url.href}>`;
        });
        if (evidence.length > 5 || (!evidence.length && item.assessment !== 'needs-review')) {
            throw new Error(`Expected cited evidence for ${project.name}`);
        }
        rows.push(
            `| ${escapeMarkdown(project.name)} | ${project.added} | ${project.removed} | ` +
                `${project.detailLinesAdded} / ${project.detailLinesRemoved} | ` +
                `${assessment} | ${confidence} | ${summary} |`
        );
        details.push(
            `### ${escapeMarkdown(project.name)}`,
            '',
            explanation,
            '',
            `**Unresolved / coverage limits:** ${unresolved}`,
            '',
            ...evidence,
            ''
        );
    }
    const footer = [
        `**Full evidence and limitations:** download \`mypy-primer-analysis-report\` from [this analysis run](${analysisUrl}).`,
        'The original raw primer comment is unchanged. Treat uncertainty and possible regressions as requests for human review.',
    ];
    const compactBody = [...heading, ...rows, '', ...footer].join('\n');
    const expandedBody = [
        ...heading,
        ...rows,
        '',
        '<details>',
        '<summary>Evidence and limitations by project</summary>',
        '',
        ...details,
        '</details>',
        '',
        ...footer,
    ].join('\n');
    const body = expandedBody.length <= 60000 ? expandedBody : compactBody;
    if (body.length > 60000) {
        throw new Error('The report exceeds the comment limit; refusing to omit projects');
    }
    return { body, fullReport: [...heading, ...rows, '', ...details].join('\n') };
}

export function getStagedMode(activationInfo: unknown, repository: string, runId: number, runAttempt: number): boolean {
    const info = record(activationInfo);
    // gh-aw v0.86.2 doesn't forward staged mode to custom jobs. The activation
    // artifact is written before the agent runs and cannot be replaced by its output.
    if (
        info.repository !== repository ||
        info.run_id !== positiveInteger(runId) ||
        info.run_attempt !== String(positiveInteger(runAttempt)) ||
        typeof info.staged !== 'boolean'
    ) {
        throw new Error('Missing or mismatched trusted activation metadata');
    }
    return info.staged;
}

export async function publishAnalysis(
    request: Request,
    manifest: Manifest,
    agentOutput: unknown,
    analysisRunId: number,
    reportPath: string,
    staged: boolean
) {
    const items = array(record(agentOutput).items)
        .map(record)
        .filter((item) => item.type === 'publish_primer_analysis');
    if (items.length !== 1) {
        throw new Error('Expected exactly one primer analysis report');
    }
    const rendered = renderReport(manifest, JSON.parse(text(items[0].report, 1000000)), analysisRunId);
    writeFileSync(reportPath, rendered.fullReport);
    const currentSource = await loadSource(request, manifest.repository, manifest.source);
    if (!(await isCurrentPullRequest(request, manifest.repository, currentSource, manifest.prNumber))) {
        return 'Skipped: the PR is closed or its head changed during analysis';
    }
    if (staged) {
        return 'Staged: report saved without posting a comment';
    }

    const parameters = { ...repositoryParameters(manifest.repository), issue_number: manifest.prNumber };
    const comments = await pages(request, 'GET /repos/{owner}/{repo}/issues/{issue_number}/comments', parameters);
    const existing = comments
        .map(record)
        .filter(
            (comment) =>
                record(comment.user).login === 'github-actions[bot]' &&
                typeof comment.body === 'string' &&
                comment.body.startsWith(`${reportPrefix}${manifest.source.headSha}:`)
        );
    for (const comment of existing) {
        const marker = /^<!-- pyright-primer-analysis:[a-f0-9]{40}:(\d+):(\d+) -->/.exec(text(comment.body, 65000));
        if (
            marker &&
            (Number(marker[1]) > manifest.source.runId ||
                (Number(marker[1]) === manifest.source.runId && Number(marker[2]) > manifest.source.runAttempt))
        ) {
            return 'Skipped: a newer primer analysis has already been posted for this commit';
        }
    }
    if (!(await isCurrentPullRequest(request, manifest.repository, currentSource, manifest.prNumber))) {
        return 'Skipped: the PR changed while existing comments were being read';
    }
    if (existing.length) {
        await request('PATCH /repos/{owner}/{repo}/issues/comments/{comment_id}', {
            ...repositoryParameters(manifest.repository),
            comment_id: positiveInteger(existing[existing.length - 1].id),
            body: rendered.body,
        });
    } else {
        await request('POST /repos/{owner}/{repo}/issues/{issue_number}/comments', {
            ...parameters,
            body: rendered.body,
        });
    }
    return 'Published: advisory analysis of every changed project';
}
