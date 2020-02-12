/*
 * fourslashrunner.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Entry point that will read all *.fourslash.ts files and
 * register jest tests for them and run
 */

import * as path from 'path';
import { normalizeSlashes } from '../common/pathUtils';
import { runFourSlashTest } from './harness/fourslash/runner';
import * as host from './harness/host';
import { srcFolder } from './harness/vfs/factory';

describe('fourslash tests', () => {
    const testFiles: string[] = [];

    const basePath = path.resolve(path.dirname(module.filename), 'fourslash/');
    for (const file of host.HOST.listFiles(basePath, /.*\.fourslash\.ts$/i, { recursive: true })) {
        testFiles.push(file);
    }

    testFiles.forEach(file => {
        describe(file, () => {
            const fn = normalizeSlashes(file);
            const justName = fn.replace(/^.*[\\/]/, '');

            it('fourslash test ' + justName + ' runs correctly', () => {
                runFourSlashTest(srcFolder, fn);
            });
        });
    });
});
