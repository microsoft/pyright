/*
* fourslash.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
*/

import { LineAndColumn, TextRange } from "../../common/textRange";
import { Marker, Range } from "../harness/fourslash/fourSlashTypes";

export interface TextChange {
    span: TextRange;
    newText: string;
}

export interface Fourslash {
    getMarkerName(m: Marker): string;
    getMarkerByName(markerName: string): Marker;
    getMarkerNames(): string[];
    getMarkers(): Marker[];

    getRanges(): Range[];
    getRangesInFile(fileName: string): Range[];
    getRangesByText(): Map<string, Range[]>;

    goToBOF(): void;
    goToEOF(): void;
    goToPosition(positionOrLineAndColumn: number | LineAndColumn): void;
    goToMarker(nameOrMarker: string | Marker): void;
    goToEachMarker(markers: readonly Marker[], action: (marker: Marker, index: number) => void): void;
    goToEachRange(action: (range: Range) => void): void;
    goToRangeStart({ fileName, pos }: Range): void;

    select(startMarker: string, endMarker: string): void;
    selectAllInFile(fileName: string): void;
    selectRange(range: Range): void;
    selectLine(index: number): void;

    moveCaretRight(count: number): void;

    /* not tested yet
    openFile(indexOrName: number | string, content?: string): void;
    paste(text: string): void;

    type(text: string): void;
    replace(start: number, length: number, text: string): void;
    deleteChar(count: number): void;
    deleteLineRange(startIndex: number, endIndexInclusive: number): void;
    deleteCharBehindMarker(count: number): void;

    verifyCaretAtMarker(markerName: string): void;
    verifyCurrentLineContent(text: string): void;
    verifyCurrentFileContent(text: string): void;
    verifyTextAtCaretIs(text: string): void;
    verifyRangeIs(expectedText: string, includeWhiteSpace?: boolean): void;

    setCancelled(numberOfCalls: number): void;
    resetCancelled(): void; */
}

declare const helper: Fourslash;