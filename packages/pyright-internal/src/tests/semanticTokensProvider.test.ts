import { semanticTokenizeSampleFile } from './testUtils';

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
