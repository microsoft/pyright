// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

declare interface String {
  uriToPath(): string;
  pathToUri(): string;
}

// tslint:disable-next-line:interface-name
declare interface Promise<T> {
  // Catches task error and ignores them.
  ignoreErrors(): void;
}
