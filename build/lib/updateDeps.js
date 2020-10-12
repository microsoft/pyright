/* eslint-disable @typescript-eslint/no-var-requires */
//@ts-check

const fsExtra = require('fs-extra');
const ncu = require('npm-check-updates');
const PQueue = require('p-queue').default;
const path = require('path');
const util = require('util');
const glob = util.promisify(require('glob'));
const exec = util.promisify(require('child_process').exec);

async function findPackages() {
    const lernaFile = await fsExtra.readFile('lerna.json', 'utf-8');

    /** @type {{ packages: string[] }} */
    const lernaConfig = JSON.parse(lernaFile);

    const matches = await Promise.all(lernaConfig.packages.map((pattern) => glob(pattern + '/package.json')));
    return ['package.json'].concat(...matches);
}

const queue = new PQueue({ concurrency: 4 });

/** @type {(packageFile: string, transitive: boolean, reject?: string[]) => Promise<void>} */
async function updatePackage(packageFile, transitive, reject = undefined) {
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
        await exec('npm install', {
            cwd: packagePath,
            env: {
                ...process.env,
                SKIP_LERNA_BOOTSTRAP: 'yes',
            },
        });
    });
}

/** @type {(transitive: boolean, reject?: string[]) => Promise<void>} */
async function updateAll(transitive, reject = undefined) {
    const packageFiles = await findPackages();
    await Promise.all(packageFiles.map((packageFile) => updatePackage(packageFile, transitive, reject)));
}

module.exports = {
    updateAll,
};
