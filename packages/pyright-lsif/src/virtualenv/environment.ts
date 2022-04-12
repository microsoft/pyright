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

export default function getEnvironment(projectVersion: string): PythonEnvironment {
    let listed = pipList();
    let bulk = pipBulkShow(listed.map((item) => item.name));
    let info = bulk.map((shown) => PythonPackage.fromPipShow(shown));

    return new PythonEnvironment(projectVersion, info);
}
