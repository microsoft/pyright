/*
 * navigationUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Helper functions for navigating files.
 */
import { ReadOnlyFileSystem } from '../common/fileSystem';

export function canNavigateToFile(fs: ReadOnlyFileSystem, path: string): boolean {
    return !fs.isInZipOrEgg(path);
}
