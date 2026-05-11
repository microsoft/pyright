import { spawnSync } from 'child_process';
import commandLineArgs, { CommandLineOptions, OptionDefinition } from 'command-line-args';
import * as fs from 'fs';
import * as path from 'path';

import { parse } from '../../common/tomlUtils';

import {
    BenchmarkMetricDefinition,
    BenchmarkReportComparison,
    BenchmarkReportComparisonArtifactPaths,
    compareBenchmarkReports,
    loadBenchmarkReport,
    renderBenchmarkComparisonMarkdown,
    writeBenchmarkReportComparisonArtifacts,
} from './benchmarkComparison';
import { BenchmarkReport, createBenchmarkReport } from './benchmarkUtils';
import {
    EcosystemProjectTag,
    EcosystemSmokeProject,
    getEcosystemSmokeProjectTags,
    getGeneratedEcosystemProject,
    selectEcosystemSmokeProjects,
} from './ecosystemSmokeProjects';
import { GeneratedEcosystemProject } from './syncMypyPrimerProjects';

export interface EcosystemBenchmarkRunConfig {
    mode: 'select';
    suiteName: 'smoke';
    outputDir: string;
    projectDate?: string;
    tag?: EcosystemProjectTag;
    projectPattern?: RegExp;
    numShards?: number;
    shardIndex?: number;
}

export interface EcosystemBenchmarkComparisonConfig {
    mode: 'compare';
    baselineReportPath: string;
    candidateReportPath: string;
    outputDir: string;
}

export interface EcosystemBenchmarkExecutionConfig {
    mode: 'execute';
    suiteName: 'smoke';
    outputDir: string;
    projectRoot: string;
    projectDate?: string;
    tag?: EcosystemProjectTag;
    projectPattern?: RegExp;
    numShards?: number;
    shardIndex?: number;
    baselineExecutable?: string;
    candidateExecutable?: string;
    mainBaselineReportPath?: string;
    baselineSourceCommit?: string;
    updateMainBaseline?: boolean;
    prepareProjects?: boolean;
    installDependencies?: boolean;
}

export interface EcosystemBenchmarkResult {
    projectName: string;
    totalTimeMs?: number;
    maxMemoryMB?: number;
    filesAnalyzed?: number;
    diagnosticCount?: number;
    errorCount?: number;
    warningCount?: number;
    informationCount?: number;
    diagnostics?: EcosystemBenchmarkDiagnostic[];
}

export interface EcosystemBenchmarkDiagnostic {
    file?: string;
    severity: string;
    message: string;
}

export interface EcosystemBenchmarkDiagnosticDiff {
    projectName: string;
    added: string[];
    removed: string[];
}

export interface EcosystemBenchmarkReportComparison extends BenchmarkReportComparison {
    diagnosticDiffs: EcosystemBenchmarkDiagnosticDiff[];
}

export interface EcosystemBenchmarkManifest {
    suiteName: 'smoke';
    executionMode: 'selection-only' | 'command-execution';
    outputDir: string;
    projectDate?: string;
    filters: {
        tag?: EcosystemProjectTag;
        projectPattern?: string;
        numShards?: number;
        shardIndex?: number;
    };
    selectedProjects: EcosystemSmokeProject[];
    selectedProjectCount: number;
    notes: string[];
}

export interface EcosystemBenchmarkExecutionArtifactPaths {
    baselineReportPath?: string;
    candidateReportPath?: string;
    comparisonArtifactPaths?: BenchmarkReportComparisonArtifactPaths;
}

interface PyrightJsonResults {
    generalDiagnostics: { file?: string; message?: string; severity: string }[];
    summary: {
        errorCount: number;
        warningCount: number;
        informationCount: number;
        filesAnalyzed: number;
        timeInSec: number;
    };
}

interface ProjectPyrightConfigFile {
    [key: string]: unknown;
    extends?: string;
    include: string[];
    exclude: string[];
}

interface MainBaselineMetadata {
    sourceCommit?: string;
    projectDate?: string;
    configMode: 'generated-benchmark-config';
    refreshedAt: string;
}

export type EcosystemBenchmarkCommand =
    | EcosystemBenchmarkRunConfig
    | EcosystemBenchmarkComparisonConfig
    | EcosystemBenchmarkExecutionConfig;

