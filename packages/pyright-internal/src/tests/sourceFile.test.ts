/*
 * sourceFile.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Unit tests for pyright sourceFile module.
 */

import { ImportResolver } from '../analyzer/importResolver';
import { SourceFile } from '../analyzer/sourceFile';
import { ConfigOptions } from '../common/configOptions';
import { FullAccessHost } from '../common/fullAccessHost';
import { combinePaths } from '../common/pathUtils';
import { createFromRealFileSystem } from '../common/realFileSystem';

test('Empty', () => {
    const filePath = combinePaths(process.cwd(), 'tests/samples/test_file1.py');
    const fs = createFromRealFileSystem();
    const sourceFile = new SourceFile(fs, filePath, '', false, false);
    const configOptions = new ConfigOptions(process.cwd());
    const importResolver = new ImportResolver(fs, configOptions, new FullAccessHost(fs));

    sourceFile.parse(configOptions, importResolver);
});
