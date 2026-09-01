/*
 * typeStubGeneration.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Tests for declarative type stub generation.
 */

import assert from 'assert';
import { CancellationToken, CancellationTokenSource } from 'vscode-languageserver';

import {
    collectTypeStubSourceFileUris,
    createPartialTypeStubGenerationPlan,
    generateTypeStubFiles,
    resolveTypeStubTarget,
    runTypeStubGeneration,
    TypeStubGenerationConflictError,
} from '../analyzer/typeStubGeneration';
import { OperationCanceledException } from '../common/cancellationUtils';
import { Uri } from '../common/uri/uri';
import { parseAndGetTestState } from './harness/fourslash/testState';

test('type stub generation returns files without writing to the file system', async () => {
    const code = `
// @filename: sample.py
//// def answer():
////     return 42
`;
    const state = parseAndGetTestState(code, '/projectRoot').state;
    const sourceUri = Uri.file('/projectRoot/sample.py', state.serviceProvider);
    const outputPath = Uri.file('/projectRoot/typings/sample', state.serviceProvider);
    const stubUri = Uri.file('/projectRoot/typings/sample/__init__.pyi', state.serviceProvider);

    const result = await state.workspace.service.backgroundAnalysisProgram.generateTypeStubFiles(
        {
            source: {
                targetImportPath: sourceUri,
                targetIsSingleFile: true,
                outputPath,
            },
            additionalFiles: [],
        },
        CancellationToken.None
    );

    assert.strictEqual(state.workspace.service.fs.existsSync(stubUri), false);
    assert.strictEqual(result.files.length, 1);
    assert.strictEqual(result.files[0].uri.toString(), stubUri.toString());
    assert.strictEqual(result.files[0].kind, 'stub');
    assert.match(result.files[0].contents, /def answer\(\): # -> Literal\[42\]:/);
});

test.each([
    {
        title: 'single-file module',
        fileName: 'sample.py',
        expectedTargetSuffix: 'site-packages',
        targetIsSingleFile: true,
    },
    {
        title: 'package',
        fileName: 'sample/__init__.py',
        expectedTargetSuffix: 'site-packages/sample',
        targetIsSingleFile: false,
    },
])(
    'target resolution finds a $title without service-specific state',
    ({ fileName, expectedTargetSuffix, targetIsSingleFile }) => {
        const state = parseAndGetTestState(
            `
// @filename: ${fileName}
// @library: true
//// def answer(): return 42
`,
            '/projectRoot'
        ).state;
        const service = state.workspace.service;

        const target = resolveTypeStubTarget(service.getImportResolver(), service.getConfigOptions(), 'sample');

        assert.ok(target.targetImportPath.pathEndsWith(expectedTargetSuffix));
        assert.strictEqual(target.targetIsSingleFile, targetIsSingleFile);
        assert.strictEqual(target.sourceFileUris.length, 1);
        assert.ok(target.sourceFileUris[0].pathEndsWith(fileName));
        assert.ok(target.outputPath.pathEndsWith('typings/sample'));
    }
);

test('target resolution honors the effective custom stub path', () => {
    const state = parseAndGetTestState(
        `
// @filename: pyrightconfig.json
//// { "stubPath": "custom-stubs" }
// @filename: sample.py
// @library: true
//// def answer(): return 42
`,
        '/projectRoot'
    ).state;
    const service = state.workspace.service;

    const target = resolveTypeStubTarget(service.getImportResolver(), service.getConfigOptions(), 'sample');
    const effectiveStubPath = service.getConfigOptions().stubPath!;

    assert.strictEqual(target.stubPath.toString(), effectiveStubPath.toString());
    assert.strictEqual(target.outputPath.toString(), effectiveStubPath.resolvePaths('sample').toString());
    assert.notStrictEqual(
        target.stubPath.toString(),
        service.getConfigOptions().projectRoot.resolvePaths('typings').toString()
    );
});

test('target resolution uses the source file execution environment', () => {
    const state = parseAndGetTestState(
        `
// @filename: pyrightconfig.json
//// {
////     "executionEnvironments": [
////         { "root": "nested", "extraPaths": ["nested-extra"] },
////         { "root": ".", "extraPaths": ["root-extra"] }
////     ]
//// }
// @filename: nested/main.py
//// import sample
// @filename: nested-extra/sample/__init__.py
//// def nested_answer(): return 1
// @filename: root-extra/sample/__init__.py
//// def root_answer(): return 2
`
    ).state;
    const service = state.workspace.service;
    const sourceFileUri = Uri.file('/nested/main.py', state.serviceProvider);

    const defaultTarget = resolveTypeStubTarget(service.getImportResolver(), service.getConfigOptions(), 'sample');
    const sourceTarget = resolveTypeStubTarget(
        service.getImportResolver(),
        service.getConfigOptions(),
        'sample',
        sourceFileUri
    );

    assert.strictEqual(defaultTarget.targetImportPath.toString(), 'file:///root-extra/sample');
    assert.strictEqual(sourceTarget.targetImportPath.toString(), 'file:///nested-extra/sample');
    assert.deepStrictEqual(
        sourceTarget.sourceFileUris.map((uri) => uri.toString()),
        ['file:///nested-extra/sample/__init__.py']
    );
});

test('target resolution reconstructs a dotted full target from the root package', () => {
    const state = parseAndGetTestState(
        `
// @filename: sample/__init__.py
// @library: true
//// # package marker
// @filename: sample/sub/__init__.py
// @library: true
//// # package marker
// @filename: sample/sub/core.py
// @library: true
//// def answer(): return 42
`,
        '/projectRoot'
    ).state;
    const service = state.workspace.service;

    const target = resolveTypeStubTarget(service.getImportResolver(), service.getConfigOptions(), 'sample.sub.core');

    assert.strictEqual(target.targetIsSingleFile, false);
    assert.ok(target.targetImportPath.pathEndsWith('site-packages/sample'));
    assert.strictEqual(target.sourceFileUris.length, 1);
    assert.ok(target.sourceFileUris[0].pathEndsWith('sample/sub/core.py'));
    assert.ok(target.outputPath.pathEndsWith('typings/sample'));
    assert.strictEqual(target.targetImportPath.getRelativePath(target.sourceFileUris[0]), './sub/core.py');
});

test('target resolution starts at the first concrete package below namespace ancestors', () => {
    const state = parseAndGetTestState(
        `
// @filename: testLib/aa/bb/__init__.py
// @library: true
//// # package marker
// @filename: testLib/aa/bb/cc.py
// @library: true
//// value = 1
// @filename: testLib/aa/sibling.py
// @library: true
//// sibling_value = 2
// @filename: testLib/root_sibling.py
// @library: true
//// root_sibling_value = 3
`,
        '/projectRoot'
    ).state;
    const service = state.workspace.service;

    const target = resolveTypeStubTarget(service.getImportResolver(), service.getConfigOptions(), 'testLib.aa.bb');
    const sourceFileUris = collectTypeStubSourceFileUris(service.fs, target, CancellationToken.None);

    assert.ok(target.targetImportPath.pathEndsWith('site-packages/testLib/aa/bb'));
    assert.ok(target.outputPath.pathEndsWith('typings/testLib/aa/bb'));
    assert.strictEqual(target.targetIsSingleFile, false);
    assert.deepStrictEqual(
        sourceFileUris.map((uri) => target.targetImportPath.getRelativePath(uri)),
        ['./__init__.py', './cc.py']
    );
});

test('full generation of a concrete module below namespace ancestors excludes sibling modules', async () => {
    const state = parseAndGetTestState(
        `
// @filename: nspkg/sub/core.py
// @library: true
//// def answer(): return 42
// @filename: nspkg/sub/sibling.py
// @library: true
//// sibling_value = 1
// @filename: unrelated/__init__.py
// @library: true
//// unrelated_value = 2
`,
        '/projectRoot'
    ).state;
    const service = state.workspace.service;

    const result = await runTypeStubGeneration(
        () => service.clone('namespace module stub generation test', 'namespace module stub generation test'),
        { kind: 'full', importName: 'nspkg.sub.core' },
        (_generationService, generated) => generated,
        CancellationToken.None
    );

    assert.deepStrictEqual(
        result.files.map((file) => file.uri.toString()),
        ['file:///typings/nspkg/sub/core.pyi']
    );
});

test('full generation from a dotted import tracks every module under the root package', async () => {
    const state = parseAndGetTestState(
        `
// @filename: sample/__init__.py
// @library: true
//// from .sub import answer
// @filename: sample/root_sibling.py
// @library: true
//// root_value = 1
// @filename: sample/sub/__init__.py
// @library: true
//// from .core import answer
// @filename: sample/sub/core.py
// @library: true
//// def answer(): return 42
// @filename: sample/sub/unimported.py
// @library: true
//// sub_value = 2
`,
        '/projectRoot'
    ).state;
    const service = state.workspace.service;

    const result = await runTypeStubGeneration(
        () => service.clone('full stub generation test', 'full stub generation test'),
        { kind: 'full', importName: 'sample.sub' },
        (_generationService, generated) => generated,
        CancellationToken.None
    );

    assert.deepStrictEqual(
        result.files.map((file) => file.uri.toString()),
        [
            'file:///typings/sample/__init__.pyi',
            'file:///typings/sample/root_sibling.pyi',
            'file:///typings/sample/sub/__init__.pyi',
            'file:///typings/sample/sub/core.pyi',
            'file:///typings/sample/sub/unimported.pyi',
        ]
    );
});

test('package source collection prefers adjacent stubs over Python sources', () => {
    const state = parseAndGetTestState(
        `
// @filename: sample/__init__.py
// @library: true
//// # package marker
// @filename: sample/module.py
// @library: true
//// value = 1
// @filename: sample/module.pyi
// @library: true
//// value: str
`,
        '/projectRoot'
    ).state;
    const service = state.workspace.service;
    const target = resolveTypeStubTarget(service.getImportResolver(), service.getConfigOptions(), 'sample');

    const sourceFileUris = collectTypeStubSourceFileUris(service.fs, target, CancellationToken.None);

    assert.deepStrictEqual(
        sourceFileUris.map((uri) => target.targetImportPath.getRelativePath(uri)),
        ['./__init__.py', './module.pyi']
    );
});

test.each([
    {
        title: 'top-level module',
        importName: 'sample',
        targetFile: '/site-packages/sample.py',
        expectedOutput: '/projectRoot/typings/sample-stubs',
        targetIsSingleFile: true,
    },
    {
        title: 'package',
        importName: 'sample',
        targetFile: '/site-packages/sample/__init__.py',
        expectedOutput: '/projectRoot/typings/sample-stubs',
        targetIsSingleFile: false,
    },
    {
        title: 'nested module',
        importName: 'sample.sub.core',
        targetFile: '/site-packages/sample/sub/core.py',
        expectedOutput: '/projectRoot/typings/sample-stubs/sub',
        targetIsSingleFile: false,
    },
    {
        title: 'nested package',
        importName: 'sample.sub',
        targetFile: '/site-packages/sample/sub/__init__.py',
        expectedOutput: '/projectRoot/typings/sample-stubs/sub',
        targetIsSingleFile: false,
    },
])(
    'partial planning maps a $title and adds the package marker',
    ({ importName, targetFile, expectedOutput, targetIsSingleFile }) => {
        const state = parseAndGetTestState('', '/projectRoot').state;
        const stubPath = Uri.file('/projectRoot/typings', state.serviceProvider);
        const targetFileUri = Uri.file(targetFile, state.serviceProvider);

        const plan = createPartialTypeStubGenerationPlan(state.workspace.service.fs, stubPath, {
            importName,
            targetFileUri,
        });

        assert.strictEqual(plan.source.targetImportPath.toString(), targetFileUri.toString());
        assert.strictEqual(plan.source.targetIsSingleFile, targetIsSingleFile);
        assert.strictEqual(
            plan.source.outputPath.toString(),
            Uri.file(expectedOutput, state.serviceProvider).toString()
        );
        assert.strictEqual(plan.additionalFiles.length, 1);
        assert.strictEqual(
            plan.additionalFiles[0].uri.toString(),
            Uri.file('/projectRoot/typings/sample-stubs/py.typed', state.serviceProvider).toString()
        );
        assert.strictEqual(plan.additionalFiles[0].contents, 'partial\n');
        assert.strictEqual(plan.additionalFiles[0].kind, 'partialMarker');
    }
);

test.each([
    '',
    '.sample',
    'sample.',
    '/outside/pkg',
    '../outside',
    'sample..sub',
    'sample/sub',
    String.raw`C:\outside\pkg`,
])('partial planning rejects invalid import name %s', (importName) => {
    const state = parseAndGetTestState('', '/projectRoot').state;
    const stubPath = Uri.file('/projectRoot/typings', state.serviceProvider);

    assert.throws(
        () =>
            createPartialTypeStubGenerationPlan(state.workspace.service.fs, stubPath, {
                importName,
                targetFileUri: Uri.file('/site-packages/sample.py', state.serviceProvider),
            }),
        /Invalid import name/
    );
});

test.each([
    '',
    '.sample',
    'sample.',
    '/outside/pkg',
    '../outside',
    'sample..sub',
    'sample/sub',
    String.raw`C:\outside\pkg`,
])('full target resolution rejects invalid import name %s before import resolution', (importName) => {
    const state = parseAndGetTestState('', '/projectRoot').state;
    const service = state.workspace.service;
    const resolveImport = jest.spyOn(service.getImportResolver(), 'resolveImport');

    assert.throws(
        () => resolveTypeStubTarget(service.getImportResolver(), service.getConfigOptions(), importName),
        /Invalid import name/
    );
    assert.strictEqual(resolveImport.mock.calls.length, 0);
});

test('partial planning preserves a valid marker and rejects an incompatible marker', () => {
    const state = parseAndGetTestState('', '/projectRoot').state;
    const fs = state.workspace.service.fs;
    const stubPath = Uri.file('/projectRoot/typings', state.serviceProvider);
    const markerUri = stubPath.resolvePaths('sample-stubs').pytypedUri;
    const options = {
        importName: 'sample',
        targetFileUri: Uri.file('/site-packages/sample.py', state.serviceProvider),
    };
    fs.mkdirSync(markerUri.getDirectory(), { recursive: true });
    fs.writeFileSync(markerUri, 'partial\r\n', 'utf8');

    assert.deepStrictEqual(createPartialTypeStubGenerationPlan(fs, stubPath, options).additionalFiles, []);

    fs.writeFileSync(markerUri, 'partial\n', 'utf8');

    assert.deepStrictEqual(createPartialTypeStubGenerationPlan(fs, stubPath, options).additionalFiles, []);

    fs.writeFileSync(markerUri, 'full\n', 'utf8');
    assert.throws(
        () => createPartialTypeStubGenerationPlan(fs, stubPath, options),
        (error) =>
            error instanceof TypeStubGenerationConflictError &&
            error.uri.equals(markerUri) &&
            /is incompatible with partial stub generation/.test(error.message)
    );

    fs.unlinkSync(markerUri);
    fs.mkdirSync(markerUri);
    assert.throws(
        () => createPartialTypeStubGenerationPlan(fs, stubPath, options),
        (error) => error instanceof TypeStubGenerationConflictError && error.uri.equals(markerUri)
    );
});

test('partial generation appends the package marker to generated stubs', () => {
    const state = parseAndGetTestState(
        `
// @filename: sample.py
//// def answer():
////     return 42
`,
        '/projectRoot'
    ).state;
    const service = state.workspace.service;
    const stubPath = Uri.file('/projectRoot/typings', state.serviceProvider);
    const sourceUri = Uri.file('/projectRoot/sample.py', state.serviceProvider);
    const plan = createPartialTypeStubGenerationPlan(service.fs, stubPath, {
        importName: 'sample',
        targetFileUri: sourceUri,
    });

    const result = generateTypeStubFiles(service.backgroundAnalysisProgram.program, plan, CancellationToken.None);

    assert.deepStrictEqual(
        result.files.map((file) => ({ uri: file.uri.toString(), kind: file.kind })),
        [
            {
                uri: Uri.file('/projectRoot/typings/sample-stubs/__init__.pyi', state.serviceProvider).toString(),
                kind: 'stub',
            },
            {
                uri: Uri.file('/projectRoot/typings/sample-stubs/py.typed', state.serviceProvider).toString(),
                kind: 'partialMarker',
            },
        ]
    );
    assert.match(result.files[0].contents, /def answer\(\): # -> Literal\[42\]:/);
    assert.strictEqual(result.files[1].contents, 'partial\n');
});

test('package generation stops on cancellation without writing output', () => {
    const code = `
// @filename: sample/a.py
//// value = 1
// @filename: sample/b.py
//// value = 2
`;
    const state = parseAndGetTestState(code, '/projectRoot').state;
    const program = state.workspace.service.backgroundAnalysisProgram.program;
    const targetImportPath = Uri.file('/projectRoot/sample', state.serviceProvider);
    const outputPath = Uri.file('/projectRoot/typings/sample', state.serviceProvider);
    const cancellationSource = new CancellationTokenSource();
    const analyzeFile = program.analyzeFile.bind(program);
    jest.spyOn(program, 'analyzeFile').mockImplementation((fileUri, token) => {
        const result = analyzeFile(fileUri, token);
        cancellationSource.cancel();
        return result;
    });

    assert.throws(
        () =>
            generateTypeStubFiles(
                program,
                {
                    source: {
                        targetImportPath,
                        targetIsSingleFile: false,
                        outputPath,
                    },
                    additionalFiles: [],
                },
                cancellationSource.token
            ),
        (error: unknown) => OperationCanceledException.is(error)
    );
    assert.strictEqual(state.workspace.service.fs.existsSync(outputPath), false);
});

test('package generation rejects an empty target instead of returning false success', () => {
    const state = parseAndGetTestState(
        `
// @filename: sample.py
//// value = 1
`,
        '/projectRoot'
    ).state;
    const outputPath = Uri.file('/projectRoot/typings/empty', state.serviceProvider);

    assert.throws(
        () =>
            generateTypeStubFiles(
                state.workspace.service.backgroundAnalysisProgram.program,
                {
                    source: {
                        targetImportPath: Uri.file('/projectRoot/empty', state.serviceProvider),
                        targetIsSingleFile: false,
                        outputPath,
                    },
                    additionalFiles: [],
                },
                CancellationToken.None
            ),
        /No source files found/
    );
    assert.strictEqual(state.workspace.service.fs.existsSync(outputPath), false);
});

test.each(['nspkg', 'nspkg.sub'])(
    'target resolution rejects namespace-only target %s instead of widening source collection',
    (importName) => {
        const state = parseAndGetTestState(
            `
// @filename: nspkg/sub/a.py
// @library: true
//// value_a = 1
// @filename: nspkg/sub/b.py
// @library: true
//// value_b = 2
`,
            '/projectRoot'
        ).state;
        const service = state.workspace.service;

        assert.throws(
            () => resolveTypeStubTarget(service.getImportResolver(), service.getConfigOptions(), importName),
            /namespace package/
        );
    }
);
