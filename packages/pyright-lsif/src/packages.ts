import * as path from 'path';
import * as child_process from 'child_process';
import { Program } from 'pyright-internal/analyzer/program';

export interface PipInformation {
    name: string;
    version: string;
}

let validExtensions = new Set(['.py', '.pyi']);

export class PackageInformation {
    constructor(public name: string, public version: string, public files: string[]) {}

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

export class PackageConfig {
    /// Maps a module name (x.y.z) to an index in this.packages
    private _moduleNameToIndex: Map<string, number>;
    private _filepathToIndex: Map<string, number>;
    private _cwd: string;

    constructor(private projectVersion: string, private program: Program, public packages: PackageInformation[]) {
        this._cwd = process.cwd();
        this._moduleNameToIndex = new Map();
        this._filepathToIndex = new Map();

        for (let index = 0; index < packages.length; index++) {
            const p = packages[index];
            for (const filepath of p.files) {
                this._filepathToIndex.set(filepath, index);
            }
        }
    }

    private _isThirdPartyFilepath(filepath: string): boolean {
        let sourceFile = this.program.getSourceFile(filepath);
        return !!sourceFile && sourceFile!.isThirdPartyImport();
    }

    public getPackageForModule(filepath: string, moduleName: string): PackageInformation | undefined {
        let sourcefile = this.program.getSourceFile(filepath)!;
        console.log(filepath, moduleName, '->', sourcefile.getFilePath(), sourcefile.isThirdPartyImport());
        if (!sourcefile.isThirdPartyImport()) {
            // packageSymbol = LsifSymbol.global(
            //     LsifSymbol.package(moduleName, visitor.config.lsifConfig.projectVersion),
            //     packageDescriptor(moduleName)
            // );
            return new PackageInformation('', this.projectVersion, []);
        }

        let packageIndex = this._moduleNameToIndex.get(moduleName);
        if (!packageIndex) {
            const moduleNameWithInit = moduleName + '.__init__';

            // TODO: This should be formalized much better and I would think this
            // could benefit a lot from some unit tests :) but we'll come back to
            // this and see if there is anything in pyright that could do this
            // for us.
            for (let index = 0; index < this.packages.length; index++) {
                const p = this.packages[index];
                for (let file of p.files) {
                    let normalized = file.slice(0, file.length - path.extname(file).length).replace(path.sep, '.');

                    if (normalized === moduleName || normalized === moduleNameWithInit) {
                        packageIndex = index;
                        break;
                    }
                }

                if (packageIndex) {
                    break;
                }
            }

            if (!packageIndex) {
                packageIndex = -1;
            }

            this._moduleNameToIndex.set(moduleName, packageIndex);
        }

        if (packageIndex === -1) {
            return undefined;
        }

        return this.packages[packageIndex];
    }

    public getPackageForFile(filepath: string): PackageInformation | undefined {
        if (this._isThirdPartyFilepath(filepath)) {
            // return { name: '', version: this.projectVersion };
            console.log('OK OK');
            return new PackageInformation('', this.projectVersion, []);
        }

        let index = this._filepathToIndex.get(filepath);
        if (!index) {
            return undefined;
        }

        return this.packages[index];
    }
}

export function getEnvironmentPackages(projectVersion: string, program: Program): PackageConfig {
    let listed = pipList();
    let bulk = pipBulkShow(listed.map((item) => item.name));
    let info = bulk.map((shown) => PackageInformation.fromPipShow(shown));

    return new PackageConfig(projectVersion, program, info);
}