const optionDefinitions: OptionDefinition[] = [
    { name: 'suite', type: String },
    { name: 'tag', type: String },
    { name: 'project', type: String },
    { name: 'num-shards', type: Number },
    { name: 'shard-index', type: Number },
    { name: 'project-date', type: String },
    { name: 'project-root', type: String },
    { name: 'baseline-executable', type: String },
    { name: 'candidate-executable', type: String },
    { name: 'baseline-report', type: String },
    { name: 'candidate-report', type: String },
    { name: 'main-baseline-report', type: String },
    { name: 'update-main-baseline', type: Boolean },
    { name: 'baseline-source-commit', type: String },
    { name: 'prepare-projects', type: Boolean },
    { name: 'install-dependencies', type: Boolean },
    { name: 'output', type: String },
];

const benchmarkOwnedConfigKeys = new Set(['include', 'exclude', 'ignore', 'strict']);
const pyrightPathArrayConfigKeys = new Set(['extraPaths']);
const pyrightPathStringConfigKeys = new Set(['stubPath', 'typeshedPath', 'venvPath']);

const ecosystemBenchmarkComparisonMetrics: readonly BenchmarkMetricDefinition<EcosystemBenchmarkResult>[] = [
    { name: 'totalTimeMs', getValue: (result) => result.totalTimeMs },
    { name: 'maxMemoryMB', getValue: (result) => result.maxMemoryMB },
    { name: 'filesAnalyzed', lowerIsBetter: false, getValue: (result) => result.filesAnalyzed },
    { name: 'diagnosticCount', getValue: (result) => result.diagnosticCount },
    { name: 'errorCount', getValue: (result) => result.errorCount },
    { name: 'warningCount', getValue: (result) => result.warningCount },
    { name: 'informationCount', getValue: (result) => result.informationCount },
];

export function parseEcosystemBenchmarkArgs(args: string[]): EcosystemBenchmarkCommand {
    const parsedArgs = commandLineArgs(optionDefinitions, { argv: args }) as CommandLineOptions;
    const outputDir = parsedArgs.output as string | undefined;
    if (!outputDir) {
        throw new Error('The --output option is required.');
    }

    const baselineReportPath = parsedArgs['baseline-report'] as string | undefined;
    const candidateReportPath = parsedArgs['candidate-report'] as string | undefined;
    const mainBaselineReportPath = parsedArgs['main-baseline-report'] as string | undefined;
    const baselineSourceCommit = parsedArgs['baseline-source-commit'] as string | undefined;
    const baselineExecutable = parsedArgs['baseline-executable'] as string | undefined;
    const candidateExecutable = parsedArgs['candidate-executable'] as string | undefined;

    if (baselineReportPath || candidateReportPath) {
        if (!candidateReportPath) {
            throw new Error('The --candidate-report option is required when comparing ecosystem benchmark reports.');
        }

        return {
            mode: 'compare',
            baselineReportPath: baselineReportPath ?? mainBaselineReportPath ?? getDefaultMainBaselineReportPath(),
            candidateReportPath,
            outputDir,
        };
    }

    const suiteName = (parsedArgs.suite as string | undefined) ?? 'smoke';

    if (suiteName !== 'smoke') {
        throw new Error(`Unsupported ecosystem benchmark suite "${suiteName}". Only "smoke" is implemented.`);
    }

    const tag = parsedArgs.tag as string | undefined;
    if (tag && !getEcosystemSmokeProjectTags().includes(tag as EcosystemProjectTag)) {
        throw new Error(`Unsupported ecosystem smoke tag "${tag}".`);
    }

    const projectPatternText = parsedArgs.project as string | undefined;

    if (baselineExecutable || candidateExecutable) {
        const projectRoot = parsedArgs['project-root'] as string | undefined;
        if (!projectRoot) {
            throw new Error('The --project-root option is required when executing ecosystem benchmarks.');
        }

        return {
            mode: 'execute',
            suiteName,
            outputDir,
            projectRoot,
            projectDate: parsedArgs['project-date'] as string | undefined,
            tag: tag as EcosystemProjectTag | undefined,
            projectPattern: projectPatternText ? new RegExp(projectPatternText, 'i') : undefined,
            numShards: parsedArgs['num-shards'] as number | undefined,
            shardIndex: parsedArgs['shard-index'] as number | undefined,
            baselineExecutable,
            candidateExecutable,
            mainBaselineReportPath,
            baselineSourceCommit,
            updateMainBaseline: parsedArgs['update-main-baseline'] as boolean | undefined,
            prepareProjects: parsedArgs['prepare-projects'] as boolean | undefined,
            installDependencies: parsedArgs['install-dependencies'] as boolean | undefined,
        };
    }

    return {
        mode: 'select',
        suiteName,
        outputDir,
        projectDate: parsedArgs['project-date'] as string | undefined,
        tag: tag as EcosystemProjectTag | undefined,
        projectPattern: projectPatternText ? new RegExp(projectPatternText, 'i') : undefined,
        numShards: parsedArgs['num-shards'] as number | undefined,
        shardIndex: parsedArgs['shard-index'] as number | undefined,
    };
}

