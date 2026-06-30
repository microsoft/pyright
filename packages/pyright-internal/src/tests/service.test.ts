/*
 * service.test.ts
 *
 * service tests.
 */

import assert from 'assert';

import { CancellationToken } from 'vscode-jsonrpc';
import { InvalidatedReason } from '../analyzer/backgroundAnalysisProgram';
import { SourceEnumerator } from '../analyzer/sourceEnumerator';
import { IPythonMode } from '../analyzer/sourceFile';
import { NullConsole } from '../common/console';
import { CommandLineOptions } from '../common/commandLineOptions';
import { combinePaths, getDirectoryPath, normalizeSlashes } from '../common/pathUtils';
import { Uri } from '../common/uri/uri';
import { getFileSpec, UriEx } from '../common/uri/uriUtils';
import { TestFileSystem } from './harness/vfs/filesystem';
import { parseTestData } from './harness/fourslash/fourSlashParser';
import { parseAndGetTestState, TestState } from './harness/fourslash/testState';

test('random library file changed', () => {
    const state = parseAndGetTestState('', '/projectRoot').state;

    assert.strictEqual(
        state.workspace.service.test_shouldHandleLibraryFileWatchChanges(
            Uri.file('/site-packages/test.py', state.serviceProvider),
            [Uri.file('/site-packages', state.serviceProvider)]
        ),
        true
    );
});

test('random library file starting with . changed', () => {
    const state = parseAndGetTestState('', '/projectRoot').state;

    assert.strictEqual(
        state.workspace.service.test_shouldHandleLibraryFileWatchChanges(
            Uri.file('/site-packages/.test.py', state.serviceProvider),
            [Uri.file('/site-packages', state.serviceProvider)]
        ),
        false
    );
});

test('source enumeration reports symlinked include roots', () => {
    const fs = new TestFileSystem(/* ignoreCase */ false, { cwd: '/' });
    fs.mkdirpSync('/realRoot/pkg');
    fs.writeFileSync(Uri.file('/realRoot/pkg/module.py', fs), 'x = 1');
    fs.symlinkSync('/realRoot', '/workspaceLink');

    const enumerator = new SourceEnumerator(
        [getFileSpec(Uri.file('/', fs), 'workspaceLink')],
        [],
        /* autoExcludeVenv */ false,
        fs,
        new NullConsole()
    );

    const result = enumerator.enumerate(/* timeLimitInMs */ 1000);

    assert.strictEqual(result.isComplete, true);
    assert.deepStrictEqual(
        enumerator.getSymlinkedDirectoryRoots().map((uri) => uri.key),
        [Uri.file('/workspaceLink', fs).key]
    );
});

test('random library file changed, nested search paths', () => {
    const state = parseAndGetTestState('', '/projectRoot').state;

    assert.strictEqual(
        state.workspace.service.test_shouldHandleLibraryFileWatchChanges(
            Uri.file('/lib/.venv/site-packages/myFile.py', state.serviceProvider),
            [Uri.file('/lib', state.serviceProvider), Uri.file('/lib/.venv/site-packages', state.serviceProvider)]
        ),
        true
    );
});

test('random library file changed, nested search paths, fs is not case sensitive', () => {
    const code = `
// global options
// @ignoreCase: true
        `;
    const state = parseAndGetTestState(code, '/projectRoot').state;

    assert.strictEqual(
        state.workspace.service.test_shouldHandleLibraryFileWatchChanges(
            Uri.file('/lib/.venv/site-packages/myFile.py', state.serviceProvider),
            [Uri.file('/lib', state.serviceProvider), Uri.file('/LIB/.venv/site-packages', state.serviceProvider)]
        ),
        true
    );
});

test('random library file changed, nested search paths, fs is case sensitive', () => {
    const code = `
// global options
// @ignoreCase: false
        `;
    const state = parseAndGetTestState(code, '/projectRoot').state;

    assert.strictEqual(
        state.workspace.service.test_shouldHandleLibraryFileWatchChanges(
            Uri.file('/lib/.venv/site-packages/myFile.py', state.serviceProvider),
            [Uri.file('/lib', state.serviceProvider), Uri.file('/LIB/.venv/site-packages', state.serviceProvider)]
        ),
        false
    );
});

test('random library file starting with . changed, fs is not case sensitive', () => {
    const code = `
// global options
// @ignoreCase: true
    `;
    const state = parseAndGetTestState(code, '/projectRoot').state;

    assert.strictEqual(
        state.workspace.service.test_shouldHandleLibraryFileWatchChanges(
            Uri.file('/lib/.test.py', state.serviceProvider),
            [Uri.file('/LIB', state.serviceProvider), Uri.file('/lib/site-packages', state.serviceProvider)]
        ),
        false
    );
});

test('random library file starting with . changed, fs is case sensitive', () => {
    const code = `
// global options
// @ignoreCase: false
    `;
    const state = parseAndGetTestState(code, '/projectRoot').state;

    assert.strictEqual(
        state.workspace.service.test_shouldHandleLibraryFileWatchChanges(
            Uri.file('/lib/.test.py', state.serviceProvider),
            [Uri.file('/LIB', state.serviceProvider), Uri.file('/lib/site-packages', state.serviceProvider)]
        ),
        true
    );
});

test('random library file under a folder starting with . changed', () => {
    const state = parseAndGetTestState('', '/projectRoot').state;

    assert.strictEqual(
        state.workspace.service.test_shouldHandleLibraryFileWatchChanges(
            Uri.file('/site-packages/.testFolder/test.py', state.serviceProvider),
            [Uri.file('/site-packages', state.serviceProvider)]
        ),
        false
    );
});

