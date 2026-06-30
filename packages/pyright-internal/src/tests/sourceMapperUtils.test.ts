/*
 * sourceFile.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for pyright sourceMapperUtils module.
 */
import assert from 'assert';
import { CancellationToken, CancellationTokenSource } from 'vscode-jsonrpc';
import { MarkupKind } from 'vscode-languageserver';

import { AnalyzerService } from '../analyzer/service';
import {
    FunctionDeclaration,
    VariableDeclaration,
    isFunctionDeclaration,
    isVariableDeclaration,
} from '../analyzer/declaration';
import { findNodeByOffset } from '../analyzer/parseTreeUtils';
import { buildImportTree as buildImportTreeImpl } from '../analyzer/sourceMapperUtils';
import { TypeCategory } from '../analyzer/types';
import { ConfigOptions } from '../common/configOptions';
import { NullConsole } from '../common/console';
import { combinePaths, getDirectoryPath, normalizeSlashes } from '../common/pathUtils';
import { convertOffsetToPosition } from '../common/positionUtils';
import { createServiceProvider } from '../common/serviceProviderExtensions';
import { TextRange } from '../common/textRange';
import { UriEx } from '../common/uri/uriUtils';
import { HoverProvider } from '../languageService/hoverProvider';
import { PartialStubService } from '../partialStubService';
import { NameNode, ParseNodeType } from '../parser/parseNodes';
import { PyrightFileSystem } from '../pyrightFileSystem';
import { parseTestData } from './harness/fourslash/fourSlashParser';
import { TestAccessHost } from './harness/testAccessHost';
import { getNodeAtMarker, parseAndGetTestState } from './harness/fourslash/testState';
import { TestFileSystem } from './harness/vfs/filesystem';

function buildImportTree(
    sourceFile: string,
    targetFile: string,
    importResolver: (f: string) => string[],
    token: CancellationToken
): string[] {
    return buildImportTreeImpl(
        UriEx.file(sourceFile),
        UriEx.file(targetFile),
        (from) => {
            const resolved = importResolver(from.getFilePath().slice(1));
            return resolved.map((f) => UriEx.file(f));
        },
        token
    ).map((u) => u.getFilePath().slice(1));
}

describe('BuildImportTree', () => {
    const tokenSource = new CancellationTokenSource();
    test('Simple', () => {
        const results = buildImportTree(
            'A',
            'C',
            (f) => {
                switch (f) {
                    case 'C':
                        return ['B'];
                    case 'B':
                        return ['A'];
                    default:
                        break;
                }
                return [];
            },
            tokenSource.token
        );
        assert.deepEqual(results, ['C', 'B']);
    });

    test('Recursion', () => {
        const results = buildImportTree(
            'A',
            'E',
            (f) => {
                switch (f) {
                    case 'E':
                        return ['D'];
                    case 'D':
                        return ['C', 'B'];
                    case 'C':
                        return ['D'];
                    case 'B':
                        return ['A'];
                    default:
                        break;
                }
                return [];
            },
            tokenSource.token
        );
        assert.deepEqual(results, ['E', 'D', 'B']);
    });

    test('Multiple Paths', () => {
        const results = buildImportTree(
            'A',
            'G',
            (f) => {
                switch (f) {
                    case 'G':
                        return ['F', 'H', 'I'];
                    case 'F':
                        return ['D', 'E'];
                    case 'D':
                        return ['C', 'B'];
                    case 'C':
                        return ['E'];
                    case 'B':
                        return ['A'];
                    default:
                        break;
                }
                return [];
            },
            tokenSource.token
        );
        assert.deepEqual(results, ['G', 'F', 'D', 'B']);
    });

    test('No paths', () => {
        const results = buildImportTree(
            'A',
            'G',
            (f) => {
                switch (f) {
                    case 'G':
                        return ['F', 'H', 'I'];
                    case 'F':
                        return ['D', 'E'];
                    case 'D':
                        return ['C', 'B'];
                    case 'C':
                        return ['E'];
                    default:
                        break;
                }
                return [];
            },
            tokenSource.token
        );
        assert.deepEqual(results, ['G']);
    });

    function genArray(start: number, end: number): string[] {
        return Array(end - start)
            .fill(0)
            .map(() => String.fromCharCode(start++));
    }

    test('Too deep', () => {
        const results = buildImportTree(
            'Z',
            'A',
            (f) => {
                const start = f.charCodeAt(0);
                const end = 'Y'.charCodeAt(0);
                return genArray(start, end);
            },
            tokenSource.token
        );
        assert.deepEqual(results, ['A']);
    });

    test('Canceled', () => {
        const canceled = new CancellationTokenSource();
        canceled.cancel();
        const results = buildImportTree(
            'A',
            'E',
            (f) => {
                switch (f) {
                    case 'E':
                        return ['D'];
                    case 'D':
                        return ['C', 'B'];
                    case 'C':
                        return ['D'];
                    case 'B':
                        return ['A'];
                    default:
                        break;
                }
                return [];
            },
            canceled.token
        );
        assert.deepEqual(results, ['E']);
    });
});

