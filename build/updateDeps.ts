import yargs from 'yargs';

import updateAll from './lib/updateDeps';

async function main() {
    const argv = yargs.options({
        transitive: { type: 'boolean' },
    }).argv;

    await updateAll(argv.transitive!, [
        // These packages impact compatibility with VS Code and other users;
        // ensure they remained pinned exactly.
        '@types/vscode',
        'vscode-jsonrpc',
        'vscode-languageclient',
        'vscode-languageserver',
        'vscode-languageserver-protocol',
        'vscode-languageserver-types',
    ]);
}

main();
