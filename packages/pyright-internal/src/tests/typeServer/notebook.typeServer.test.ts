/*
 * notebook.typeServer.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Tests for the type server's notebook cell-chain maintenance (NotebookUriMapper +
 * createNotebookData / openNotebookCellChain / updateNotebookStructure).
 *
 * This is a Pyright-native port of Pylance's `notebook.common.ts`. It exercises only the
 * cell-chain core functions against a real AnalyzerService; it does not drive the notebook
 * document handler (which just sequences calls to these same functions).
 */

import {
    DidChangeNotebookDocumentParams,
    NotebookCellArrayChange,
    NotebookCellKind,
    TextDocumentIdentifier,
    TextDocumentItem,
} from 'vscode-languageserver-protocol';

import { AnalyzerService } from '../../analyzer/service';
import { IPythonMode } from '../../analyzer/sourceFile';
import { CommandLineOptions } from '../../common/commandLineOptions';
import { NullConsole } from '../../common/console';
import { DiagnosticCategory } from '../../common/diagnostic';
import { normalizeSlashes } from '../../common/pathUtils';
import { ServiceKeys } from '../../common/serviceKeys';
import { createServiceProvider } from '../../common/serviceProviderExtensions';
import { Uri } from '../../common/uri/uri';
import { PyrightFileSystem } from '../../pyrightFileSystem';
import { createNotebookData, openNotebookCellChain, updateNotebookStructure } from '../../typeServer/notebookCellChain';
import { NotebookUriMapper } from '../../typeServer/notebookUriMapper';
import { createInitStatus, WellKnownWorkspaceKinds, Workspace } from '../../workspaceFactory';
import * as host from '../harness/testHost';
import { createFromFileSystem } from '../harness/vfs/factory';

