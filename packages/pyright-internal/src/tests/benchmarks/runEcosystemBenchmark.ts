import commandLineArgs, { CommandLineOptions, OptionDefinition } from 'command-line-args';
import * as fs from 'fs';
import * as path from 'path';

import {
    BenchmarkMetricDefinition,
    BenchmarkReportComparisonArtifactPaths,
    compareAndWriteBenchmarkReportFiles,
} from './benchmarkComparison';
import {
    EcosystemProjectTag,
    EcosystemSmokeProject,
    getEcosystemSmokeProjectTags,
    selectEcosystemSmokeProjects,
} from './ecosystemSmokeProjects';

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
    executionMode: 'selection-only';
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

export type EcosystemBenchmarkCommand = EcosystemBenchmarkRunConfig | EcosystemBenchmarkComparisonConfig;

const optionDefinitions: OptionDefinition[] = [
    { name: 'suite', type: String },
    { name: 'tag', type: String },
    { name: 'project', type: String },
    { name: 'num-shards', type: Number },
    { name: 'shard-index', type: Number },
    { name: 'project-date', type: String },
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

export function runEcosystemBenchmark(args: string[]): string | BenchmarkReportComparisonArtifactPaths {
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

    const manifest = buildEcosystemBenchmarkManifest(command);
    const manifestPath = writeEcosystemBenchmarkManifest(command.outputDir, manifest);

    console.log(`Selected ${manifest.selectedProjectCount} ecosystem project(s).`);
    console.log(`Manifest written to: ${manifestPath}`);

    return manifestPath;
}

if (require.main === module) {
    runEcosystemBenchmark(process.argv.slice(2));
}