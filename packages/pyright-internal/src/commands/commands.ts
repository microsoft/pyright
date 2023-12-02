/*
 * commands.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Command identifier strings.
 */

export const enum Commands {
    createTypeStub = 'pyright.createtypestub',
    restartServer = 'pyright.restartserver',
    orderImports = 'pyright.organizeimports',
    unusedImport = 'pyright.unusedImport',
    dumpFileDebugInfo = 'pyright.dumpFileDebugInfo',
    dumpTokens = 'pyright.dumpTokens',
    dumpNodes = 'pyright.dumpNodes',
    dumpTypes = 'pyright.dumpTypes',
    dumpCachedTypes = 'pyright.dumpCachedTypes',
    dumpCodeFlowGraph = 'pyright.dumpCodeFlowGraph',
}
