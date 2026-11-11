/*
 * typeInferencePyrightEntry.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

import * as fs from 'fs';
import * as path from 'path';

let rootDirectory = __dirname;
while (!fs.existsSync(path.join(rootDirectory, 'typeshed-fallback'))) {
    const parentDirectory = path.dirname(rootDirectory);
    if (parentDirectory === rootDirectory) {
        throw new Error('Could not find the pyright-internal root directory');
    }
    rootDirectory = parentDirectory;
}

(global as any).__rootDirectory = rootDirectory;

void import('../../pyright.js').then(({ main }) => main());
