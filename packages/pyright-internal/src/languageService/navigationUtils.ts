/*
 * navigationUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Helper functions for navigating files.
 */
import { Location } from 'vscode-languageserver-types';
import { ReadOnlyFileSystem } from '../common/fileSystem';
import { convertPathToUri } from '../common/pathUtils';
import { DocumentRange } from '../common/textRange';

export function canNavigateToFile(fs: ReadOnlyFileSystem, path: string): boolean {
    return !fs.isInZip(path);
}

export function convertDocumentRangesToLocation(fs: ReadOnlyFileSystem, ranges: DocumentRange[]): Location[] {
    return ranges.map((range) => convertDocumentRangeToLocation(fs, range)).filter((loc) => !!loc) as Location[];
}

export function convertDocumentRangeToLocation(fs: ReadOnlyFileSystem, range: DocumentRange): Location | undefined {
    if (!canNavigateToFile(fs, range.path)) {
        return undefined;
    }

    return Location.create(convertPathToUri(fs, range.path), range.range);
}
