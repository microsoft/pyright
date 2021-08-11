/*
 * fourSlashRunner.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Entry point that will read all *.fourslash.ts files and
 * register jest tests for them and run
 */

import * as path from 'path';

import { normalizeSlashes } from '../common/pathUtils';
import { runFourSlashTest } from './harness/fourslash/runner';
import * as host from './harness/testHost';
import { MODULE_PATH } from './harness/vfs/filesystem';

describe('fourslash tests', () => {
    const testFiles: string[] = [];

    const basePath = path.resolve(path.dirname(module.filename), 'fourslash/');
    for (const file of host.HOST.listFiles(basePath, /.*\.fourslash\.ts$/i, { recursive: true })) {
        testFiles.push(file);
    }

    testFiles.forEach((file) => {
        describe(file, () => {
            const fn = normalizeSlashes(file);
            const justName = fn.replace(/^.*[\\/]/, '');

            // TODO: make these to use promise/async rather than callback token
            it('fourslash test ' + justName + ' run', (cb) => {
                runFourSlashTest(MODULE_PATH, fn, cb);
            });
        });
    });
});
