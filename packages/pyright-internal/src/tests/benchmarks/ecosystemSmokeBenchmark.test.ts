/*
 * ecosystemSmokeBenchmark.test.ts
 * Copyright (c) Microsoft Corporation.
 *
 * Sanity checks and artifact emission for the curated ecosystem smoke benchmark manifest.
 */

import { createBenchmarkReport, writeBenchmarkReport } from './benchmarkUtils';
import {
    ecosystemSmokeProjects,
    getEcosystemSmokeProjectNames,
    getEcosystemSmokeProjectTags,
    selectEcosystemSmokeProjects,
} from './ecosystemSmokeProjects';

const RUN_BENCHMARKS_ENV = 'PYRIGHT_RUN_BENCHMARKS';

interface EcosystemSmokeManifestResult {
    suiteName: string;
    projectCount: number;
    tags: string[];
    projects: typeof ecosystemSmokeProjects;
}

const benchmarkSuite = process.env[RUN_BENCHMARKS_ENV] === '1' ? describe : describe.skip;

benchmarkSuite('Ecosystem Smoke Manifest', () => {
    test('validates curated project metadata', () => {
        const projectNames = getEcosystemSmokeProjectNames();
        const uniqueProjectNames = new Set(projectNames);

        expect(ecosystemSmokeProjects).toHaveLength(10);
        expect(uniqueProjectNames.size).toBe(projectNames.length);
        expect(projectNames).toEqual([
            'black',
            'pytest',
            'attrs',
            'pydantic',
            'python-chess',
            'packaging',
            'rich',
            'mypy_primer',
            'django-modern-rest',
            'pandas',
        ]);

        for (const project of ecosystemSmokeProjects) {
            expect(project.mypyPrimerProject).toBeTruthy();
            expect(project.tags.length).toBeGreaterThan(0);
            expect(project.reason).toBeTruthy();
        }

        const result: EcosystemSmokeManifestResult = {
            suiteName: 'ecosystem-smoke',
            projectCount: ecosystemSmokeProjects.length,
            tags: getEcosystemSmokeProjectTags(),
            projects: ecosystemSmokeProjects,
        };

        writeBenchmarkReport(
            'ecosystem-smoke',
            'ecosystem-smoke-projects',
            createBenchmarkReport('ecosystem-smoke', 0, 0, [result])
        );
    });

    test('selects projects by tag, pattern, and shard', () => {
        expect(selectEcosystemSmokeProjects({ tag: 'overloads' }).map((project) => project.name)).toEqual(['pandas']);
        expect(
            selectEcosystemSmokeProjects({ projectPattern: /django|pandas/ }).map((project) => project.name)
        ).toEqual(['django-modern-rest', 'pandas']);

        const shard0 = selectEcosystemSmokeProjects({ numShards: 2, shardIndex: 0 }).map((project) => project.name);
        const shard1 = selectEcosystemSmokeProjects({ numShards: 2, shardIndex: 1 }).map((project) => project.name);
        const combinedShards = [...shard0, ...shard1].sort();

        expect(shard0).toEqual(['black', 'attrs', 'python-chess', 'rich', 'django-modern-rest']);
        expect(shard1).toEqual(['pytest', 'pydantic', 'packaging', 'mypy_primer', 'pandas']);
        expect(combinedShards).toEqual(getEcosystemSmokeProjectNames().sort());
        expect(() => selectEcosystemSmokeProjects({ numShards: 2, shardIndex: 2 })).toThrow('shardIndex');
    });
});
