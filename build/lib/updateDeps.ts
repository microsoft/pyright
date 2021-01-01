import { exec } from 'child_process';
import fsExtra from 'fs-extra';
import glob from 'glob';
import ncu from 'npm-check-updates';
import PQueue from 'p-queue';
import path from 'path';
import util from 'util';
const asyncGlob = util.promisify(glob);
const asyncExec = util.promisify(exec);

async function findPackages() {
    const lernaFile = await fsExtra.readFile('lerna.json', 'utf-8');

    const lernaConfig: { packages: string[] } = JSON.parse(lernaFile);

    const matches = await Promise.all(lernaConfig.packages.map((pattern) => asyncGlob(pattern + '/package.json')));
    return ['package.json'].concat(...matches);
}

const queue = new PQueue({ concurrency: 4 });

async function updatePackage(packageFile: string, transitive: boolean, reject?: string[]): Promise<void> {
    packageFile = path.resolve(packageFile);
    const packagePath = path.dirname(packageFile);
    const packageName = path.basename(packagePath);

    console.log(`${packageName}: updating with ncu`);
    const updateResult = await ncu.run({
        packageFile: packageFile,
        target: 'minor',
        upgrade: true,
        reject: reject,
    });

    if (!transitive && Object.keys(updateResult).length === 0) {
        // If nothing changed and we aren't updating transitive deps, don't run npm install.
        return;
    }

    if (transitive) {
        console.log(`${packageName}: removing package-lock.json and node_modules`);
        await fsExtra.remove(path.join(packagePath, 'package-lock.json'));
        await fsExtra.remove(path.join(packagePath, 'node_modules'));
    }

    await queue.add(async () => {
        console.log(`${packageName}: reinstalling package`);
        await asyncExec('npm install', {
            cwd: packagePath,
            env: {
                ...process.env,
                SKIP_LERNA_BOOTSTRAP: 'yes',
            },
        });
    });
}

async function updateAll(transitive: boolean, reject?: string[]): Promise<void> {
    const packageFiles = await findPackages();
    await Promise.all(packageFiles.map((packageFile) => updatePackage(packageFile, transitive, reject)));
}

export default updateAll;
