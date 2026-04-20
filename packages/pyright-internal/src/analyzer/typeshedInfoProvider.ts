/*
 * typeshedInfoProvider.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

import { stripFileExtension } from '../common/pathUtils';
import { pythonVersion3_0, PythonVersion } from '../common/pythonVersion';
import { Uri } from '../common/uri/uri';

import type { ImportLogger } from './importLogger';
import {
    ImportResolverFileSystem,
    SupportedVersionInfo,
    TypeshedInfoProvider,
    TypeshedThirdPartyPackageMapResult,
} from './importResolverTypes';
import * as PythonPathUtils from './pythonPathUtils';

export function createDefaultTypeshedInfoProvider(fileSystem: ImportResolverFileSystem): TypeshedInfoProvider {
    return new DefaultTypeshedInfoProvider(fileSystem);
}

class DefaultTypeshedInfoProvider implements TypeshedInfoProvider {
    private readonly _typeshedRootCache = new Map<string, Uri | undefined>();
    private readonly _typeshedSubdirectoryCache = new Map<string, Uri | undefined>();
    private readonly _thirdPartyPackageMapCache = new Map<string, TypeshedThirdPartyPackageMapResult>();
    private readonly _stdlibVersionInfoCache = new Map<string, ReadonlyMap<string, SupportedVersionInfo>>();

    constructor(private readonly _fileSystem: ImportResolverFileSystem) {
        // Empty
    }

    getTypeshedRoot(customTypeshedPath: Uri | undefined, _importLogger?: ImportLogger): Uri | undefined {
        const key = customTypeshedPath?.key ?? '';
        const cached = this._typeshedRootCache.get(key);
        if (cached !== undefined) {
            return cached;
        }

        const root = this._computeTypeshedRoot(customTypeshedPath);
        this._typeshedRootCache.set(key, root);
        return root;
    }

    getTypeshedSubdirectory(
        isStdLib: boolean,
        customTypeshedPath: Uri | undefined,
        importLogger?: ImportLogger
    ): Uri | undefined {
        const key = `${isStdLib ? 'stdlib' : 'thirdParty'}:${customTypeshedPath?.key ?? ''}`;
        const cached = this._typeshedSubdirectoryCache.get(key);
        if (cached !== undefined) {
            return cached;
        }

        const typeshedRoot = this.getTypeshedRoot(customTypeshedPath, importLogger);
        if (!typeshedRoot) {
            this._typeshedSubdirectoryCache.set(key, undefined);
            return undefined;
        }

        const subdir = PythonPathUtils.getTypeshedSubdirectory(typeshedRoot, isStdLib);
        if (!this._fileSystem.dirExists(subdir)) {
            this._typeshedSubdirectoryCache.set(key, undefined);
            return undefined;
        }

        this._typeshedSubdirectoryCache.set(key, subdir);
        return subdir;
    }

    getThirdPartyPackageMap(
        customTypeshedPath: Uri | undefined,
        importLogger?: ImportLogger
    ): TypeshedThirdPartyPackageMapResult {
        const key = customTypeshedPath?.key ?? '';
        const cached = this._thirdPartyPackageMapCache.get(key);
        if (cached) {
            return cached;
        }

        const thirdPartyDir = this.getTypeshedSubdirectory(/* isStdLib */ false, customTypeshedPath, importLogger);
        const typeshedThirdPartyPackagePaths = new Map<string, Uri[]>();

        if (thirdPartyDir) {
            // `readdirEntriesSync` is cached by ImportResolverFileSystem, so repeated calls across
            // ImportResolvers will share the same cached directory enumerations.
            for (const outerEntry of this._fileSystem.readdirEntriesSync(thirdPartyDir)) {
                if (!outerEntry.isDirectory()) {
                    continue;
                }

                const innerDirPath = thirdPartyDir.combinePaths(outerEntry.name);

                for (const innerEntry of this._fileSystem.readdirEntriesSync(innerDirPath)) {
                    if (innerEntry.name === '@python2') {
                        continue;
                    }

                    if (innerEntry.isDirectory()) {
                        const pathList = typeshedThirdPartyPackagePaths.get(innerEntry.name);
                        if (pathList) {
                            pathList.push(innerDirPath);
                        } else {
                            typeshedThirdPartyPackagePaths.set(innerEntry.name, [innerDirPath]);
                        }
                    } else if (innerEntry.isFile()) {
                        if (innerEntry.name.endsWith('.pyi')) {
                            const strippedFileName = stripFileExtension(innerEntry.name);
                            const pathList = typeshedThirdPartyPackagePaths.get(strippedFileName);
                            if (pathList) {
                                pathList.push(innerDirPath);
                            } else {
                                typeshedThirdPartyPackagePaths.set(strippedFileName, [innerDirPath]);
                            }
                        }
                    }
                }
            }
        }

        const flattenPaths = Array.from(typeshedThirdPartyPackagePaths.values()).flatMap((v) => v);
        const result: TypeshedThirdPartyPackageMapResult = [
            typeshedThirdPartyPackagePaths,
            Array.from(new Set(flattenPaths)).sort(),
        ];

        this._thirdPartyPackageMapCache.set(key, result);
        return result;
    }

    getStdLibModuleVersionInfo(
        customTypeshedPath: Uri | undefined,
        importLogger?: ImportLogger
    ): ReadonlyMap<string, SupportedVersionInfo> {
        const key = customTypeshedPath?.key ?? '';
        const cached = this._stdlibVersionInfoCache.get(key);
        if (cached) {
            return cached;
        }

        const versionRangeMap = new Map<string, SupportedVersionInfo>();

        // Read the VERSIONS file from typeshed.
        const typeshedStdLibPath = this.getTypeshedSubdirectory(/* isStdLib */ true, customTypeshedPath, importLogger);
        if (typeshedStdLibPath) {
            const versionsFilePath = typeshedStdLibPath.combinePaths('VERSIONS');
            try {
                const fileStats = this._fileSystem.statSync(versionsFilePath);
                if (fileStats.size > 0 && fileStats.size < 256 * 1024) {
                    const fileContents = this._fileSystem.readFileSync(versionsFilePath, 'utf8');
                    fileContents.split(/\r?\n/).forEach((line) => {
                        const commentSplit = line.split('#');

                        // Platform-specific information can be specified after a semicolon.
                        const semicolonSplit = commentSplit[0].split(';').map((s) => s.trim());

                        // Version information is found after a colon.
                        const colonSplit = semicolonSplit[0].split(':');
                        if (colonSplit.length !== 2) {
                            return;
                        }

                        const versionSplit = colonSplit[1].split('-');
                        if (versionSplit.length > 2) {
                            return;
                        }

                        const moduleName = colonSplit[0].trim();
                        if (!moduleName) {
                            return;
                        }

                        let minVersionString = versionSplit[0].trim();
                        if (minVersionString.endsWith('+')) {
                            // If the version ends in "+", strip it off.
                            minVersionString = minVersionString.substr(0, minVersionString.length - 1);
                        }

                        let minVersion = PythonVersion.fromString(minVersionString);
                        if (!minVersion) {
                            minVersion = pythonVersion3_0;
                        }

                        let maxVersion: PythonVersion | undefined;
                        if (versionSplit.length > 1) {
                            maxVersion = PythonVersion.fromString(versionSplit[1].trim());
                        }

                        // A semicolon can be followed by a semicolon-delimited list of other
                        // exclusions. The "platform" exclusion is a comma delimited list platforms
                        // that are supported or not supported.
                        let supportedPlatforms: string[] | undefined;
                        let unsupportedPlatforms: string[] | undefined;
                        const platformsHeader = 'platforms=';
                        let platformExclusions = semicolonSplit.slice(1).find((s) => s.startsWith(platformsHeader));

                        if (platformExclusions) {
                            platformExclusions = platformExclusions.trim().substring(platformsHeader.length);
                            const commaSplit = platformExclusions.split(',');
                            for (let platform of commaSplit) {
                                platform = platform.trim();
                                let isUnsupported = false;

                                // Remove the '!' from the start if it's an exclusion.
                                if (platform.startsWith('!')) {
                                    isUnsupported = true;
                                    platform = platform.substring(1);
                                }

                                if (isUnsupported) {
                                    unsupportedPlatforms = unsupportedPlatforms ?? [];
                                    unsupportedPlatforms.push(platform);
                                } else {
                                    supportedPlatforms = supportedPlatforms ?? [];
                                    supportedPlatforms.push(platform);
                                }
                            }
                        }

                        versionRangeMap.set(moduleName, {
                            min: minVersion,
                            max: maxVersion,
                            supportedPlatforms,
                            unsupportedPlatforms,
                        });
                    });
                } else {
                    importLogger?.log(`Typeshed stdlib VERSIONS file is unexpectedly large`);
                }
            } catch (e: any) {
                importLogger?.log(`Could not read typeshed stdlib VERSIONS file: '${JSON.stringify(e)}'`);
            }
        }

        this._stdlibVersionInfoCache.set(key, versionRangeMap);
        return versionRangeMap;
    }

    private _computeTypeshedRoot(customTypeshedPath: Uri | undefined): Uri | undefined {
        // Did the user specify a typeshed path? If not, use the fallback.
        if (customTypeshedPath) {
            if (this._fileSystem.dirExists(customTypeshedPath)) {
                return customTypeshedPath;
            }
        }

        const fallback = PythonPathUtils.getTypeShedFallbackPath(this._fileSystem) ?? Uri.empty();
        return fallback.isEmpty() ? undefined : fallback;
    }
}
