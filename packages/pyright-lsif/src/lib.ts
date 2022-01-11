import * as fs from 'fs';
import * as path from 'path';

import { Indexer } from './indexer';
import { lib } from './lsif';
import { Input } from './lsif-typescript/Input';
import { Range } from './lsif-typescript/Range';

export const lsif_typed = lib.codeintel.lsif_typed;

export interface Options {
    projectRoot: string;
    project: string;
    writeIndex: (index: lib.codeintel.lsif_typed.Index) => void;
}

export function index(options: Options) {
    const indexer = new Indexer({}, options);
    indexer.index();
}

const packageName = "lsif-pyright pypi";

export function formatSnapshot(input: Input, document: lib.codeintel.lsif_typed.Document): string {
    const out: string[] = [];
    document.occurrences.sort(occurrencesByLine);
    let occurrenceIndex = 0;
    for (const [lineNumber, line] of input.lines.entries()) {
        out.push('');
        out.push(line);
        out.push('\n');
        while (
            occurrenceIndex < document.occurrences.length &&
            document.occurrences[occurrenceIndex].range[0] === lineNumber
        ) {
            const occurrence = document.occurrences[occurrenceIndex];
            occurrenceIndex++;
            if (occurrence.range.length > 3) {
                // Skip multiline occurrences for now.
                continue;
            }
            const range = Range.fromLsif(occurrence.range);
            out.push('#');

            let modifier = 0;
            if (range.start.character === 0) {
                modifier = 1;
            } else {
                out.push(' '.repeat(range.start.character - 1));
            }
            const length = range.end.character - range.start.character - modifier;
            if (length < 0) {
                throw new Error(input.format(range, 'negative length occurrence!'));
            }
            out.push('^'.repeat(length));
            out.push(' ');
            const isDefinition = (occurrence.symbol_roles & lsif_typed.SymbolRole.Definition) > 0;
            out.push(isDefinition ? 'definition' : 'reference');
            out.push(' ');
            const symbol = occurrence.symbol.startsWith(packageName)
                ? occurrence.symbol.slice(packageName.length)
                : occurrence.symbol;
            out.push(symbol);
            out.push('\n');
        }
    }
    return out.join('');
}

export function writeSnapshot(outputPath: string, obtained: string): void {
    // eslint-disable-next-line no-sync
    fs.mkdirSync(path.dirname(outputPath), {
        recursive: true,
    });
    // eslint-disable-next-line no-sync
    fs.writeFileSync(outputPath, obtained);
}

function occurrencesByLine(a: lib.codeintel.lsif_typed.Occurrence, b: lib.codeintel.lsif_typed.Occurrence): number {
    return Range.fromLsif(a.range).compare(Range.fromLsif(b.range));
}
