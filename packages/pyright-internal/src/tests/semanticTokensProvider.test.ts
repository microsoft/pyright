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
            { type: 'variable', modifiers: [], start: 26, length: 3 },
            { type: 'type', modifiers: [], start: 31, length: 5 },
            { type: 'class', modifiers: [], start: 37, length: 3 },
            { type: 'class', modifiers: [], start: 43, length: 5 },
            { type: 'function', modifiers: ['definition'], start: 54, length: 3 },
            { type: 'function', modifiers: [], start: 54, length: 3 },
            { type: 'type', modifiers: [], start: 63, length: 5 },
        ]);
    });

    test('functions', () => {
        const result = semanticTokenizeSampleFile('functions.py');
        expect(result).toStrictEqual([
            { type: 'namespace', modifiers: [], start: 5, length: 6 },
            { type: 'class', modifiers: [], start: 19, length: 8 },
            { type: 'class', modifiers: [], start: 19, length: 8 },
            { type: 'function', modifiers: ['definition'], start: 34, length: 3 },
            { type: 'function', modifiers: [], start: 34, length: 3 },
            { type: 'variable', modifiers: [], start: 38, length: 1 },
            { type: 'class', modifiers: [], start: 41, length: 3 },
            { type: 'variable', modifiers: [], start: 47, length: 1 },
            { type: 'variable', modifiers: [], start: 52, length: 1 },
            { type: 'class', modifiers: [], start: 58, length: 3 },
            { type: 'function', modifiers: [], start: 72, length: 3 },
            { type: 'type', modifiers: [], start: 79, length: 3 },
            { type: 'class', modifiers: [], start: 85, length: 8 },
            { type: 'function', modifiers: [], start: 105, length: 3 },
            { type: 'class', modifiers: [], start: 110, length: 8 },
            { type: 'class', modifiers: [], start: 120, length: 3 },
        ]);
    });
} else {
    // prevent jest from failing because no tests were found
    test('windows placeholder', () => {});
}
