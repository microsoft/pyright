/* eslint-disable @typescript-eslint/no-var-requires */
//@ts-check

const yargs = require('yargs');

const { updateAll } = require('./lib/updateDeps');

async function main() {
    const argv = yargs.options({
        transitive: { type: 'boolean' },
    }).argv;

    await updateAll(argv.transitive, ['@types/vscode']);
}

main();
