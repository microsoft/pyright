// Lerna doesn't do a good job preserving the indention in lock files.
// Check that the lock files are still indented correctly, otherwise
// the change will cause problems with merging and the updateDeps script.

import detectIndent from 'detect-indent';
import fsExtra from 'fs-extra';
import glob from 'glob';
import util from 'util';
const asyncGlob = util.promisify(glob);

async function findPackageLocks() {
    const lernaFile = await fsExtra.readFile('lerna.json', 'utf-8');

    const lernaConfig: { packages: string[] } = JSON.parse(lernaFile);

    const matches = await Promise.all(lernaConfig.packages.map((pattern) => asyncGlob(pattern + '/package-lock.json')));
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
