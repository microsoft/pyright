/*
 * fourSlashParser.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Tests and show how to use fourslash markup languages
 * and how to use parseTestData API itself for other unit tests
 */

import assert from 'assert';

import { getBaseFileName, normalizeSlashes } from '../common/pathUtils';
import { compareStringsCaseSensitive } from '../common/stringUtils';
import { parseTestData } from './harness/fourslash/fourSlashParser';
import {
    getFileAtRawOffset,
    tryConvertContentOffsetToRawOffset,
    tryConvertRawOffsetToContentOffset,
} from './harness/fourslash/fourSlashRawUtils';
import {
    CompilerSettings,
    Marker,
    Range,
    RawToken,
    RawTokenKind,
    RawTokenRange,
} from './harness/fourslash/fourSlashTypes';
import * as host from './harness/testHost';
import * as factory from './harness/vfs/factory';
import { UriEx } from '../common/uri/uriUtils';

test('GlobalOptions', () => {
    const code = `
// global options
// @libpath: ../dist/lib
// @pythonversion: 3.7

////class A:
////    pass
    `;

    const content = `class A:
    pass`;

    const data = parseTestData('.', code, 'test.py');
    assertOptions(data.globalOptions, [
        ['libpath', '../dist/lib'],
        ['pythonversion', '3.7'],
    ]);

    assert.equal(data.files.length, 1);
    assert.equal(data.files[0].fileName, 'test.py');
    assert.equal(data.files[0].content, content);
});

test('Filename', () => {
    const code = `
// @filename: file1.py
////class A:
////    pass
    `;

    const content = `class A:
    pass`;

    const data = parseTestData('.', code, 'test.py');
    assertOptions(data.globalOptions, []);

    assert.equal(data.files.length, 1);
    assert.equal(data.files[0].fileName, normalizeSlashes('./file1.py'));
    assert.equal(data.files[0].content, content);
});

test('Extra file options', () => {
    // filename must be the first file options
    const code = `
// @filename: file1.py
// @library: false
////class A:
////    pass
    `;

    const data = parseTestData('.', code, 'test.py');

    assert.equal(data.files[0].fileName, normalizeSlashes('./file1.py'));

    assertOptions(data.globalOptions, []);
    assertOptions(data.files[0].fileOptions, [
        ['filename', 'file1.py'],
        ['library', 'false'],
    ]);
});

test('Library options', () => {
    // filename must be the first file options
    const code = `
// @filename: file1.py
// @library: true
////class A:
////    pass
    `;

    const data = parseTestData('.', code, 'test.py');

    assert.equal(data.files[0].fileName, factory.libFolder.combinePaths('file1.py').getFilePath());
});

test('Range', () => {
    const code = `
////class A:
////    [|pass|]
    `;

    const content = `class A:
    pass`;

    const data = parseTestData('.', code, 'test.py');
    assert.equal(data.files[0].content, content);

    assert.deepEqual(stripRanges(data.ranges), [
        { fileName: 'test.py', fileUri: UriEx.file('test.py'), pos: 13, end: 17, marker: undefined },
    ]);
});

test('Marker', () => {
    const code = `
////class A:
////    /*marker1*/pass
    `;

    const content = `class A:
    pass`;

    const data = parseTestData('.', code, 'test.py');
    assert.equal(data.files[0].content, content);

    const marker = { fileName: 'test.py', fileUri: UriEx.file('test.py'), position: 13 };
    assert.deepEqual(stripMarkers(data.markers), [marker]);
    assert.deepEqual(stripMarker(data.markerPositions.get('marker1')!), marker);
});

test('MarkerWithData', () => {
    // embedded json data
    const code = `
////class A:
////    {| "data1":"1", "data2":"2" |}pass
    `;

    const content = `class A:
    pass`;

    const data = parseTestData('.', code, 'test.py');
    assert.equal(data.files[0].content, content);

    assert.deepEqual(stripMarkers(data.markers), [
        { fileName: 'test.py', fileUri: UriEx.file('test.py'), position: 13, data: { data1: '1', data2: '2' } },
    ]);
    assert.equal(data.markerPositions.size, 0);
});

