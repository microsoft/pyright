import * as fs from 'fs';
import * as path from 'path';

import { lib } from './lsif';
import { index, formatSnapshot, writeSnapshot } from './lib';
import { Input } from './lsif-typescript/Input';

console.log('============================================================');

const inputDirectory = path.join(process.cwd(), 'snapshots', 'input');
const outputDirectory = path.join(process.cwd(), 'snapshots', 'output');
const snapshotDirectory = path.relative('.', path.join(inputDirectory, 'poetry_project'));
const projectRoot = path.join(inputDirectory, path.relative(inputDirectory, snapshotDirectory));

console.log('Indexing:', projectRoot, path.relative('.', projectRoot));

const lsifIndex = new lib.codeintel.lsif_typed.Index();
index({
    projectRoot,
    project: path.relative('.', projectRoot),
    writeIndex: (partialIndex: any): void => {
        if (partialIndex.metadata) {
            lsifIndex.metadata = partialIndex.metadata;
        }
        for (const document of partialIndex.documents) {
            lsifIndex.documents.push(document);
        }
    },
});

fs.writeFileSync(path.join(projectRoot, 'dump.lsif-typed'), lsifIndex.serializeBinary());

for (const doc of lsifIndex.documents) {
    if (doc.relative_path.startsWith('..')) {
        console.log('Skipping Doc:', doc.relative_path);
        continue;
    }

    const inputPath = path.join(projectRoot, doc.relative_path);
    const input = Input.fromFile(inputPath);
    const obtained = formatSnapshot(input, doc);
    const relativeToInputDirectory = path.relative(inputDirectory, inputPath);
    const outputPath = path.resolve(outputDirectory, relativeToInputDirectory);
    writeSnapshot(outputPath, obtained);
}

console.log('Done!');
