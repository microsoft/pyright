import commandLineArgs, { CommandLineOptions, OptionDefinition } from 'command-line-args';
import * as fs from 'fs';
import * as path from 'path';

export interface GeneratedEcosystemProject {
    name: string;
    mypyPrimerProject: string;
    source: {
        kind: 'manual-snapshot' | 'mypy-primer';
        inputFile?: string;
    };
    location?: string;
    pyrightCommand?: string;
    paths?: string[];
    dependencies?: string[];
    installCommand?: string;
    supportedPlatforms?: string[];
    cost?: number;
}

const optionDefinitions: OptionDefinition[] = [
    { name: 'input', type: String },
    { name: 'output', type: String },
];

const defaultMypyPrimerProjectSourcePath = getBenchmarkFilePath('mypy_primer.smoke_projects.snapshot.py');

export function parseMypyPrimerProjectSource(sourceText: string, inputFile?: string): GeneratedEcosystemProject[] {
    const blocks = extractProjectBlocks(sourceText);

    return ensureUniqueProjectNames(
        blocks.flatMap((block) => {
            const project = parseProjectBlock(block, inputFile);
            return project ? [project] : [];
        })
    ).sort((left, right) => left.name.localeCompare(right.name));
}

export function writeGeneratedEcosystemProjects(
    outputPath: string,
    projects: readonly GeneratedEcosystemProject[]
): void {
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(projects, undefined, 2)}\n`, 'utf-8');
}

export function syncMypyPrimerProjects(args: string[]): string {
    const parsedArgs = commandLineArgs(optionDefinitions, { argv: args }) as CommandLineOptions;
    const inputPath = (parsedArgs.input as string | undefined) ?? defaultMypyPrimerProjectSourcePath;
    const outputPath =
        (parsedArgs.output as string | undefined) ?? getWritableBenchmarkFilePath('ecosystem-projects.generated.json');

    const sourceText = fs.readFileSync(inputPath, 'utf-8');
    const projects = parseMypyPrimerProjectSource(sourceText, inputPath);
    writeGeneratedEcosystemProjects(outputPath, projects);
    console.log(`Wrote ${projects.length} ecosystem project definitions to ${outputPath}`);

    return outputPath;
}

export function getBenchmarkSourceDirectory(): string {
    return path.dirname(getWritableBenchmarkFilePath('ecosystem-projects.generated.json'));
}

export function getDefaultMypyPrimerProjectSourcePath(): string {
    return defaultMypyPrimerProjectSourcePath;
}

function getBenchmarkFilePath(filename: string): string {
    const sourceFilePath = path.resolve(__dirname, filename);
    if (fs.existsSync(sourceFilePath)) {
        return sourceFilePath;
    }

    return path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'src', 'tests', 'benchmarks', filename);
}

function getWritableBenchmarkFilePath(filename: string): string {
    const sourceFilePath = path.resolve(__dirname, filename);
    if (!sourceFilePath.includes(`${path.sep}out${path.sep}`)) {
        return sourceFilePath;
    }

    return path.resolve(__dirname, '..', '..', '..', '..', '..', '..', 'src', 'tests', 'benchmarks', filename);
}

function extractProjectBlocks(sourceText: string): string[] {
    const blocks: string[] = [];
    let startIndex = sourceText.indexOf('Project(');

    while (startIndex >= 0) {
        let depth = 0;
        let inString = false;
        let stringQuote = '';
        let previousChar = '';

        for (let index = startIndex; index < sourceText.length; index++) {
            const currentChar = sourceText[index];

            if (inString) {
                if (currentChar === stringQuote && previousChar !== '\\') {
                    inString = false;
                    stringQuote = '';
                }
            } else if (currentChar === '"' || currentChar === "'") {
                inString = true;
                stringQuote = currentChar;
            } else if (currentChar === '(') {
                depth += 1;
            } else if (currentChar === ')') {
                depth -= 1;
                if (depth === 0) {
                    blocks.push(sourceText.slice(startIndex, index + 1));
                    startIndex = sourceText.indexOf('Project(', index + 1);
                    break;
                }
            }

            previousChar = currentChar;
        }

        if (depth !== 0) {
            throw new Error('Failed to parse mypy_primer project definitions.');
        }
    }

    return blocks;
}

function parseProjectBlock(block: string, inputFile?: string): GeneratedEcosystemProject | undefined {
    const location = matchSingleQuotedOrDoubleQuotedValue(block, 'location');
    if (matchNoneValue(block, 'pyright_cmd')) {
        return undefined;
    }

    const pyrightCommand = matchSingleQuotedOrDoubleQuotedValue(block, 'pyright_cmd');
    const paths = matchStringArrayValue(block, 'paths');
    const dependencies = matchStringArrayValue(block, 'deps');
    const installCommand = matchSingleQuotedOrDoubleQuotedValue(block, 'install_cmd');
    const supportedPlatforms = matchStringArrayValue(block, 'platforms');
    const cost = matchNumberValue(block, 'cost');
    const nameOverride = matchSingleQuotedOrDoubleQuotedValue(block, 'name_override');
    const mypyPrimerProject = deriveProjectName(location);
    const normalizedInputFile = inputFile ? normalizeInputFileReference(inputFile) : undefined;

    return {
        name: nameOverride ?? mypyPrimerProject,
        mypyPrimerProject,
        source: {
            kind: 'mypy-primer',
            inputFile: normalizedInputFile,
        },
        location,
        pyrightCommand,
        paths,
        dependencies,
        installCommand,
        supportedPlatforms,
        cost,
    };
}

function ensureUniqueProjectNames(projects: readonly GeneratedEcosystemProject[]): GeneratedEcosystemProject[] {
    const nameCounts = new Map<string, number>();

    return projects.map((project) => {
        const count = (nameCounts.get(project.name) ?? 0) + 1;
        nameCounts.set(project.name, count);

        if (count === 1) {
            return project;
        }

        return { ...project, name: `${project.name}-${count}` };
    });
}

function normalizeInputFileReference(inputFile: string): string {
    if (!path.isAbsolute(inputFile)) {
        return inputFile.replace(/\\/g, '/');
    }

    const benchmarkRelativePath = path.relative(getBenchmarkSourceDirectory(), inputFile);
    if (!benchmarkRelativePath.startsWith('..') && !path.isAbsolute(benchmarkRelativePath)) {
        return benchmarkRelativePath.replace(/\\/g, '/');
    }

    const cwdRelativePath = path.relative(process.cwd(), inputFile);
    if (!cwdRelativePath.startsWith('..') && !path.isAbsolute(cwdRelativePath)) {
        return cwdRelativePath.replace(/\\/g, '/');
    }

    return path.basename(inputFile);
}

function deriveProjectName(location: string | undefined): string {
    if (!location) {
        throw new Error('Each mypy_primer project must define a location.');
    }

    const trimmedLocation = location.replace(/\/+$/, '');
    const slashIndex = trimmedLocation.lastIndexOf('/');
    return slashIndex >= 0 ? trimmedLocation.slice(slashIndex + 1) : trimmedLocation;
}

function matchSingleQuotedOrDoubleQuotedValue(block: string, fieldName: string): string | undefined {
    const match = block.match(new RegExp(`${fieldName}\\s*=\\s*(['\"])(.*?)\\1`, 's'));
    return match?.[2];
}

function matchNoneValue(block: string, fieldName: string): boolean {
    return new RegExp(`${fieldName}\\s*=\\s*None(,|\\s|\\))`, 's').test(block);
}

function matchNumberValue(block: string, fieldName: string): number | undefined {
    const match = block.match(new RegExp(`${fieldName}\\s*=\\s*(\\d+(?:\\.\\d+)?)`, 's'));
    return match ? Number(match[1]) : undefined;
}

function matchStringArrayValue(block: string, fieldName: string): string[] | undefined {
    const match = block.match(new RegExp(`${fieldName}\\s*=\\s*\\[(.*?)\\]`, 's'));
    if (!match) {
        return undefined;
    }

    return Array.from(match[1].matchAll(/(['\"])(.*?)\1/g)).map((entry) => entry[2]);
}

if (require.main === module) {
    syncMypyPrimerProjects(process.argv.slice(2));
}
