/* eslint-disable @typescript-eslint/no-var-requires */
//@ts-check

const { promises: fsAsync } = require('fs');
const chalk = require('chalk').default;

async function main() {
    const packageJson = await fsAsync.readFile('package.json', 'utf-8');
    const obj = JSON.parse(packageJson);

    const name = obj.name;
    if (name !== 'pyright') {
        console.error(chalk.red(`Extension name must be "pyright", but is currently set to "${name}".`));
        console.error(chalk.red('Please package by running "npm run package" to ensure the name is set correctly.'));
        console.error();
        process.exit(1);
    }
}

main();
