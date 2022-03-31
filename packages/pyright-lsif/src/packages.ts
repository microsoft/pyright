import * as path from 'path';
import * as child_process from 'child_process';

export interface PipInformation {
    name: string;
    version: string;
}

let validExtensions = new Set(['.py', '.pyi']);

export class PackageInformation {
    private constructor(public name: string, public version: string, public files: string[]) {}

    static fromPipShow(output: string): PackageInformation {
        let name = '';
        let version = '';
        let files: string[] = [];

        let gettingFiles = false;
        for (let line of output.split('\n')) {
            line = line.trim();
            if (!line) {
                continue;
            }

            let split = line.split(':', 2).map((x) => x.trim());
            if (split.length == 2) {
                switch (split[0]) {
                    case 'Name':
                        name = split[1];
                        break;
                    case 'Version':
                        version = split[1];
                    case 'Files':
                        gettingFiles = true;
                }
            } else {
                if (!gettingFiles) {
                    throw 'Unexpected. Thought I should be getting files now';
                }

                // Skip cached or out of project rfiles
                if (line.startsWith('..') || line.includes('__pycache__')) {
                    continue;
                }

                // Only include extensions that we care about
                if (!validExtensions.has(path.extname(line))) {
                    continue;
                }

                files.push(line);
            }
        }

        return new PackageInformation(name, version, files);
    }
}

export function pipList(): PipInformation[] {
    const pipListJson = JSON.parse(child_process.execSync('pip list --format=json').toString()) as PipInformation[];
    return pipListJson;
}

export function pipShow(name: string): string {
    return child_process.execSync(`pip show -f ${name}`).toString();
}

function pipBulkShow(names: string[]): string[] {
    // TODO: This probably breaks with enough names. Should batch them into 512 or whatever the max for bash would be
    return child_process
        .execSync(`pip show -f ${names.join(' ')}`)
        .toString()
        .split('---');
}

export class ProjectEnvironment {
    constructor(public packages: PackageInformation[]) {
    }

    public getPackageForFile(filepath: string): PackageInformation | undefined {
        return undefined;
    }
}

export function getEnvironmentPackages(): ProjectEnvironment {
    let listed = pipList();
    let bulk = pipBulkShow(listed.map((item) => item.name));
    let info = bulk.map((shown) => PackageInformation.fromPipShow(shown));

    return new ProjectEnvironment(info);
}
