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
        } finally {
            fs.rmSync(tempDir, { force: true, recursive: true });
        }
    });
});
