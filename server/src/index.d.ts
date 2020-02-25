/*
 * index.d.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Global definitions of extension interfaces.
 */

declare interface Promise<T> {
    // Catches task error and ignores them.
    ignoreErrors(): void;
}
