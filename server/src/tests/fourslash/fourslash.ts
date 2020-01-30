/*
* fourslash.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
*
* this file only exists for the richer editing experiences on *.fourslash.ts files. 
* when fourslash tests are actually running this file is not used.
* 
* this basically provides type information through // <reference .. > while editing but
* get ignored when test run due to how test code is injected when running.
* see - server\pyright\server\src\tests\harness\fourslash\runner.ts@runCode - for more detail
*
* when run, helper variable will be bount to TestState (server\pyright\server\src\tests\harness\fourslash\testState.ts)
* so make sure Foruslash type is in sync with TestState
* 
* for how markup language and helper is used in fourslash tests, see these 2 tests
* server\pyright\server\src\tests\fourSlashParser.test.ts
* server\pyright\server\src\tests\testState.test.ts
*/
declare namespace _ {
    interface TextRange {
        start: number;
        length: number;
    }

    interface LineAndColumn {
        // Both line and column are zero-based
        line: number;
        column: number;
    }

    interface Marker {
        fileName: string;
        position: number;
        data?: {};
    }

    interface Range {
        fileName: string;
        marker?: Marker;
        pos: number;
        end: number;
    }

    interface TextChange {
        span: TextRange;
        newText: string;
    }

    interface Fourslash {
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

        verifyDiagnostics(): void;

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
}

declare var helper: _.Fourslash;