test('MarkerWithDataAndName', () => {
    // embedded json data with "name"
    const code = `
////class A:
////    {| "name": "marker1", "data1":"1", "data2":"2" |}pass
    `;

    const content = `class A:
    pass`;

    const data = parseTestData('.', code, 'test.py');
    assert.equal(data.files[0].content, content);

    const marker = {
        fileName: 'test.py',
        fileUri: UriEx.file('test.py'),
        position: 13,
        data: { name: 'marker1', data1: '1', data2: '2' },
    };
    assert.deepEqual(stripMarkers(data.markers), [marker]);
    assert.deepEqual(stripMarker(data.markerPositions.get(marker.data.name)!), marker);
});

test('RangeWithMarker', () => {
    // range can have 1 marker in it
    const code = `
////class A:
////    [|/*marker1*/pass|]
    `;

    const content = `class A:
    pass`;

    const data = parseTestData('.', code, 'test.py');
    assert.equal(data.files[0].content, content);

    const marker = { fileName: 'test.py', fileUri: UriEx.file('test.py'), position: 13 };
    assert.deepEqual(stripMarkers(data.markers), [marker]);
    assert.deepEqual(stripMarker(data.markerPositions.get('marker1')!), marker);

    assert.deepEqual(stripRanges(data.ranges), [
        { fileName: 'test.py', fileUri: UriEx.file('test.py'), pos: 13, end: 17, marker },
    ]);
});

test('RangeWithMarkerAndJsonData', () => {
    // range can have 1 marker in it
    const code = `
////class A:
////    [|{| "name": "marker1", "data1":"1", "data2":"2" |}pass|]
    `;

    const content = `class A:
    pass`;

    const data = parseTestData('.', code, 'test.py');
    assert.equal(data.files[0].content, content);

    const marker = {
        fileName: 'test.py',
        fileUri: UriEx.file('test.py'),
        position: 13,
        data: { name: 'marker1', data1: '1', data2: '2' },
    };
    assert.deepEqual(stripMarkers(data.markers), [marker]);
    assert.deepEqual(stripMarker(data.markerPositions.get(marker.data.name)!), marker);

    assert.deepEqual(stripRanges(data.ranges), [
        { fileName: 'test.py', fileUri: UriEx.file('test.py'), pos: 13, end: 17, marker },
    ]);
});

test('Multiple Files', () => {
    // range can have 1 marker in it
    const code = `
// @filename: src/A.py
// @library: false
////class A:
////    pass

// @filename: src/B.py
// @library: true
////class B:
////    pass

// @filename: src/C.py
////class C:
////    pass
    `;

    const data = parseTestData('.', code, 'test.py');
    assert.equal(data.files.length, 3);

    assert.equal(data.files.filter((f) => f.fileName === normalizeSlashes('./src/A.py'))[0].content, getContent('A'));
    assert.equal(
        data.files.filter((f) => f.fileName === factory.libFolder.resolvePaths('src/B.py').getFilePath())[0].content,
        getContent('B')
    );
    assert.equal(data.files.filter((f) => f.fileName === normalizeSlashes('./src/C.py'))[0].content, getContent('C'));
});

test('Multiple Files with default name', () => {
    // only very first one can omit filename
    const code = `
////class A:
////    pass

// @filename: src/B.py
////class B:
////    pass

// @filename: src/C.py
////class C:
////    pass
    `;

    const data = parseTestData('.', code, './src/test.py');
    assert.equal(data.files.length, 3);

    assert.equal(
        data.files.filter((f) => f.fileName === normalizeSlashes('./src/test.py'))[0].content,
        getContent('A')
    );
    assert.equal(data.files.filter((f) => f.fileName === normalizeSlashes('./src/B.py'))[0].content, getContent('B'));
    assert.equal(data.files.filter((f) => f.fileName === normalizeSlashes('./src/C.py'))[0].content, getContent('C'));
});

