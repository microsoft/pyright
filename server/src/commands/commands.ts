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
    orderImports = 'pyright.organizeimports',
    addMissingOptionalToParam = 'pyright.addoptionalforparam'
}
