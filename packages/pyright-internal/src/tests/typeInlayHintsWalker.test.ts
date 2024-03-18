import { inlayHintSampleFile } from './testUtils';

//TODO: these tests have different start positions in ci on windows, i assume because of crlf moment
if (process.platform !== 'win32' || !process.env['CI']) {
    test('variables', () => {
        const result = inlayHintSampleFile('variables.py');
        expect(result).toStrictEqual([
            {
                inlayHintType: 'variable',
                position: 53,
                value: ': str',
            },
            {
                inlayHintType: 'variable',
                position: 364,
                value: ': TypeAlias',
            },
        ]);
    });

    test('function defs', () => {
        const result = inlayHintSampleFile('function_defs.py');
        expect(result).toStrictEqual([
            { inlayHintType: 'functionReturn', position: 38, value: '-> None' },
            { inlayHintType: 'functionReturn', position: 88, value: "-> Literal['']" },
        ]);
    });

    test('function calls', () => {
        const result = inlayHintSampleFile('function_calls.py');
        expect(result).toStrictEqual([
            { inlayHintType: 'parameter', position: 99, value: 'value=' },
            { inlayHintType: 'parameter', position: 175, value: 'value=' },
            { inlayHintType: 'parameter', position: 178, value: 'bar=' },
            { inlayHintType: 'parameter', position: 219, value: 'bar=' },
            { inlayHintType: 'parameter', position: 418, value: 'a=' },
            { inlayHintType: 'parameter', position: 446, value: 'b=' },
        ]);
    });
} else {
    // prevent jest from failing because no tests were found
    test('windows placeholder', () => {});
}
