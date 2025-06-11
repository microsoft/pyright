/*
 * navigationUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Helper functions for navigating files.
 */
import { Location } from 'vscode-languageserver-types';
import { DocumentRange } from '../common/docRange';
import { ReadOnlyFileSystem } from '../common/fileSystem';
import { Uri } from '../common/uri/uri';
import { convertUriToLspUriString } from '../common/uri/uriUtils';

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

    return Location.create(convertUriToLspUriString(fs, range.uri), range.range);
}