describe('updateNotebookStructure Tests (typeServer mode)', () => {
    const testFileSystem = createFromFileSystem(host.HOST, /* ignoreCase */ false, {
        cwd: normalizeSlashes('/'),
    });
    const fileSystem = new PyrightFileSystem(testFileSystem);
    const serviceProvider = createServiceProvider(testFileSystem, fileSystem);
    let uriMapper: NotebookUriMapper;
    let analyzerService: AnalyzerService;
    let workspace: Workspace;
    const notebookUriString = 'file:///notebook.ipynb';
    const notebookUri = Uri.parse(notebookUriString, serviceProvider);

    beforeEach(() => {
        uriMapper = new NotebookUriMapper(serviceProvider.get(ServiceKeys.caseSensitivityDetector));
        analyzerService = new AnalyzerService('name', serviceProvider, {
            console: new NullConsole(),
            shouldRunAnalysis: () => true,
        });

        // Don't run analysis automatically.
        const options = new CommandLineOptions(normalizeSlashes('/src'), false);
        options.languageServerSettings.enableAmbientAnalysis = false;
        analyzerService.setOptions(options);

        workspace = {
            workspaceName: 'name',
            rootUri: Uri.file('/src', serviceProvider),
            kinds: [WellKnownWorkspaceKinds.Regular],
            service: analyzerService,
            disableLanguageServices: false,
            disableOrganizeImports: false,
            disableWorkspaceSymbol: false,
            isInitialized: createInitStatus(),
            searchPathsToWatch: [],
            disableTaggedHints: false,
        };
    });

    afterEach(() => {
        analyzerService.dispose();
    });

    test('delete cell', () => {
        const nd = _setupWorkspace(notebookUriString, [
            _createCellUri('one'),
            _createCellUri('two'),
            _createCellUri('three'),
        ]);

        const structure = {
            array: { start: 1, deleteCount: 1 },
            didOpen: undefined,
            didClose: [{ uri: _createCellUri('two') }],
        };
        _applyChange(notebookUriString, structure);

        updateNotebookStructure(structure, nd, uriMapper, workspace);

        _verifyUris(nd.mappedCellUris, [_createCellFilePath('one'), _createCellFilePath('three')]);
        expect(analyzerService.hasSourceFile(_createCellFilePath('two'))).toBe(false);
    });

    test('delete top cell', () => {
        const nd = _setupWorkspace(notebookUriString, [
            _createCellUri('one'),
            _createCellUri('two'),
            _createCellUri('three'),
        ]);

        const structure = {
            array: { start: 0, deleteCount: 1 },
            didOpen: undefined,
            didClose: [{ uri: _createCellUri('one') }],
        };
        _applyChange(notebookUriString, structure);

        updateNotebookStructure(structure, nd, uriMapper, workspace);

        _verifyUris(nd.mappedCellUris, [_createCellFilePath('two'), _createCellFilePath('three')]);
        expect(analyzerService.hasSourceFile(_createCellFilePath('one'))).toBe(false);
    });

    test('insert cell', () => {
        const nd = _setupWorkspace(notebookUriString, [_createCellUri('one'), _createCellUri('two')]);
        const structure = {
            array: {
                cells: [{ kind: NotebookCellKind.Code, document: _createCellUri('new') }],
                start: 1,
                deleteCount: 0,
            },
            didOpen: [{ uri: _createCellUri('new'), languageId: 'python', version: 1, text: '' }],
            didClose: undefined,
        };
        _applyChange(notebookUriString, structure);

        updateNotebookStructure(structure, nd, uriMapper, workspace);

        _verifyUris(nd.mappedCellUris, [
            _createCellFilePath('one'),
            _createCellFilePath('new'),
            _createCellFilePath('two'),
        ]);
        expect(analyzerService.hasSourceFile(_createCellFilePath('new'))).toBe(true);
        expect(analyzerService.getChainedUri(_createCellFilePath('new'))?.equals(_createCellFilePath('one'))).toBe(
            true
        );
    });

    test('reorder cell', () => {
        const nd = _setupWorkspace(notebookUriString, [
            _createCellUri('one'),
            _createCellUri('two'),
            _createCellUri('three'),
        ]);
        const structure = {
            array: {
                cells: [
                    { kind: NotebookCellKind.Code, document: _createCellUri('three') },
                    { kind: NotebookCellKind.Code, document: _createCellUri('two') },
                ],
                start: 1,
                deleteCount: 2,
            },
            didOpen: undefined,
            didClose: undefined,
        };
        _applyChange(notebookUriString, structure);

        updateNotebookStructure(structure, nd, uriMapper, workspace);

        _verifyUris(nd.mappedCellUris, [
            _createCellFilePath('one'),
            _createCellFilePath('three'),
            _createCellFilePath('two'),
        ]);
        expect(analyzerService.getChainedUri(_createCellFilePath('two'))?.equals(_createCellFilePath('three'))).toBe(
            true
        );
        expect(analyzerService.getChainedUri(_createCellFilePath('three'))?.equals(_createCellFilePath('one'))).toBe(
            true
        );
    });

    test('repair if duplicate cell detected', () => {
        const nd = _setupWorkspace(notebookUriString, [_createCellUri('one'), _createCellUri('two')]);
        const structure = {
            array: {
                cells: [{ kind: NotebookCellKind.Code, document: _createCellUri('one') }],
                start: 2,
                deleteCount: 0,
            },
            didOpen: [{ uri: _createCellUri('one'), languageId: 'python', version: 1, text: '' }],
            didClose: undefined,
        };
        _applyChange(notebookUriString, structure);

        // Should not throw; instead it should repair the chain by removing the duplicate.
        expect(() => updateNotebookStructure(structure, nd, uriMapper, workspace)).not.toThrow();
        // The duplicate entry should have been removed, leaving only the original two cells.
        _verifyUris(nd.mappedCellUris, [_createCellFilePath('one'), _createCellFilePath('two')]);
    });

    test('delete last cell', () => {
        const nd = _setupWorkspace(notebookUriString, [
            _createCellUri('one'),
            _createCellUri('two'),
            _createCellUri('three'),
        ]);

        const structure = {
            array: { start: 2, deleteCount: 1 },
            didOpen: undefined,
            didClose: [{ uri: _createCellUri('three') }],
        };
        _applyChange(notebookUriString, structure);

        updateNotebookStructure(structure, nd, uriMapper, workspace);

        _verifyUris(nd.mappedCellUris, [_createCellFilePath('one'), _createCellFilePath('two')]);
        expect(analyzerService.hasSourceFile(_createCellFilePath('three'))).toBe(false);
        // The chain should remain intact after the last cell is deleted: prefix → one → two
        expect(analyzerService.getChainedUri(_createCellFilePath('two'))?.equals(_createCellFilePath('one'))).toBe(
            true
        );
        expect(analyzerService.getChainedUri(_createCellFilePath('one'))?.equals(nd.prefixCellUri)).toBe(true);
    });

    test('delete and create cells', () => {
        const nd = _setupWorkspace(notebookUriString, [_createCellUri('one')]);

        const structure = {
            array: {
                cells: [{ kind: NotebookCellKind.Code, document: _createCellUri('new') }],
                start: 0,
                deleteCount: 1,
            },
            didOpen: [{ uri: _createCellUri('new'), languageId: 'python', version: 1, text: '' }],
            didClose: [{ uri: _createCellUri('one') }],
        };
        _applyChange(notebookUriString, structure);

        updateNotebookStructure(structure, nd, uriMapper, workspace);

        _verifyUris(nd.mappedCellUris, [_createCellFilePath('new')]);
        expect(analyzerService.hasSourceFile(_createCellFilePath('new'))).toBe(true);
        expect(analyzerService.getChainedUri(_createCellFilePath('new'))?.equals(nd.prefixCellUri)).toBe(true);
    });

    test('unused symbol in chained source file', () => {
        _setupWorkspace(notebookUriString, [_createCellUri('one'), _createCellUri('two'), _createCellUri('three')]);

        const source1 = workspace.service.test_program.getBoundSourceFileInfo(_createCellFilePath('one'))!;
        const source2 = workspace.service.test_program.getBoundSourceFileInfo(_createCellFilePath('two'))!;
        const source3 = workspace.service.test_program.getBoundSourceFileInfo(_createCellFilePath('three'))!;

        // Since we created the workspace for tests, some flags that would be set when
        // workspace.getSettings is called are not set. Manually set them here.
        source1.isTracked = true;
        source2.isTracked = true;
        source3.isTracked = true;

        _updateCellContent('one', 'import os');
        expect(
            source1.sourceFile
                .getDiagnostics(workspace.service.getConfigOptions())
                ?.some((d) => d.category === DiagnosticCategory.UnusedCode)
        ).toBe(true);

        _updateCellContent('two', 'os');
        expect(
            source1.sourceFile
                .getDiagnostics(workspace.service.getConfigOptions())
                ?.some((d) => d.category === DiagnosticCategory.UnusedCode)
        ).toBe(false);

        _updateCellContent('one', 'import os\nimport sys');
        expect(
            source1.sourceFile
                .getDiagnostics(workspace.service.getConfigOptions())
                ?.some((d) => d.category === DiagnosticCategory.UnusedCode)
        ).toBe(true);

        _updateCellContent('three', 'sys');
        expect(
            source1.sourceFile
                .getDiagnostics(workspace.service.getConfigOptions())
                ?.some((d) => d.category === DiagnosticCategory.UnusedCode)
        ).toBe(false);

        _updateCellContent('two', '');
        expect(
            source1.sourceFile
                .getDiagnostics(workspace.service.getConfigOptions())
                ?.some((d) => d.category === DiagnosticCategory.UnusedCode)
        ).toBe(true);
    });

    function _updateCellContent(cellName: string, text: string) {
        const filePath = _createCellFilePath(cellName);
        const source = workspace.service.test_program.getBoundSourceFileInfo(filePath)!;

        workspace.service.updateOpenFileContents(
            filePath,
            (source.sourceFile.getClientVersion() ?? 0) + 1,
            text,
            IPythonMode.CellDocs
        );

        while (workspace.service.test_program.analyze());
    }

    function _setupWorkspace(notebookUri: string, cellFileUris: string[]) {
        const cells = cellFileUris.map((uri) => TextDocumentItem.create(uri, 'python', 1, ''));
        const params = {
            notebookDocument: {
                notebookType: 'jupyter-notebook',
                uri: notebookUri,
                version: 1,
                cells: cells.map((cell) => ({ kind: NotebookCellKind.Code, document: cell.uri })),
            },
            cellTextDocuments: cells,
        };

        const notebookPath = uriMapper.parseNotebookOpen(params);
        const notebookData = createNotebookData(
            notebookPath,
            cells,
            uriMapper,
            serviceProvider.get(ServiceKeys.caseSensitivityDetector)
        );
        openNotebookCellChain(cells, notebookData, uriMapper, workspace);
        return notebookData;
    }

    function _applyChange(
        notebookUri: string,
        structure: {
            array: NotebookCellArrayChange;
            didOpen?: TextDocumentItem[];
            didClose?: TextDocumentIdentifier[];
        }
    ) {
        const params: DidChangeNotebookDocumentParams = {
            notebookDocument: {
                uri: notebookUri,
                version: 2,
            },
            change: {
                cells: {
                    structure,
                },
            },
        };
        uriMapper.parseNotebookChange(params);
    }

    function _createCellUri(cell: string) {
        return `vscode-notebook-cell:notebook.ipynb#${cell}`;
    }

    function _createCellFilePath(cell: string) {
        return notebookUri.addExtension('.py').withFragment(cell);
    }

    function _verifyUris(actual: Uri[], expected: Uri[]) {
        expect(actual.length).toBe(expected.length);
        for (let i = 0; i < actual.length; i++) {
            expect(actual[i].equals(expected[i])).toBe(true);
        }
    }
});
