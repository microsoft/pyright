import * as fs from 'fs';
import { join } from 'path';
import * as path from 'path';
import * as process from 'process';

import * as Diff from 'diff';

import * as lsif from '../lsif';
import { Input } from '../lsif-typescript/Input';
import { formatSnapshot, index as lsifIndex, writeSnapshot } from '../lib';

const lsif_typed = lsif.lib.codeintel.lsif_typed;

function isUpdateSnapshot(): boolean {
    return true || process.argv.includes('--update-snapshots');
}

const inputDirectory = join(process.cwd(), 'snapshots', 'input');
const outputDirectory = join(process.cwd(), 'snapshots', 'output');

const snapshotDirectories = fs.readdirSync(inputDirectory);
const isUpdate = isUpdateSnapshot();
if (isUpdate && fs.existsSync(outputDirectory)) {
    fs.rmSync(outputDirectory, { recursive: true });
}

describe('indexer', () => {
    for (const snapshotDirectory of snapshotDirectories) {
        it(`Snapshot for: ${snapshotDirectory}`, () => {
            const projectRoot = join(inputDirectory, snapshotDirectory);

            const index = new lsif.lib.codeintel.lsif_typed.Index();
            lsifIndex({
                projectRoot,
                project: path.relative('.', projectRoot),
                writeIndex: (partialIndex: any): void => {
                    if (partialIndex.metadata) {
                        index.metadata = partialIndex.metadata;
                    }
                    for (const document of partialIndex.documents) {
                        index.documents.push(document);
                    }
                },
            });

            fs.writeFileSync(path.join(projectRoot, 'dump.lsif-typed'), index.serializeBinary());

            for (const doc of index.documents) {
                const inputPath = path.join(projectRoot, doc.relative_path);
                const relativeToInputDirectory = path.relative(inputDirectory, inputPath);
                const outputPath = path.resolve(outputDirectory, relativeToInputDirectory);
                const expected: string = fs.existsSync(outputPath) ? fs.readFileSync(outputPath).toString() : '';
                const input = Input.fromFile(inputPath);
                const obtained = formatSnapshot(input, doc);
                if (obtained !== expected) {
                    if (isUpdate) {
                        writeSnapshot(outputPath, obtained);
                    } else {
                        const patch = Diff.createTwoFilesPatch(
                            outputPath,
                            outputPath,
                            expected,
                            obtained,
                            '(what the snapshot tests expect)',
                            "(what the current code produces). Run the command 'npm run update-snapshots' to accept the new behavior."
                        );
                        throw new Error(patch);
                    }
                }
            }
        });
    }
});
