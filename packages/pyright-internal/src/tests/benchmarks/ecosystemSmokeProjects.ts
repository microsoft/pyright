import * as fs from 'fs';
import * as path from 'path';

export type EcosystemProjectCost = 'small' | 'medium' | 'large';

export type EcosystemProjectTag =
    | 'data-science'
    | 'dataclass-like'
    | 'decorators'
    | 'django'
    | 'dynamic'
    | 'generics'
    | 'large'
    | 'overloads'
    | 'parser-heavy'
    | 'plugins'
    | 'pydantic'
    | 'stubs-heavy'
    | 'typed-library'
    | 'web';

export interface EcosystemSmokeProject {
    name: string;
    mypyPrimerProject: string;
    cost: EcosystemProjectCost;
    tags: EcosystemProjectTag[];
    reason: string;
}

export interface EcosystemSmokeProjectSelectionOptions {
    tag?: EcosystemProjectTag;
    projectPattern?: RegExp;
    numShards?: number;
    shardIndex?: number;
}

interface GeneratedEcosystemProject {
    name: string;
    mypyPrimerProject: string;
}

interface EcosystemProjectOverride {
    includeInSmoke?: boolean;
    smokeOrder?: number;
    cost?: EcosystemProjectCost;
    tags?: EcosystemProjectTag[];
    reason?: string;
}

const generatedProjects = loadGeneratedProjects();
const ecosystemProjectOverrides = loadProjectOverrides();

export const ecosystemSmokeProjects: readonly EcosystemSmokeProject[] = generatedProjects
    .map((project) => buildSmokeProject(project, ecosystemProjectOverrides[project.name]))
    .filter((project): project is EcosystemSmokeProject => project !== undefined)
    .sort((left, right) => getSmokeOrder(left.name) - getSmokeOrder(right.name));

export function getEcosystemSmokeProjectNames(): string[] {
    return ecosystemSmokeProjects.map((project) => project.name);
}

export function getEcosystemSmokeProjectsByTag(tag: EcosystemProjectTag): EcosystemSmokeProject[] {
    return ecosystemSmokeProjects.filter((project) => project.tags.includes(tag));
}

export function getEcosystemSmokeProjectTags(): EcosystemProjectTag[] {
    return Array.from(new Set(ecosystemSmokeProjects.flatMap((project) => project.tags))).sort();
}

export function selectEcosystemSmokeProjects(
    options: EcosystemSmokeProjectSelectionOptions = {}
): EcosystemSmokeProject[] {
    const { tag, projectPattern, numShards, shardIndex } = options;
    let projects = [...ecosystemSmokeProjects];

    if (tag) {
        projects = projects.filter((project) => project.tags.includes(tag));
    }

    if (projectPattern) {
        projects = projects.filter((project) => matchesProjectPattern(projectPattern, project));
    }

    if (numShards !== undefined || shardIndex !== undefined) {
        validateShardOptions(numShards, shardIndex);
        projects = projects.filter((_, index) => index % numShards! === shardIndex);
    }

    return projects;
}

function matchesProjectPattern(pattern: RegExp, project: EcosystemSmokeProject): boolean {
    pattern.lastIndex = 0;
    const matchesName = pattern.test(project.name);
    pattern.lastIndex = 0;
    const matchesMypyPrimerProject = pattern.test(project.mypyPrimerProject);
    pattern.lastIndex = 0;

    return matchesName || matchesMypyPrimerProject;
}

function validateShardOptions(numShards: number | undefined, shardIndex: number | undefined): void {
    if (numShards === undefined || shardIndex === undefined) {
        throw new Error('Both numShards and shardIndex must be provided for ecosystem smoke project sharding.');
    }

    if (!Number.isInteger(numShards) || numShards <= 0) {
        throw new Error('numShards must be a positive integer.');
    }

    if (!Number.isInteger(shardIndex) || shardIndex < 0 || shardIndex >= numShards) {
        throw new Error('shardIndex must be an integer greater than or equal to 0 and less than numShards.');
    }
}

function buildSmokeProject(
    project: GeneratedEcosystemProject,
    override: EcosystemProjectOverride | undefined
): EcosystemSmokeProject | undefined {
    if (!override?.includeInSmoke) {
        return undefined;
    }

    if (!override.cost || !override.tags || override.tags.length === 0 || !override.reason) {
        throw new Error(`Smoke project ${project.name} is missing required ecosystem metadata overrides.`);
    }

    return {
        name: project.name,
        mypyPrimerProject: project.mypyPrimerProject,
        cost: override.cost,
        tags: [...override.tags],
        reason: override.reason,
    };
}

function getSmokeOrder(projectName: string): number {
    const smokeOrder = ecosystemProjectOverrides[projectName]?.smokeOrder;
    if (smokeOrder === undefined) {
        return Number.MAX_SAFE_INTEGER;
    }

    return smokeOrder;
}

function loadGeneratedProjects(): GeneratedEcosystemProject[] {
    return readJsonFile<GeneratedEcosystemProject[]>('ecosystem-projects.generated.json');
}

function loadProjectOverrides(): Record<string, EcosystemProjectOverride> {
    return readJsonFile<Record<string, EcosystemProjectOverride>>('ecosystem-projects.overrides.json');
}

function readJsonFile<T>(filename: string): T {
    const filePath = getBenchmarkFilePath(filename);
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T;
}

function getBenchmarkFilePath(filename: string): string {
    const sourceFilePath = path.resolve(__dirname, filename);
    if (fs.existsSync(sourceFilePath)) {
        return sourceFilePath;
    }

    return path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'src', 'tests', 'benchmarks', filename);
}