test('basic file change', () => {
    const code = `
// @filename: test.py
//// [|/*marker*/|]
    `;

    testSourceFileWatchChange(code);
});

test('non python file', () => {
    const code = `
// @filename: test.pyc
//// [|/*marker*/|]
    `;

    testSourceFileWatchChange(code, /* expected */ false);
});

test('temp file', () => {
    const code = `
// @filename: test.py.12345678901234567890123456789012.py
//// [|/*marker*/|]
    `;

    testSourceFileWatchChange(code, /* expected */ false);
});

test('excluded file', () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "exclude": ["**/excluded.py"]
//// }

// @filename: included.py
//// # empty

// @filename: excluded.py
//// [|/*marker*/|]
    `;

    testSourceFileWatchChange(code, /* expected */ false);
});

test('excluded but still part of program', () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "exclude": ["**/excluded.py"]
//// }

// @filename: included.py
//// from . import excluded

// @filename: excluded.py
//// [|/*marker*/|]
    `;

    const state = parseAndGetTestState(code, '/projectRoot').state;
    const marker = state.getMarkerByName('marker');

    while (state.workspace.service.test_program.analyze());

    assert.strictEqual(
        state.workspace.service.test_shouldHandleSourceFileWatchChanges(marker.fileUri, /* isFile */ true),
        true
    );
});

test('py.typed marker file', () => {
    const code = `
// @filename: myPkg/__init__.py
//// # empty

// @filename: myPkg/py.typed
//// [|/*marker*/|]
    `;

    testSourceFileWatchChange(code, /* expected */ true);
});

test('py.typed marker file outside workspace semantics', () => {
    const code = `
// @filename: random/py.typed
//// [|/*marker*/|]
    `;

    testSourceFileWatchChange(code, /* expected */ false);
});

test('py.typed marker file add causes invalidation', () => {
    const code = `
// @filename: myPkg/__init__.py
//// # empty
    `;

    const state = parseAndGetTestState(code, '/projectRoot').state;
    const pyTypedUri = Uri.file('/projectRoot/myPkg/py.typed', state.serviceProvider);

    // Setup the file watcher for the project.
    const cmdOptions = new CommandLineOptions(state.workspace.rootUri, false);
    cmdOptions.languageServerSettings.watchForSourceChanges = true;
    state.workspace.service.setOptions(cmdOptions);

    let invalidatedReason: InvalidatedReason | undefined;
    state.workspace.service.test_setOnInvalidatedCallback((reason) => {
        invalidatedReason = reason;
    });

    state.testFS.writeFileSync(pyTypedUri, 'marker');
    state.testFS.fireFileWatcherEvent(pyTypedUri.toString(), 'add');

    assert.strictEqual(invalidatedReason, InvalidatedReason.SourceWatcherChanged);
});

test('py.typed marker file change causes invalidation', () => {
    const code = `
// @filename: myPkg/__init__.py
//// # empty

// @filename: myPkg/py.typed
//// marker
    `;

    const state = parseAndGetTestState(code, '/projectRoot').state;
    const pyTypedUri = Uri.file('/projectRoot/myPkg/py.typed', state.serviceProvider);

    // Setup the file watcher for the project.
    const cmdOptions = new CommandLineOptions(state.workspace.rootUri, false);
    cmdOptions.languageServerSettings.watchForSourceChanges = true;
    state.workspace.service.setOptions(cmdOptions);

    let invalidatedReason: InvalidatedReason | undefined;
    state.workspace.service.test_setOnInvalidatedCallback((reason) => {
        invalidatedReason = reason;
    });

    state.testFS.writeFileSync(pyTypedUri, 'changed');
    state.testFS.fireFileWatcherEvent(pyTypedUri.toString(), 'change');

    assert.strictEqual(invalidatedReason, InvalidatedReason.SourceWatcherChanged);
});

test('py.typed marker file delete causes invalidation', () => {
    const code = `
// @filename: myPkg/__init__.py
//// # empty

// @filename: myPkg/py.typed
//// marker
    `;

    const state = parseAndGetTestState(code, '/projectRoot').state;
    const pyTypedUri = Uri.file('/projectRoot/myPkg/py.typed', state.serviceProvider);

    // Setup the file watcher for the project.
    const cmdOptions = new CommandLineOptions(state.workspace.rootUri, false);
    cmdOptions.languageServerSettings.watchForSourceChanges = true;
    state.workspace.service.setOptions(cmdOptions);

    let invalidatedReason: InvalidatedReason | undefined;
    state.workspace.service.test_setOnInvalidatedCallback((reason) => {
        invalidatedReason = reason;
    });

    // The watcher reports only 'add' and 'change'. Deletions are inferred when the path can't be stat'ed.
    state.testFS.unlinkSync(pyTypedUri);
    state.testFS.fireFileWatcherEvent(pyTypedUri.toString(), 'change');

    assert.strictEqual(invalidatedReason, InvalidatedReason.SourceWatcherChanged);
});

test('random folder changed', () => {
    const code = `
// @filename: notUsed.py
//// # empty
    `;

    const state = parseAndGetTestState(code, '/projectRoot').state;

    assert.strictEqual(
        state.workspace.service.test_shouldHandleSourceFileWatchChanges(
            Uri.file('/randomFolder', state.serviceProvider),
            /* isFile */ false
        ),
        false
    );
});

