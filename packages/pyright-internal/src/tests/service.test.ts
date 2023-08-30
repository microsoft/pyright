/*
 * service.test.ts
 *
 * service tests.
 */

import assert from 'assert';

import { combinePaths, getDirectoryPath } from '../common/pathUtils';
import { parseAndGetTestState } from './harness/fourslash/testState';
import { CancellationToken } from 'vscode-jsonrpc';
import { IPythonMode } from '../analyzer/sourceFile';

test('random library file changed', () => {
    const state = parseAndGetTestState('', '/projectRoot').state;

    assert.strictEqual(
        state.workspace.service.test_shouldHandleLibraryFileWatchChanges('/site-packages/test.py', ['/site-packages']),
        true
    );
});

test('random library file starting with . changed', () => {
    const state = parseAndGetTestState('', '/projectRoot').state;

    assert.strictEqual(
        state.workspace.service.test_shouldHandleLibraryFileWatchChanges('/site-packages/.test.py', ['/site-packages']),
        false
    );
});

test('random library file changed, nested search paths', () => {
    const state = parseAndGetTestState('', '/projectRoot').state;

    assert.strictEqual(
        state.workspace.service.test_shouldHandleLibraryFileWatchChanges('/lib/.venv/site-packages/myFile.py', [
            '/lib',
            '/lib/.venv/site-packages',
        ]),
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
        state.workspace.service.test_shouldHandleLibraryFileWatchChanges('/lib/.venv/site-packages/myFile.py', [
            '/lib',
            '/LIB/.venv/site-packages',
        ]),
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
        state.workspace.service.test_shouldHandleLibraryFileWatchChanges('/lib/.venv/site-packages/myFile.py', [
            '/lib',
            '/LIB/.venv/site-packages',
        ]),
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
        state.workspace.service.test_shouldHandleLibraryFileWatchChanges('/lib/.test.py', [
            '/LIB',
            '/lib/site-packages',
        ]),
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
        state.workspace.service.test_shouldHandleLibraryFileWatchChanges('/lib/.test.py', [
            '/LIB',
            '/lib/site-packages',
        ]),
        true
    );
});

test('random library file under a folder starting with . changed', () => {
    const state = parseAndGetTestState('', '/projectRoot').state;

    assert.strictEqual(
        state.workspace.service.test_shouldHandleLibraryFileWatchChanges('/site-packages/.testFolder/test.py', [
            '/site-packages',
        ]),
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
        state.workspace.service.test_shouldHandleSourceFileWatchChanges(marker.fileName, /* isFile */ true),
        true
    );
});

test('random folder changed', () => {
    const code = `
// @filename: notUsed.py
//// # empty
    `;

    const state = parseAndGetTestState(code, '/projectRoot').state;

    assert.strictEqual(
        state.workspace.service.test_shouldHandleSourceFileWatchChanges('/randomFolder', /* isFile */ false),
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

test('program containsSourceFileIn', () => {
    const code = `
// @ignoreCase: true

// @filename: myLib/__init__.py
//// # empty
    `;

    const state = parseAndGetTestState(code, '/projectRoot').state;
    assert(state.workspace.service.test_program.containsSourceFileIn(state.activeFile.fileName));
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

    const newFilePath = combinePaths(getDirectoryPath(open.fileName), 'interimFile.py');
    state.testFS.writeFileSync(newFilePath, '# empty', 'utf8');

    const options = {
        isTracked: true,
        ipythonMode: IPythonMode.None,
        chainedFilePath: newFilePath,
        realFilePath: closed.fileName,
    };

    // try run edit mode
    verifyRunEditMode('# first');

    // try run again to make sure things are cleared up correctly
    verifyRunEditMode('# second');

    function verifyRunEditMode(value: string) {
        state.workspace.service.runEditMode((p) => {
            p.addInterimFile(newFilePath);
            p.setFileOpened(open.fileName, 0, value, options);
            p.setFileOpened(closed.fileName, 0, value, options);

            const interim = p.getSourceFileInfo(newFilePath);
            assert(interim);

            const openFile = p.getSourceFileInfo(open.fileName);
            assert(openFile);
            assert(openFile.isOpenByClient);
            assert.strictEqual(value, openFile.sourceFile.getFileContent());

            const closedFile = p.getSourceFileInfo(closed.fileName);
            assert(closedFile);
            assert(closedFile.isOpenByClient);
            assert.strictEqual(value, closedFile.sourceFile.getFileContent());
        }, CancellationToken.None);

        const interim = state.workspace.service.test_program.getSourceFileInfo(newFilePath);
        assert(!interim);

        const openFile = state.workspace.service.test_program.getSourceFileInfo(open.fileName);
        assert(openFile);
        assert(openFile.isOpenByClient);

        assert.strictEqual('', openFile.sourceFile.getFileContent()?.trim());

        const closedFile = state.workspace.service.test_program.getSourceFileInfo(closed.fileName);
        assert(closedFile);
        assert(!closedFile.isOpenByClient);

        const content = closedFile.sourceFile.getFileContent() ?? '';
        assert.strictEqual('', content.trim());
    }
});

function testSourceFileWatchChange(code: string, expected = true, isFile = true) {
    const state = parseAndGetTestState(code, '/projectRoot').state;
    const marker = state.getMarkerByName('marker');
    const path = isFile ? marker.fileName : getDirectoryPath(marker.fileName);

    assert.strictEqual(state.workspace.service.test_shouldHandleSourceFileWatchChanges(path, isFile), expected);
}
