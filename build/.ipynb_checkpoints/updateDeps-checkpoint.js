/* eslint-disable @typescript-eslint/no-var-requires */
//@ts-check

const yargs = require('yargs');

const { updateAll } = require('./lib/updateDeps');

async function main() {
    const argv = yargs.options({
        transitive: { type: 'boolean' },
    }).argv;

    await updateAll(!!argv.transitive, [
        // These packages impact compatibility with VS Code and other users;
        // ensure they remained pinned exactly.
        '@types/vscode',
        'vsce',
        'vscode-jsonrpc',
        'vscode-languageclient',
        'vscode-languageserver',
        'vscode-languageserver-protocol',
        'vscode-languageserver-types',
        // Minor version changes have breaks; require a manual update.
        'typescript',
    ]);
}

main();