test('Multiple Files with markers', () => {
    // range can have 1 marker in it
    const code = `
// @filename: src/A.py
////class A:
////    [|pass|]

// @filename: src/B.py
////class B:
////    [|/*marker1*/pass|]

// @filename: src/C.py
////class C:
////    [|{|"name":"marker2", "data":"2"|}pass|]
    `;

    const data = parseTestData('.', code, 'test.py');
    assert.equal(data.files.length, 3);

    assert.equal(data.files.filter((f) => f.fileName === normalizeSlashes('./src/A.py'))[0].content, getContent('A'));
    assert.equal(data.files.filter((f) => f.fileName === normalizeSlashes('./src/B.py'))[0].content, getContent('B'));
    assert.equal(data.files.filter((f) => f.fileName === normalizeSlashes('./src/C.py'))[0].content, getContent('C'));

    assert.equal(data.ranges.length, 3);

    assert(data.markerPositions.get('marker1'));
    assert(data.markerPositions.get('marker2'));

    assert.equal(data.ranges.filter((r) => r.marker).length, 2);
});

test('fourSlashWithFileSystem', () => {
    const code = `
// @filename: src/A.py
////class A:
////    pass

// @filename: src/B.py
////class B:
////    pass

// @filename: src/C.py
////class C:
////    pass
    `;

    const data = parseTestData('.', code, 'unused');
    const documents = data.files.map(
        (f) => new factory.TextDocument(f.fileName, f.content, new Map<string, string>(Object.entries(f.fileOptions)))
    );

    const fs = factory.createFromFileSystem(host.HOST, /* ignoreCase */ false, {
        documents,
        cwd: normalizeSlashes('/'),
    });

    for (const file of data.files) {
        assert.equal(fs.readFileSync(file.fileUri, 'utf8'), getContent(getBaseFileName(file.fileName, '.py', false)));
    }
});

test('RawTokensLossless', () => {
    const code = '// @filename: a.py\r\n////a/*m*/b\r\n';
    const data = parseTestData('.', code, 'test.py');

    assert.equal(data.rawText, code);
    assert(data.rawText);
    assert(data.rawTokens);

    const reconstructed = data.rawTokens.map((t) => data.rawText!.slice(t.start, t.end)).join('');
    assert.equal(reconstructed, code);

    assert.equal(data.rawTokens[0].start, 0);
    assert.equal(data.rawTokens[data.rawTokens.length - 1].end, code.length);
    for (let i = 0; i < data.rawTokens.length - 1; i++) {
        assert.equal(data.rawTokens[i].end, data.rawTokens[i + 1].start);
    }

    const twoSlash = data.rawTokens.find((t) => t.kind === RawTokenKind.TwoSlashPrefix);
    assert(twoSlash);
    assert.equal(data.rawText.slice(twoSlash.start, twoSlash.end), '//');

    const fourSlash = data.rawTokens.find((t) => t.kind === RawTokenKind.FourSlashPrefix);
    assert(fourSlash);
    assert.equal(data.rawText.slice(fourSlash.start, fourSlash.end), '////');

    const cr = data.rawTokens.find((t) => t.kind === RawTokenKind.NewLineCR);
    const lf = data.rawTokens.find((t) => t.kind === RawTokenKind.NewLineLF);
    assert(cr);
    assert(lf);
    assert.equal(data.rawText.slice(cr.start, cr.end), '\r');
    assert.equal(data.rawText.slice(lf.start, lf.end), '\n');
});

