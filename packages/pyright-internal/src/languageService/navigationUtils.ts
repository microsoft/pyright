/*
 * navigationUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Helper functions for navigating files.
 */
import { Location } from 'vscode-languageserver-types';
import { ReadOnlyFileSystem } from '../common/fileSystem';
import { DocumentRange } from '../common/textRange';
import { Uri } from '../common/uri';

export function canNavigateToFile(fs: ReadOnlyFileSystem, path: Uri): boolean {
    return !fs.isInZip(path);
}

export function convertDocumentRangesToLocation(
    fs: ReadOnlyFileSystem,
    ranges: DocumentRange[],
    converter: (fs: ReadOnlyFileSystem, range: DocumentRange) => Location | undefined = convertDocumentRangeToLocation
): Location[] {
    return ranges.map((range) => converter(fs, range)).filter((loc) => !!loc) as Location[];
}

export function convertDocumentRangeToLocation(fs: ReadOnlyFileSystem, range: DocumentRange): Location | undefined {
    if (!canNavigateToFile(fs, range.uri)) {
        return undefined;
    }

    return Location.create(range.uri.toString(), range.range);
}