export function getDefaultMainBaselineReportPath(): string {
    return getWritableBenchmarkFilePath('baselines', 'ecosystem-smoke-main.json');
}

export function buildEcosystemBenchmarkManifest(config: EcosystemBenchmarkRunConfig): EcosystemBenchmarkManifest {
    const selectedProjects = selectEcosystemSmokeProjects({
        tag: config.tag,
        projectPattern: config.projectPattern,
        numShards: config.numShards,
        shardIndex: config.shardIndex,
    });

    return {
        suiteName: config.suiteName,
        executionMode: 'selection-only',
        outputDir: config.outputDir,
        projectDate: config.projectDate,
        filters: {
            tag: config.tag,
            projectPattern: config.projectPattern?.source,
            numShards: config.numShards,
            shardIndex: config.shardIndex,
        },
        selectedProjects,
        selectedProjectCount: selectedProjects.length,
        notes: [
            'This runner currently resolves the ecosystem smoke selection and writes a manifest artifact.',
            'Project execution against base/head Pyright is not implemented yet.',
        ],
    };
}

export function executeEcosystemBenchmark(
    config: EcosystemBenchmarkExecutionConfig
): EcosystemBenchmarkExecutionArtifactPaths {
    const selectedProjects = selectEcosystemSmokeProjects({
        tag: config.tag,
        projectPattern: config.projectPattern,
        numShards: config.numShards,
        shardIndex: config.shardIndex,
    });

    if (config.prepareProjects) {
        prepareEcosystemProjectCheckouts(
            selectedProjects,
            config.projectRoot,
            config.projectDate,
            config.installDependencies ?? false
        );
    }

    const baselineResults = config.baselineExecutable
        ? executeEcosystemBenchmarkSuite(selectedProjects, config.projectRoot, config.baselineExecutable)
        : undefined;
    const candidateResults = config.candidateExecutable
        ? executeEcosystemBenchmarkSuite(selectedProjects, config.projectRoot, config.candidateExecutable)
        : undefined;

    const artifactPaths: EcosystemBenchmarkExecutionArtifactPaths = {};
    fs.mkdirSync(config.outputDir, { recursive: true });

    if (baselineResults) {
        artifactPaths.baselineReportPath = writeNamedBenchmarkReport(
            config.outputDir,
            'baseline-report.json',
            createBenchmarkReport('ecosystem-smoke', 0, 1, baselineResults)
        );

        if (config.updateMainBaseline) {
            writeMainBaselineReport(
                artifactPaths.baselineReportPath,
                config.mainBaselineReportPath ?? getDefaultMainBaselineReportPath(),
                {
                    sourceCommit: config.baselineSourceCommit,
                    projectDate: config.projectDate,
                    configMode: 'generated-benchmark-config',
                    refreshedAt: new Date().toISOString(),
                }
            );
        }
    }

    if (candidateResults) {
        artifactPaths.candidateReportPath = writeNamedBenchmarkReport(
            config.outputDir,
            'candidate-report.json',
            createBenchmarkReport('ecosystem-smoke', 0, 1, candidateResults)
        );
    }

    if (artifactPaths.baselineReportPath && artifactPaths.candidateReportPath) {
        artifactPaths.comparisonArtifactPaths = compareAndWriteEcosystemBenchmarkReportFiles(
            artifactPaths.baselineReportPath,
            artifactPaths.candidateReportPath,
            config.outputDir
        );
    } else if (artifactPaths.candidateReportPath) {
        const mainBaselineReportPath = config.mainBaselineReportPath ?? getDefaultMainBaselineReportPath();
        if (fs.existsSync(mainBaselineReportPath)) {
            artifactPaths.comparisonArtifactPaths = compareAndWriteEcosystemBenchmarkReportFiles(
                mainBaselineReportPath,
                artifactPaths.candidateReportPath,
                config.outputDir
            );
        }
    }

    return artifactPaths;
}

