/*
 * fourSlashTypes.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Various common types for fourslash test framework
 */
import * as debug from '../../../common/debug';
import { Uri } from '../../../common/uri/uri';

/** well known global option names */
export const enum GlobalMetadataOptionNames {
    projectRoot = 'projectroot',
    ignoreCase = 'ignorecase',
    typeshed = 'typeshed',
    indexer = 'indexer',
    indexerWithoutStdLib = 'indexerwithoutstdlib',
    indexerOptions = 'indexeroptions',
}

/** Any option name not belong to this will become global option */
export const enum MetadataOptionNames {
    fileName = 'filename',
    library = 'library',
    distLibrary = 'distlibrary',
    ipythonMode = 'ipythonmode',
    chainedTo = 'chainedto',
}

/** List of allowed file metadata names */
export const fileMetadataNames = [
    MetadataOptionNames.fileName,
    MetadataOptionNames.library,
    MetadataOptionNames.distLibrary,
    MetadataOptionNames.ipythonMode,
    MetadataOptionNames.chainedTo,
];

/** all the necessary information to set the right compiler settings */
export interface CompilerSettings<T = string> {
    [name: string]: T;
}

export const enum RawTokenKind {
    Whitespace = 'whitespace',
    NewLineCR = 'newlineCR',
    NewLineLF = 'newlineLF',
    Text = 'text',

    // Line prefixes
    TwoSlashPrefix = 'twoSlashPrefix',
    FourSlashPrefix = 'fourSlashPrefix',

    // Directive grammar (only when syntactically active)
    DirectiveAt = 'directiveAt',
    DirectiveName = 'directiveName',
    DirectiveColon = 'directiveColon',
    DirectiveValue = 'directiveValue',

    // Range grammar (only when syntactically active inside a four-slash content line)
    RangeStart = 'rangeStart',
    RangeEnd = 'rangeEnd',

    // Marker grammar (only when syntactically active inside a four-slash content line)
    MarkerStart = 'markerStart',
    MarkerName = 'markerName',
    MarkerEnd = 'markerEnd',

    // Object marker grammar (only when syntactically active inside a four-slash content line)
    ObjectMarkerStart = 'objectMarkerStart',
    ObjectMarkerText = 'objectMarkerText',
    ObjectMarkerEnd = 'objectMarkerEnd',
}

export interface RawToken {
    kind: RawTokenKind;
    // Raw offsets into the original fourslash test string. End is exclusive.
    start: number;
    end: number;
}

export interface RawTokenRange {
    // Token indices into FourSlashData.rawTokens. End is exclusive.
    startToken: number;
    endToken: number;
}

export interface RawContentMappingSegment {
    // Raw offsets into the original fourslash test string. End is exclusive.
    rawStart: number;
    rawEnd: number;
    // Offsets into FourSlashFile.content. End is exclusive.
    contentStart: number;
    contentEnd: number;
}

export interface RawContentMapping {
    // Piecewise-linear mapping segments. Any offset outside all segments is unmapped.
    segments: RawContentMappingSegment[];
}

export interface FourSlashFileRawData {
    // Token ranges for the four-slash content lines that contributed to this file.
    // Multiple ranges are used to keep consumption straightforward.
    tokenRanges: RawTokenRange[];

    // Mapping between raw offsets (original test string) and content offsets (FourSlashFile.content).
    // Mapping is strict: offsets in stripped syntax (prefixes, directives, marker/range tokens, chomped spaces) are unmapped.
    rawToContent?: RawContentMapping;
    contentToRaw?: RawContentMapping;

    // RawData for file options directives, keyed by option name.
    fileOptionsRawData?: CompilerSettings<CompilerSettingRawData>;
}

export interface CompilerSettingRawData {
    // Token range covering the full directive line (including // and any whitespace/newline tokens on that line).
    directiveLine: RawTokenRange;
    // Token range for the // prefix.
    prefix: RawTokenRange;
    // Token range for '@' + directive name.
    name: RawTokenRange;
    // Token range for ':' if present.
    colon?: RawTokenRange | undefined;
    // Token range for the directive value (may be empty).
    value: RawTokenRange;
}

/** Represents a parsed source file with metadata */
export interface FourSlashFile {
    // The contents of the file (with markers, etc stripped out)
    content: string;
    fileName: string;
    fileUri: Uri;
    version: number;
    // File-specific options (name/value pairs)
    fileOptions: CompilerSettings;

    // Optional raw parsing metadata used for semantic tokenization of the original test string.
    rawData?: FourSlashFileRawData;
}

/** Represents a set of parsed source files and options */
export interface FourSlashData {
    // Global options (name/value pairs)
    globalOptions: CompilerSettings;
    files: FourSlashFile[];

    // The original, unmodified fourslash test string.
    rawText?: string;
    // Lossless raw token stream that tiles rawText exactly.
    rawTokens?: RawToken[];
    // RawData for global options directives, keyed by option name.
    globalOptionsRawData?: CompilerSettings<CompilerSettingRawData>;

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
    rangesByText?: MultiMap<Range> | undefined;
}

export interface Marker {
    fileName: string;
    fileUri: Uri;
    position: number;
    data?: {};

    // Optional raw token references for this marker in the original test string.
    rawData?: MarkerRawData;
}

export interface MarkerRawData {
    kind: 'slashStar' | 'object';

    full: RawTokenRange;
    start: RawTokenRange;
    end: RawTokenRange;

    // Present when kind === 'slashStar'.
    name?: RawTokenRange | undefined;
    // Present when kind === 'object'.
    text?: RawTokenRange | undefined;
}

export interface Range {
    fileName: string;
    fileUri: Uri;
    marker?: Marker | undefined;
    pos: number;
    end: number;

    // Optional raw token references for this range in the original test string.
    rawData?: RangeRawData;
}

export interface RangeRawData {
    full: RawTokenRange;
    open: RawTokenRange;
    selected: RawTokenRange;
    close: RawTokenRange;
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
    private static readonly _notCanceled = -1;
    private _numberOfCallsBeforeCancellation = TestCancellationToken._notCanceled;

    isCancellationRequested(): boolean {
        if (this._numberOfCallsBeforeCancellation < 0) {
            return false;
        }

        if (this._numberOfCallsBeforeCancellation > 0) {
            this._numberOfCallsBeforeCancellation--;
            return false;
        }

        return true;
    }

    setCancelled(numberOfCalls = 0): void {
        debug.assert(numberOfCalls >= 0);
        this._numberOfCallsBeforeCancellation = numberOfCalls;
    }

    resetCancelled(): void {
        this._numberOfCallsBeforeCancellation = TestCancellationToken._notCanceled;
    }
}
