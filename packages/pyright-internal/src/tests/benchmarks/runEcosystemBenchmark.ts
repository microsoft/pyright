import { spawnSync } from 'child_process';
import commandLineArgs, { CommandLineOptions, OptionDefinition } from 'command-line-args';
import * as fs from 'fs';
import * as path from 'path';

import {
    BenchmarkMetricDefinition,
    BenchmarkReportComparisonArtifactPaths,
    compareBenchmarkReports,
    compareAndWriteBenchmarkReportFiles,
} from './benchmarkComparison';
import { BenchmarkReport, createBenchmarkReport } from './benchmarkUtils';
import {
    EcosystemProjectTag,
    EcosystemSmokeProject,
    getGeneratedEcosystemProject,
    getEcosystemSmokeProjectTags,
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
}

export interface EcosystemBenchmarkResult {
    projectName: string;
    totalTimeMs?: number;
    maxMemoryMB?: number;
    diagnosticCount?: number;
    errorCount?: number;
    warningCount?: number;
    informationCount?: number;
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
    generalDiagnostics: { severity: string }[];
    summary: {
        errorCount: number;
        warningCount: number;
        informationCount: number;
        filesAnalyzed: number;
        timeInSec: number;
    };
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
    { name: 'output', type: String },
];

const ecosystemBenchmarkComparisonMetrics: readonly BenchmarkMetricDefinition<EcosystemBenchmarkResult>[] = [
    { name: 'totalTimeMs', getValue: (result) => result.totalTimeMs },
    { name: 'maxMemoryMB', getValue: (result) => result.maxMemoryMB },
];

export function parseEcosystemBenchmarkArgs(args: string[]): EcosystemBenchmarkCommand {
    const parsedArgs = commandLineArgs(optionDefinitions, { argv: args }) as CommandLineOptions;
    const outputDir = parsedArgs.output as string | undefined;
    if (!outputDir) {
        throw new Error('The --output option is required.');
    }

    const baselineReportPath = parsedArgs['baseline-report'] as string | undefined;
    const candidateReportPath = parsedArgs['candidate-report'] as string | undefined;
    const baselineExecutable = parsedArgs['baseline-executable'] as string | undefined;
    const candidateExecutable = parsedArgs['candidate-executable'] as string | undefined;

    if (baselineReportPath || candidateReportPath) {
        if (!baselineReportPath || !candidateReportPath) {
            throw new Error('Both --baseline-report and --candidate-report must be provided together.');
        }

        return {
            mode: 'compare',
            baselineReportPath,
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
    }

    if (candidateResults) {
        artifactPaths.candidateReportPath = writeNamedBenchmarkReport(
            config.outputDir,
            'candidate-report.json',
            createBenchmarkReport('ecosystem-smoke', 0, 1, candidateResults)
        );
    }

    if (artifactPaths.baselineReportPath && artifactPaths.candidateReportPath) {
        artifactPaths.comparisonArtifactPaths = compareAndWriteBenchmarkReportFiles<EcosystemBenchmarkResult>(
            artifactPaths.baselineReportPath,
            artifactPaths.candidateReportPath,
            config.outputDir,
            (result) => result.projectName,
            ecosystemBenchmarkComparisonMetrics
        );
    }

    return artifactPaths;
}

export function compareEcosystemBenchmarkReports(
    baselineReportPath: string,
    candidateReportPath: string,
    outputDir: string
): BenchmarkReportComparisonArtifactPaths {
    return compareAndWriteBenchmarkReportFiles<EcosystemBenchmarkResult>(
        baselineReportPath,
        candidateReportPath,
        outputDir,
        (result) => result.projectName,
        ecosystemBenchmarkComparisonMetrics
    );
}

export function writeEcosystemBenchmarkManifest(outputDir: string, manifest: EcosystemBenchmarkManifest): string {
    fs.mkdirSync(outputDir, { recursive: true });

    const manifestPath = path.join(outputDir, 'ecosystem-run-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2), 'utf-8');

    return manifestPath;
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
    const invocation = buildPyrightInvocation(executableCommand, project);
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
        throw new Error(`Pyright execution for ${projectName} did not produce JSON output.`);
    }

    const jsonResults = JSON.parse(output) as PyrightJsonResults;
    const diagnosticCount =
        jsonResults.summary.errorCount + jsonResults.summary.warningCount + jsonResults.summary.informationCount;

    return {
        projectName,
        totalTimeMs: Math.round(elapsedMs * 100) / 100,
        diagnosticCount,
        errorCount: jsonResults.summary.errorCount,
        warningCount: jsonResults.summary.warningCount,
        informationCount: jsonResults.summary.informationCount,
    };
}

export function buildPyrightInvocation(
    executableCommand: string,
    project: GeneratedEcosystemProject
): { command: string; args: string[] } {
    const template = project.pyrightCommand ?? '{pyright} {paths}';
    const projectPaths = project.paths && project.paths.length > 0 ? project.paths : ['.'];
    const tokens = tokenizeCommandTemplate(template);
    const executableTokens = getExecutableCommandTokens(executableCommand);
    if (executableTokens.length === 0) {
        throw new Error('The Pyright executable command cannot be empty.');
    }

    const args: string[] = [];
    let command = executableTokens[0];
    let insertedExecutable = false;

    for (const token of tokens) {
        if (token === '{pyright}') {
            command = executableTokens[0];
            args.push(...executableTokens.slice(1));
            insertedExecutable = true;
            continue;
        }

        if (token === '{paths}') {
            args.push(...projectPaths);
            continue;
        }

        args.push(token);
    }

    if (!insertedExecutable) {
        args.unshift(...executableTokens.slice(1));
    }

    if (!args.includes('--outputjson')) {
        args.push('--outputjson');
    }

    return { command, args };
}

function tokenizeCommandTemplate(template: string): string[] {
    return Array.from(template.matchAll(/"([^"]*)"|'([^']*)'|\S+/g)).map((match) => match[1] ?? match[2] ?? match[0]);
}

function getExecutableCommandTokens(executableCommand: string): string[] {
    return fs.existsSync(executableCommand) ? [executableCommand] : tokenizeCommandTemplate(executableCommand);
}

function writeNamedBenchmarkReport<ResultT>(outputDir: string, fileName: string, report: BenchmarkReport<ResultT>): string {
    const outputPath = path.join(outputDir, fileName);
    fs.writeFileSync(outputPath, JSON.stringify(report, undefined, 2), 'utf-8');
    return outputPath;
}

if (require.main === module) {
    runEcosystemBenchmark(process.argv.slice(2));
}