export function compareEcosystemBenchmarkReports(
    baselineReportPath: string,
    candidateReportPath: string,
    outputDir: string
): BenchmarkReportComparisonArtifactPaths {
    return compareAndWriteEcosystemBenchmarkReportFiles(baselineReportPath, candidateReportPath, outputDir);
}

export function writeEcosystemBenchmarkManifest(outputDir: string, manifest: EcosystemBenchmarkManifest): string {
    fs.mkdirSync(outputDir, { recursive: true });

    const manifestPath = path.join(outputDir, 'ecosystem-run-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2), 'utf-8');

    return manifestPath;
}

export function writeMainBaselineReport(
    sourceReportPath: string,
    baselineReportPath: string,
    metadata?: MainBaselineMetadata
): string {
    fs.mkdirSync(path.dirname(baselineReportPath), { recursive: true });

    if (!metadata) {
        fs.copyFileSync(sourceReportPath, baselineReportPath);
        return baselineReportPath;
    }

    const report = JSON.parse(fs.readFileSync(sourceReportPath, 'utf-8')) as Record<string, unknown>;
    report.mainBaseline = metadata;
    fs.writeFileSync(baselineReportPath, JSON.stringify(report, undefined, 2), 'utf-8');
    return baselineReportPath;
}

export function compareEcosystemBenchmarkReportData(
    baselineReport: BenchmarkReport<EcosystemBenchmarkResult>,
    candidateReport: BenchmarkReport<EcosystemBenchmarkResult>
): EcosystemBenchmarkReportComparison {
    return {
        ...compareBenchmarkReports(
            baselineReport,
            candidateReport,
            (result) => result.projectName,
            ecosystemBenchmarkComparisonMetrics
        ),
        diagnosticDiffs: compareEcosystemDiagnosticResults(baselineReport.results, candidateReport.results),
    };
}

export function runEcosystemBenchmark(
    args: string[]
): string | BenchmarkReportComparisonArtifactPaths | EcosystemBenchmarkExecutionArtifactPaths {
    const command = parseEcosystemBenchmarkArgs(args);

    if (command.mode === 'compare') {
        const artifactPaths = compareEcosystemBenchmarkReports(
            command.baselineReportPath,
            command.candidateReportPath,
            command.outputDir
        );

        console.log(`Comparison artifacts written to: ${command.outputDir}`);
        return artifactPaths;
    }

    if (command.mode === 'execute') {
        const artifactPaths = executeEcosystemBenchmark(command);
        console.log(`Execution artifacts written to: ${command.outputDir}`);
        return artifactPaths;
    }

    const manifest = buildEcosystemBenchmarkManifest(command);
    const manifestPath = writeEcosystemBenchmarkManifest(command.outputDir, manifest);

    console.log(`Selected ${manifest.selectedProjectCount} ecosystem project(s).`);
    console.log(`Manifest written to: ${manifestPath}`);

    return manifestPath;
}

function executeEcosystemBenchmarkSuite(
    projects: readonly EcosystemSmokeProject[],
    projectRoot: string,
    executableCommand: string
): EcosystemBenchmarkResult[] {
    return projects.map((project) => executeEcosystemProject(project, projectRoot, executableCommand));
}

function prepareEcosystemProjectCheckouts(
    projects: readonly EcosystemSmokeProject[],
    projectRoot: string,
    projectDate: string | undefined,
    installDependencies: boolean
): void {
    fs.mkdirSync(projectRoot, { recursive: true });

    for (const project of projects) {
        const generatedProject = getGeneratedEcosystemProject(project.name);
        if (!generatedProject) {
            throw new Error(`No generated ecosystem metadata found for project ${project.name}.`);
        }

        prepareEcosystemProjectCheckout(generatedProject, path.join(projectRoot, generatedProject.name), projectDate);

        if (installDependencies) {
            installEcosystemProjectDependencies(generatedProject, path.join(projectRoot, generatedProject.name));
        }
    }
}

export function prepareEcosystemProjectCheckout(
    project: GeneratedEcosystemProject,
    workingDirectory: string,
    projectDate: string | undefined
): void {
    if (!project.location) {
        throw new Error(`Cannot prepare ecosystem project ${project.name}; no repository location is configured.`);
    }

    if (fs.existsSync(workingDirectory)) {
        runRequiredProcess('git', ['fetch', '--all', '--tags'], workingDirectory, `update ${project.name}`);
    } else {
        runRequiredProcess('git', ['clone', project.location, workingDirectory], undefined, `clone ${project.name}`);
    }

    if (projectDate) {
        const commit = runRequiredProcess(
            'git',
            ['rev-list', '-n', '1', `--before=${projectDate}`, 'HEAD'],
            workingDirectory,
            `resolve ${project.name} project-date commit`
        ).trim();
        if (!commit) {
            throw new Error(`Could not find a ${project.name} commit before ${projectDate}.`);
        }

        runRequiredProcess('git', ['checkout', '--force', commit], workingDirectory, `checkout ${project.name}`);
    }
}

function installEcosystemProjectDependencies(project: GeneratedEcosystemProject, workingDirectory: string): void {
    if (project.dependencies && project.dependencies.length > 0) {
        runRequiredProcess(
            'python',
            ['-m', 'pip', 'install', ...project.dependencies],
            workingDirectory,
            `install ${project.name} dependency metadata`
        );
    }

    if (project.installCommand) {
        runRequiredProcess(project.installCommand, [], workingDirectory, `run ${project.name} install command`, true);
    }
}

function runRequiredProcess(
    command: string,
    args: readonly string[],
    cwd: string | undefined,
    description: string,
    shell = false
): string {
    const result = spawnSync(command, args, {
        cwd,
        encoding: 'utf-8',
        shell,
    });

    if (result.error) {
        throw result.error;
    }

    if (result.status !== 0) {
        throw new Error(
            `Failed to ${description}.\nCommand: ${[command, ...args].join(' ')}\nExit status: ${
                result.status ?? 'unknown'
            }\nstderr:\n${(result.stderr ?? '').trim()}\nstdout:\n${(result.stdout ?? '').trim()}`
        );
    }

    return result.stdout ?? '';
}

function executeEcosystemProject(
    project: EcosystemSmokeProject,
    projectRoot: string,
    executableCommand: string
): EcosystemBenchmarkResult {
    const generatedProject = getGeneratedEcosystemProject(project.name);
    if (!generatedProject) {
        throw new Error(`No generated ecosystem metadata found for project ${project.name}.`);
    }

    const workingDirectory = path.join(projectRoot, generatedProject.name);
    if (!fs.existsSync(workingDirectory)) {
        throw new Error(`Expected ecosystem project checkout at ${workingDirectory}.`);
    }

    return executePyrightProjectCommand(project.name, generatedProject, workingDirectory, executableCommand);
}

export function executePyrightProjectCommand(
    projectName: string,
    project: GeneratedEcosystemProject,
    workingDirectory: string,
    executableCommand: string
): EcosystemBenchmarkResult {
    const pyrightConfigPath = writeProjectPyrightConfig(workingDirectory, project);
    const invocation = resolvePyrightInvocationPaths(
        buildPyrightInvocation(executableCommand, project, pyrightConfigPath),
        process.cwd()
    );
    const startTime = process.hrtime.bigint();
    const result = spawnSync(invocation.command, invocation.args, {
        cwd: workingDirectory,
        encoding: 'utf-8',
    });
    const elapsedMs = Number(process.hrtime.bigint() - startTime) / 1_000_000;

    if (result.error) {
        throw result.error;
    }

    const output = result.stdout?.trim();
    if (!output) {
        throw createPyrightExecutionError(projectName, invocation, result.status, result.stdout, result.stderr);
    }

    let jsonResults: PyrightJsonResults;
    try {
        jsonResults = JSON.parse(output) as PyrightJsonResults;
    } catch (error) {
        throw createPyrightExecutionError(projectName, invocation, result.status, result.stdout, result.stderr, error);
    }
    const diagnosticCount =
        jsonResults.summary.errorCount + jsonResults.summary.warningCount + jsonResults.summary.informationCount;

    return {
        projectName,
        totalTimeMs: Math.round(elapsedMs * 100) / 100,
        filesAnalyzed: jsonResults.summary.filesAnalyzed,
        diagnosticCount,
        errorCount: jsonResults.summary.errorCount,
        warningCount: jsonResults.summary.warningCount,
        informationCount: jsonResults.summary.informationCount,
        diagnostics: jsonResults.generalDiagnostics.map(normalizePyrightDiagnostic),
    };
}

function compareAndWriteEcosystemBenchmarkReportFiles(
    baselineReportPath: string,
    candidateReportPath: string,
    outputDir: string
): BenchmarkReportComparisonArtifactPaths {
    const baselineReport = loadBenchmarkReport<EcosystemBenchmarkResult>(baselineReportPath);
    const candidateReport = loadBenchmarkReport<EcosystemBenchmarkResult>(candidateReportPath);
    const comparison = compareEcosystemBenchmarkReportData(baselineReport, candidateReport);
    const artifactPaths = writeBenchmarkReportComparisonArtifacts(
        outputDir,
        baselineReport,
        candidateReport,
        comparison
    );

    fs.writeFileSync(artifactPaths.markdownPath, renderEcosystemBenchmarkComparisonMarkdown(comparison), 'utf-8');
    return artifactPaths;
}

function compareEcosystemDiagnosticResults(
    baselineResults: readonly EcosystemBenchmarkResult[],
    candidateResults: readonly EcosystemBenchmarkResult[]
): EcosystemBenchmarkDiagnosticDiff[] {
    const candidateByProject = new Map(candidateResults.map((result) => [result.projectName, result]));

    return baselineResults.flatMap((baselineResult) => {
        const candidateResult = candidateByProject.get(baselineResult.projectName);
        if (!candidateResult) {
            return [];
        }

        const baselineDiagnostics = getDiagnosticSignatureSet(baselineResult);
        const candidateDiagnostics = getDiagnosticSignatureSet(candidateResult);
        const added = [...candidateDiagnostics].filter((entry) => !baselineDiagnostics.has(entry)).sort();
        const removed = [...baselineDiagnostics].filter((entry) => !candidateDiagnostics.has(entry)).sort();

        return added.length > 0 || removed.length > 0
            ? [{ projectName: baselineResult.projectName, added, removed }]
            : [];
    });
}

function getDiagnosticSignatureSet(result: EcosystemBenchmarkResult): Set<string> {
    return new Set((result.diagnostics ?? []).map(formatDiagnosticSignature));
}

function normalizePyrightDiagnostic(
    diagnostic: PyrightJsonResults['generalDiagnostics'][number]
): EcosystemBenchmarkDiagnostic {
    return {
        file: diagnostic.file,
        severity: diagnostic.severity,
        message: diagnostic.message ?? '',
    };
}

function formatDiagnosticSignature(diagnostic: EcosystemBenchmarkDiagnostic): string {
    return [diagnostic.severity, diagnostic.file ?? '<unknown>', diagnostic.message].join(' | ');
}

function renderEcosystemBenchmarkComparisonMarkdown(comparison: EcosystemBenchmarkReportComparison): string {
    const lines = [renderBenchmarkComparisonMarkdown(comparison).trimEnd(), '', '## Diagnostic Diffs', ''];

    if (comparison.diagnosticDiffs.length === 0) {
        lines.push('None.');
        return `${lines.join('\n')}\n`;
    }

    for (const diff of comparison.diagnosticDiffs) {
        lines.push(`### ${diff.projectName}`, '');
        appendDiagnosticDiffList(lines, 'Added diagnostics', diff.added);
        appendDiagnosticDiffList(lines, 'Removed diagnostics', diff.removed);
    }

    return `${lines.join('\n')}\n`;
}

function appendDiagnosticDiffList(lines: string[], heading: string, diagnostics: readonly string[]): void {
    lines.push(`#### ${heading}`, '');

    if (diagnostics.length === 0) {
        lines.push('None.', '');
        return;
    }

    for (const diagnostic of diagnostics) {
        lines.push(`- ${diagnostic}`);
    }

    lines.push('');
}

function createPyrightExecutionError(
    projectName: string,
    invocation: { command: string; args: string[] },
    status: number | null,
    stdout: string | undefined,
    stderr: string | undefined,
    cause?: unknown
): Error {
    const stdoutPrefix = (stdout ?? '').trim().slice(0, 1000);
    const stderrOutput = (stderr ?? '').trim();
    const details = [
        `Pyright execution for ${projectName} did not produce JSON output.`,
        `Command: ${[invocation.command, ...invocation.args].join(' ')}`,
        `Exit status: ${status ?? 'unknown'}`,
    ];

    if (cause instanceof Error) {
        details.push(`JSON parse error: ${cause.message}`);
    }

    if (stderrOutput.length > 0) {
        details.push(`stderr:\n${stderrOutput}`);
    }

    if (stdoutPrefix.length > 0) {
        details.push(`stdout prefix:\n${stdoutPrefix}`);
    }

    return new Error(details.join('\n'));
}

export function buildPyrightInvocation(
    executableCommand: string,
    project: GeneratedEcosystemProject,
    pyrightConfigPath?: string
): { command: string; args: string[] } {
    const template = project.pyrightCommand ?? '{pyright} {paths}';
    const projectPaths = project.paths && project.paths.length > 0 ? project.paths : ['.'];
    const tokens = tokenizeCommandTemplate(template);
    const executableTokens = getExecutableCommandTokens(executableCommand);
    if (executableTokens.length === 0) {
        throw new Error('The Pyright executable command cannot be empty.');
    }

    const executableArgs = executableTokens.slice(1);
    const pyrightArgs: string[] = [];
    let command = executableTokens[0];
    let insertedExecutable = false;

    for (const token of tokens) {
        if (token === '{pyright}') {
            command = executableTokens[0];
            insertedExecutable = true;
            continue;
        }

        if (token === '{paths}') {
            if (pyrightConfigPath) {
                continue;
            }

            pyrightArgs.push(...projectPaths);
            continue;
        }

        pyrightArgs.push(token);
    }

    if (!pyrightArgs.includes('--outputjson')) {
        pyrightArgs.push('--outputjson');
    }

    if (pyrightConfigPath && !pyrightArgs.includes('-p') && !pyrightArgs.includes('--project')) {
        pyrightArgs.push('-p', pyrightConfigPath);
    }

    const args = [...executableArgs];
    if (requiresNodeArgumentSeparator(command, executableArgs, pyrightArgs)) {
        args.push('--');
    }

    args.push(...pyrightArgs);

    return { command, args };
}

export function writeProjectPyrightConfig(workingDirectory: string, project: GeneratedEcosystemProject): string {
    const configDirectory = path.join(workingDirectory, '.pyright-benchmark');
    fs.mkdirSync(configDirectory, { recursive: true });

    const configPath = path.join(configDirectory, 'pyrightconfig.json');
    const sourcePaths = selectProjectSourcePaths(project).map((entry) =>
        getConfigRelativePath(configDirectory, path.resolve(workingDirectory, entry))
    );
    const projectConfigPath = path.join(workingDirectory, 'pyrightconfig.json');
    const projectPyrightSettings = fs.existsSync(projectConfigPath)
        ? {}
        : readPyprojectPyrightSettings(workingDirectory, configDirectory);
    const config: ProjectPyrightConfigFile = {
        ...projectPyrightSettings,
        extends: fs.existsSync(projectConfigPath)
            ? getConfigRelativePath(configDirectory, projectConfigPath)
            : undefined,
        include: sourcePaths,
        exclude: ['../**/test', '../**/tests', '../**/testing', '../**/test_*', '../**/*_test.py', '../**/*_tests.py'],
    };

    fs.writeFileSync(configPath, JSON.stringify(config, undefined, 2), 'utf-8');
    return configPath;
}

function readPyprojectPyrightSettings(workingDirectory: string, configDirectory: string): Record<string, unknown> {
    const pyprojectPath = path.join(workingDirectory, 'pyproject.toml');
    if (!fs.existsSync(pyprojectPath)) {
        return {};
    }

    const parsed = parse(fs.readFileSync(pyprojectPath, 'utf-8')) as { tool?: { pyright?: Record<string, unknown> } };
    const pyrightSettings = parsed.tool?.pyright;
    if (!pyrightSettings) {
        return {};
    }

    const copiedSettings: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(pyrightSettings)) {
        if (benchmarkOwnedConfigKeys.has(key)) {
            continue;
        }

        copiedSettings[key] = rebasePyprojectConfigValue(key, value, workingDirectory, configDirectory);
    }

    return copiedSettings;
}

