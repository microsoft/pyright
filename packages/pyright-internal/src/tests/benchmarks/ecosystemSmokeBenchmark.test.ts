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

        writeBenchmarkReport('ecosystem-smoke', 'ecosystem-smoke-projects', createBenchmarkReport(0, 0, [result]));
    });
});