test('RawTokensTraceCoversAllKinds', () => {
    const code = '//   @pythonversion:\t3.12  \r\n' + '////\t[|ab/*m*/cd{| "x": 1 |}ef|]\r\n';

    const data = parseTestData('.', code, 'test.py');
    assert.equal(data.rawText, code);
    assert(data.rawText);
    assert(data.rawTokens);

    const trace = data.rawTokens.map((t) => [t.kind, data.rawText!.slice(t.start, t.end)] as const);

    const expectedTrace = [
        // Directive line.
        [RawTokenKind.TwoSlashPrefix, '//'],
        [RawTokenKind.Whitespace, '   '],
        [RawTokenKind.DirectiveAt, '@'],
        [RawTokenKind.DirectiveName, 'pythonversion'],
        [RawTokenKind.DirectiveColon, ':'],
        [RawTokenKind.Whitespace, '\t'],
        [RawTokenKind.DirectiveValue, '3.12'],
        [RawTokenKind.Whitespace, '  '],
        [RawTokenKind.NewLineCR, '\r'],
        [RawTokenKind.NewLineLF, '\n'],

        // Four-slash content line.
        [RawTokenKind.FourSlashPrefix, '////'],
        [RawTokenKind.Whitespace, '\t'],
        [RawTokenKind.RangeStart, '[|'],
        [RawTokenKind.Text, 'ab'],
        [RawTokenKind.MarkerStart, '/*'],
        [RawTokenKind.MarkerName, 'm'],
        [RawTokenKind.MarkerEnd, '*/'],
        [RawTokenKind.Text, 'cd'],
        [RawTokenKind.ObjectMarkerStart, '{|'],
        [RawTokenKind.ObjectMarkerText, ' "x": 1 '],
        [RawTokenKind.ObjectMarkerEnd, '|}'],
        [RawTokenKind.Text, 'ef'],
        [RawTokenKind.RangeEnd, '|]'],
        [RawTokenKind.NewLineCR, '\r'],
        [RawTokenKind.NewLineLF, '\n'],
    ] as const;

    assert.deepEqual(trace, expectedTrace);

    const allKinds: RawToken['kind'][] = [
        RawTokenKind.Whitespace,
        RawTokenKind.NewLineCR,
        RawTokenKind.NewLineLF,
        RawTokenKind.Text,
        RawTokenKind.TwoSlashPrefix,
        RawTokenKind.FourSlashPrefix,
        RawTokenKind.DirectiveAt,
        RawTokenKind.DirectiveName,
        RawTokenKind.DirectiveColon,
        RawTokenKind.DirectiveValue,
        RawTokenKind.RangeStart,
        RawTokenKind.RangeEnd,
        RawTokenKind.MarkerStart,
        RawTokenKind.MarkerName,
        RawTokenKind.MarkerEnd,
        RawTokenKind.ObjectMarkerStart,
        RawTokenKind.ObjectMarkerText,
        RawTokenKind.ObjectMarkerEnd,
    ];

    const seen = new Set<RawToken['kind']>(data.rawTokens.map((t) => t.kind));
    const missing = allKinds.filter((k) => !seen.has(k));
    assert.deepEqual(
        missing,
        [],
        `Missing raw token kinds: ${missing.join(', ')}\n\nTrace:\n${trace
            .map(([k, s]) => `${k}: ${JSON.stringify(s)}`)
            .join('\n')}`
    );
});

test('RawDataTokenRangesForMarkerRangeAndDirective', () => {
    const code = '// @pythonversion: 3.12\n' + '////class A:\n' + '////    [|/*marker1*/pass|]\n';

    const data = parseTestData('.', code, 'test.py');
    assert(data.rawText);
    assert(data.rawTokens);

    const directive = data.globalOptionsRawData?.pythonversion;
    assert(directive);
    assert.equal(sliceByTokenRange(data.rawText, data.rawTokens, directive.prefix), '//');
    assert.equal(sliceByTokenRange(data.rawText, data.rawTokens, directive.name), '@pythonversion');
    assert.equal(sliceByTokenRange(data.rawText, data.rawTokens, directive.colon!), ':');
    assert.equal(sliceByTokenRange(data.rawText, data.rawTokens, directive.value), '3.12');

    assert.equal(data.ranges.length, 1);
    const range = data.ranges[0];
    assert(range.rawData);
    assert.equal(sliceByTokenRange(data.rawText, data.rawTokens, range.rawData.open), '[|');
    assert.equal(sliceByTokenRange(data.rawText, data.rawTokens, range.rawData.close), '|]');
    assert.equal(sliceByTokenRange(data.rawText, data.rawTokens, range.rawData.full), '[|/*marker1*/pass|]');
    assert.equal(sliceByTokenRange(data.rawText, data.rawTokens, range.rawData.selected), '/*marker1*/pass');

    assert.equal(data.markers.length, 1);
    const marker = data.markers[0];
    assert(marker.rawData);
    assert.equal(marker.rawData.kind, 'slashStar');
    assert.equal(sliceByTokenRange(data.rawText, data.rawTokens, marker.rawData.full), '/*marker1*/');
    assert.equal(sliceByTokenRange(data.rawText, data.rawTokens, marker.rawData.name!), 'marker1');
});

