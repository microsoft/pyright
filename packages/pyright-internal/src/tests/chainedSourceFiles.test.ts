/*
 * chainedSourceFiles.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for tokenizer ipython mode
 */

import assert from 'assert';
import { CancellationToken } from 'vscode-jsonrpc';
import { MarkupKind } from 'vscode-languageserver-types';

import { Program } from '../analyzer/program';
import { AnalyzerService } from '../analyzer/service';
import { IPythonMode } from '../analyzer/sourceFile';
import { ConfigOptions } from '../common/configOptions';
import { NullConsole } from '../common/console';
import { normalizeSlashes } from '../common/pathUtils';
import { convertOffsetsToRange, convertOffsetToPosition } from '../common/positionUtils';
import { ServiceProvider } from '../common/serviceProvider';
import { Uri } from '../common/uri/uri';
import { UriEx } from '../common/uri/uriUtils';
import { CompletionProvider } from '../languageService/completionProvider';
import { parseTestData } from './harness/fourslash/fourSlashParser';
import { TestAccessHost } from './harness/testAccessHost';
import * as host from './harness/testHost';
import { createFromFileSystem, distlibFolder, libFolder } from './harness/vfs/factory';
import * as vfs from './harness/vfs/filesystem';

test('check chained files', () => {
    const code = `
// @filename: test1.py
//// def foo1(): pass

// @filename: test2.py
//// def foo2(): pass

// @filename: test3.py
//// def foo3(): pass

// @filename: test4.py
//// [|foo/*marker*/|]
    `;

    const basePath = UriEx.file(normalizeSlashes('/'));
    const { data, service } = createServiceWithChainedSourceFiles(basePath, code);

    const marker = data.markerPositions.get('marker')!;
    const markerUri = marker.fileUri;

    const parseResult = service.getParseResults(markerUri)!;
    const result = new CompletionProvider(
        service.test_program,
        markerUri,
        convertOffsetToPosition(marker.position, parseResult.tokenizerOutput.lines),
        {
            format: MarkupKind.Markdown,
            lazyEdit: false,
            snippet: false,
        },
        CancellationToken.None
    ).getCompletions();

    assert(result?.items.some((i) => i.label === 'foo1'));
    assert(result?.items.some((i) => i.label === 'foo2'));
    assert(result?.items.some((i) => i.label === 'foo3'));
});

test('modify chained files', () => {
    const code = `
// @filename: test1.py
//// def foo1(): pass

// @filename: test2.py
//// [|/*delete*/|]
//// def foo2(): pass

// @filename: test3.py
//// def foo3(): pass

// @filename: test4.py
//// [|foo/*marker*/|]
    `;

    const basePath = UriEx.file(normalizeSlashes('/'));
    const { data, service } = createServiceWithChainedSourceFiles(basePath, code);

    // Make sure files are all realized.
    const marker = data.markerPositions.get('marker')!;
    const markerUri = marker.fileUri;
    const parseResult = service.getParseResults(markerUri)!;

    // Close file in the middle of the chain
    service.setFileClosed(data.markerPositions.get('delete')!.fileUri);

    // Make sure we don't get suggestion from auto import but from chained files.
    service.test_program.configOptions.autoImportCompletions = false;

    const result = new CompletionProvider(
        service.test_program,
        markerUri,
        convertOffsetToPosition(marker.position, parseResult.tokenizerOutput.lines),
        {
            format: MarkupKind.Markdown,
            lazyEdit: false,
            snippet: false,
        },
        CancellationToken.None
    ).getCompletions();

    assert(result);

    assert(!result.items.some((i) => i.label === 'foo1'));
    assert(!result.items.some((i) => i.label === 'foo2'));
    assert(result.items.some((i) => i.label === 'foo3'));
});

test('modify chained files', async () => {
    const code = `
// @filename: test1.py
//// [|/*changed*/|]
//// def foo1(): pass

// @filename: test2.py
//// def foo2(): pass

// @filename: test3.py
//// def foo3(): pass

// @filename: test4.py
//// [|/*marker*/foo1()|]
    `;

    const basePath = UriEx.file(normalizeSlashes('/'));
    const { data, service } = createServiceWithChainedSourceFiles(basePath, code);

    const marker = data.markerPositions.get('marker')!;
    const markerUri = marker.fileUri;
    const range = data.ranges.find((r) => r.marker === marker)!;

    const parseResults = service.getParseResults(markerUri)!;
    analyze(service.test_program);

    // Initially, there should be no error.
    const initialDiags = await service.getDiagnosticsForRange(
        markerUri,
        convertOffsetsToRange(range.pos, range.end, parseResults.tokenizerOutput.lines),
        CancellationToken.None
    );

    assert.strictEqual(initialDiags.length, 0);

    // Change test1 content
    service.updateOpenFileContents(data.markerPositions.get('changed')!.fileUri, 2, 'def foo5(): pass');
    analyze(service.test_program);

    const finalDiags = await service.getDiagnosticsForRange(
        markerUri,
        convertOffsetsToRange(range.pos, range.end, parseResults.tokenizerOutput.lines),
        CancellationToken.None
    );

    assert.strictEqual(finalDiags.length, 1);
});

