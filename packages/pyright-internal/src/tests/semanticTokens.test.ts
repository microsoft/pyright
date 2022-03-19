import assert from 'assert';
import { CancellationToken } from 'vscode-jsonrpc';
import { SemanticTokenModifiers, SemanticTokenTypes, integer } from 'vscode-languageserver-types';

import { Program } from '../analyzer/program';
import { AnalyzerService } from '../analyzer/service';
import { IPythonMode } from '../analyzer/sourceFile';
import { ConfigOptions } from '../common/configOptions';
import { NullConsole } from '../common/console';
import { normalizeSlashes } from '../common/pathUtils';
import { ServiceProvider } from '../common/serviceProvider';
import { Uri } from '../common/uri/uri';
import { SemanticTokenEntry, SemanticTokensProvider } from '../languageService/semanticTokensProvider';
import { parseTestData } from './harness/fourslash/fourSlashParser';
import { TestAccessHost } from './harness/testAccessHost';
import * as host from './harness/testHost';
import { createFromFileSystem, distlibFolder, libFolder } from './harness/vfs/factory';
import * as vfs from './harness/vfs/filesystem';

test('check direct declarations', async () => {
    const code = `
// @filename: test2.py
//// [|/*marker*/
//// def foo(): pass
//// @dataclass
//// class Foo:
////     name: str
////     count: int
////     @property
////     def bar(self):
////         return self.count + 1
//// f = Foo("a", 2)
//// f.name
//// f.count
//// |]
    `;

    const basePath = normalizeSlashes('/');
    const { data, service } = createServiceWithChainedSourceFiles(basePath, code);

    const marker = data.markerPositions.get('marker')!;
    const range = data.ranges.find((r) => r.marker === marker)!;

    const parseResults = service.getParseResult(marker.fileUri)!;
    analyze(service.test_program);

    var provider = new SemanticTokensProvider(service.test_program, marker.fileUri, CancellationToken.None);
    const result = provider.getResult();
    assert(result);

    // def foo(): pass
    checkEntry(result.data[0], 1, 4, 3, SemanticTokenTypes.function, [SemanticTokenModifiers.declaration]);

    // class Foo
    checkEntry(result.data[1], 3, 6, 3, SemanticTokenTypes.class, [SemanticTokenModifiers.declaration]);

    // name: str
    checkEntry(result.data[2], 4, 4, 4, SemanticTokenTypes.variable, [
        SemanticTokenModifiers.declaration,
        SemanticTokenModifiers.modification,
    ]);
    checkEntry(result.data[3], 4, 10, 3, SemanticTokenTypes.class, []);

    // count: int
    checkEntry(result.data[4], 5, 4, 5, SemanticTokenTypes.variable, [
        SemanticTokenModifiers.declaration,
        SemanticTokenModifiers.modification,
    ]);
    checkEntry(result.data[5], 5, 11, 3, SemanticTokenTypes.class, []);

    // @property
    checkEntry(result.data[6], 6, 5, 8, SemanticTokenTypes.class, []);

    // def bar(self):
    checkEntry(result.data[7], 7, 8, 3, SemanticTokenTypes.property, [SemanticTokenModifiers.declaration]);
    checkEntry(result.data[8], 7, 12, 4, SemanticTokenTypes.parameter, [SemanticTokenModifiers.declaration]);

    // return self.count + 1
    checkEntry(result.data[9], 8, 15, 4, SemanticTokenTypes.parameter, []);
    checkEntry(result.data[10], 8, 20, 5, SemanticTokenTypes.variable, [SemanticTokenModifiers.modification]);

    // f = Foo("a", 2)
    checkEntry(result.data[11], 9, 0, 1, SemanticTokenTypes.variable, [SemanticTokenModifiers.declaration]);
    checkEntry(result.data[12], 9, 4, 3, SemanticTokenTypes.class, []);

    // f.name
    checkEntry(result.data[13], 10, 0, 1, SemanticTokenTypes.variable, []);
    checkEntry(result.data[14], 10, 2, 4, SemanticTokenTypes.variable, [SemanticTokenModifiers.modification]);

    // f.count
    checkEntry(result.data[15], 11, 0, 1, SemanticTokenTypes.variable, []);
    checkEntry(result.data[16], 11, 2, 5, SemanticTokenTypes.variable, [SemanticTokenModifiers.modification]);
});

function checkEntry(
    entry: SemanticTokenEntry,
    line: integer,
    start: integer,
    length: integer,
    type: SemanticTokenTypes,
    modifiers: SemanticTokenModifiers[]
) {
    assert.strictEqual(entry.line, line);
    assert.strictEqual(entry.start, start);
    assert.strictEqual(entry.length, length);
    assert.strictEqual(entry.type, type);
    assert.deepStrictEqual(entry.modifiers, modifiers);
}

function createServiceWithChainedSourceFiles(basePath: string, code: string) {
    const fs = createFromFileSystem(host.HOST, /*ignoreCase*/ false, { cwd: basePath });
    const service = new AnalyzerService(
        'test service',
        new ServiceProvider(),
        {
            console: new NullConsole(),

            hostFactory: () => new TestAccessHost(Uri.file(vfs.MODULE_PATH), [libFolder, distlibFolder]),
            importResolverFactory: AnalyzerService.createImportResolver,
            configOptions: new ConfigOptions(Uri.file(basePath)),
            fileSystem: fs,
        }
    );

    const data = parseTestData(basePath, code, '');

    let chainedFilePath: Uri | undefined;
    for (const file of data.files) {
        const uri = Uri.file(file.fileName);
        service.setFileOpened(uri, 1, file.content, IPythonMode.None, chainedFilePath);
        chainedFilePath = uri;
    }
    return { data, service };
}

function analyze(program: Program) {
    while (program.analyze()) {
        // Process all queued items
    }
}
