/*
 * pythonLanguageVersion.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Types and functions that relate to the Python language version
 * and features within them.
 */

export enum PythonVersion {
    // The order of this enumeration is significant. We assume
    // that we can use comparison operators to check for older
    // or newer versions.
    V3_0 = 0x0300,
    V3_1 = 0x0301,
    V3_2 = 0x0302,
    V3_3 = 0x0303,
    V3_4 = 0x0304,
    V3_5 = 0x0305,
    V3_6 = 0x0306,
    V3_7 = 0x0307,
    V3_8 = 0x0308,
    V3_9 = 0x0309,
    V3_10 = 0x030a,
    V3_11 = 0x030b,
}

export const latestStablePythonVersion = PythonVersion.V3_10;

export function versionToString(version: PythonVersion): string {
    const majorVersion = (version >> 8) & 0xff;
    const minorVersion = version & 0xff;
    return `${majorVersion}.${minorVersion}`;
}

export function versionFromString(verString: string): PythonVersion | undefined {
    const split = verString.split('.');
    if (split.length < 2) {
        return undefined;
    }

    const majorVersion = parseInt(split[0], 10);
    const minorVersion = parseInt(split[1], 10);

    return versionFromMajorMinor(majorVersion, minorVersion);
}

export function versionFromMajorMinor(major: number, minor: number): PythonVersion | undefined {
    if (isNaN(major) || isNaN(minor)) {
        return undefined;
    }

    if (major > 255 || minor > 255) {
        return undefined;
    }

    const value = major * 256 + minor;
    if (PythonVersion[value] === undefined) {
        return undefined;
    }

    // Pyright currently supports only 3.x.
    if (!is3x(value)) {
        return undefined;
    }

    return value;
}

export function is3x(version: PythonVersion): boolean {
    return version >> 8 === 3;
}
