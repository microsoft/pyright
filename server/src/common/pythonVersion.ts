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
    V24 = 0x0204,
    V25 = 0x0205,
    V26 = 0x0206,
    V27 = 0x0207,
    V30 = 0x0300,
    V31 = 0x0301,
    V32 = 0x0302,
    V33 = 0x0303,
    V34 = 0x0304,
    V35 = 0x0305,
    V36 = 0x0306,
    V37 = 0x0307,
    V38 = 0x0308
}

export const latestStablePythonVersion = PythonVersion.V38;
export const latestPythonVersion = PythonVersion.V38;

export function versionToString(version: PythonVersion): string {
    const majorVersion = (version >> 8) & 0xff;
    const minorVersion = version & 0xff;
    return `${majorVersion}.${minorVersion}`;
}

export function versionFromString(verString: string): PythonVersion | undefined {
    const split = verString.split('.');
    if (split.length !== 2) {
        return undefined;
    }

    const majorVersion = parseInt(split[0], 10);
    const minorVersion = parseInt(split[1], 10);

    if (isNaN(majorVersion) || isNaN(minorVersion)) {
        return undefined;
    }

    if (majorVersion > 255 || minorVersion > 255) {
        return undefined;
    }

    const value = majorVersion * 256 + minorVersion;
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