function generateChainedFiles(count: number, lastFile: string) {
    let code = '';
    for (let i = 0; i < count; i++) {
        code += `
// @filename: test${i + 1}.py
//// def foo${i + 1}(): pass
`;
    }
    code += lastFile;
    return code;
}

test('chained files with 1000s of files', async () => {
    const lastFile = `
// @filename: testFinal.py
//// [|/*marker*/foo1()|]
    `;
    const code = generateChainedFiles(1000, lastFile);
    const basePath = UriEx.file(normalizeSlashes('/'));
    const { data, service } = createServiceWithChainedSourceFiles(basePath, code);
    const marker = data.markerPositions.get('marker')!;
    const markerUri = marker.fileUri;
    const range = data.ranges.find((r) => r.marker === marker)!;

    const parseResults = service.getParseResults(markerUri)!;
    analyze(service.test_program);

    // There should be no error as it should find the foo1 in the first chained file.
    const initialDiags = await service.getDiagnosticsForRange(
        markerUri,
        convertOffsetsToRange(range.pos, range.end, parseResults.tokenizerOutput.lines),
        CancellationToken.None
    );

    assert.strictEqual(initialDiags.length, 0);
});

test('imported by files', async () => {
    const code = `
// @filename: test1.py
//// import [|/*marker*/os|]

// @filename: test2.py
//// os.path.join()
    `;

    const basePath = UriEx.file(normalizeSlashes('/'));
    const { data, service } = createServiceWithChainedSourceFiles(basePath, code);
    analyze(service.test_program);

    const marker = data.markerPositions.get('marker')!;
    const markerUri = marker.fileUri;
    const range = data.ranges.find((r) => r.marker === marker)!;

    const parseResults = service.getParseResults(markerUri)!;
    const diagnostics = await service.getDiagnosticsForRange(
        markerUri,
        convertOffsetsToRange(range.pos, range.end, parseResults.tokenizerOutput.lines),
        CancellationToken.None
    );

    assert.strictEqual(diagnostics.length, 0);
});

test('re ordering cells', async () => {
    const code = `
// @filename: test1.py
//// import [|/*marker*/os|]

// @filename: test2.py
//// /*bottom*/os.path.join()
    `;

    const basePath = UriEx.file(normalizeSlashes('/'));
    const { data, service } = createServiceWithChainedSourceFiles(basePath, code);
    analyze(service.test_program);

    const marker = data.markerPositions.get('marker')!;
    const markerUri = marker.fileUri;
    const range = data.ranges.find((r) => r.marker === marker)!;

    const bottom = data.markerPositions.get('bottom')!;
    const bottomUri = bottom.fileUri;

    service.updateChainedUri(bottomUri, undefined);
    service.updateChainedUri(markerUri, bottomUri);
    analyze(service.test_program);

    const parseResults = service.getParseResults(markerUri)!;
    const diagnostics = await service.getDiagnosticsForRange(
        markerUri,
        convertOffsetsToRange(range.pos, range.end, parseResults.tokenizerOutput.lines),
        CancellationToken.None
    );

    assert.strictEqual(diagnostics.length, 1);
});

function createServiceWithChainedSourceFiles(basePath: Uri, code: string) {
    const fs = createFromFileSystem(host.HOST, /*ignoreCase*/ false, { cwd: basePath.getFilePath() });
    const service = new AnalyzerService('test service', new ServiceProvider(), {
        console: new NullConsole(),
        hostFactory: () => new TestAccessHost(UriEx.file(vfs.MODULE_PATH), [libFolder, distlibFolder]),
        importResolverFactory: AnalyzerService.createImportResolver,
        configOptions: new ConfigOptions(basePath),
        fileSystem: fs,
    });

    const data = parseTestData(basePath.getFilePath(), code, '');

    let chainedFilePath: Uri | undefined;
    for (const file of data.files) {
        const uri = file.fileUri;
        service.setFileOpened(uri, 1, file.content, IPythonMode.CellDocs, chainedFilePath);
        chainedFilePath = uri;
    }
    return { data, service };
}

function analyze(program: Program) {
    while (program.analyze()) {
        // Process all queued items
    }
}
