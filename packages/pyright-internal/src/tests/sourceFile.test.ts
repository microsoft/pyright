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
import { RealTempFile, createFromRealFileSystem } from '../common/realFileSystem';
import { createServiceProvider } from '../common/serviceProviderExtensions';
import { parseAndGetTestState } from './harness/fourslash/testState';
import { Uri } from '../common/uri/uri';

test('Empty', () => {
    const filePath = combinePaths(process.cwd(), 'tests/samples/test_file1.py');
    const tempFile = new RealTempFile();
    const fs = createFromRealFileSystem(tempFile);
    const serviceProvider = createServiceProvider(tempFile, fs);
    const sourceFile = new SourceFile(serviceProvider, Uri.file(filePath, serviceProvider), '', false, false, {
        isEditMode: false,
    });
    const configOptions = new ConfigOptions(Uri.file(process.cwd(), serviceProvider));
    const sp = createServiceProvider(fs);
    const importResolver = new ImportResolver(sp, configOptions, new FullAccessHost(sp));

    sourceFile.parse(configOptions, importResolver);
    serviceProvider.dispose();
});

test('Empty Open file', () => {
    const code = `
// @filename: test.py
//// [|/*marker*/# Content|]
    `;

    const state = parseAndGetTestState(code).state;
    const marker = state.getMarkerByName('marker');

    assert.strictEqual(
        state.workspace.service.test_program.getSourceFile(marker.fileUri)?.getFileContent(),
        '# Content'
    );

    state.workspace.service.updateOpenFileContents(marker.fileUri, 1, '');
    assert.strictEqual(state.workspace.service.test_program.getSourceFile(marker.fileUri)?.getFileContent(), '');
});