function rebasePyprojectConfigValue(
    key: string,
    value: unknown,
    workingDirectory: string,
    configDirectory: string
): unknown {
    if (pyrightPathArrayConfigKeys.has(key) && Array.isArray(value)) {
        return value.map((entry) =>
            typeof entry === 'string'
                ? getConfigRelativePath(configDirectory, path.resolve(workingDirectory, entry))
                : entry
        );
    }

    if (pyrightPathStringConfigKeys.has(key) && typeof value === 'string') {
        return getConfigRelativePath(configDirectory, path.resolve(workingDirectory, value));
    }

    return value;
}

function tokenizeCommandTemplate(template: string): string[] {
    return Array.from(template.matchAll(/"([^"]*)"|'([^']*)'|\S+/g)).map((match) => match[1] ?? match[2] ?? match[0]);
}

function getExecutableCommandTokens(executableCommand: string): string[] {
    return fs.existsSync(executableCommand) ? [executableCommand] : tokenizeCommandTemplate(executableCommand);
}

function resolvePyrightInvocationPaths(
    invocation: { command: string; args: string[] },
    baseDirectory: string
): { command: string; args: string[] } {
    const command = resolveExistingPath(baseDirectory, invocation.command);
    const args = [...invocation.args];
    const commandName = path.basename(command).toLowerCase();

    if ((commandName === 'node' || commandName === 'node.exe') && args.length > 0) {
        const firstArg = args[0];
        if (firstArg !== '-e' && firstArg !== '--eval' && firstArg !== '--') {
            args[0] = resolveExistingPath(baseDirectory, firstArg);
        }
    }

    return { command, args };
}

