import commandLineArgs, { CommandLineOptions, OptionDefinition } from 'command-line-args';
import * as fs from 'fs';
import * as path from 'path';

import {
    EcosystemProjectTag,
    EcosystemSmokeProject,
    getEcosystemSmokeProjectTags,
    selectEcosystemSmokeProjects,
} from './ecosystemSmokeProjects';

export interface EcosystemBenchmarkRunConfig {
    suiteName: 'smoke';
    outputDir: string;
    projectDate?: string;
    tag?: EcosystemProjectTag;
    projectPattern?: RegExp;
    numShards?: number;
    shardIndex?: number;
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

const optionDefinitions: OptionDefinition[] = [
    { name: 'suite', type: String },
    { name: 'tag', type: String },
    { name: 'project', type: String },
    { name: 'num-shards', type: Number },
    { name: 'shard-index', type: Number },
    { name: 'project-date', type: String },
    { name: 'output', type: String },
];

export function parseEcosystemBenchmarkArgs(args: string[]): EcosystemBenchmarkRunConfig {
    const parsedArgs = commandLineArgs(optionDefinitions, { argv: args }) as CommandLineOptions;
    const suiteName = (parsedArgs.suite as string | undefined) ?? 'smoke';

    if (suiteName !== 'smoke') {
        throw new Error(`Unsupported ecosystem benchmark suite "${suiteName}". Only "smoke" is implemented.`);
    }

    const outputDir = parsedArgs.output as string | undefined;
    if (!outputDir) {
        throw new Error('The --output option is required.');
    }

    const tag = parsedArgs.tag as string | undefined;
    if (tag && !getEcosystemSmokeProjectTags().includes(tag as EcosystemProjectTag)) {
        throw new Error(`Unsupported ecosystem smoke tag "${tag}".`);
    }

    const projectPatternText = parsedArgs.project as string | undefined;

    return {
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

export function writeEcosystemBenchmarkManifest(outputDir: string, manifest: EcosystemBenchmarkManifest): string {
    fs.mkdirSync(outputDir, { recursive: true });

    const manifestPath = path.join(outputDir, 'ecosystem-run-manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2), 'utf-8');

    return manifestPath;
}

export function runEcosystemBenchmark(args: string[]): string {
    const config = parseEcosystemBenchmarkArgs(args);
    const manifest = buildEcosystemBenchmarkManifest(config);
    const manifestPath = writeEcosystemBenchmarkManifest(config.outputDir, manifest);

    console.log(`Selected ${manifest.selectedProjectCount} ecosystem project(s).`);
    console.log(`Manifest written to: ${manifestPath}`);

    return manifestPath;
}

if (require.main === module) {
    runEcosystemBenchmark(process.argv.slice(2));
}