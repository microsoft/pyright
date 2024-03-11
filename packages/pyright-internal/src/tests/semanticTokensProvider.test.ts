import { semanticTokenizeSampleFile } from './testUtils';

//TODO: these tests have different start positions in ci on windows, i assume because of crlf moment
if (process.platform !== 'win32' || !process.env['CI']) {
    test('variable', () => {
        const result = semanticTokenizeSampleFile('variable.py');
        expect(result).toStrictEqual([{ type: 'variable', length: 1, start: 0, modifiers: [] }]);
    });

    test('type annotation', () => {
        const result = semanticTokenizeSampleFile('type_annotation.py');
        expect(result).toStrictEqual([
            { type: 'variable', modifiers: [], start: 0, length: 1 },
            { type: 'class', modifiers: [], start: 3, length: 3 },
            { type: 'variable', modifiers: [], start: 7, length: 1 },
            { type: 'class', modifiers: [], start: 10, length: 3 },
        ]);
    });

    test('imports', () => {
        const result = semanticTokenizeSampleFile('imports.py');
        expect(result).toStrictEqual([
            //TODO: fix duplicates
            { type: 'namespace', modifiers: [], start: 5, length: 6 },
            { type: 'class', modifiers: [], start: 19, length: 5 },
            { type: 'class', modifiers: [], start: 19, length: 5 },
            { type: 'class', modifiers: [], start: 26, length: 8 },
            { type: 'class', modifiers: [], start: 38, length: 3 },
            { type: 'namespace', modifiers: [], start: 47, length: 11 },
            { type: 'namespace', modifiers: [], start: 59, length: 3 },
            { type: 'class', modifiers: [], start: 70, length: 8 },
            { type: 'class', modifiers: [], start: 70, length: 8 },
        ]);
    });

    test('final', () => {
        const result = semanticTokenizeSampleFile('final.py');
        expect(result).toStrictEqual([
            { type: 'namespace', modifiers: [], start: 5, length: 6 },
            { type: 'class', modifiers: [], start: 19, length: 5 },
            { type: 'class', modifiers: [], start: 19, length: 5 },
            { type: 'variable', modifiers: ['readonly'], start: 26, length: 3 },
            { type: 'variable', modifiers: ['readonly'], start: 35, length: 3 },
            { type: 'class', modifiers: [], start: 40, length: 5 },
        ]);
    });

    test('never', () => {
        const result = semanticTokenizeSampleFile('never.py');
        expect(result).toStrictEqual([
            { type: 'namespace', modifiers: [], start: 5, length: 6 },
            { type: 'class', modifiers: [], start: 19, length: 5 },
            { type: 'class', modifiers: [], start: 19, length: 5 },
            { type: 'type', modifiers: [], start: 31, length: 5 },
            { type: 'variable', modifiers: [], start: 26, length: 3 },
            { type: 'variable', modifiers: [], start: 31, length: 5 }, // TODO: this one shouldnt be here
            { type: 'class', modifiers: [], start: 37, length: 3 },
            { type: 'class', modifiers: [], start: 43, length: 5 },
            { type: 'function', modifiers: ['definition'], start: 54, length: 3 },
            { type: 'function', modifiers: [], start: 54, length: 3 },
            { type: 'variable', modifiers: [], start: 63, length: 5 }, // TODO: this should be a type
        ]);
    });

    test('functions', () => {
        const result = semanticTokenizeSampleFile('functions.py');
        expect(result).toStrictEqual([
            { type: 'function', modifiers: ['definition'], start: 4, length: 3 },
            { type: 'function', modifiers: [], start: 4, length: 3 },
            { type: 'variable', modifiers: [], start: 8, length: 1 },
            { type: 'class', modifiers: [], start: 11, length: 3 },
            { type: 'variable', modifiers: [], start: 17, length: 1 },
            { type: 'variable', modifiers: [], start: 22, length: 1 },
            { type: 'class', modifiers: [], start: 28, length: 3 },
        ]);
    });
}