test('find type alias decl', () => {
    const code = `
// @filename: test.py
//// from typing import Mapping
//// [|/*decl*/M|] = Mapping
////
//// def foo(/*marker*/m: M): pass
    `;

    assertTypeAlias(code);
});

test('find type alias decl from inferred type', () => {
    const code = `
// @filename: test.py
//// from typing import Mapping
//// [|/*decl*/M|] = Mapping
////
//// def foo(m: M):
////     return m

// @filename: test1.py
//// from test import foo
//// a = { "hello": 10 }
////
//// /*marker*/b = foo(a)
    `;

    assertTypeAlias(code);
});

function assertTypeAlias(code: string) {
    const state = parseAndGetTestState(code).state;

    const node = getNodeAtMarker(state, 'marker');
    assert(node.nodeType === ParseNodeType.Name);

    const type = state.program.evaluator!.getType(node);
    assert(type?.category === TypeCategory.Class);

    assert.strictEqual(type.shared.name, 'Mapping');
    assert.strictEqual(type.props?.typeAliasInfo?.shared.name, 'M');
    assert.strictEqual(type.props?.typeAliasInfo.shared.moduleName, 'test');

    const marker = state.getMarkerByName('marker');
    const markerUri = marker.fileUri;
    const mapper = state.program.getSourceMapper(
        markerUri,
        CancellationToken.None,
        /* mapCompiled */ false,
        /* preferStubs */ true
    );

    const range = state.getRangeByMarkerName('decl')!;
    const decls = mapper.findDeclarationsByType(markerUri, type, /* userTypeAlias */ true);

    const decl = decls.find((d) => isVariableDeclaration(d) && d.typeAliasName && d.typeAliasName.d.value === 'M') as
        | VariableDeclaration
        | undefined;
    assert(decl);

    assert.deepEqual(TextRange.create(decl.node.start, decl.node.length), TextRange.fromBounds(range.pos, range.end));
}

