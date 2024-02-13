/*
 * commands.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Command identifier strings.
 */

export const enum Commands {
    createTypeStub = 'basedpyright.createtypestub',
    restartServer = 'basedpyright.restartserver',
    orderImports = 'basedpyright.organizeimports',
    unusedImport = 'basedpyright.unusedImport',
    dumpFileDebugInfo = 'basedpyright.dumpFileDebugInfo',
    dumpTokens = 'basedpyright.dumpTokens',
    dumpNodes = 'basedpyright.dumpNodes',
    dumpTypes = 'basedpyright.dumpTypes',
    dumpCachedTypes = 'basedpyright.dumpCachedTypes',
    dumpCodeFlowGraph = 'basedpyright.dumpCodeFlowGraph',
    import = 'basedpyright.import',
}
