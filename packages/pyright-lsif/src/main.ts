import * as fs from 'fs';
import * as path from 'path';
import * as child_process from 'child_process';

import { lib } from './lsif';
import { index, formatSnapshot, writeSnapshot } from './lib';
import { Input } from './lsif-typescript/Input';
import * as yargs from 'yargs';

console.log('Yargin');

export function main(): void {
    yargs
        .scriptName('lsif-pyright')
        .usage('$0 <cmd> [args]')
        .version('0.0')
        .command(
            'index [project]',
            'LSIF index a project',
            (yargs) => {
              console.log("Is this?");
                yargs.positional('project', {
                    type: 'string',
                    default: '.',
                    describe:
                        'path to the TypeScript project to index. Normally, this directory contains a tsconfig.json file.',
                });

                yargs.option('projectVersion', {
                    type: 'string',
                    default: '',
                    describe: 'version of project',
                });
            },
            (argv) => {
                const workspaceRoot = argv.project as string;
                let workspaceVersion = argv.projectVersion as string;

                const projectRoot = workspaceRoot;

                process.chdir(workspaceRoot);
                if (workspaceVersion === '') {
                  // Default to current git hash
                  workspaceVersion = child_process.execSync('git rev-parse HEAD').toString().trim();
                }

                const lsifIndex = new lib.codeintel.lsiftyped.Index();


                console.log('Indexing:', projectRoot, '@', workspaceVersion);

                index({
                    workspaceRoot,
                    projectRoot,
                    version: workspaceVersion,
                    writeIndex: (partialIndex: any): void => {
                        if (partialIndex.metadata) {
                            lsifIndex.metadata = partialIndex.metadata;
                        }
                        for (const doc of partialIndex.documents) {
                            lsifIndex.documents.push(doc);
                        }
                    },
                });

                console.log('Writing to: ', path.join(projectRoot, 'dump.lsif-typed'));
                fs.writeFileSync(path.join(projectRoot, 'dump.lsif-typed'), lsifIndex.serializeBinary());

                const outputDirectory = path.join('/home/tjdevries/tmp/', 'snapshots', 'output');
                for (const doc of lsifIndex.documents) {
                    if (doc.relative_path.startsWith('..')) {
                        console.log('Skipping Doc:', doc.relative_path);
                        continue;
                    }

                    const inputPath = path.join(projectRoot, doc.relative_path);
                    const input = Input.fromFile(inputPath);
                    const obtained = formatSnapshot(input, doc);
                    const relativeToInputDirectory = path.relative(projectRoot, inputPath);
                    const outputPath = path.resolve(outputDirectory, relativeToInputDirectory);
                    writeSnapshot(outputPath, obtained);
                }
            }
        )
        .help().argv;

    console.log('Done?');
}

main()
