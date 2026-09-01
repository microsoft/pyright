/*
 * service.test.ts
 *
 * service tests.
 */

import assert from 'assert';

import { CancellationToken } from 'vscode-jsonrpc';
import { InvalidatedReason } from '../analyzer/backgroundAnalysisProgram';
import { getNextServiceId } from '../analyzer/service';
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

test('service clone preserves effective configuration', () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////     "stubPath": "custom-stubs",
////     "extraPaths": ["shared"],
////     "executionEnvironments": [
////         { "root": "src", "extraPaths": ["src-extra"] },
////         { "root": "tests", "extraPaths": ["test-extra"] }
////     ]
//// }
//
// @filename: src/main.py
//// import sample
//
// @filename: sample/__init__.py
// @library: true
//// def answer(): return 42
`;
    const state = parseAndGetTestState(code, '/projectRoot').state;
    const options = new CommandLineOptions('/projectRoot', /* fromLanguageServer */ true);
    options.languageServerSettings.pythonPath = '/custom/python';
    state.workspace.service.setOptions(options);

    const clone = state.workspace.service.clone('test clone', getNextServiceId('test clone'));

    try {
        const originalConfig = state.workspace.service.getConfigOptions();
        const cloneConfig = clone.getConfigOptions();
        assert.strictEqual(cloneConfig.projectRoot.toString(), originalConfig.projectRoot.toString());
        assert.strictEqual(cloneConfig.stubPath?.toString(), originalConfig.stubPath?.toString());
        assert.strictEqual(cloneConfig.pythonPath?.toString(), originalConfig.pythonPath?.toString());
        assert.deepStrictEqual(
            cloneConfig.defaultExtraPaths?.map((uri) => uri.toString()),
            originalConfig.defaultExtraPaths?.map((uri) => uri.toString())
        );
        assert.deepStrictEqual(
            cloneConfig.executionEnvironments.map((env) => ({
                root: env.root?.toString(),
                extraPaths: env.extraPaths.map((uri) => uri.toString()),
            })),
            originalConfig.executionEnvironments.map((env) => ({
                root: env.root?.toString(),
                extraPaths: env.extraPaths.map((uri) => uri.toString()),
            }))
        );
    } finally {
        clone.dispose();
    }
});

test('service clone preserves directly configured options', () => {
    const code = `
// @filename: sample/__init__.py
// @library: true
//// def answer(): return 42
`;
    const state = parseAndGetTestState(code, '/projectRoot').state;

    const originalConfig = state.workspace.service.getConfigOptions();
    const clone = state.workspace.service.clone('test clone', getNextServiceId('test clone'));

    try {
        assert.strictEqual(clone.getConfigOptions(), originalConfig);
        assert.strictEqual(clone.getImportResolver().getConfigOptions(), originalConfig);
    } finally {
        clone.dispose();
    }
});

test('service clone program mutations do not affect the parent', () => {
    const code = `
// @filename: main.py
//// value = 1
//
// @filename: sample/__init__.py
// @library: true
//// def answer(): return 42
`;
    const state = parseAndGetTestState(code, '/projectRoot').state;
    const parent = state.workspace.service;
    const parentConfig = parent.getConfigOptions();
    const parentConfigSnapshot = { ...parentConfig };
    const parentUserFiles = parent.getUserFiles();
    const parentAllowedImportsSpy = jest.spyOn(parent.test_program, 'setAllowedThirdPartyImports');
    const clone = parent.clone('test clone', getNextServiceId('test clone'));
    const sampleUri = Uri.file('/sample/__init__.py', state.serviceProvider);

    try {
        clone.backgroundAnalysisProgram.setAllowedThirdPartyImports(['sample']);
        clone.backgroundAnalysisProgram.setTrackedFiles([sampleUri]);

        assert.strictEqual(parentAllowedImportsSpy.mock.calls.length, 0);
        assert.deepStrictEqual(parent.getUserFiles(), parentUserFiles);
        assert.deepStrictEqual({ ...parent.getConfigOptions() }, parentConfigSnapshot);
        assert.deepStrictEqual(clone.getUserFiles(), [sampleUri]);
    } finally {
        clone.dispose();
    }
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

test('source enumeration reports discovered config files', () => {
    const fs = new TestFileSystem(/* ignoreCase */ false, { cwd: '/' });
    fs.mkdirpSync('/projectRoot/pkgA');
    fs.mkdirpSync('/projectRoot/pkgB');
    fs.mkdirpSync('/projectRoot/pkgC');
    fs.writeFileSync(Uri.file('/projectRoot/pyrightconfig.json', fs), '{}');
    fs.writeFileSync(Uri.file('/projectRoot/pkgA/pyrightconfig.json', fs), '{}');
    fs.writeFileSync(Uri.file('/projectRoot/pkgB/pyproject.toml', fs), '[tool.pyright]\n');
    fs.writeFileSync(Uri.file('/projectRoot/pkgC/module.py', fs), 'x = 1');

    const enumerator = new SourceEnumerator(
        [getFileSpec(Uri.file('/', fs), 'projectRoot')],
        [],
        /* autoExcludeVenv */ false,
        fs,
        new NullConsole()
    );

    const result = enumerator.enumerate(/* timeLimitInMs */ 1000);

    assert.strictEqual(result.isComplete, true);
    assert.deepStrictEqual(
        enumerator
            .getDiscoveredConfigFiles()
            .map((uri) => uri.key)
            .sort(),
        [
            Uri.file('/projectRoot/pkgA/pyrightconfig.json', fs).key,
            Uri.file('/projectRoot/pkgB/pyproject.toml', fs).key,
            Uri.file('/projectRoot/pyrightconfig.json', fs).key,
        ].sort()
    );
});

test('source enumeration skips config files inside auto-excluded virtual environments', () => {
    const fs = new TestFileSystem(/* ignoreCase */ false, { cwd: '/' });
    fs.mkdirpSync('/projectRoot/env');
    fs.writeFileSync(Uri.file('/projectRoot/pyrightconfig.json', fs), '{}');
    // `env` is marked as a virtual environment; with autoExcludeVenv it must not be scanned.
    fs.writeFileSync(Uri.file('/projectRoot/env/pyvenv.cfg', fs), '');
    fs.writeFileSync(Uri.file('/projectRoot/env/pyrightconfig.json', fs), '{}');

    const enumerator = new SourceEnumerator(
        [getFileSpec(Uri.file('/', fs), 'projectRoot')],
        [],
        /* autoExcludeVenv */ true,
        fs,
        new NullConsole()
    );

    const result = enumerator.enumerate(/* timeLimitInMs */ 1000);

    assert.strictEqual(result.isComplete, true);
    assert.deepStrictEqual(
        enumerator.getDiscoveredConfigFiles().map((uri) => uri.key),
        [Uri.file('/projectRoot/pyrightconfig.json', fs).key]
    );
});

test('explicit include does not rescue a directory detected as a virtual environment', () => {
    const fs = new TestFileSystem(/* ignoreCase */ false, { cwd: '/' });
    fs.mkdirpSync('/projectRoot/env');
    fs.writeFileSync(Uri.file('/projectRoot/module.py', fs), 'x = 1');
    // `env` looks like a virtual environment. Even though the user explicitly includes it, the
    // default virtual-environment exclusion takes precedence over `include` (default excludes trump
    // includes, just like any other exclude), so it stays excluded.
    fs.writeFileSync(Uri.file('/projectRoot/env/pyvenv.cfg', fs), '');
    fs.writeFileSync(Uri.file('/projectRoot/env/module.py', fs), 'y = 1');

    const enumerator = new SourceEnumerator(
        [getFileSpec(Uri.file('/', fs), 'projectRoot'), getFileSpec(Uri.file('/', fs), 'projectRoot/env')],
        [],
        /* autoExcludeVenv */ true,
        fs,
        new NullConsole()
    );

    const result = enumerator.enumerate(/* timeLimitInMs */ 1000);

    assert.strictEqual(result.isComplete, true);
    // The venv source file is not matched and the directory is reported as auto-excluded.
    assert.ok(!result.matches.has(Uri.file('/projectRoot/env/module.py', fs).key));
    assert.deepStrictEqual(
        [...new Set(result.autoExcludedDirs.map((uri) => uri.key))],
        [Uri.file('/projectRoot/env', fs).key]
    );
});

test('source enumeration skips config files under excluded directories', () => {
    const fs = new TestFileSystem(/* ignoreCase */ false, { cwd: '/' });
    fs.mkdirpSync('/projectRoot/build');
    fs.writeFileSync(Uri.file('/projectRoot/pyrightconfig.json', fs), '{}');
    fs.writeFileSync(Uri.file('/projectRoot/build/pyrightconfig.json', fs), '{}');

    const enumerator = new SourceEnumerator(
        [getFileSpec(Uri.file('/', fs), 'projectRoot')],
        [getFileSpec(Uri.file('/projectRoot', fs), 'build')],
        /* autoExcludeVenv */ false,
        fs,
        new NullConsole()
    );

    const result = enumerator.enumerate(/* timeLimitInMs */ 1000);

    assert.strictEqual(result.isComplete, true);
    assert.deepStrictEqual(
        enumerator.getDiscoveredConfigFiles().map((uri) => uri.key),
        [Uri.file('/projectRoot/pyrightconfig.json', fs).key]
    );
});

test('source enumeration skips config files matching an exclude file spec', () => {
    const fs = new TestFileSystem(/* ignoreCase */ false, { cwd: '/' });
    fs.mkdirpSync('/projectRoot/pkgA');
    fs.writeFileSync(Uri.file('/projectRoot/pyrightconfig.json', fs), '{}');
    // pkgA is not an excluded directory (it is still scanned for sources), but its config
    // file is explicitly excluded, so it must not be surfaced as a discovered config root.
    fs.writeFileSync(Uri.file('/projectRoot/pkgA/pyrightconfig.json', fs), '{}');
    fs.writeFileSync(Uri.file('/projectRoot/pkgA/module.py', fs), 'x = 1');

    const enumerator = new SourceEnumerator(
        [getFileSpec(Uri.file('/', fs), 'projectRoot')],
        [getFileSpec(Uri.file('/projectRoot', fs), 'pkgA/pyrightconfig.json')],
        /* autoExcludeVenv */ false,
        fs,
        new NullConsole()
    );

    const result = enumerator.enumerate(/* timeLimitInMs */ 1000);

    assert.strictEqual(result.isComplete, true);
    assert.deepStrictEqual(
        enumerator.getDiscoveredConfigFiles().map((uri) => uri.key),
        [Uri.file('/projectRoot/pyrightconfig.json', fs).key]
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

test('empty cache preserves analyzer information for retained parse trees', () => {
    const state = parseAndGetTestState('//// value = 1', '/projectRoot').state;
    const program = state.workspace.service.test_program;

    while (program.analyze());

    const parseTree = program.getParseResults(state.activeFile.fileUri)!.parserOutput.parseTree;
    assert.ok(program.analyzerNodeInfoContext.getFileInfo(parseTree));

    program.emptyCache();

    assert.ok(program.analyzerNodeInfoContext.getFileInfo(parseTree));

    while (program.analyze());

    const nextParseTree = program.getParseResults(state.activeFile.fileUri)!.parserOutput.parseTree;
    program.emptyCache();

    assert.ok(program.analyzerNodeInfoContext.getFileInfo(parseTree));
    assert.ok(program.analyzerNodeInfoContext.getFileInfo(nextParseTree));
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

    // Opening an existing untracked file does not change its tracked state.
    // Tracking is determined at creation time.
    program.setFileOpened(uri, 1, 'value = 1', {
        ipythonMode: IPythonMode.None,
        chainedFileUri: undefined,
    });

    assert.strictEqual(sourceFileInfo.isOpenByClient, true);
    assert.strictEqual(sourceFileInfo.isTracked, false);
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

test('setTrackedFiles does not preserve tracked state for non-virtual open files', () => {
    const state = parseAndGetTestState('', '/projectRoot').state;
    const program = state.workspace.service.test_program;
    const uri = UriEx.file('/projectRoot/interim.py');

    state.testFS.mkdirpSync('/projectRoot');
    state.testFS.writeFileSync(uri, 'value = 1');
    program.addTrackedFile(uri);
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
