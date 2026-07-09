/*
 * nodeMain.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Thin entry-point shim for the Pyright type server. All server logic lives in
 * pyright-internal so that vscode-languageserver resolves to a single copy (matching
 * how the `pyright` package's entry points shim over pyright-internal).
 */

import { main } from 'pyright-internal/typeServer/nodeMain';

void main();

