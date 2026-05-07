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

export const ecosystemSmokeProjects: readonly EcosystemSmokeProject[] = [
    {
        name: 'black',
        mypyPrimerProject: 'black',
        cost: 'medium',
        tags: ['parser-heavy', 'typed-library'],
        reason: 'Parser-heavy practical codebase with broad syntax coverage.',
    },
    {
        name: 'pytest',
        mypyPrimerProject: 'pytest',
        cost: 'large',
        tags: ['dynamic', 'plugins', 'typed-library'],
        reason: 'Large dynamic project with plugin patterns and pragmatic typing.',
    },
    {
        name: 'attrs',
        mypyPrimerProject: 'attrs',
        cost: 'small',
        tags: ['dataclass-like', 'decorators', 'typed-library'],
        reason: 'Dataclass-like decorator patterns with stable runtime.',
    },
    {
        name: 'pydantic',
        mypyPrimerProject: 'pydantic',
        cost: 'medium',
        tags: ['decorators', 'generics', 'pydantic', 'typed-library'],
        reason: 'Decorator-heavy validation models with generics and dataclass-like transforms.',
    },
    {
        name: 'python-chess',
        mypyPrimerProject: 'python-chess',
        cost: 'small',
        tags: ['typed-library'],
        reason: 'Clean typed library with a useful expected-success signal.',
    },
    {
        name: 'packaging',
        mypyPrimerProject: 'packaging',
        cost: 'small',
        tags: ['typed-library'],
        reason: 'Small stable baseline project for low-noise smoke runs.',
    },
    {
        name: 'rich',
        mypyPrimerProject: 'rich',
        cost: 'medium',
        tags: ['typed-library'],
        reason: 'Practical typed library with meaningful module structure.',
    },
    {
        name: 'mypy_primer',
        mypyPrimerProject: 'mypy_primer',
        cost: 'small',
        tags: ['typed-library'],
        reason: 'Typed tool codebase that anchors compatibility with the source project manifest.',
    },
    {
        name: 'django-modern-rest',
        mypyPrimerProject: 'django-modern-rest',
        cost: 'medium',
        tags: ['django', 'pydantic', 'web'],
        reason: 'Web project with Django-style and pydantic-style patterns.',
    },
    {
        name: 'pandas',
        mypyPrimerProject: 'pandas',
        cost: 'large',
        tags: ['data-science', 'large', 'overloads', 'stubs-heavy'],
        reason: 'Data-science project that stresses overloads, stubs, and large-project behavior.',
    },
];

export function getEcosystemSmokeProjectNames(): string[] {
    return ecosystemSmokeProjects.map((project) => project.name);
}

export function getEcosystemSmokeProjectsByTag(tag: EcosystemProjectTag): EcosystemSmokeProject[] {
    return ecosystemSmokeProjects.filter((project) => project.tags.includes(tag));
}

export function getEcosystemSmokeProjectTags(): EcosystemProjectTag[] {
    return Array.from(new Set(ecosystemSmokeProjects.flatMap((project) => project.tags))).sort();
}