test('StrictRawToContentMapping', () => {
    const code = '////class A:\r\n////    /*marker1*/pass\r\n';
    const data = parseTestData('.', code, 'test.py');
    const file = data.files[0];

    const rawOffsetPass = code.indexOf('pass');
    assert(rawOffsetPass >= 0);
    assert.equal(tryConvertRawOffsetToContentOffset(file, rawOffsetPass), file.content.indexOf('pass'));

    const rawOffsetMarker = code.indexOf('/*marker1*/');
    assert(rawOffsetMarker >= 0);
    assert.equal(tryConvertRawOffsetToContentOffset(file, rawOffsetMarker), undefined);

    const rawOffsetCr = code.indexOf('\r');
    assert(rawOffsetCr >= 0);
    assert.equal(tryConvertRawOffsetToContentOffset(file, rawOffsetCr), undefined);

    const passContentOffset = file.content.indexOf('pass');
    assert.equal(tryConvertContentOffsetToRawOffset(file, passContentOffset), rawOffsetPass);

    const rawOffsetAfterPass = rawOffsetPass + 'pass'.length;
    assert.equal(tryConvertRawOffsetToContentOffset(file, rawOffsetAfterPass), file.content.length);
    assert.equal(tryConvertContentOffsetToRawOffset(file, file.content.length), rawOffsetAfterPass);
});

test('StrictRawToContentMapping_UnmappedPrefixesAndRangeDelimiters', () => {
    const code = '////[|a|]\n';
    const data = parseTestData('.', code, 'test.py');
    const file = data.files[0];

    // Raw offsets inside the four-slash prefix are unmapped.
    const rawOffsetInPrefix = code.indexOf('////') + 2;
    assert.equal(tryConvertRawOffsetToContentOffset(file, rawOffsetInPrefix), undefined);

    // Range delimiter tokens are metacharacters and are unmapped.
    const rawOffsetRangeStart = code.indexOf('[|');
    assert(rawOffsetRangeStart >= 0);
    // The start of a stripped delimiter can coincide with a mapped segment boundary.
    // Strictness means the bytes *inside* the delimiter are unmapped.
    assert.equal(tryConvertRawOffsetToContentOffset(file, rawOffsetRangeStart + 1), undefined);

    const rawOffsetRangeEnd = code.indexOf('|]');
    assert(rawOffsetRangeEnd >= 0);
    assert.equal(tryConvertRawOffsetToContentOffset(file, rawOffsetRangeEnd), file.content.length);
    assert.equal(tryConvertRawOffsetToContentOffset(file, rawOffsetRangeEnd + 1), undefined);

    // Content inside the range should map.
    const rawOffsetA = code.indexOf('a');
    assert(rawOffsetA >= 0);
    assert.equal(tryConvertRawOffsetToContentOffset(file, rawOffsetA), file.content.indexOf('a'));
});

test('StrictRawToContentMapping_LfMapsButCrDoesNot', () => {
    const code = '////a\r\n////b\r\n';
    const data = parseTestData('.', code, 'test.py');
    const file = data.files[0];

    assert.equal(file.content, 'a\nb');

    const rawOffsetCr = code.indexOf('\r');
    const rawOffsetLf = code.indexOf('\n');
    assert(rawOffsetCr >= 0);
    assert(rawOffsetLf >= 0);

    assert.equal(tryConvertRawOffsetToContentOffset(file, rawOffsetCr), undefined);
    assert.equal(tryConvertRawOffsetToContentOffset(file, rawOffsetLf), file.content.indexOf('\n'));
    assert.equal(tryConvertContentOffsetToRawOffset(file, file.content.indexOf('\n')), rawOffsetLf);
});

test('InvalidSlashStarMarkerIsTreatedAsComment', () => {
    const code = '////a/*bad-marker*/b\n';
    const data = parseTestData('.', code, 'test.py');
    const file = data.files[0];

    assert.equal(data.markers.length, 0);
    assert.equal(file.content, 'a/*bad-marker*/b');

    const rawOffsetCommentStart = code.indexOf('/*');
    assert(rawOffsetCommentStart >= 0);
    assert.equal(tryConvertRawOffsetToContentOffset(file, rawOffsetCommentStart), file.content.indexOf('/*'));
});

