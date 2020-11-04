/* eslint-disable @typescript-eslint/no-var-requires */
//@ts-check

// Lerna doesn't do a good job preserving the indention in lock files.
// Check that the lock files are still indented correctly, otherwise
// the change will cause problems with merging and the updateDeps script.

const detectIndent = require('detect-indent');
const fsExtra = require('fs-extra');
const util = require('util');
const glob = util.promisify(require('glob'));

async function findPackageLocks() {
    const lernaFile = await fsExtra.readFile('lerna.json', 'utf-8');

    /** @type {{ packages: string[] }} */
    const lernaConfig = JSON.parse(lernaFile);

    const matches = await Promise.all(lernaConfig.packages.map((pattern) => glob(pattern + '/package-lock.json')));
    return ['package-lock.json'].concat(...matches);
}

async function main() {
    const locks = await findPackageLocks();

    let ok = true;

    for (const filepath of locks) {
        const input = await fsExtra.readFile(filepath, 'utf-8');
        const indent = detectIndent(input);

        if (indent.indent !== '    ') {
            ok = false;
            console.error(`${filepath} has invalid indent "${indent.indent}"`);
        }
    }

    if (!ok) {
        console.error('Lerna may have modified package-lock.json during bootstrap.');
        console.error('You may need to revert any package-lock changes and rerun install:all.');
        process.exit(1);
    }
}

main();