function requiresNodeArgumentSeparator(command: string, executableArgs: string[], pyrightArgs: string[]): boolean {
    if (pyrightArgs.length === 0) {
        return false;
    }

    const commandName = path.basename(command).toLowerCase();
    if (commandName !== 'node' && commandName !== 'node.exe') {
        return false;
    }

    return executableArgs.includes('-e') || executableArgs.includes('--eval');
}

function selectProjectSourcePaths(project: GeneratedEcosystemProject): string[] {
    const configuredPaths = project.paths && project.paths.length > 0 ? project.paths : ['.'];
    const sourcePaths = configuredPaths.filter((entry) => !isTestLikePath(entry));

    return sourcePaths.length > 0 ? sourcePaths : configuredPaths;
}

function isTestLikePath(entry: string): boolean {
    return /(^|[\\/])(test|tests|testing|testdata)([\\/]|$)/i.test(entry);
}

function getConfigRelativePath(fromDirectory: string, targetPath: string): string {
    const relativePath = path.relative(fromDirectory, targetPath);
    return relativePath.length > 0 ? relativePath.replace(/\\/g, '/') : '.';
}

function resolveExistingPath(baseDirectory: string, entry: string): string {
    if (path.isAbsolute(entry)) {
        return entry;
    }

    const resolvedPath = path.resolve(baseDirectory, entry);
    return fs.existsSync(resolvedPath) ? resolvedPath : entry;
}

function getWritableBenchmarkFilePath(...pathParts: string[]): string {
    const sourceFilePath = path.resolve(__dirname, ...pathParts);
    if (!sourceFilePath.includes(`${path.sep}out${path.sep}`)) {
        return sourceFilePath;
    }

    return path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'src', 'tests', 'benchmarks', ...pathParts);
}

function writeNamedBenchmarkReport<ResultT>(
    outputDir: string,
    fileName: string,
    report: BenchmarkReport<ResultT>
): string {
    const outputPath = path.join(outputDir, fileName);
    fs.writeFileSync(outputPath, JSON.stringify(report, undefined, 2), 'utf-8');
    return outputPath;
}

if (require.main === module) {
    runEcosystemBenchmark(process.argv.slice(2));
}
