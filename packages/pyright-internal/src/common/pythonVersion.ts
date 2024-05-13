/*
 * pythonLanguageVersion.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Types and functions that relate to the Python language version.
 */

export type PythonReleaseLevel = 'alpha' | 'beta' | 'candidate' | 'final';

export class PythonVersion {
    constructor(
        private _major: number,
        private _minor: number,
        private _micro?: number,
        private _releaseLevel?: PythonReleaseLevel,
        private _serial?: number
    ) {}

    get major() {
        return this._major;
    }

    get minor() {
        return this._minor;
    }

    get micro() {
        return this._micro;
    }

    get releaseLevel() {
        return this._releaseLevel;
    }

    get serial() {
        return this._serial;
    }

    isEqualTo(other: PythonVersion) {
        if (this.major !== other.major || this.minor !== other.minor) {
            return false;
        }

        if (this._micro === undefined || other._micro === undefined) {
            return true;
        } else if (this._micro !== other._micro) {
            return false;
        }

        if (this._releaseLevel === undefined || other._releaseLevel === undefined) {
            return true;
        } else if (this._releaseLevel !== other._releaseLevel) {
            return false;
        }

        if (this._serial === undefined || other._serial === undefined) {
            return true;
        } else if (this._serial !== other._serial) {
            return false;
        }

        return true;
    }

    isGreaterThan(other: PythonVersion) {
        if (this.major > other.major) {
            return true;
        } else if (this.major < other.major) {
            return false;
        }

        if (this.minor > other.minor) {
            return true;
        } else if (this.minor < other.minor) {
            return false;
        }

        if (this._micro === undefined || other._micro === undefined || this._micro < other._micro) {
            return false;
        } else if (this._micro > other._micro) {
            return true;
        }

        // We leverage the fact that the alphabetical ordering
        // of the release level designators are ordered by increasing
        // release level.
        if (
            this._releaseLevel === undefined ||
            other._releaseLevel === undefined ||
            this._releaseLevel < other._releaseLevel
        ) {
            return false;
        } else if (this._releaseLevel > other._releaseLevel) {
            return true;
        }

        if (this._serial === undefined || other._serial === undefined || this._serial < other._serial) {
            return false;
        } else if (this._serial > other._serial) {
            return true;
        }

        // They are exactly equal!
        return false;
    }

    isGreaterOrEqualTo(other: PythonVersion) {
        return this.isEqualTo(other) || this.isGreaterThan(other);
    }

    isLessThan(other: PythonVersion) {
        return !this.isGreaterOrEqualTo(other);
    }

    isLessOrEqualTo(other: PythonVersion) {
        return !this.isGreaterThan(other);
    }

    toMajorMinorString(): string {
        return `${this._major}.${this._minor}`;
    }

    toString(): string {
        let version = this.toMajorMinorString();

        if (this._micro === undefined) {
            return version;
        }

        version += `.${this._micro}`;

        if (this._releaseLevel === undefined) {
            return version;
        }

        version += `.${this._releaseLevel}`;

        if (this._serial === undefined) {
            return version;
        }

        version += `.${this._serial}`;
        return version;
    }

    static fromString(val: string): PythonVersion | undefined {
        const split = val.split('.');

        if (split.length < 2) {
            return undefined;
        }

        const major = parseInt(split[0], 10);
        const minor = parseInt(split[1], 10);

        if (isNaN(major) || isNaN(minor)) {
            return undefined;
        }

        let micro: number | undefined;
        if (split.length >= 3) {
            micro = parseInt(split[2], 10);
            if (isNaN(micro)) {
                micro = undefined;
            }
        }

        let releaseLevel: PythonReleaseLevel | undefined;
        if (split.length >= 4) {
            const releaseLevels: PythonReleaseLevel[] = ['alpha', 'beta', 'candidate', 'final'];
            if (releaseLevels.some((level) => level === split[3])) {
                releaseLevel = split[3] as PythonReleaseLevel;
            }
        }

        let serial: number | undefined;
        if (split.length >= 5) {
            serial = parseInt(split[4], 10);
            if (isNaN(serial)) {
                serial = undefined;
            }
        }

        return new PythonVersion(major, minor, micro, releaseLevel, serial);
    }
}

// Predefine some versions.
export const pythonVersion3_0 = new PythonVersion(3, 0);
export const pythonVersion3_1 = new PythonVersion(3, 1);
export const pythonVersion3_2 = new PythonVersion(3, 2);
export const pythonVersion3_3 = new PythonVersion(3, 3);
export const pythonVersion3_4 = new PythonVersion(3, 4);
export const pythonVersion3_5 = new PythonVersion(3, 5);
export const pythonVersion3_6 = new PythonVersion(3, 6);
export const pythonVersion3_7 = new PythonVersion(3, 7);
export const pythonVersion3_8 = new PythonVersion(3, 8);
export const pythonVersion3_9 = new PythonVersion(3, 9);
export const pythonVersion3_10 = new PythonVersion(3, 10);
export const pythonVersion3_11 = new PythonVersion(3, 11);
export const pythonVersion3_12 = new PythonVersion(3, 12);
export const pythonVersion3_13 = new PythonVersion(3, 13);
export const pythonVersion3_14 = new PythonVersion(3, 14);

export const latestStablePythonVersion = pythonVersion3_12;