test('excluded folder changed', () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "exclude": ["**/.*"]
//// }
    
// @filename: .excluded/notUsed.py
//// [|/*marker*/|]
    `;

    testSourceFileWatchChange(code, /* expected */ false, /* isFile */ false);
});

test('file under excluded folder changed', () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "exclude": ["**/.*"]
//// }
    
// @filename: included.py
//// # empty

// @filename: .excluded/notUsed.py
//// [|/*marker*/|]
    `;

    testSourceFileWatchChange(code, /* expected */ false);
});

test('folder under excluded folder changed', () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "exclude": ["**/.*"]
//// }

// @filename: .excluded/nested/notUsed.py
//// [|/*marker*/|]
    `;

    testSourceFileWatchChange(code, /* expected */ false, /* isFile */ false);
});

test('folder that contains no file has changed', () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "exclude": ["**/excluded.py"]
//// }

// @filename: included.py
//// # empty

// @filename: lib/excluded.py
//// [|/*marker*/|]
    `;

    testSourceFileWatchChange(code, /* expected */ false, /* isFile */ false);
});

test('folder that contains a file has changed', () => {
    const code = `
// @filename: lib/included.py
//// [|/*marker*/|]
    `;

    testSourceFileWatchChange(code, /* expected */ true, /* isFile */ false);
});