test('find method declarations through alias factory assignment', () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: _collections_abc.py
// @library: true
//// class MutableMapping:
////     def update(self, value=None):
////         '''Do the thing.
////
////         Updates the internal state.'''
////         pass

// @filename: _typing.pyi
// @library: true
//// from typing import overload
//// class MutableMapping:
////     @overload
////     def update(self) -> None: ...
////     @overload
////     def update(self, value: int) -> None: ...

// @filename: _typing.py
// @library: true
//// from _collections_abc import MutableMapping as _MutableMapping
////
//// def _alias(value, _parameter_count):
////     return value
////
//// MutableMapping = _alias(_MutableMapping, 2)

// @filename: _builtins.pyi
// @library: true
//// from _typing import MutableMapping
//// class MyDict(MutableMapping):
////     pass

// @filename: test.py
//// from _builtins import MyDict
//// d = MyDict()
//// d./*marker*/update()
    `;

    const state = parseAndGetTestState(code).state;
    const node = getNodeAtMarker(state, 'marker') as NameNode;

    assert.strictEqual(node.nodeType, ParseNodeType.Name);

    const decls = state.program.evaluator!.getDeclInfoForNameNode(node)?.decls;
    assert(decls && decls.length > 0, 'Expected declarations for update');

    const stubDecls = decls.filter((decl): decl is FunctionDeclaration => isFunctionDeclaration(decl));
    assert(stubDecls.length > 0, 'Expected function declarations for update');

    const marker = state.getMarkerByName('marker');
    const mapper = state.program.getSourceMapper(
        marker.fileUri,
        CancellationToken.None,
        /* mapCompiled */ false,
        /* preferStubs */ false
    );

    const implDecls = stubDecls.flatMap((decl) => mapper.findFunctionDeclarations(decl));

    assert.deepStrictEqual(getUniqueDeclPaths(implDecls), ['/lib/site-packages/_collections_abc.py']);
});

test('find method declarations through typeshed stdlib alias chain', () => {
    const stdlibSourceRoot = '/python-stdlib';
    const { data, service } = createAnalyzerServiceFromCode(getTypeshedStdlibAliasChainCode(), [stdlibSourceRoot]);
    while (service.test_program.analyze()) {
        // Continue until analysis completes.
    }

    const marker = data.markerPositions.get('marker');
    assert(marker, 'Expected marker for update reference');

    const sourceFile = service.test_program.getBoundSourceFile(marker.fileUri);
    assert(sourceFile, 'Expected source file for marker file');

    const parseResults = sourceFile.getParseResults();
    assert(parseResults, 'Expected parse results for marker file');

    const node = findNodeByOffset(parseResults.parserOutput.parseTree, marker.position) as NameNode;
    assert.strictEqual(node.nodeType, ParseNodeType.Name);

    const decls = service.test_program.evaluator!.getDeclInfoForNameNode(node)?.decls;
    assert(decls && decls.length > 0, 'Expected declarations for update');

    const stubDecls = decls.filter((decl): decl is FunctionDeclaration => isFunctionDeclaration(decl));
    assert(stubDecls.length > 0, 'Expected function declarations for update');

    const mapper = service.test_program.getSourceMapper(
        marker.fileUri,
        CancellationToken.None,
        /* mapCompiled */ false,
        /* preferStubs */ false
    );

    const implDecls = stubDecls.flatMap((decl) => mapper.findFunctionDeclarations(decl));

    assert.deepStrictEqual(getUniqueDeclPaths(implDecls), ['/python-stdlib/_collections_abc.py']);
});

test('hover shows inherited stdlib docstring through configured venv', () => {
    const stdlibSourceRoot = '/python-stdlib';
    const venvPath = '/venvs';
    const venvName = 'test';
    const venvRoot = `${venvPath}/${venvName}`;
    const venvSitePackages = `${venvRoot}/lib/site-packages`;

    const { data, service } = createAnalyzerServiceFromCode(
        getTypeshedStdlibAliasChainCode(),
        [stdlibSourceRoot, venvSitePackages],
        { hostPrefix: venvRoot, venvPath, venv: venvName }
    );
    while (service.test_program.analyze()) {
        // Continue until analysis completes.
    }

    const marker = data.markerPositions.get('marker');
    assert(marker, 'Expected marker for hover target');

    const sourceFile = service.test_program.getBoundSourceFile(marker.fileUri);
    assert(sourceFile, 'Expected source file for hover target');

    const parseResults = sourceFile.getParseResults();
    assert(parseResults, 'Expected parse results for hover target');

    const position = convertOffsetToPosition(marker.position, parseResults.tokenizerOutput.lines);
    const hover = new HoverProvider(
        service.test_program,
        marker.fileUri,
        position,
        MarkupKind.Markdown,
        CancellationToken.None
    ).getHover();

    assert(hover, 'Expected hover result for update');
    assert(!Array.isArray(hover.contents) && typeof hover.contents !== 'string', 'Expected structured hover contents');

    const contents = hover.contents as { kind: MarkupKind; value: string };

    assert.strictEqual(contents.kind, MarkupKind.Markdown);
    const expectedHoverMarkdown =
        '```python\n(method) def update(value: Unknown = None) -> Unknown\n```\n---\nDo the thing.\n\nUpdates the internal state.';
    assert.strictEqual(contents.value, expectedHoverMarkdown);
});

function getUniqueDeclPaths(decls: FunctionDeclaration[]) {
    return Array.from(new Set(decls.map((decl) => normalizeSlashes(decl.uri.getFilePath(), '/'))));
}

function getTypeshedStdlibAliasChainCode() {
    return `
// @filename: /typeshed-fallback/stdlib/typing.pyi
//// class MutableMapping:
////     def update(self, value=None) -> None: ...

// @filename: /python-stdlib/_collections_abc.py
//// class MutableMapping:
////     def update(self, value=None):
////         '''Do the thing.
////
////         Updates the internal state.'''
////         pass

// @filename: /python-stdlib/typing.py
//// from _collections_abc import MutableMapping as _MutableMapping
////
//// def _alias(value, _parameter_count):
////     return value
////
//// MutableMapping = _alias(_MutableMapping, 2)

// @filename: /typeshed-fallback/stdlib/builtins.pyi
//// from typing import MutableMapping
//// class dict(MutableMapping):
////     pass

// @filename: /venvs/test/lib/site-packages/sentinel.py
//// x = 1

// @filename: /src/test.py
//// d = dict()
//// d./*marker*/update()
    `;
}

function createAnalyzerServiceFromCode(code: string, pythonSearchPaths: string[], options?: CustomAnalyzerOptions) {
    const data = parseTestData('/', code, '');
    const testFS = new TestFileSystem(/* ignoreCase */ false, { cwd: normalizeSlashes('/') });

    for (const file of data.files) {
        const filePath = normalizeSlashes(file.fileName);
        testFS.mkdirpSync(getDirectoryPath(filePath));
        testFS.writeFileSync(UriEx.file(filePath), file.content, 'utf8');
    }

    const fs = new PyrightFileSystem(testFS);
    const serviceProvider = createServiceProvider(testFS, fs, new PartialStubService(fs));
    const configOptions = new ConfigOptions(UriEx.file('/'));
    configOptions.internalTestMode = true;
    configOptions.useLibraryCodeForTypes = true;

    if (options?.venvPath && options.venv) {
        configOptions.venvPath = UriEx.file(options.venvPath);
        configOptions.venv = options.venv;
        configOptions.pythonPath = UriEx.file(combinePaths(options.venvPath, options.venv, 'python'));
    }

    const service = new AnalyzerService('test service', serviceProvider, {
        console: new NullConsole(),
        hostFactory: () =>
            new TestAccessHost(
                options?.hostPrefix ? UriEx.file(options.hostPrefix) : serviceProvider.fs().getModulePath(),
                pythonSearchPaths.map((path) => UriEx.file(path)),
                serviceProvider.fs()
            ),
        importResolverFactory: AnalyzerService.createImportResolver,
        configOptions,
        fileSystem: fs,
        libraryReanalysisTimeProvider: () => 0,
        shouldRunAnalysis: () => true,
    });

    for (const file of data.files) {
        service.setFileOpened(file.fileUri, 1, file.content);
    }

    return { data, service };
}

interface CustomAnalyzerOptions {
    hostPrefix?: string;
    venvPath?: string;
    venv?: string;
}
