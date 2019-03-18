/*
* sourceFile.test.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Unit tests for pyright sourceFile module.
*/

import { SourceFile } from '../analyzer/sourceFile';
import { ConfigOptions } from '../common/configOptions';
import { combinePaths } from '../common/pathUtils';

test('Empty', () => {
    let filePath = combinePaths(process.cwd(), 'tests/samples/test_file1.py');
    let sourceFile = new SourceFile(filePath, false);
    let configOptions = new ConfigOptions(process.cwd());

    sourceFile.parse(configOptions);
});
