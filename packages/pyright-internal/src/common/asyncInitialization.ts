/*
 * asyncInitialization.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * helpers shared between multiple packages such as pyright-internal and pyright
 */

import { ensureTomlModuleLoaded } from './tomlUtils';

export async function initializeDependencies() {
    // Ensure dynamic imports are loaded.
    await ensureTomlModuleLoaded();

    if (process.env.NODE_ENV === 'production') {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        require('source-map-support').install();
    }
}