test('folder that contains no file but whose parent has __init__ has changed', () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "exclude": ["**/excluded.py"]
//// }

// @filename: lib/__init__.py
//// # empty

// @filename: lib/nested/excluded.py
//// [|/*marker*/|]
    `;

    testSourceFileWatchChange(code, /* expected */ true, /* isFile */ false);
});

test('library file watching for extra path under workspace', () => {
    const watchers = getRegisteredLibraryFileWatchers('/src', ['extraPath'], ['extraPath/**']);
    assert(watchers.some((w) => w.paths.some((p) => p.equals(UriEx.file('/src/extraPath')))));
});

test('user file watching as extra path under workspace', () => {
    // Sometimes, this trick is used to make sub-modules to top-level modules.
    const watchers = getRegisteredLibraryFileWatchers('/src', ['extraPath']);

    // This shouldn't be recognized as library file.
    assert(!watchers.some((w) => w.paths.some((p) => p.equals(UriEx.file('/src/extraPath')))));
});

test('library file watching another workspace root using extra path', () => {
    // The extra path for a different workspace root will be initially added as a relative path,
    // but when it reaches the service layer, it will be normalized to an absolute path.
    // That's why it is used as an absolute path here.
    const watchers = getRegisteredLibraryFileWatchers('/root1', ['/root2']);
    assert(watchers.some((w) => w.paths.some((p) => p.equals(UriEx.file('/root2')))));
});

test('program containsSourceFileIn', () => {
    const code = `
// @ignoreCase: true

// @filename: myLib/__init__.py
//// # empty
    `;

    const state = parseAndGetTestState(code, '/projectRoot').state;
    assert(state.workspace.service.test_program.containsSourceFileIn(state.activeFile.fileUri));
});

test('service runEditMode', () => {
    const code = `
// @filename: open.py
//// /*open*/

// @filename: closed.py
//// /*closed*/
    `;

    const state = parseAndGetTestState(code, '/projectRoot').state;
    const open = state.getMarkerByName('open');
    const closed = state.getMarkerByName('closed');
    const openUri = open.fileUri;
    const closedUri = closed.fileUri;

    const newFileUri = Uri.file(combinePaths(getDirectoryPath(open.fileName), 'interimFile.py'), state.serviceProvider);
    state.testFS.writeFileSync(newFileUri, '# empty', 'utf8');

    const options = {
        ipythonMode: IPythonMode.None,
        chainedFileUri: newFileUri,
    };

    // try run edit mode
    verifyRunEditMode('# first');

    // try run again to make sure things are cleared up correctly
    verifyRunEditMode('# second');

    function verifyRunEditMode(value: string) {
        state.workspace.service.runEditMode((p) => {
            p.addInterimFile(newFileUri);
            p.setFileOpened(openUri, 0, value, options);
            p.setFileOpened(closedUri, 0, value, options);

            const interim = p.getSourceFileInfo(newFileUri);
            assert(interim);

            const openFile = p.getSourceFileInfo(openUri);
            assert(openFile);
            assert(openFile.isOpenByClient);
            assert.strictEqual(value, openFile.contents);

            const closedFile = p.getSourceFileInfo(closedUri);
            assert(closedFile);
            assert(closedFile.isOpenByClient);
            assert.strictEqual(value, closedFile.contents);
        }, CancellationToken.None);

        const interim = state.workspace.service.test_program.getSourceFileInfo(newFileUri);
        assert(!interim);

        const openFile = state.workspace.service.test_program.getSourceFileInfo(openUri);
        assert(openFile);
        assert(openFile.isOpenByClient);

        assert.strictEqual('', openFile.contents?.trim());

        const closedFile = state.workspace.service.test_program.getSourceFileInfo(closedUri);
        assert(closedFile);
        assert(!closedFile.isOpenByClient);

        const content = closedFile.contents ?? '';
        assert.strictEqual('', content.trim());
    }
});

test('setFileOpened does not change tracked state for existing source files', () => {
    const state = parseAndGetTestState('', '/projectRoot').state;
    const program = state.workspace.service.test_program;
    const uri = UriEx.file('/projectRoot/interim.py');

    program.addInterimFile(uri);

    const sourceFileInfo = program.getSourceFileInfo(uri);
    assert(sourceFileInfo);
    assert.strictEqual(sourceFileInfo.isTracked, false);
    const oldEvaluator = program.evaluator;

    // Opening an existing untracked file does not change its tracked state.
    // Tracking is determined at creation time.
    program.setFileOpened(uri, 1, 'value = 1', {
        ipythonMode: IPythonMode.None,
        chainedFileUri: undefined,
    });

    assert.strictEqual(sourceFileInfo.isOpenByClient, true);
    assert.strictEqual(sourceFileInfo.isTracked, false);
    assert.strictEqual(program.evaluator, oldEvaluator);
});

test('setTrackedFiles does not untrack virtual open files', () => {
    const state = parseAndGetTestState('', '/projectRoot').state;
    const program = state.workspace.service.test_program;
    const uri = Uri.parse('vscode-copilot-chat-code-block://conversation/block1.py', state.serviceProvider);

    program.setFileOpened(uri, 1, 'value = 1', {
        isVirtual: true,
        ipythonMode: IPythonMode.None,
        chainedFileUri: undefined,
    });

    program.setTrackedFiles([]);

    const sourceFileInfo = program.getSourceFileInfo(uri);
    assert(sourceFileInfo);
    assert.strictEqual(sourceFileInfo.isOpenByClient, true);
    assert.strictEqual(sourceFileInfo.isVirtual, true);
    assert.strictEqual(sourceFileInfo.isTracked, true);
});

test('setFileOpened does not recreate evaluator for new files', () => {
    const state = parseAndGetTestState('', '/projectRoot').state;
    const program = state.workspace.service.test_program;
    const oldEvaluator = program.evaluator;
    const uri = UriEx.file('/projectRoot/newFile.py');

    program.setFileOpened(uri, 1, 'value = 1', {
        ipythonMode: IPythonMode.None,
        chainedFileUri: undefined,
    });

    assert.strictEqual(program.evaluator, oldEvaluator);
});

test('setTrackedFiles does not preserve tracked state for non-virtual open files', () => {
    const state = parseAndGetTestState('', '/projectRoot').state;
    const program = state.workspace.service.test_program;
    const uri = UriEx.file('/projectRoot/interim.py');

    state.testFS.mkdirpSync('/projectRoot');
    state.testFS.writeFileSync(uri, 'value = 1');
    program.addTrackedFile(uri);
    const oldEvaluator = program.evaluator;

    program.setFileOpened(uri, 1, 'value = 1', {
        ipythonMode: IPythonMode.None,
        chainedFileUri: undefined,
    });

    program.setTrackedFiles([]);

    const sourceFileInfo = program.getSourceFileInfo(uri);
    assert(sourceFileInfo);
    assert.strictEqual(sourceFileInfo.isOpenByClient, true);
    assert.strictEqual(sourceFileInfo.isVirtual, false);
    assert.strictEqual(sourceFileInfo.isTracked, false);
    assert.strictEqual(program.evaluator, oldEvaluator);
});

test('setFileClosed auto-untracks and removes virtual files from the source list', () => {
    const state = parseAndGetTestState('', '/projectRoot').state;
    const program = state.workspace.service.test_program;
    const uri = Uri.parse('vscode-copilot-chat-code-block://conversation/block1.py', state.serviceProvider);

    program.setFileOpened(uri, 1, 'value = 1', {
        isVirtual: true,
        ipythonMode: IPythonMode.None,
        chainedFileUri: undefined,
    });

    const sourceFileInfo = program.getSourceFileInfo(uri);
    assert(sourceFileInfo);
    assert.strictEqual(sourceFileInfo.isTracked, true);
    assert.strictEqual(sourceFileInfo.isVirtual, true);

    program.setFileClosed(uri);

    // Virtual files are auto-untracked on close and removed from source list
    assert.strictEqual(program.getSourceFileInfo(uri), undefined);
});

test('untitled files are treated as virtual and survive setTrackedFiles', () => {
    const state = parseAndGetTestState('', '/projectRoot').state;
    const program = state.workspace.service.test_program;
    const uri = Uri.parse('untitled:Untitled-1.py', state.serviceProvider);

    program.setFileOpened(uri, 1, 'value = 1', {
        isVirtual: uri.isUntitled(),
        ipythonMode: IPythonMode.None,
        chainedFileUri: undefined,
    });

    const sourceFileInfo = program.getSourceFileInfo(uri);
    assert(sourceFileInfo);
    assert.strictEqual(sourceFileInfo.isVirtual, true);
    assert.strictEqual(sourceFileInfo.isTracked, true);

    // Untitled files should survive tracked-file refresh since they
    // are in-memory-only and don't participate in disk enumeration.
    program.setTrackedFiles([]);

    assert.strictEqual(sourceFileInfo.isTracked, true);
});

test('file changes cause semantic update', () => {
    const code = `
// @filename: open.py
//// import closed
//// /*open*/

// @filename: closed.py
//// /*closed*/
    `;

    const state = parseAndGetTestState(code, '/projectRoot').state;
    const open = state.getMarkerByName('open');
    const closed = state.getMarkerByName('closed');
    const openUri = open.fileUri;
    const closedUri = closed.fileUri;
    const openContents = state.testFS.readFileSync(openUri, 'utf-8');
    const options = {
        ipythonMode: IPythonMode.None,
        chainedFileUri: undefined,
    };
    const cmdOptions = new CommandLineOptions(state.workspace.rootUri, false);
    cmdOptions.languageServerSettings.watchForSourceChanges = true;
    state.workspace.service.setOptions(cmdOptions);

    // Changing the closed file should update the semantic version of the open file as it is
    // imported by it.
    const p = state.workspace.service.test_program;
    p.setFileOpened(openUri, 0, openContents, options);
    // Do a parse so that imports are processed but not a full analysis as that would load
    // the closed file into memory.
    p.getParseResults(openUri);
    const openFile = p.getSourceFileInfo(openUri);
    assert(openFile);
    assert(openFile.isOpenByClient);
    assert.strictEqual(openContents, openFile.contents);
    assert.strictEqual(openFile.imports.length, 3);
    const oldSemanticVersion = openFile.semanticVersion;
    state.testFS.writeFileSync(closedUri, 'print("changed")');
    state.testFS.fireFileWatcherEvent(closedUri.toString(), 'change');
    assert.strictEqual(openFile.semanticVersion, oldSemanticVersion + 1);
});

test('open empty file does not use disk contents for dirty check', () => {
    const state = parseAndGetTestState('', '/projectRoot').state;
    const uri = UriEx.file('/projectRoot/test.py');
    const program = state.workspace.service.test_program;

    state.testFS.mkdirpSync('/projectRoot');
    state.testFS.writeFileSync(uri, 'disk_value = 1');
    program.addTrackedFile(uri);
    program.setFileOpened(uri, 1, '', {
        ipythonMode: IPythonMode.None,
        chainedFileUri: undefined,
    });

    while (program.analyze()) {
        // Process all queued items.
    }

    const sourceFileInfo = program.getSourceFileInfo(uri);
    assert(sourceFileInfo);
    assert.strictEqual(sourceFileInfo.isOpenByClient, true);
    assert.strictEqual(sourceFileInfo.sourceFile.isCheckingRequired(), false);
    assert.strictEqual(sourceFileInfo.sourceFile.didContentsChangeOnDisk(), false);
});

test('setFileClosed drops tracked syntax without invalidating evaluator caches', () => {
    const code = `
// @filename: test.py
//// # module lead
//// # lifetime comment retained on token
//// def f():
////     pass
//// missing_type_ignore  # type: ignore[reportUndefinedVariable]
//// missing_pyright_ignore  # pyright: ignore[reportUndefinedVariable]
    `;

    const state = parseAndGetTestState(code, '/projectRoot').state;
    const uri = UriEx.file('/projectRoot/test.py');
    const program = state.workspace.service.test_program;

    while (program.analyze()) {
        // Process all queued items.
    }

    const sourceFileInfo = program.getSourceFileInfo(uri);
    assert(sourceFileInfo);

    const writableData = (sourceFileInfo.sourceFile as any)._writableData;
    assert(writableData.parserOutput);
    assert(writableData.tokenizerOutput);
    assert(writableData.parsedFileContents?.includes('lifetime comment retained on token'));
    assert(writableData.typeIgnoreLines.size > 0);
    assert(writableData.pyrightIgnoreLines.size > 0);
    assert(sourceFileInfo.sourceFile.getImports().length > 0);
    const oldSourceFileInfoImportCount = sourceFileInfo.imports.length;
    const oldEvaluator = program.evaluator as any;
    assert(oldEvaluator);
    const oldEvaluatorStats = oldEvaluator.getEvaluatorCacheStats();
    assert(oldEvaluatorStats.typeCache > 0);

    program.setFileClosed(uri);

    assert.strictEqual(program.evaluator, oldEvaluator);
    assert.deepStrictEqual(oldEvaluator.getEvaluatorCacheStats(), oldEvaluatorStats);
    assert.strictEqual(program.getSourceFileInfo(uri), sourceFileInfo);
    assert.strictEqual(sourceFileInfo.isOpenByClient, false);
    assert.strictEqual(writableData.clientDocumentContents, undefined);
    assert.strictEqual(writableData.tokenizerOutput, undefined);
    assert.strictEqual(writableData.parserOutput, undefined);
    assert.strictEqual(writableData.parsedFileContents, undefined);
    assert.strictEqual(writableData.tokenizerLines, undefined);
    assert.strictEqual(writableData.moduleSymbolTable, undefined);
    assert.strictEqual(writableData.typeIgnoreLines.size, 0);
    assert.strictEqual(writableData.typeIgnoreAll, undefined);
    assert.strictEqual(writableData.pyrightIgnoreLines.size, 0);
    assert.strictEqual(sourceFileInfo.sourceFile.getImports().length, 0);
    assert.strictEqual(sourceFileInfo.imports.length, oldSourceFileInfoImportCount);
});

test('setFileClosed invalidates evaluator when disk contents changed', () => {
    const code = `
// @filename: test.py
//// class C:
////     value: int = 1
////
//// c = C()
//// reveal_type(c.value)
    `;

    const state = parseAndGetTestState(code, '/projectRoot').state;
    const uri = UriEx.file('/projectRoot/test.py');
    const program = state.workspace.service.test_program;

    while (program.analyze()) {
        // Process all queued items.
    }

    const oldEvaluator = program.evaluator as any;
    assert(oldEvaluator);
    assert(oldEvaluator.getEvaluatorCacheStats().typeCache > 0);

    state.testFS.writeFileSync(uri, `${state.testFS.readFileSync(uri, 'utf8')}\nother = 1\n`);
    program.setFileClosed(uri);

    assert.notStrictEqual(program.evaluator, oldEvaluator);
    Object.entries(oldEvaluator.getEvaluatorCacheStats()).forEach(([name, value]) => {
        if (name !== 'evaluatorGeneration') {
            assert.strictEqual(value, 0, `${name} should be cleared when close observes changed contents`);
        }
    });
});

test('setTrackedFiles removes closed files and clears evaluator retainers', () => {
    const code = `
// @filename: test.py
//// class C:
////     value: int = 1
////
//// c = C()
//// reveal_type(c.value)
    `;

    const state = parseAndGetTestState(code, '/projectRoot').state;
    const uri = UriEx.file('/projectRoot/test.py');
    const program = state.workspace.service.test_program;

    while (program.analyze()) {
        // Process all queued items.
    }

    const sourceFileInfo = program.getSourceFileInfo(uri);
    assert(sourceFileInfo);
    const writableData = (sourceFileInfo.sourceFile as any)._writableData;
    assert(writableData.parserOutput);

    const oldEvaluator = program.evaluator as any;
    assert(oldEvaluator);
    assert(oldEvaluator.getEvaluatorCacheStats().typeCache > 0);

    program.setFileClosed(uri);
    assert.strictEqual(program.evaluator, oldEvaluator);

    program.setTrackedFiles([]);

    assert.strictEqual(program.getSourceFileInfo(uri), undefined);
    assert.notStrictEqual(program.evaluator, oldEvaluator);
    assert.strictEqual(writableData.parserOutput, undefined);
    Object.entries(oldEvaluator.getEvaluatorCacheStats()).forEach(([name, value]) => {
        if (name !== 'evaluatorGeneration') {
            assert.strictEqual(value, 0, `${name} should be cleared when a file is removed`);
        }
    });
});

test('updateOpenFileContents disposes evaluator caches and stale parse output', () => {
    const code = `
// @filename: test.py
//// class C:
////     value: int = 1
////
//// c = C()
//// reveal_type(c.value)
    `;

    const state = parseAndGetTestState(code, '/projectRoot').state;
    const uri = UriEx.file('/projectRoot/test.py');
    const program = state.workspace.service.test_program;

    while (program.analyze()) {
        // Process all queued items.
    }

    const sourceFileInfo = program.getSourceFileInfo(uri);
    assert(sourceFileInfo);

    const writableData = (sourceFileInfo.sourceFile as any)._writableData;
    const oldParserOutput = writableData.parserOutput;
    assert(oldParserOutput);
    const oldEvaluator = program.evaluator as any;
    assert(oldEvaluator);
    assert(oldEvaluator.getTypeCacheEntryCount() > 0);
    const oldEvaluatorGeneration = oldEvaluator.getEvaluatorCacheStats().evaluatorGeneration;
    assert(oldEvaluator.getEvaluatorCacheStats().typeCache > 0);

    state.workspace.service.updateOpenFileContents(uri, 2, `${state.testFS.readFileSync(uri, 'utf8')}\nother = 1\n`);

    assert(program.evaluator);
    assert.notStrictEqual(program.evaluator, oldEvaluator);
    Object.entries(oldEvaluator.getEvaluatorCacheStats()).forEach(([name, value]) => {
        if (name !== 'evaluatorGeneration') {
            assert.strictEqual(value, 0, `${name} should be cleared on evaluator disposal`);
        }
    });
    const newEvaluatorStats = (program.evaluator as any).getEvaluatorCacheStats();
    assert(newEvaluatorStats.evaluatorGeneration > oldEvaluatorGeneration);
    Object.entries(newEvaluatorStats).forEach(([name, value]) => {
        if (name !== 'evaluatorGeneration') {
            assert.strictEqual(value, 0, `${name} should be empty on the new evaluator`);
        }
    });
    assert.strictEqual(sourceFileInfo.sourceFile.getParserOutput(), undefined);
    assert.strictEqual(writableData.parserOutput, undefined);
    assert.notStrictEqual(writableData.parserOutput, oldParserOutput);
});

test('updateOpenFileContents with unchanged contents preserves evaluator and diagnostic version', () => {
    const code = `
// @filename: test.py
//// value: int = 1
    `;

    const state = parseAndGetTestState(code, '/projectRoot').state;
    const uri = UriEx.file('/projectRoot/test.py');
    const contents = state.testFS.readFileSync(uri, 'utf8');
    const program = state.workspace.service.test_program;

    state.workspace.service.setFileOpened(uri, 1, contents);
    while (program.analyze()) {
        // Process all queued items.
    }
    program.getDiagnostics(program.configOptions);

    const sourceFileInfo = program.getSourceFileInfo(uri);
    assert(sourceFileInfo);
    assert.strictEqual(sourceFileInfo.isOpenByClient, true);
    const oldEvaluator = program.evaluator;
    const oldDiagnosticsVersion = sourceFileInfo.diagnosticsVersion;

    state.workspace.service.updateOpenFileContents(uri, 2, contents);

    assert.strictEqual(program.evaluator, oldEvaluator);
    assert.strictEqual(sourceFileInfo.diagnosticsVersion, oldDiagnosticsVersion);
});

test('setFileOpened disposes evaluator caches when contents change', () => {
    const code = `
// @filename: test.py
//// class C:
////     value: int = 1
////
//// c = C()
//// reveal_type(c.value)
    `;

    const state = parseAndGetTestState(code, '/projectRoot').state;
    const uri = UriEx.file('/projectRoot/test.py');
    const program = state.workspace.service.test_program;

    while (program.analyze()) {
        // Process all queued items.
    }

    const sourceFileInfo = program.getSourceFileInfo(uri);
    assert(sourceFileInfo);

    const oldEvaluator = program.evaluator as any;
    assert(oldEvaluator);
    assert(oldEvaluator.getEvaluatorCacheStats().typeCache > 0);
    const oldEvaluatorGeneration = oldEvaluator.getEvaluatorCacheStats().evaluatorGeneration;

    state.workspace.service.setFileOpened(uri, 2, `${state.testFS.readFileSync(uri, 'utf8')}\nother = 1\n`);

    assert.notStrictEqual(program.evaluator, oldEvaluator);
    Object.entries(oldEvaluator.getEvaluatorCacheStats()).forEach(([name, value]) => {
        if (name !== 'evaluatorGeneration') {
            assert.strictEqual(value, 0, `${name} should be cleared on evaluator disposal`);
        }
    });
    assert((program.evaluator as any).getEvaluatorCacheStats().evaluatorGeneration > oldEvaluatorGeneration);
    assert.strictEqual(sourceFileInfo.sourceFile.getParserOutput(), undefined);
});

test('setFileOpened defers evaluator disposal during edit mode', () => {
    const code = `
// @filename: test.py
//// value = 1
//// reveal_type(value)
    `;

    const state = parseAndGetTestState(code, '/projectRoot').state;
    const uri = UriEx.file('/projectRoot/test.py');
    const program = state.workspace.service.test_program;

    while (program.analyze()) {
        // Process all queued items.
    }

    const oldEvaluator = program.evaluator as any;
    assert(oldEvaluator);
    assert(oldEvaluator.getEvaluatorCacheStats().typeCache > 0);

    state.workspace.service.runEditMode((p) => {
        p.setFileOpened(uri, 2, `${state.testFS.readFileSync(uri, 'utf8')}\nother = 1\n`);
        assert.strictEqual(program.evaluator, oldEvaluator);
        assert(oldEvaluator.getEvaluatorCacheStats().typeCache > 0);
    }, CancellationToken.None);

    assert.notStrictEqual(program.evaluator, oldEvaluator);
    Object.entries(oldEvaluator.getEvaluatorCacheStats()).forEach(([name, value]) => {
        if (name !== 'evaluatorGeneration') {
            assert.strictEqual(value, 0, `${name} should be cleared when edit mode exits`);
        }
    });
});

test('setFileOpened marks dependents dirty during edit mode', () => {
    const code = `
// @filename: a.py
//// value: int = 1
// @filename: b.py
//// from a import value
//// reveal_type(value)
    `;

    const state = parseAndGetTestState(code, '/projectRoot').state;
    const aUri = UriEx.file('/projectRoot/a.py');
    const bUri = UriEx.file('/projectRoot/b.py');
    const program = state.workspace.service.test_program;

    while (program.analyze()) {
        // Process all queued items.
    }

    const bInfo = program.getSourceFileInfo(bUri);
    assert(bInfo);
    assert.strictEqual(bInfo.sourceFile.isCheckingRequired(), false);

    const oldEvaluator = program.evaluator as any;
    assert(oldEvaluator);

    state.workspace.service.runEditMode((p) => {
        p.setFileOpened(aUri, 2, `${state.testFS.readFileSync(aUri, 'utf8')}\nother = 1\n`);
        assert.strictEqual(program.evaluator, oldEvaluator);
        assert.strictEqual(bInfo.sourceFile.isCheckingRequired(), true);
    }, CancellationToken.None);

    assert.notStrictEqual(program.evaluator, oldEvaluator);
});

test('setFileOpened marks all files dirty for builtins change', () => {
    const code = `
// @filename: a.py
//// value = 1
// @filename: builtins.pyi
//// class object:
////     pass
    `;

    const state = parseAndGetTestState(code, '/projectRoot').state;
    const aUri = UriEx.file('/projectRoot/a.py');
    const builtinsUri = UriEx.file('/projectRoot/builtins.pyi');
    const program = state.workspace.service.test_program;

    while (program.analyze()) {
        // Process all queued items.
    }

    const aInfo = program.getSourceFileInfo(aUri);
    assert(aInfo);
    assert.strictEqual(aInfo.sourceFile.isCheckingRequired(), false);

    const oldEvaluator = program.evaluator as any;
    assert(oldEvaluator);

    state.workspace.service.setFileOpened(
        builtinsUri,
        2,
        `${state.testFS.readFileSync(builtinsUri, 'utf8')}\nclass int(object): ...\n`
    );

    assert.strictEqual(aInfo.sourceFile.isCheckingRequired(), true);
    assert.notStrictEqual(program.evaluator, oldEvaluator);
});

test('updateChainedUri does not recreate evaluator for unchanged chain', () => {
    const code = `
// @filename: test.py
//// value = 1
    `;

    const state = parseAndGetTestState(code, '/projectRoot').state;
    const uri = UriEx.file('/projectRoot/test.py');
    const program = state.workspace.service.test_program;

    while (program.analyze()) {
        // Process all queued items.
    }

    const oldEvaluator = program.evaluator;

    program.updateChainedUri(uri, undefined);

    assert.strictEqual(program.evaluator, oldEvaluator);
});

test('disposeEvaluator preserves active evaluator state during reentrant invalidation', () => {
    const code = `
// @filename: test.py
//// class C:
////     pass
    `;

    const state = parseAndGetTestState(code, '/projectRoot').state;
    const uri = UriEx.file('/projectRoot/test.py');
    const program = state.workspace.service.test_program;

    while (program.analyze()) {
        // Process all queued items.
    }

    const oldEvaluator = program.evaluator as any;
    const parseTree = program.getParseResults(uri)!.parserOutput.parseTree;

    program.run(() => {
        oldEvaluator.useSpeculativeMode(parseTree, () => {
            (program as any)._createNewEvaluator();
        });
    }, CancellationToken.None);

    assert.notStrictEqual(program.evaluator, oldEvaluator);
    Object.entries(oldEvaluator.getEvaluatorCacheStats()).forEach(([name, value]) => {
        if (name !== 'evaluatorGeneration') {
            assert.strictEqual(value, 0, `${name} should be cleared after active evaluator unwinds`);
        }
    });
});

test('program dispose clears evaluator and source retainers', () => {
    const code = `
// @filename: test.py
//// class C:
////     value: int = 1
////
//// c = C()
//// reveal_type(c.value)
    `;

    const state = parseAndGetTestState(code, '/projectRoot').state;
    const uri = UriEx.file('/projectRoot/test.py');
    const program = state.workspace.service.test_program;
    state.workspace.service.setFileOpened(uri, 1, state.testFS.readFileSync(uri, 'utf8'));

    while (program.analyze()) {
        // Process all queued items.
    }

    const sourceFileInfo = program.getSourceFileInfo(uri);
    assert(sourceFileInfo);
    const writableData = (sourceFileInfo.sourceFile as any)._writableData;
    assert(writableData.parserOutput);
    assert(writableData.clientDocumentContents);

    const oldEvaluator = program.evaluator as any;
    assert(oldEvaluator);
    assert(oldEvaluator.getEvaluatorCacheStats().typeCache > 0);

    program.dispose();

    assert.strictEqual(program.evaluator, undefined);
    assert.strictEqual(program.getSourceFileInfo(uri), undefined);
    assert.strictEqual(writableData.parserOutput, undefined);
    assert.strictEqual(writableData.clientDocumentContents, undefined);
    Object.entries(oldEvaluator.getEvaluatorCacheStats()).forEach(([name, value]) => {
        if (name !== 'evaluatorGeneration') {
            assert.strictEqual(value, 0, `${name} should be cleared when program is disposed`);
        }
    });
});

test('emptyCache drops retained parse tree and parsed contents for closed tracked file', () => {
    const code = `
// @filename: test.py
//// # lifetime source text
//// value = 1
    `;

    const state = parseAndGetTestState(code, '/projectRoot').state;
    const uri = UriEx.file('/projectRoot/test.py');
    const program = state.workspace.service.test_program;

    while (program.analyze()) {
        // Process all queued items.
    }

    const sourceFileInfo = program.getSourceFileInfo(uri);
    assert(sourceFileInfo);

    const writableData = (sourceFileInfo.sourceFile as any)._writableData;
    assert(writableData.parserOutput);
    assert(writableData.parsedFileContents?.includes('lifetime source text'));

    program.setFileClosed(uri);
    program.emptyCache();

    assert.strictEqual(program.getSourceFileInfo(uri), sourceFileInfo);
    assert.strictEqual(writableData.parserOutput, undefined);
    assert.strictEqual(writableData.parsedFileContents, undefined);
    assert.strictEqual(writableData.moduleSymbolTable, undefined);
});

test('emptyCache preserves diagnostic range for checked files', () => {
    const code = `
// @filename: test.py
//// value = 1
//// bad: int = ""
    `;

    const state = parseAndGetTestState(code, '/projectRoot').state;
    const uri = UriEx.file('/projectRoot/test.py');
    const program = state.workspace.service.test_program;

    while (program.analyze()) {
        // Process all queued items.
    }

    const diagnosticsBefore = program.analyzeFileAndGetDiagnostics(uri);
    assert(diagnosticsBefore.length > 0);

    program.emptyCache();

    const diagnosticsAfter = program.analyzeFileAndGetDiagnostics(uri);
    assert.strictEqual(diagnosticsAfter.length, diagnosticsBefore.length);
});

test('emptyCache preserves text range and diagnostic range queries for open files', () => {
    const code = `
// @filename: test.py
//// value: int = ""
//// /*marker*/value
    `;

    const state = parseAndGetTestState(code, '/projectRoot').state;
    const marker = state.getMarkerByName('marker');
    const uri = marker.fileUri;
    const program = state.workspace.service.test_program;
    state.workspace.service.setFileOpened(uri, 1, state.testFS.readFileSync(uri, 'utf8'));

    while (program.analyze()) {
        // Process all queued items.
    }

    const wholeFileRange = program.getSourceFile(uri)!.getRange();
    const diagnosticsBefore = program.getDiagnosticsForRange(uri, wholeFileRange);
    assert(diagnosticsBefore.length > 0);

    program.emptyCache();

    assert.strictEqual(
        program.getTextOnRange(
            uri,
            { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } },
            CancellationToken.None
        ),
        'value'
    );
    assert.strictEqual(program.getDiagnosticsForRange(uri, wholeFileRange).length, diagnosticsBefore.length);
});

function testSourceFileWatchChange(code: string, expected = true, isFile = true) {
    const state = parseAndGetTestState(code, '/projectRoot').state;
    const marker = state.getMarkerByName('marker');
    const path = isFile ? marker.fileName : getDirectoryPath(marker.fileName);

    assert.strictEqual(
        state.workspace.service.test_shouldHandleSourceFileWatchChanges(Uri.file(path, state.serviceProvider), isFile),
        expected
    );
}

function getRegisteredLibraryFileWatchers(root: string, extraPaths: string[], excludes: string[] = []) {
    root = normalizeSlashes(root);

    const data = parseTestData(root, '', '');
    const state = new TestState(root, data);

    const options = new CommandLineOptions(state.workspace.rootUri, false);
    options.languageServerSettings.watchForLibraryChanges = true;
    options.configSettings.extraPaths = extraPaths;
    options.configSettings.excludeFileSpecs = excludes;

    state.workspace.service.setOptions(options);

    return state.testFS.fileWatchers;
}
