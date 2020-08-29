/* eslint-disable @typescript-eslint/no-var-requires */
//@ts-check

const fsExtra = require('fs-extra');
const detectIndent = require('detect-indent');

/**
 * @param {string} [filepath]
 * @param {(obj: any) => void} [modifier]
 */
async function modifyJsonInPlace(filepath, modifier) {
    const input = await fsExtra.readFile(filepath, 'utf-8');
    const indent = detectIndent(input);
    const obj = JSON.parse(input);

    modifier(obj);

    let output = JSON.stringify(obj, null, indent.indent);

    if (input.endsWith('\n')) {
        output += '\n';
    }

    if (input.indexOf('\r\n') !== -1) {
        output = output.replace(/\n/g, '\r\n');
    }

    await fsExtra.writeFile(filepath, output, 'utf-8');
}

async function main() {
    const name = process.argv[2];
    await modifyJsonInPlace('package.json', (obj) => {
        obj.name = name;
    });
}

main();
