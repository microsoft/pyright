/*
 * syncMypyPrimerProjects.test.ts
 * Copyright (c) Microsoft Corporation.
 *
 * Tests for the mypy_primer project sync scaffold.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
    getBenchmarkSourceDirectory,
    getDefaultMypyPrimerProjectSourcePath,
    parseMypyPrimerProjectSource,
    syncMypyPrimerProjects,
    writeGeneratedEcosystemProjects,
} from './syncMypyPrimerProjects';

const RUN_BENCHMARKS_ENV = 'PYRIGHT_RUN_BENCHMARKS';

const benchmarkSuite = process.env[RUN_BENCHMARKS_ENV] === '1' ? describe : describe.skip;

benchmarkSuite('Sync Mypy Primer Projects', () => {
    test('parses project blocks from mypy_primer source', () => {
        const projects = parseMypyPrimerProjectSource(
            [
                'Project(',
                '    location="https://github.com/psf/black",',
                '    pyright_cmd="{pyright} {paths}",',
                '    paths=["src"],',
                ')',
                '',
                'Project(',
                '    location="https://github.com/pydantic/pydantic",',
                '    pyright_cmd="{pyright} {paths}",',
                '    paths=["pydantic", "tests"],',
                ')',
            ].join('\n'),
            'projects.py'
        );

        expect(projects).toEqual([
            {
                name: 'black',
                mypyPrimerProject: 'black',
                source: { kind: 'mypy-primer', inputFile: 'projects.py' },
                location: 'https://github.com/psf/black',
                pyrightCommand: '{pyright} {paths}',
                paths: ['src'],
            },
            {
                name: 'pydantic',
                mypyPrimerProject: 'pydantic',
                source: { kind: 'mypy-primer', inputFile: 'projects.py' },
                location: 'https://github.com/pydantic/pydantic',
                pyrightCommand: '{pyright} {paths}',
                paths: ['pydantic', 'tests'],
            },
        ]);
    });

    test('parses upstream metadata and filters pyright-disabled projects', () => {
        const projects = parseMypyPrimerProjectSource(
            [
                'Project(',
                '    location="https://github.com/example/project",',
                '    name_override="example-project",',
                '    pyright_cmd="{pyright} {paths}",',
                '    paths=["src"],',
                '    deps=["types-requests"],',
                '    install_cmd="python -m pip install -e .",',
                '    platforms=["linux", "darwin"],',
                '    cost=2.5,',
                ')',
                '',
                'Project(',
                '    location="https://github.com/example/project",',
                '    pyright_cmd="{pyright} {paths}",',
                '    paths=["lib"],',
                ')',
                '',
                'Project(',
                '    location="https://github.com/example/skip-me",',
                '    pyright_cmd=None,',
                ')',
            ].join('\n'),
            'projects.py'
        );

        expect(projects).toEqual([
            {
                name: 'example-project',
                mypyPrimerProject: 'project',
                source: { kind: 'mypy-primer', inputFile: 'projects.py' },
                location: 'https://github.com/example/project',
                pyrightCommand: '{pyright} {paths}',
                paths: ['src'],
                dependencies: ['types-requests'],
                installCommand: 'python -m pip install -e .',
                supportedPlatforms: ['linux', 'darwin'],
                cost: 2.5,
            },
            {
                name: 'project',
                mypyPrimerProject: 'project',
                source: { kind: 'mypy-primer', inputFile: 'projects.py' },
                location: 'https://github.com/example/project',
                pyrightCommand: '{pyright} {paths}',
                paths: ['lib'],
            },
        ]);
    });

    test('deduplicates project names derived from repeated locations', () => {
        const projects = parseMypyPrimerProjectSource(
            [
                'Project(location="https://github.com/example/project", pyright_cmd="{pyright}")',
                'Project(location="https://github.com/example/project", pyright_cmd="{pyright}")',
            ].join('\n'),
            'projects.py'
        );

        expect(projects.map((project) => project.name)).toEqual(['project', 'project-2']);
    });

    test('writes generated ecosystem projects', () => {
        const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-mypy-primer-sync-'));
        const outputPath = path.join(outputDir, 'ecosystem-projects.generated.json');

        try {
            writeGeneratedEcosystemProjects(outputPath, [
                {
                    name: 'black',
                    mypyPrimerProject: 'black',
                    source: { kind: 'manual-snapshot' },
                },
            ]);

            expect(JSON.parse(fs.readFileSync(outputPath, 'utf-8'))).toEqual([
                {
                    name: 'black',
                    mypyPrimerProject: 'black',
                    source: { kind: 'manual-snapshot' },
                },
            ]);
        } finally {
            fs.rmSync(outputDir, { force: true, recursive: true });
        }
    });

    test('syncs project definitions from an input file', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-mypy-primer-cli-'));
        const inputPath = path.join(tempDir, 'projects.py');
        const outputPath = path.join(tempDir, 'ecosystem-projects.generated.json');

        try {
            fs.writeFileSync(
                inputPath,
                [
                    'Project(',
                    '    location="https://github.com/psf/black",',
                    '    pyright_cmd="{pyright} {paths}",',
                    '    paths=["src"],',
                    ')',
                ].join('\n'),
                'utf-8'
            );

            const writtenPath = syncMypyPrimerProjects(['--input', inputPath, '--output', outputPath]);

            expect(writtenPath).toBe(outputPath);
            expect(JSON.parse(fs.readFileSync(outputPath, 'utf-8'))[0].name).toBe('black');
            expect(path.isAbsolute(JSON.parse(fs.readFileSync(outputPath, 'utf-8'))[0].source.inputFile)).toBe(false);
        } finally {
            fs.rmSync(tempDir, { force: true, recursive: true });
        }
    });

    test('stores checked-in snapshot input paths relative to the benchmark source directory', () => {
        const projects = parseMypyPrimerProjectSource(
            [
                'Project(',
                '    location="https://github.com/psf/black",',
                '    pyright_cmd="{pyright} {paths}",',
                '    paths=["src"],',
                ')',
            ].join('\n'),
            path.join(getBenchmarkSourceDirectory(), 'mypy_primer.smoke_projects.snapshot.py')
        );

        expect(projects[0].source.inputFile).toBe('mypy_primer.smoke_projects.snapshot.py');
    });

    test('defaults to the checked-in smoke snapshot and creates the output directory', () => {
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pyright-mypy-primer-default-'));
        const outputPath = path.join(tempDir, 'nested', 'ecosystem-projects.generated.json');

        try {
            const writtenPath = syncMypyPrimerProjects(['--output', outputPath]);
            const projects = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));

            expect(writtenPath).toBe(outputPath);
            expect(fs.existsSync(getDefaultMypyPrimerProjectSourcePath())).toBe(true);
            expect(projects).toHaveLength(10);
            expect(
                projects.every(
                    (project: { source: { inputFile?: string } }) => !path.isAbsolute(project.source.inputFile ?? '')
                )
            ).toBe(true);
            expect(projects.find((project: { name: string }) => project.name === 'black')).toMatchObject({
                pyrightCommand: '{pyright} {paths}',
                paths: ['src'],
            });
            expect(projects.find((project: { name: string }) => project.name === 'django-modern-rest')).toMatchObject({
                pyrightCommand: '{pyright}',
                paths: ['dmr'],
            });
        } finally {
            fs.rmSync(tempDir, { force: true, recursive: true });
        }
    });
});
