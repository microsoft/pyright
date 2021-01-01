import detectIndent from 'detect-indent';
import { readFile, writeFile } from 'fs-extra';

async function modifyJsonInPlace(filepath: string, modifier: (obj: any) => void) {
    const input = await readFile(filepath, 'utf-8');
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

    await writeFile(filepath, output, 'utf-8');
}

async function main() {
    const name = process.argv[2];
    await modifyJsonInPlace('package.json', (obj) => {
        obj.name = name;
    });
}

main();
