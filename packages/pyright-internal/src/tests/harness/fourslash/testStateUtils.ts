/*
 * testStateUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Various test utility functions for TestState.
 */

import assert from 'assert';
import * as JSONC from 'jsonc-parser';

import { Comparison, toBoolean } from '../../../common/core';
import { combinePaths, getBaseFileName } from '../../../common/pathUtils';
import { getStringComparer } from '../../../common/stringUtils';
import * as vfs from '../vfs/filesystem';
import { FourSlashData, FourSlashFile, GlobalMetadataOptionNames, Marker, MetadataOptionNames } from './fourSlashTypes';
import { configFileName } from '../../../common/pathConsts';

export function createVfsInfoFromFourSlashData(projectRoot: string, testData: FourSlashData) {
    const metaProjectRoot = testData.globalOptions[GlobalMetadataOptionNames.projectRoot];
    projectRoot = metaProjectRoot ? combinePaths(projectRoot, metaProjectRoot) : projectRoot;

    const ignoreCase = toBoolean(testData.globalOptions[GlobalMetadataOptionNames.ignoreCase]);

    let rawConfigJson = '';
    const sourceFileNames: string[] = [];
    const files: vfs.FileSet = {};

    for (const file of testData.files) {
        // if one of file is configuration file, set config options from the given json
        if (isConfig(file, ignoreCase)) {
            try {
                rawConfigJson = JSONC.parse(file.content);
            } catch (e: any) {
                throw new Error(`Failed to parse test ${file.fileName}: ${e.message}`);
            }
        } else {
            files[file.fileName] = new vfs.File(file.content, { meta: file.fileOptions, encoding: 'utf8' });

            if (!toBoolean(file.fileOptions[MetadataOptionNames.library])) {
                sourceFileNames.push(file.fileName);
            }
        }
    }
    return { files, sourceFileNames, projectRoot, ignoreCase, rawConfigJson };
}

export function getMarkerName(testData: FourSlashData, markerToFind: Marker) {
    let found: string | undefined;
    testData.markerPositions.forEach((marker, name) => {
        if (marker === markerToFind) {
            found = name;
        }
    });

    assert.ok(found);
    return found!;
}

export function getMarkerByName(testData: FourSlashData, markerName: string) {
    const markerPos = testData.markerPositions.get(markerName);
    if (markerPos === undefined) {
        throw new Error(
            `Unknown marker "${markerName}" Available markers: ${getMarkerNames(testData)
                .map((m) => '"' + m + '"')
                .join(', ')}`
        );
    } else {
        return markerPos;
    }
}

export function getMarkerNames(testData: FourSlashData): string[] {
    return [...testData.markerPositions.keys()];
}

export function getRangeByMarkerName(testData: FourSlashData, markerName: string) {
    const marker = getMarkerByName(testData, markerName);
    return testData.ranges.find((r) => r.marker === marker);
}

function isConfig(file: FourSlashFile, ignoreCase: boolean): boolean {
    const comparer = getStringComparer(ignoreCase);
    return comparer(getBaseFileName(file.fileName), configFileName) === Comparison.EqualTo;
}
