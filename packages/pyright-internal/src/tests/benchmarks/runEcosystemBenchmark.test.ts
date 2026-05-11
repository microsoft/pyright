/*
 * runEcosystemBenchmark.test.ts
 * Copyright (c) Microsoft Corporation.
 *
 * Tests for the ecosystem benchmark runner entry point.
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { BenchmarkReport, benchmarkReportSchemaVersion } from './benchmarkUtils';
import {
    buildEcosystemBenchmarkManifest,
    buildPyrightInvocation,
    compareEcosystemBenchmarkReportData,
    compareEcosystemBenchmarkReports,
    EcosystemBenchmarkResult,
    executePyrightProjectCommand,
    getDefaultMainBaselineReportPath,
    parseEcosystemBenchmarkArgs,
    prepareEcosystemProjectCheckout,
    runEcosystemBenchmark,
    writeEcosystemBenchmarkManifest,
    writeMainBaselineReport,
    writeProjectPyrightConfig,
} from './runEcosystemBenchmark';
import { GeneratedEcosystemProject } from './syncMypyPrimerProjects';

const RUN_BENCHMARKS_ENV = 'PYRIGHT_RUN_BENCHMARKS';

const benchmarkSuite = process.env[RUN_BENCHMARKS_ENV] === '1' ? describe : describe.skip;

benchmarkSuite('Ecosystem Benchmark Runner', () => {
    test('parses smoke runner arguments', () => {
        const config = parseEcosystemBenchmarkArgs([
            '--suite',
            'smoke',
            '--tag',
            'overloads',
            '--project',
            'pandas',
            '--num-shards',
            '2',
            '--shard-index',
            '1',
            '--project-date',
            '2026-01-01',
            '--output',
            'artifacts/ecosystem-smoke',
        ]);

        expect(config.mode).toBe('select');
        if (config.mode !== 'select') {
            throw new Error('Expected selection mode.');
        }

        expect(config.suiteName).toBe('smoke');
        expect(config.tag).toBe('overloads');
        expect(config.projectPattern?.source).toBe('pandas');
        expect(config.numShards).toBe(2);
        expect(config.shardIndex).toBe(1);
        expect(config.projectDate).toBe('2026-01-01');
        expect(config.outputDir).toBe('artifacts/ecosystem-smoke');
    });

    test('builds a filtered smoke manifest', () => {
        const config = parseEcosystemBenchmarkArgs(['--suite', 'smoke', '--tag', 'overloads', '--output', 'artifacts']);

        expect(config.mode).toBe('select');
        if (config.mode !== 'select') {
            throw new Error('Expected selection mode.');
        }

        const manifest = buildEcosystemBenchmarkManifest(config);

        expect(manifest.executionMode).toBe('selection-only');
        expect(manifest.selectedProjectCount).toBe(1);
        expect(manifest.selectedProjects.map((project) => project.name)).toEqual(['pandas']);
    });

    test('writes an ecosystem run manifest', () => {
        const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-ecosystem-runner-'));

        try {
            const config = parseEcosystemBenchmarkArgs([
                '--suite',
                'smoke',
                '--project',
                'django',
                '--output',
                outputDir,
            ]);

            expect(config.mode).toBe('select');
            if (config.mode !== 'select') {
                throw new Error('Expected selection mode.');
            }

            const manifest = buildEcosystemBenchmarkManifest(config);
            const manifestPath = writeEcosystemBenchmarkManifest(outputDir, manifest);

            expect(manifestPath).toBe(path.join(outputDir, 'ecosystem-run-manifest.json'));
            expect(JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))).toEqual(manifest);
        } finally {
            fs.rmSync(outputDir, { force: true, recursive: true });
        }
    });

    test('runs end to end and writes a manifest artifact', () => {
        const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-ecosystem-runner-main-'));

        try {
            const manifestPath = runEcosystemBenchmark([
                '--suite',
                'smoke',
                '--tag',
                'parser-heavy',
                '--output',
                outputDir,
            ]);

            expect(typeof manifestPath).toBe('string');

            const manifest = JSON.parse(fs.readFileSync(manifestPath as string, 'utf-8'));

            expect(manifest.selectedProjects.map((project: { name: string }) => project.name)).toEqual(['black']);
        } finally {
            fs.rmSync(outputDir, { force: true, recursive: true });
        }
    });

    test('rejects unsupported suite names', () => {
        expect(() => parseEcosystemBenchmarkArgs(['--suite', 'full', '--output', 'artifacts'])).toThrow(
            'Unsupported ecosystem benchmark suite'
        );
    });

    test('parses comparison mode arguments', () => {
        const config = parseEcosystemBenchmarkArgs([
            '--baseline-report',
            'old.json',
            '--candidate-report',
            'new.json',
            '--output',
            'artifacts',
        ]);

        expect(config).toEqual({
            mode: 'compare',
            baselineReportPath: 'old.json',
            candidateReportPath: 'new.json',
            outputDir: 'artifacts',
        });
    });

    test('defaults comparison mode to the checked-in main baseline', () => {
        const config = parseEcosystemBenchmarkArgs(['--candidate-report', 'new.json', '--output', 'artifacts']);

        expect(config).toEqual({
            mode: 'compare',
            baselineReportPath: getDefaultMainBaselineReportPath(),
            candidateReportPath: 'new.json',
            outputDir: 'artifacts',
        });
    });

    test('parses execution mode arguments', () => {
        const config = parseEcosystemBenchmarkArgs([
            '--suite',
            'smoke',
            '--project-root',
            'q:/projects',
            '--baseline-executable',
            'node ./out/packages/pyright-internal/src/pyright.js',
            '--output',
            'artifacts',
        ]);

        expect(config).toEqual({
            mode: 'execute',
            suiteName: 'smoke',
            outputDir: 'artifacts',
            projectRoot: 'q:/projects',
            projectDate: undefined,
            tag: undefined,
            projectPattern: undefined,
            numShards: undefined,
            shardIndex: undefined,
            baselineExecutable: 'node ./out/packages/pyright-internal/src/pyright.js',
            candidateExecutable: undefined,
            mainBaselineReportPath: undefined,
            baselineSourceCommit: undefined,
            updateMainBaseline: undefined,
            prepareProjects: undefined,
            installDependencies: undefined,
        });
    });

    test('parses main baseline source commit', () => {
        const config = parseEcosystemBenchmarkArgs([
            '--suite',
            'smoke',
            '--project-root',
            'q:/projects',
            '--baseline-executable',
            'node ../pyright/index.js',
            '--baseline-source-commit',
            'abc123',
            '--output',
            'artifacts',
        ]);

        expect(config.mode).toBe('execute');
        if (config.mode !== 'execute') {
            throw new Error('Expected execution mode.');
        }

        expect(config.baselineSourceCommit).toBe('abc123');
    });

    test('parses project preparation flags', () => {
        const config = parseEcosystemBenchmarkArgs([
            '--suite',
            'smoke',
            '--project-root',
            'q:/projects',
            '--baseline-executable',
            'node ../pyright/index.js',
            '--prepare-projects',
            '--install-dependencies',
            '--output',
            'artifacts',
        ]);

        expect(config.mode).toBe('execute');
        if (config.mode !== 'execute') {
            throw new Error('Expected execution mode.');
        }

        expect(config.prepareProjects).toBe(true);
        expect(config.installDependencies).toBe(true);
    });

    test('builds a pyright invocation from project metadata', () => {
        const invocation = buildPyrightInvocation(
            'node ./dist/pyright.js',
            {
                name: 'black',
                mypyPrimerProject: 'black',
                source: { kind: 'mypy-primer' },
                pyrightCommand: '{pyright} --lib {paths}',
                paths: ['src', 'tests'],
            },
            'c:/temp/pyrightconfig.json'
        );

        expect(invocation.command).toBe('node');
        expect(invocation.args).toEqual([
            './dist/pyright.js',
            '--lib',
            '--outputjson',
            '-p',
            'c:/temp/pyrightconfig.json',
        ]);
    });

    test('inserts a separator for node eval commands', () => {
        const invocation = buildPyrightInvocation(
            'node -e "require(\'./out/pyright.js\').main()"',
            {
                name: 'black',
                mypyPrimerProject: 'black',
                source: { kind: 'mypy-primer' },
                pyrightCommand: '{pyright}',
            },
            'c:/temp/pyrightconfig.json'
        );

        expect(invocation.command).toBe('node');
        expect(invocation.args).toEqual([
            '-e',
            "require('./out/pyright.js').main()",
            '--',
            '--outputjson',
            '-p',
            'c:/temp/pyrightconfig.json',
        ]);
    });

    test('writes a project pyrightconfig.json with source-only includes', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-project-config-'));

        try {
            const configPath = writeProjectPyrightConfig(tempDir, {
                name: 'pydantic',
                mypyPrimerProject: 'pydantic',
                source: { kind: 'mypy-primer' },
                paths: ['src', 'tests', 'testdata'],
            });
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

            expect(config.include).toEqual(['../src']);
            expect(config.exclude).toContain('../**/tests');
        } finally {
            fs.rmSync(tempDir, { force: true, recursive: true });
        }
    });

    test('falls back to configured paths when every path looks test-like', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-project-config-fallback-'));

        try {
            const configPath = writeProjectPyrightConfig(tempDir, {
                name: 'example',
                mypyPrimerProject: 'example',
                source: { kind: 'mypy-primer' },
                paths: ['tests'],
            });
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

            expect(config.include).toEqual(['../tests']);
        } finally {
            fs.rmSync(tempDir, { force: true, recursive: true });
        }
    });

    test('extends an existing project pyrightconfig when writing benchmark config', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-project-config-extends-'));

        try {
            fs.writeFileSync(path.join(tempDir, 'pyrightconfig.json'), '{"typeCheckingMode":"strict"}', 'utf-8');

            const configPath = writeProjectPyrightConfig(tempDir, {
                name: 'example',
                mypyPrimerProject: 'example',
                source: { kind: 'mypy-primer' },
                paths: ['src'],
            });
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

            expect(config.extends).toBe('../pyrightconfig.json');
            expect(config.include).toEqual(['../src']);
        } finally {
            fs.rmSync(tempDir, { force: true, recursive: true });
        }
    });

    test('merges pyproject tool pyright settings into benchmark config', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-project-config-pyproject-'));

        try {
            fs.writeFileSync(
                path.join(tempDir, 'pyproject.toml'),
                [
                    '[tool.pyright]',
                    'typeCheckingMode = "strict"',
                    'include = ["tests"]',
                    'extraPaths = ["typings"]',
                    'stubPath = "stubs"',
                ].join('\n'),
                'utf-8'
            );

            const configPath = writeProjectPyrightConfig(tempDir, {
                name: 'example',
                mypyPrimerProject: 'example',
                source: { kind: 'mypy-primer' },
                paths: ['src'],
            });
            const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

            expect(config.typeCheckingMode).toBe('strict');
            expect(config.extraPaths).toEqual(['../typings']);
            expect(config.stubPath).toBe('../stubs');
            expect(config.include).toEqual(['../src']);
        } finally {
            fs.rmSync(tempDir, { force: true, recursive: true });
        }
    });

    test('executes a project command and captures benchmark results', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-ecosystem-execute-'));
        const workingDirectory = path.join(tempDir, 'black');
        const fakePyrightScriptPath = path.join(tempDir, 'fake-pyright.js');

        try {
            fs.mkdirSync(workingDirectory, { recursive: true });
            fs.writeFileSync(
                fakePyrightScriptPath,
                [
                    'const configArgIndex = process.argv.indexOf("-p");',
                    'if (configArgIndex < 0) { throw new Error("missing -p"); }',
                    'const fs = require("fs");',
                    'const config = JSON.parse(fs.readFileSync(process.argv[configArgIndex + 1], "utf8"));',
                    'if (JSON.stringify(config.include) !== JSON.stringify(["../src"])) {',
                    '  throw new Error(`unexpected include paths: ${JSON.stringify(config.include)}`);',
                    '}',
                    'const result = {',
                    '  generalDiagnostics: [{ severity: "error" }, { severity: "warning" }],',
                    '  summary: {',
                    '    filesAnalyzed: 3,',
                    '    errorCount: 1,',
                    '    warningCount: 1,',
                    '    informationCount: 0,',
                    '    timeInSec: 0.25',
                    '  }',
                    '};',
                    'console.log(JSON.stringify(result));',
                ].join('\n'),
                'utf-8'
            );

            const result = executePyrightProjectCommand(
                'black',
                createGeneratedProject({
                    pyrightCommand: `{pyright} "${fakePyrightScriptPath}" {paths}`,
                    paths: ['src', 'tests'],
                }),
                workingDirectory,
                process.execPath
            );

            expect(result.projectName).toBe('black');
            expect(result.filesAnalyzed).toBe(3);
            expect(result.diagnosticCount).toBe(2);
            expect(result.errorCount).toBe(1);
            expect(result.warningCount).toBe(1);
            expect(result.informationCount).toBe(0);
            expect(result.diagnostics).toEqual([
                { file: undefined, severity: 'error', message: '' },
                { file: undefined, severity: 'warning', message: '' },
            ]);
            expect(result.totalTimeMs).toBeGreaterThanOrEqual(0);
        } finally {
            fs.rmSync(tempDir, { force: true, recursive: true });
        }
    });

    test('prepares a project checkout from git metadata', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-ecosystem-prepare-'));
        const sourceRepo = path.join(tempDir, 'source');
        const checkoutDir = path.join(tempDir, 'checkout');

        try {
            fs.mkdirSync(sourceRepo, { recursive: true });
            runGit(['init'], sourceRepo);
            runGit(['config', 'core.autocrlf', 'false'], sourceRepo);
            runGit(['config', 'user.email', 'pyright-benchmark@example.com'], sourceRepo);
            runGit(['config', 'user.name', 'Pyright Benchmark'], sourceRepo);
            fs.writeFileSync(path.join(sourceRepo, 'sample.py'), 'x = 1\n', 'utf-8');
            runGit(['add', 'sample.py'], sourceRepo);
            runGit(['commit', '-m', 'initial'], sourceRepo, {
                GIT_AUTHOR_DATE: '2025-01-01T00:00:00Z',
                GIT_COMMITTER_DATE: '2025-01-01T00:00:00Z',
            });

            prepareEcosystemProjectCheckout(
                createGeneratedProject({ location: sourceRepo }),
                checkoutDir,
                '2026-01-01'
            );

            expect(fs.existsSync(path.join(checkoutDir, 'sample.py'))).toBe(true);
            expect(runGit(['status', '--short'], checkoutDir)).toBe('');
        } finally {
            fs.rmSync(tempDir, { force: true, recursive: true });
        }
    });

    test('includes command details when pyright emits no JSON', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-ecosystem-execute-error-'));
        const workingDirectory = path.join(tempDir, 'black');
        const fakePyrightScriptPath = path.join(tempDir, 'fake-pyright-error.js');

        try {
            fs.mkdirSync(workingDirectory, { recursive: true });
            fs.writeFileSync(
                fakePyrightScriptPath,
                ['console.log("not json");', 'console.error("synthetic stderr");', 'process.exit(2);'].join('\n'),
                'utf-8'
            );

            expect(() =>
                executePyrightProjectCommand(
                    'black',
                    createGeneratedProject({
                        pyrightCommand: `{pyright} "${fakePyrightScriptPath}" {paths}`,
                        paths: ['src'],
                    }),
                    workingDirectory,
                    process.execPath
                )
            ).toThrow(/Command: .*fake-pyright-error\.js[\s\S]*Exit status: 2[\s\S]*synthetic stderr/);
        } finally {
            fs.rmSync(tempDir, { force: true, recursive: true });
        }
    });

    test('resolves relative node script paths against the runner cwd during execution', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-ecosystem-relative-exec-'));
        const workingDirectory = path.join(tempDir, 'projects', 'black');
        const fakePyrightScriptPath = path.join(tempDir, 'fake-pyright-cli.js');
        const previousCwd = process.cwd();

        try {
            fs.mkdirSync(workingDirectory, { recursive: true });
            fs.writeFileSync(
                fakePyrightScriptPath,
                createFakePyrightScript({ errorCount: 0, warningCount: 0, informationCount: 0 }),
                'utf-8'
            );

            process.chdir(tempDir);

            const result = executePyrightProjectCommand(
                'black',
                createGeneratedProject({
                    paths: ['src'],
                }),
                workingDirectory,
                `"${process.execPath}" ./fake-pyright-cli.js`
            );

            expect(result.projectName).toBe('black');
            expect(result.filesAnalyzed).toBe(3);
            expect(result.diagnosticCount).toBe(0);
        } finally {
            process.chdir(previousCwd);
            fs.rmSync(tempDir, { force: true, recursive: true });
        }
    });

    test('runs execution mode end to end and writes reports plus comparison artifacts', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-ecosystem-execution-main-'));
        const projectRoot = tempDir;
        const projectDir = path.join(projectRoot, 'black');
        const outputDir = path.join(tempDir, 'artifacts');
        const baselineScriptPath = path.join(tempDir, 'baseline-pyright.js');
        const candidateScriptPath = path.join(tempDir, 'candidate-pyright.js');

        try {
            fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
            fs.writeFileSync(path.join(projectDir, 'src', 'sample.py'), 'x = 1\n', 'utf-8');

            fs.writeFileSync(
                baselineScriptPath,
                createFakePyrightScript({ errorCount: 1, warningCount: 0, informationCount: 0 }),
                'utf-8'
            );
            fs.writeFileSync(
                candidateScriptPath,
                createFakePyrightScript({ errorCount: 0, warningCount: 1, informationCount: 0 }),
                'utf-8'
            );

            const artifactPaths = runEcosystemBenchmark([
                '--suite',
                'smoke',
                '--tag',
                'parser-heavy',
                '--project-root',
                projectRoot,
                '--project-date',
                '2026-01-01',
                '--baseline-executable',
                `"${process.execPath}" "${baselineScriptPath}"`,
                '--candidate-executable',
                `"${process.execPath}" "${candidateScriptPath}"`,
                '--output',
                outputDir,
            ]);

            expect(typeof artifactPaths).not.toBe('string');
            expect(fs.existsSync((artifactPaths as { baselineReportPath: string }).baselineReportPath)).toBe(true);
            expect(fs.existsSync((artifactPaths as { candidateReportPath: string }).candidateReportPath)).toBe(true);
            expect(
                fs.existsSync(
                    (artifactPaths as { comparisonArtifactPaths: { jsonPath: string } }).comparisonArtifactPaths
                        .jsonPath
                )
            ).toBe(true);

            const baselineReport = JSON.parse(
                fs.readFileSync((artifactPaths as { baselineReportPath: string }).baselineReportPath, 'utf-8')
            );
            const candidateReport = JSON.parse(
                fs.readFileSync((artifactPaths as { candidateReportPath: string }).candidateReportPath, 'utf-8')
            );

            expect(baselineReport.results[0].filesAnalyzed).toBe(3);
            expect(candidateReport.results[0].filesAnalyzed).toBe(3);
        } finally {
            fs.rmSync(tempDir, { force: true, recursive: true });
        }
    });

    test('compares candidate-only execution against a main baseline report when present', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-ecosystem-candidate-main-'));
        const projectRoot = tempDir;
        const projectDir = path.join(projectRoot, 'black');
        const outputDir = path.join(tempDir, 'artifacts');
        const candidateScriptPath = path.join(tempDir, 'candidate-pyright.js');
        const mainBaselineReportPath = path.join(tempDir, 'baselines', 'ecosystem-smoke-main.json');

        try {
            fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
            fs.mkdirSync(path.dirname(mainBaselineReportPath), { recursive: true });
            fs.writeFileSync(path.join(projectDir, 'src', 'sample.py'), 'x = 1\n', 'utf-8');
            fs.writeFileSync(
                candidateScriptPath,
                createFakePyrightScript({ errorCount: 0, warningCount: 1, informationCount: 0 }),
                'utf-8'
            );
            fs.writeFileSync(
                mainBaselineReportPath,
                JSON.stringify(
                    createEcosystemBenchmarkReport('2026-05-07T00:00:00.000Z', [
                        { projectName: 'black', diagnosticCount: 0, warningCount: 0 },
                    ]),
                    undefined,
                    2
                ),
                'utf-8'
            );

            const artifactPaths = runEcosystemBenchmark([
                '--suite',
                'smoke',
                '--tag',
                'parser-heavy',
                '--project-root',
                projectRoot,
                '--candidate-executable',
                `"${process.execPath}" "${candidateScriptPath}"`,
                '--main-baseline-report',
                mainBaselineReportPath,
                '--output',
                outputDir,
            ]);

            expect(typeof artifactPaths).not.toBe('string');
            expect((artifactPaths as { baselineReportPath?: string }).baselineReportPath).toBeUndefined();
            expect(
                fs.existsSync(
                    (artifactPaths as { comparisonArtifactPaths: { jsonPath: string } }).comparisonArtifactPaths
                        .jsonPath
                )
            ).toBe(true);
        } finally {
            fs.rmSync(tempDir, { force: true, recursive: true });
        }
    });

    test('copies execution baseline report into the main baseline path', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-ecosystem-main-baseline-'));
        const projectRoot = tempDir;
        const projectDir = path.join(projectRoot, 'black');
        const outputDir = path.join(tempDir, 'artifacts');
        const baselineScriptPath = path.join(tempDir, 'baseline-pyright.js');
        const mainBaselineReportPath = path.join(tempDir, 'baselines', 'ecosystem-smoke-main.json');

        try {
            fs.mkdirSync(path.join(projectDir, 'src'), { recursive: true });
            fs.writeFileSync(path.join(projectDir, 'src', 'sample.py'), 'x = 1\n', 'utf-8');
            fs.writeFileSync(
                baselineScriptPath,
                createFakePyrightScript({ errorCount: 0, warningCount: 0, informationCount: 0 }),
                'utf-8'
            );

            const artifactPaths = runEcosystemBenchmark([
                '--suite',
                'smoke',
                '--tag',
                'parser-heavy',
                '--project-root',
                projectRoot,
                '--project-date',
                '2026-01-01',
                '--baseline-executable',
                `"${process.execPath}" "${baselineScriptPath}"`,
                '--update-main-baseline',
                '--main-baseline-report',
                mainBaselineReportPath,
                '--baseline-source-commit',
                'abc123',
                '--output',
                outputDir,
            ]);

            expect(typeof artifactPaths).not.toBe('string');
            expect(fs.existsSync(mainBaselineReportPath)).toBe(true);
            expect(JSON.parse(fs.readFileSync(mainBaselineReportPath, 'utf-8')).results[0].projectName).toBe('black');
            expect(JSON.parse(fs.readFileSync(mainBaselineReportPath, 'utf-8')).mainBaseline.sourceCommit).toBe(
                'abc123'
            );
            expect(JSON.parse(fs.readFileSync(mainBaselineReportPath, 'utf-8')).mainBaseline.projectDate).toBe(
                '2026-01-01'
            );
            expect(JSON.parse(fs.readFileSync(mainBaselineReportPath, 'utf-8')).mainBaseline.configMode).toBe(
                'generated-benchmark-config'
            );
        } finally {
            fs.rmSync(tempDir, { force: true, recursive: true });
        }
    });

    test('copies a report to a main baseline path', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-ecosystem-copy-baseline-'));
        const sourceReportPath = path.join(tempDir, 'baseline-report.json');
        const mainBaselineReportPath = path.join(tempDir, 'nested', 'ecosystem-smoke-main.json');

        try {
            fs.writeFileSync(sourceReportPath, '{"results":[]}', 'utf-8');

            expect(writeMainBaselineReport(sourceReportPath, mainBaselineReportPath)).toBe(mainBaselineReportPath);
            expect(fs.readFileSync(mainBaselineReportPath, 'utf-8')).toBe('{"results":[]}');
        } finally {
            fs.rmSync(tempDir, { force: true, recursive: true });
        }
    });

    test('stamps copied main baseline metadata', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-ecosystem-stamp-baseline-'));
        const sourceReportPath = path.join(tempDir, 'baseline-report.json');
        const mainBaselineReportPath = path.join(tempDir, 'nested', 'ecosystem-smoke-main.json');

        try {
            fs.writeFileSync(sourceReportPath, '{"results":[]}', 'utf-8');

            writeMainBaselineReport(sourceReportPath, mainBaselineReportPath, {
                sourceCommit: 'abc123',
                projectDate: '2026-01-01',
                configMode: 'generated-benchmark-config',
                refreshedAt: '2026-05-08T00:00:00.000Z',
            });

            expect(JSON.parse(fs.readFileSync(mainBaselineReportPath, 'utf-8'))).toEqual({
                results: [],
                mainBaseline: {
                    sourceCommit: 'abc123',
                    projectDate: '2026-01-01',
                    configMode: 'generated-benchmark-config',
                    refreshedAt: '2026-05-08T00:00:00.000Z',
                },
            });
        } finally {
            fs.rmSync(tempDir, { force: true, recursive: true });
        }
    });

    test('writes comparison artifacts from ecosystem benchmark reports', () => {
        const reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-ecosystem-report-'));
        const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-ecosystem-compare-'));

        try {
            const baselinePath = path.join(reportsDir, 'old.json');
            const candidatePath = path.join(reportsDir, 'new.json');

            fs.writeFileSync(
                baselinePath,
                JSON.stringify(
                    createEcosystemBenchmarkReport('2026-05-07T00:00:00.000Z', [
                        { projectName: 'black', totalTimeMs: 100, maxMemoryMB: 250 },
                    ]),
                    undefined,
                    2
                ),
                'utf-8'
            );
            fs.writeFileSync(
                candidatePath,
                JSON.stringify(
                    createEcosystemBenchmarkReport('2026-05-07T01:00:00.000Z', [
                        { projectName: 'black', totalTimeMs: 120, maxMemoryMB: 260 },
                    ]),
                    undefined,
                    2
                ),
                'utf-8'
            );

            const artifactPaths = compareEcosystemBenchmarkReports(baselinePath, candidatePath, outputDir);

            expect(JSON.parse(fs.readFileSync(artifactPaths.jsonPath, 'utf-8')).compared[0].key).toBe('black');
            expect(fs.readFileSync(artifactPaths.markdownPath, 'utf-8')).toContain('Largest Regressions');
            expect(JSON.parse(fs.readFileSync(artifactPaths.oldJsonPath, 'utf-8')).results[0].projectName).toBe(
                'black'
            );
        } finally {
            fs.rmSync(reportsDir, { force: true, recursive: true });
            fs.rmSync(outputDir, { force: true, recursive: true });
        }
    });

    test('compares ecosystem diagnostic metrics when reports include them', () => {
        const reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-ecosystem-diagnostics-'));
        const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-ecosystem-diagnostics-compare-'));

        try {
            const baselinePath = path.join(reportsDir, 'old.json');
            const candidatePath = path.join(reportsDir, 'new.json');

            fs.writeFileSync(
                baselinePath,
                JSON.stringify(
                    createEcosystemBenchmarkReport('2026-05-07T00:00:00.000Z', [
                        {
                            projectName: 'black',
                            diagnosticCount: 1,
                            errorCount: 1,
                            warningCount: 0,
                            diagnostics: [{ file: 'src/a.py', severity: 'error', message: 'old diagnostic' }],
                        },
                    ]),
                    undefined,
                    2
                ),
                'utf-8'
            );
            fs.writeFileSync(
                candidatePath,
                JSON.stringify(
                    createEcosystemBenchmarkReport('2026-05-07T01:00:00.000Z', [
                        {
                            projectName: 'black',
                            diagnosticCount: 2,
                            errorCount: 1,
                            warningCount: 1,
                            diagnostics: [
                                { file: 'src/a.py', severity: 'error', message: 'old diagnostic' },
                                { file: 'src/b.py', severity: 'warning', message: 'new diagnostic' },
                            ],
                        },
                    ]),
                    undefined,
                    2
                ),
                'utf-8'
            );

            const artifactPaths = compareEcosystemBenchmarkReports(baselinePath, candidatePath, outputDir);
            const comparison = JSON.parse(fs.readFileSync(artifactPaths.jsonPath, 'utf-8'));

            expect(comparison.compared[0].metrics.map((metric: { metric: string }) => metric.metric)).toEqual([
                'diagnosticCount',
                'errorCount',
                'warningCount',
            ]);
            expect(comparison.diagnosticDiffs).toEqual([
                {
                    projectName: 'black',
                    added: ['warning | src/b.py | new diagnostic'],
                    removed: [],
                },
            ]);
            expect(fs.readFileSync(artifactPaths.markdownPath, 'utf-8')).toContain('diagnosticCount');
            expect(fs.readFileSync(artifactPaths.markdownPath, 'utf-8')).toContain('## Diagnostic Diffs');
        } finally {
            fs.rmSync(reportsDir, { force: true, recursive: true });
            fs.rmSync(outputDir, { force: true, recursive: true });
        }
    });

    test('builds diagnostic diffs from report data', () => {
        const comparison = compareEcosystemBenchmarkReportData(
            createEcosystemBenchmarkReport('2026-05-07T00:00:00.000Z', [
                {
                    projectName: 'black',
                    diagnostics: [
                        { file: 'src/a.py', severity: 'error', message: 'old diagnostic' },
                        { file: 'src/stable.py', severity: 'warning', message: 'stable diagnostic' },
                    ],
                },
            ]),
            createEcosystemBenchmarkReport('2026-05-07T01:00:00.000Z', [
                {
                    projectName: 'black',
                    diagnostics: [
                        { file: 'src/b.py', severity: 'information', message: 'new diagnostic' },
                        { file: 'src/stable.py', severity: 'warning', message: 'stable diagnostic' },
                    ],
                },
            ])
        );

        expect(comparison.diagnosticDiffs).toEqual([
            {
                projectName: 'black',
                added: ['information | src/b.py | new diagnostic'],
                removed: ['error | src/a.py | old diagnostic'],
            },
        ]);
    });

    test('runs comparison mode end to end', () => {
        const reportsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-ecosystem-report-main-'));
        const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-ecosystem-compare-main-'));

        try {
            const baselinePath = path.join(reportsDir, 'old.json');
            const candidatePath = path.join(reportsDir, 'new.json');

            fs.writeFileSync(
                baselinePath,
                JSON.stringify(
                    createEcosystemBenchmarkReport('2026-05-07T00:00:00.000Z', [
                        { projectName: 'black', totalTimeMs: 100 },
                    ]),
                    undefined,
                    2
                ),
                'utf-8'
            );
            fs.writeFileSync(
                candidatePath,
                JSON.stringify(
                    createEcosystemBenchmarkReport('2026-05-07T01:00:00.000Z', [
                        { projectName: 'black', totalTimeMs: 95 },
                    ]),
                    undefined,
                    2
                ),
                'utf-8'
            );

            const artifactPaths = runEcosystemBenchmark([
                '--baseline-report',
                baselinePath,
                '--candidate-report',
                candidatePath,
                '--output',
                outputDir,
            ]);

            expect(typeof artifactPaths).not.toBe('string');
            expect(fs.existsSync((artifactPaths as { jsonPath: string }).jsonPath)).toBe(true);
        } finally {
            fs.rmSync(reportsDir, { force: true, recursive: true });
            fs.rmSync(outputDir, { force: true, recursive: true });
        }
    });
});

