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
import { parseTestData } from './harness/fourslash/fourSlashParser';
import { TestAccessHost } from './harness/testAccessHost';
import * as host from './harness/testHost';
import { createFromFileSystem, distlibFolder, libFolder } from './harness/vfs/factory';
import * as vfs from './harness/vfs/filesystem';
import { CompletionProvider } from '../languageService/completionProvider';

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

    const basePath = normalizeSlashes('/');
    const { data, service } = createServiceWithChainedSourceFiles(basePath, code);

    const marker = data.markerPositions.get('marker')!;

    const parseResult = service.getParseResult(marker.fileName)!;
    const result = new CompletionProvider(
        service.test_program,
        basePath,
        marker.fileName,
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

    const basePath = normalizeSlashes('/');
    const { data, service } = createServiceWithChainedSourceFiles(basePath, code);

    // Make sure files are all realized.
    const marker = data.markerPositions.get('marker')!;
    const parseResult = service.getParseResult(marker.fileName)!;

    // Close file in the middle of the chain
    service.setFileClosed(data.markerPositions.get('delete')!.fileName);

    // Make sure we don't get suggestion from auto import but from chained files.
    service.test_program.configOptions.autoImportCompletions = false;

    const result = new CompletionProvider(
        service.test_program,
        basePath,
        marker.fileName,
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

    const basePath = normalizeSlashes('/');
    const { data, service } = createServiceWithChainedSourceFiles(basePath, code);

    const marker = data.markerPositions.get('marker')!;
    const range = data.ranges.find((r) => r.marker === marker)!;

    const parseResults = service.getParseResult(marker.fileName)!;
    analyze(service.test_program);

    // Initially, there should be no error.
    const initialDiags = await service.getDiagnosticsForRange(
        marker.fileName,
        convertOffsetsToRange(range.pos, range.end, parseResults.tokenizerOutput.lines),
        CancellationToken.None
    );

    assert.strictEqual(initialDiags.length, 0);

    // Change test1 content
    service.updateOpenFileContents(data.markerPositions.get('changed')!.fileName, 2, 'def foo5(): pass');
    analyze(service.test_program);

    const finalDiags = await service.getDiagnosticsForRange(
        marker.fileName,
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
    const basePath = normalizeSlashes('/');
    const { data, service } = createServiceWithChainedSourceFiles(basePath, code);
    const marker = data.markerPositions.get('marker')!;
    const range = data.ranges.find((r) => r.marker === marker)!;

    const parseResults = service.getParseResult(marker.fileName)!;
    analyze(service.test_program);

    // There should be no error as it should find the foo1 in the first chained file.
    const initialDiags = await service.getDiagnosticsForRange(
        marker.fileName,
        convertOffsetsToRange(range.pos, range.end, parseResults.tokenizerOutput.lines),
        CancellationToken.None
    );

    assert.strictEqual(initialDiags.length, 0);
});

function createServiceWithChainedSourceFiles(basePath: string, code: string) {
    const service = new AnalyzerService(
        'test service',
        createFromFileSystem(host.HOST, /*ignoreCase*/ false, { cwd: basePath }),
        {
            console: new NullConsole(),
            hostFactory: () => new TestAccessHost(vfs.MODULE_PATH, [libFolder, distlibFolder]),
            importResolverFactory: AnalyzerService.createImportResolver,
            configOptions: new ConfigOptions(basePath),
        }
    );

    const data = parseTestData(basePath, code, '');

    let chainedFilePath: string | undefined;
    for (const file of data.files) {
        service.setFileOpened(file.fileName, 1, file.content, IPythonMode.None, chainedFilePath);
        chainedFilePath = file.fileName;
    }
    return { data, service };
}

function analyze(program: Program) {
    while (program.analyze()) {
        // Process all queued items
    }
}
