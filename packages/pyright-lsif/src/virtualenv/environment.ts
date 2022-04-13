import * as fs from 'fs';
import * as child_process from 'child_process';
import PythonPackage from './PythonPackage';
import PythonEnvironment from './PythonEnvironment';

// Some future improvements:
//  - Could use `importlib` and execute some stuff from Python

interface PipInformation {
    name: string;
    version: string;
}

function pipList(): PipInformation[] {
    return JSON.parse(child_process.execSync('pip list --format=json').toString()) as PipInformation[];
}

function pipBulkShow(names: string[]): string[] {
    // TODO: This probably breaks with enough names. Should batch them into 512 or whatever the max for bash would be
    return child_process
        .execSync(`pip show -f ${names.join(' ')}`)
        .toString()
        .split('---');
}

export default function getEnvironment(projectVersion: string, cachedEnvFile: string | undefined): PythonEnvironment {
    if (cachedEnvFile) {
        let f = JSON.parse(fs.readFileSync(cachedEnvFile).toString()).map((entry: any) => {
          return new PythonPackage(entry.name, entry.version, entry.files);
        });

        return new PythonEnvironment(projectVersion, f);
    }

    const listed = pipList();
    const bulk = pipBulkShow(listed.map((item) => item.name));
    const info = bulk.map((shown) => PythonPackage.fromPipShow(shown));

    return new PythonEnvironment(projectVersion, info);
}
