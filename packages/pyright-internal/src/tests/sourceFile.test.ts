/*
 * sourceFile.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Unit tests for pyright sourceFile module.
 */
import * as assert from 'assert';

import { getFileInfo } from '../analyzer/analyzerNodeInfo';
import { ImportResolver } from '../analyzer/importResolver';
import { SourceFile } from '../analyzer/sourceFile';
import { ConfigOptions } from '../common/configOptions';
import { FullAccessHost } from '../common/fullAccessHost';
import { combinePaths } from '../common/pathUtils';
import { createFromRealFileSystem } from '../common/realFileSystem';
import { parseAndGetTestState } from './harness/fourslash/testState';

test('Empty', () => {
    const filePath = combinePaths(process.cwd(), 'tests/samples/test_file1.py');
    const fs = createFromRealFileSystem();
    const sourceFile = new SourceFile(fs, filePath, '', false, false);
    const configOptions = new ConfigOptions(process.cwd());
    const importResolver = new ImportResolver(fs, configOptions, new FullAccessHost(fs));

    sourceFile.parse(configOptions, importResolver);
});

test('Empty Open file', () => {
    const code = `
// @filename: test.py
//// [|/*marker*/# Content|]
    `;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');

    assert.strictEqual(
        state.workspace.service.test_program.getSourceFile(marker.fileName)?.getFileContent(),
        '# Content'
    );

    state.workspace.service.updateOpenFileContents(marker.fileName, 1, '');
    assert.strictEqual(state.workspace.service.test_program.getSourceFile(marker.fileName)?.getFileContent(), '');
});

test('Open library file first and then user file that consumes it', () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }
    
// @filename: myLib/py.typed
// @library: true
//// # empty

// @filename: myLib/__init__.py
// @library: true
//// /*lib*/def foo(): pass

// @filename: test.py
//// /*user*/from myLib import foo
    `;

    const state = parseAndGetTestState(code).state;
    const libMarker = state.getMarkerByName('lib');
    const userMarker = state.getMarkerByName('user');

    // Open Library file first.
    state.openFile(libMarker.fileName);

    // Verify that the file is NOT marked as library
    {
        const libraryFileInfo = state.workspace.service.test_program.getBoundSourceFileInfo(libMarker.fileName)!;
        assert.strictEqual(libraryFileInfo.isThirdPartyImport, false);
        assert.strictEqual(libraryFileInfo.isThirdPartyPyTypedPresent, false);

        assert.strictEqual(libraryFileInfo.sourceFile.isThirdPartyImport(), false);
        assert.strictEqual(libraryFileInfo.sourceFile.isThirdPartyPyTypedPresent(), false);

        const fileInfo = getFileInfo(libraryFileInfo.sourceFile.getParseResults()!.parseTree);
        assert.strictEqual(fileInfo.isInPyTypedPackage, false);
    }

    // Now open a user file that consume the library file
    state.openFile(userMarker.fileName);

    // Make sure we parse the user file.
    const userFileInfo = state.workspace.service.test_program.getBoundSourceFileInfo(userMarker.fileName)!;

    // Verify that the file is still NOT marked as library
    {
        const libraryFileInfo = state.workspace.service.test_program.getBoundSourceFileInfo(libMarker.fileName)!;
        assert.strictEqual(libraryFileInfo.isThirdPartyImport, false);
        assert.strictEqual(libraryFileInfo.isThirdPartyPyTypedPresent, false);

        assert.strictEqual(libraryFileInfo.sourceFile.isThirdPartyImport(), false);
        assert.strictEqual(libraryFileInfo.sourceFile.isThirdPartyPyTypedPresent(), false);

        const fileInfo = getFileInfo(libraryFileInfo.sourceFile.getParseResults()!.parseTree);
        assert.strictEqual(fileInfo.isInPyTypedPackage, false);
    }

    // Verify that the library file is now imported by user file.
    {
        const libraryFileInfo = state.workspace.service.test_program.getBoundSourceFileInfo(libMarker.fileName)!;

        assert.strictEqual(userFileInfo.imports.filter((i) => i === libraryFileInfo).length, 1);
        assert.strictEqual(libraryFileInfo.importedBy.filter((i) => i === userFileInfo).length, 1);
    }

    // Verify that the library file is now stucked in the wrong state.
    state.workspace.service.setFileClosed(libMarker.fileName);
    state.workspace.service.setFileClosed(userMarker.fileName);

    {
        const libraryFileInfo = state.workspace.service.test_program.getBoundSourceFileInfo(libMarker.fileName)!;
        assert.strictEqual(libraryFileInfo.isThirdPartyImport, false);
        assert.strictEqual(libraryFileInfo.isThirdPartyPyTypedPresent, false);

        assert.strictEqual(libraryFileInfo.sourceFile.isThirdPartyImport(), false);
        assert.strictEqual(libraryFileInfo.sourceFile.isThirdPartyPyTypedPresent(), false);

        const fileInfo = getFileInfo(libraryFileInfo.sourceFile.getParseResults()!.parseTree);
        assert.strictEqual(fileInfo.isInPyTypedPackage, false);
    }
});

test('Open user file that consumes a library first and then the library file', () => {
    const code = `
// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }
    
// @filename: myLib/py.typed
// @library: true
//// # empty

// @filename: myLib/__init__.py
// @library: true
//// /*lib*/def foo(): pass

// @filename: test.py
//// /*user*/from myLib import foo
    `;

    const state = parseAndGetTestState(code).state;
    const libMarker = state.getMarkerByName('lib');
    const userMarker = state.getMarkerByName('user');

    // Open the user file first.
    state.openFile(userMarker.fileName);

    // Make sure we parse the user file.
    const userFileInfo = state.workspace.service.test_program.getBoundSourceFileInfo(userMarker.fileName)!;

    // Verify that the file is marked as library
    {
        const libraryFileInfo = state.workspace.service.test_program.getBoundSourceFileInfo(libMarker.fileName)!;
        assert.strictEqual(libraryFileInfo.isThirdPartyImport, true);
        assert.strictEqual(libraryFileInfo.isThirdPartyPyTypedPresent, true);

        assert.strictEqual(libraryFileInfo.sourceFile.isThirdPartyImport(), true);
        assert.strictEqual(libraryFileInfo.sourceFile.isThirdPartyPyTypedPresent(), true);

        const fileInfo = getFileInfo(libraryFileInfo.sourceFile.getParseResults()!.parseTree);
        assert.strictEqual(fileInfo.isInPyTypedPackage, true);
    }

    // Now open the library file
    state.openFile(libMarker.fileName);

    // Verify that the file is still marked as library
    {
        const libraryFileInfo = state.workspace.service.test_program.getBoundSourceFileInfo(libMarker.fileName)!;
        assert.strictEqual(libraryFileInfo.isThirdPartyImport, true);
        assert.strictEqual(libraryFileInfo.isThirdPartyPyTypedPresent, true);

        assert.strictEqual(libraryFileInfo.sourceFile.isThirdPartyImport(), true);
        assert.strictEqual(libraryFileInfo.sourceFile.isThirdPartyPyTypedPresent(), true);

        const fileInfo = getFileInfo(libraryFileInfo.sourceFile.getParseResults()!.parseTree);
        assert.strictEqual(fileInfo.isInPyTypedPackage, true);
    }

    // Verify that the library file is imported by user file.
    {
        const libraryFileInfo = state.workspace.service.test_program.getBoundSourceFileInfo(libMarker.fileName)!;
        assert.strictEqual(userFileInfo.imports.filter((i) => i === libraryFileInfo).length, 1);
        assert.strictEqual(libraryFileInfo.importedBy.filter((i) => i === userFileInfo).length, 1);
    }

    // Verify that the library file is in correct state.
    state.workspace.service.setFileClosed(libMarker.fileName);
    state.workspace.service.setFileClosed(userMarker.fileName);

    {
        const libraryFileInfo = state.workspace.service.test_program.getBoundSourceFileInfo(libMarker.fileName)!;
        assert.strictEqual(libraryFileInfo.isThirdPartyImport, true);
        assert.strictEqual(libraryFileInfo.isThirdPartyPyTypedPresent, true);

        assert.strictEqual(libraryFileInfo.sourceFile.isThirdPartyImport(), true);
        assert.strictEqual(libraryFileInfo.sourceFile.isThirdPartyPyTypedPresent(), true);

        const fileInfo = getFileInfo(libraryFileInfo.sourceFile.getParseResults()!.parseTree);
        assert.strictEqual(fileInfo.isInPyTypedPackage, true);
    }
});
