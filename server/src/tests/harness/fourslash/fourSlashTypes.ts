/*
 * fourSlashTypes.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Various common types for fourslash test framework
 */
import * as debug from '../../../common/debug';

/** well known global option names */
export const enum GlobalMetadataOptionNames {
    projectRoot = 'projectroot',
    ignoreCase = 'ignorecase',
    typeshed = 'typeshed',
    asynctest = 'asynctest',
}

/** Any option name not belong to this will become global option */
export const enum MetadataOptionNames {
    fileName = 'filename',
    library = 'library',
}

/** List of allowed file metadata names */
export const fileMetadataNames = [MetadataOptionNames.fileName, MetadataOptionNames.library];

/** all the necessary information to set the right compiler settings */
export interface CompilerSettings {
    [name: string]: string;
}

/** Represents a parsed source file with metadata */
export interface FourSlashFile {
    // The contents of the file (with markers, etc stripped out)
    content: string;
    fileName: string;
    version: number;
    // File-specific options (name/value pairs)
    fileOptions: CompilerSettings;
}

/** Represents a set of parsed source files and options */
export interface FourSlashData {
    // Global options (name/value pairs)
    globalOptions: CompilerSettings;
    files: FourSlashFile[];

    // A mapping from marker names to name/position pairs
    markerPositions: Map<string, Marker>;
    markers: Marker[];

    /**
     * Inserted in source files by surrounding desired text
     * in a range with `[|` and `|]`. For example,
     *
     * [|text in range|]
     *
     * is a range with `text in range` "selected".
     */
    ranges: Range[];
    rangesByText?: MultiMap<Range>;
}

export interface Marker {
    fileName: string;
    position: number;
    data?: {};
}

export interface Range {
    fileName: string;
    marker?: Marker;
    pos: number;
    end: number;
}

export interface MultiMap<T> extends Map<string, T[]> {
    /**
     * Adds the value to an array of values associated with the key, and returns the array.
     * Creates the array if it does not already exist.
     */
    add(key: string, value: T): T[];

    /**
     * Removes a value from an array of values associated with the key.
     * Does not preserve the order of those values.
     * Does nothing if `key` is not in `map`, or `value` is not in `map[key]`.
     */
    remove(key: string, value: T): void;
}

/** Review: is this needed? we might just use one from vscode */
export interface HostCancellationToken {
    isCancellationRequested(): boolean;
}

export class TestCancellationToken implements HostCancellationToken {
    // 0 - cancelled
    // >0 - not cancelled
    // <0 - not cancelled and value denotes number of isCancellationRequested after which token become cancelled
    private static readonly notCanceled = -1;
    private numberOfCallsBeforeCancellation = TestCancellationToken.notCanceled;

    isCancellationRequested(): boolean {
        if (this.numberOfCallsBeforeCancellation < 0) {
            return false;
        }

        if (this.numberOfCallsBeforeCancellation > 0) {
            this.numberOfCallsBeforeCancellation--;
            return false;
        }

        return true;
    }

    setCancelled(numberOfCalls = 0): void {
        debug.assert(numberOfCalls >= 0);
        this.numberOfCallsBeforeCancellation = numberOfCalls;
    }

    resetCancelled(): void {
        this.numberOfCallsBeforeCancellation = TestCancellationToken.notCanceled;
    }
}
