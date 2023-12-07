/*
 * sourceFile.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Unit tests for pyright sourceFile module.
 */
import * as assert from 'assert';

import { ImportResolver } from '../analyzer/importResolver';
import { SourceFile } from '../analyzer/sourceFile';
import { ConfigOptions } from '../common/configOptions';
import { FullAccessHost } from '../common/fullAccessHost';
import { combinePaths } from '../common/pathUtils';
import { createFromRealFileSystem } from '../common/realFileSystem';
import { createServiceProvider } from '../common/serviceProviderExtensions';
import { Uri } from '../common/uri/uri';
import { parseAndGetTestState } from './harness/fourslash/testState';

test('Empty', () => {
    const filePath = combinePaths(process.cwd(), 'tests/samples/test_file1.py');
    const fs = createFromRealFileSystem();
    const serviceProvider = createServiceProvider(fs);
    const sourceFile = new SourceFile(serviceProvider, Uri.file(filePath), '', false, false, { isEditMode: false });
    const configOptions = new ConfigOptions(Uri.file(process.cwd()));
    const sp = createServiceProvider(fs);
    const importResolver = new ImportResolver(sp, configOptions, new FullAccessHost(sp));

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
        state.workspace.service.test_program.getSourceFile(Uri.file(marker.fileName))?.getFileContent(),
        '# Content'
    );

    state.workspace.service.updateOpenFileContents(Uri.file(marker.fileName), 1, '');
    assert.strictEqual(
        state.workspace.service.test_program.getSourceFile(Uri.file(marker.fileName))?.getFileContent(),
        ''
    );
});
