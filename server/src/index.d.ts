/*
* index.d.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Global definitions of extension interfaces.
*/

// tslint:disable-next-line:interface-name
declare interface Promise<T> {
  // Catches task error and ignores them.
  ignoreErrors(): void;
}
