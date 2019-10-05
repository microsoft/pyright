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
import { combinePaths } from '../common/pathUtils';

test('Empty', () => {
    const filePath = combinePaths(process.cwd(), 'tests/samples/test_file1.py');
    const sourceFile = new SourceFile(filePath, false, false);
    const configOptions = new ConfigOptions(process.cwd());
    const importResolver = new ImportResolver(configOptions);

    sourceFile.parse(configOptions, importResolver);
});