function createEcosystemBenchmarkReport(
    timestamp: string,
    results: EcosystemBenchmarkResult[]
): BenchmarkReport<EcosystemBenchmarkResult> {
    return {
        schemaVersion: benchmarkReportSchemaVersion,
        suiteName: 'ecosystem-smoke',
        timestamp,
        system: {
            platform: 'win32',
            arch: 'x64',
            cpus: 'test-cpu',
            cpuCount: 8,
            totalMemoryMB: 16384,
            nodeVersion: process.version,
        },
        config: {
            warmupIterations: 0,
            benchmarkIterations: 1,
        },
        results,
    };
}

function createGeneratedProject(overrides: Partial<GeneratedEcosystemProject> = {}): GeneratedEcosystemProject {
    return {
        name: 'black',
        mypyPrimerProject: 'black',
        source: { kind: 'mypy-primer' },
        ...overrides,
    };
}

function runGit(args: readonly string[], cwd: string, env: NodeJS.ProcessEnv = {}): string {
    const result = spawnSync('git', args, {
        cwd,
        encoding: 'utf-8',
        env: { ...process.env, ...env },
    });

    if (result.error) {
        throw result.error;
    }

    if (result.status !== 0) {
        throw new Error(
            `git ${args.join(' ')} failed with ${result.status ?? 'unknown'}\n${result.stderr}\n${result.stdout}`
        );
    }

    return result.stdout.trim();
}

function createFakePyrightScript(counts: {
    errorCount: number;
    warningCount: number;
    informationCount: number;
}): string {
    const diagnosticEntries = [
        ...Array.from({ length: counts.errorCount }, () => '{ severity: "error" }'),
        ...Array.from({ length: counts.warningCount }, () => '{ severity: "warning" }'),
        ...Array.from({ length: counts.informationCount }, () => '{ severity: "information" }'),
    ].join(', ');

    return [
        'const result = {',
        `  generalDiagnostics: [${diagnosticEntries}],`,
        '  summary: {',
        '    filesAnalyzed: 3,',
        `    errorCount: ${counts.errorCount},`,
        `    warningCount: ${counts.warningCount},`,
        `    informationCount: ${counts.informationCount},`,
        '    timeInSec: 0.25',
        '  }',
        '};',
        'console.log(JSON.stringify(result));',
    ].join('\n');
}