test('UnterminatedRangeThrows', () => {
    const code = '////[|a\n';
    assert.throws(
        () => parseTestData('.', code, 'test.py'),
        (e: unknown) => e instanceof Error && e.message.includes('Unterminated range.')
    );
});

test('GetOwningFileAtRawOffset', () => {
    const code = '// @filename: A.py\n' + '////class A: pass\n' + '\n' + '// @filename: B.py\n' + '////class B: pass\n';

    const data = parseTestData('.', code, 'test.py');
    assert.equal(data.files.length, 2);

    const bRawOffset = code.indexOf('class B');
    assert(bRawOffset >= 0);
    const owningFile = getFileAtRawOffset(data, bRawOffset);
    assert(owningFile);
    assert.equal(getBaseFileName(owningFile.fileName, '.py', false), 'B');
});

test('GetOwningFileAtRawOffset_Boundaries', () => {
    const code = '// @filename: A.py\n' + '////class A: pass\n' + '// @filename: B.py\n' + '////class B: pass\n';

    const data = parseTestData('.', code, 'test.py');
    assert.equal(data.files.length, 2);

    // The newline token at the end of A's four-slash line is still owned by file A.
    const aLineEndLf = code.indexOf('////class A: pass') + '////class A: pass'.length;
    assert.equal(code[aLineEndLf], '\n');
    const fileAtALineLf = getFileAtRawOffset(data, aLineEndLf);
    assert(fileAtALineLf);
    assert.equal(getBaseFileName(fileAtALineLf.fileName, '.py', false), 'A');

    // The @filename directive line is not part of any file's tokenRanges.
    const bDirectiveOffset = code.indexOf('// @filename: B.py');
    assert(bDirectiveOffset >= 0);
    assert.equal(getFileAtRawOffset(data, bDirectiveOffset), undefined);

    // The first four-slash line after the directive is owned by file B.
    const bContentOffset = code.indexOf('////class B');
    assert(bContentOffset >= 0);
    const fileAtBLine = getFileAtRawOffset(data, bContentOffset);
    assert(fileAtBLine);
    assert.equal(getBaseFileName(fileAtBLine.fileName, '.py', false), 'B');
});

function getContent(className: string) {
    return `class ${className}:
    pass`;
}

function assertOptions(actual: CompilerSettings, expected: [string, string][], message?: string | Error): void {
    assert.deepEqual(
        Object.entries(actual).sort((x, y) => compareStringsCaseSensitive(x[0], y[0])),
        expected,
        message
    );
}

type LegacyMarker = {
    fileName: string;
    fileUri: unknown;
    position: number;
    data?: {};
};

type LegacyRange = {
    fileName: string;
    fileUri: unknown;
    pos: number;
    end: number;
    marker: LegacyMarker | undefined;
};

function stripMarker(marker: Marker): LegacyMarker {
    const base: Omit<LegacyMarker, 'data'> = {
        fileName: marker.fileName,
        fileUri: marker.fileUri,
        position: marker.position,
    };

    // Preserve legacy shape: omit `data` when undefined.
    return marker.data !== undefined ? { ...base, data: marker.data } : base;
}

function stripMarkers(markers: Marker[]): LegacyMarker[] {
    return markers.map((m) => stripMarker(m));
}

function stripRanges(ranges: Range[]): LegacyRange[] {
    return ranges.map((r) => ({
        fileName: r.fileName,
        fileUri: r.fileUri,
        pos: r.pos,
        end: r.end,
        marker: r.marker ? stripMarker(r.marker) : undefined,
    }));
}

function sliceByTokenRange(rawText: string, rawTokens: RawToken[], tokenRange: RawTokenRange) {
    if (tokenRange.startToken === tokenRange.endToken) {
        return '';
    }

    const start = rawTokens[tokenRange.startToken].start;
    const end = rawTokens[tokenRange.endToken - 1].end;
    return rawText.slice(start, end);
}
