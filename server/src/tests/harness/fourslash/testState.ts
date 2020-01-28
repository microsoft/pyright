/*
* testState.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
*/

import * as debug from "../../../common/debug"
import * as io from "../io"
import * as vfs from "../vfs/filesystem";
import * as path from "path";

import Char from "typescript-char";

import { TestCancellationToken, Marker, Range, FourSlashFile, FourSlashData, CompilerSettings, GlobalMetadataOptionNames, pythonSettingFilename, MultiMap } from "./fourSlashTypes";
import { ConfigOptions } from "../../../common/configOptions";
import { getBaseFileName, normalizeSlashes, normalizePath, combinePaths, comparePaths } from "../../../common/pathUtils";
import { getStringComparer } from "../../../common/stringUtils";
import { Comparison, isString, isNumber } from "../../../common/core";
import { NullConsole } from "../../../common/console";
import { createFromFileSystem } from "../vfs/factory";
import { LineAndColumn, TextRange } from "../../../common/textRange";

export class TestState {
    private readonly cancellationToken: TestCancellationToken;
    public readonly fs: vfs.FileSystem;
    public readonly configOptions: ConfigOptions;

    // The current caret position in the active file
    public currentCaretPosition = 0;
    // The position of the end of the current selection, or -1 if nothing is selected
    public selectionEnd = -1;

    public lastKnownMarker = "";

    // The file that's currently 'opened'
    public activeFile!: FourSlashFile;

    constructor(private basePath: string, public testData: FourSlashData) {
        const strIgnoreCase = GlobalMetadataOptionNames.ignoreCase;
        const ignoreCase = testData.globalOptions[strIgnoreCase]?.toUpperCase() === "TRUE";

        this.cancellationToken = new TestCancellationToken();
        let configOptions = this.convertGlobalOptionsToConfigOptions(this.testData.globalOptions);

        const files: vfs.FileSet = {};
        for (const file of testData.files) {
            // if one of file is configuration file, set config options from the given json
            if (this.isConfig(file, ignoreCase)) {
                let configJson: any;
                try {
                    configJson = JSON.parse(file.content);
                }
                catch (e) {
                    throw new Error(`Failed to parse test ${file.fileName}: ${e.message}`);
                }

                configOptions.initializeFromJson(configJson, new NullConsole());
            }
            else {
                files[file.fileName] = new vfs.File(file.content, { meta: file.fileOptions, encoding: "utf8" });
            }
        }

        // set config options
        this.configOptions = configOptions;

        const fs = createFromFileSystem(io.IO, ignoreCase, { cwd: basePath, meta: testData.globalOptions });
        fs.apply(files);

        // expose the file system
        this.fs = fs;

        // Open the first file by default
        this.openFile(0);
    }

    // Entry points from fourslash.ts
    public goToMarker(nameOrMarker: string | Marker = "") {
        const marker = isString(nameOrMarker) ? this.getMarkerByName(nameOrMarker) : nameOrMarker;
        if (this.activeFile.fileName !== marker.fileName) {
            this.openFile(marker.fileName);
        }

        const content = this.getFileContent(marker.fileName);
        if (marker.position === -1 || marker.position > content.length) {
            throw new Error(`Marker "${nameOrMarker}" has been invalidated by unrecoverable edits to the file.`);
        }

        const mName = isString(nameOrMarker) ? nameOrMarker : this.getMarkerName(marker);
        this.lastKnownMarker = mName;
        this.goToPosition(marker.position);
    }

    public goToEachMarker(markers: readonly Marker[], action: (marker: Marker, index: number) => void) {
        debug.assert(markers.length > 0);
        for (let i = 0; i < markers.length; i++) {
            this.goToMarker(markers[i]);
            action(markers[i], i);
        }
    }

    public getMarkerName(m: Marker): string {
        let found: string | undefined = undefined;
        this.testData.markerPositions.forEach((marker, name) => {
            if (marker === m) {
                found = name;
            }
        });

        debug.assertDefined(found);
        return found!;
    }

    public getMarkers(): Marker[] {
        //  Return a copy of the list
        return this.testData.markers.slice(0);
    }

    public getMarkerNames(): string[] {
        return [...this.testData.markerPositions.keys()];
    }

    public goToPosition(positionOrLineAndColumn: number | LineAndColumn) {
        const pos = isNumber(positionOrLineAndColumn)
            ? positionOrLineAndColumn
            : this.convertPositionToOffset(this.activeFile.fileName, positionOrLineAndColumn);
        this.currentCaretPosition = pos;
        this.selectionEnd = -1;
    }

    public select(startMarker: string, endMarker: string) {
        const start = this.getMarkerByName(startMarker), end = this.getMarkerByName(endMarker);
        debug.assert(start.fileName === end.fileName);
        if (this.activeFile.fileName !== start.fileName) {
            this.openFile(start.fileName);
        }
        this.goToPosition(start.position);
        this.selectionEnd = end.position;
    }

    public selectAllInFile(fileName: string) {
        this.openFile(fileName);
        this.goToPosition(0);
        this.selectionEnd = this.activeFile.content.length;
    }

    public selectRange(range: Range): void {
        this.goToRangeStart(range);
        this.selectionEnd = range.end;
    }

    public selectLine(index: number) {
        const lineStart = this.convertPositionToOffset(this.activeFile.fileName, { line: index, column: 0 });
        const lineEnd = lineStart + this.getLineContent(index).length;
        this.selectRange({ fileName: this.activeFile.fileName, pos: lineStart, end: lineEnd });
    }

    public goToEachRange(action: (range: Range) => void) {
        const ranges = this.getRanges();
        debug.assert(ranges.length > 0);
        for (const range of ranges) {
            this.selectRange(range);
            action(range);
        }
    }

    public goToRangeStart({ fileName, pos }: Range) {
        this.openFile(fileName);
        this.goToPosition(pos);
    }

    public getRanges(): Range[] {
        return this.testData.ranges;
    }

    public getRangesInFile(fileName = this.activeFile.fileName) {
        return this.getRanges().filter(r => r.fileName === fileName);
    }

    public rangesByText(): Map<string, Range[]> {
        if (this.testData.rangesByText) return this.testData.rangesByText;
        const result = this.createMultiMap<Range>();
        this.testData.rangesByText = result;
        for (const range of this.getRanges()) {
            const text = this.rangeText(range);
            result.add(text, range);
        }
        return result;
    }

    public goToBOF() {
        this.goToPosition(0);
    }

    public goToEOF() {
        const len = this.getFileContent(this.activeFile.fileName).length;
        this.goToPosition(len);
    }

    public moveCaretRight(count = 1) {
        this.currentCaretPosition += count;
        this.currentCaretPosition = Math.min(this.currentCaretPosition, this.getFileContent(this.activeFile.fileName).length);
        this.selectionEnd = -1;
    }

    // Opens a file given its 0-based index or fileName
    public openFile(indexOrName: number | string, content?: string): void {
        const fileToOpen: FourSlashFile = this.findFile(indexOrName);
        fileToOpen.fileName = normalizeSlashes(fileToOpen.fileName);
        this.activeFile = fileToOpen;

        // Let the host know that this file is now open
        // this.languageServiceAdapterHost.openFile(fileToOpen.fileName, content);
    }

    public printCurrentFileState(showWhitespace: boolean, makeCaretVisible: boolean) {
        for (const file of this.testData.files) {
            const active = (this.activeFile === file);
            io.IO.log(`=== Script (${file.fileName}) ${(active ? "(active, cursor at |)" : "")} ===`);
            let content = this.getFileContent(file.fileName);
            if (active) {
                content = content.substr(0, this.currentCaretPosition) + (makeCaretVisible ? "|" : "") + content.substr(this.currentCaretPosition);
            }
            if (showWhitespace) {
                content = makeWhitespaceVisible(content);
            }
            io.IO.log(content);
        }
    }

    public deleteChar(count = 1) {
        let offset = this.currentCaretPosition;
        const ch = "";

        const checkCadence = (count >> 2) + 1;

        for (let i = 0; i < count; i++) {
            this.editScriptAndUpdateMarkers(this.activeFile.fileName, offset, offset + 1, ch);

            if (i % checkCadence === 0) {
                this.checkPostEditInvariants();
            }
        }

        this.checkPostEditInvariants();
    }

    public replace(start: number, length: number, text: string) {
        this.editScriptAndUpdateMarkers(this.activeFile.fileName, start, start + length, text);
        this.checkPostEditInvariants();
    }

    public deleteLineRange(startIndex: number, endIndexInclusive: number) {
        const startPos = this.convertPositionToOffset(this.activeFile.fileName, { line: startIndex, column: 0 });
        const endPos = this.convertPositionToOffset(this.activeFile.fileName, { line: endIndexInclusive + 1, column: 0 });
        this.replace(startPos, endPos - startPos, "");
    }

    public deleteCharBehindMarker(count = 1) {
        let offset = this.currentCaretPosition;
        const ch = "";
        const checkCadence = (count >> 2) + 1;

        for (let i = 0; i < count; i++) {
            this.currentCaretPosition--;
            offset--;
            this.editScriptAndUpdateMarkers(this.activeFile.fileName, offset, offset + 1, ch);

            if (i % checkCadence === 0) {
                this.checkPostEditInvariants();
            }

            // Don't need to examine formatting because there are no formatting changes on backspace.
        }

        this.checkPostEditInvariants();
    }

    // Enters lines of text at the current caret position
    public type(text: string) {
        let offset = this.currentCaretPosition;
        const selection = this.getSelection();
        this.replace(selection.start, selection.length, "");

        for (let i = 0; i < text.length; i++) {
            const ch = text.charAt(i);
            this.editScriptAndUpdateMarkers(this.activeFile.fileName, offset, offset, ch);

            this.currentCaretPosition++;
            offset++;
        }

        this.checkPostEditInvariants();
    }

    // Enters text as if the user had pasted it
    public paste(text: string) {
        this.editScriptAndUpdateMarkers(this.activeFile.fileName, this.currentCaretPosition, this.currentCaretPosition, text);
        this.checkPostEditInvariants();
    }

    public verifyCaretAtMarker(markerName = "") {
        const pos = this.getMarkerByName(markerName);
        if (pos.fileName !== this.activeFile.fileName) {
            throw new Error(`verifyCaretAtMarker failed - expected to be in file "${pos.fileName}", but was in file "${this.activeFile.fileName}"`);
        }
        if (pos.position !== this.currentCaretPosition) {
            throw new Error(`verifyCaretAtMarker failed - expected to be at marker "/*${markerName}*/, but was at position ${this.currentCaretPosition}(${this.getLineColStringAtPosition(this.currentCaretPosition)})`);
        }
    }

    public verifyCurrentLineContent(text: string) {
        const actual = this.getCurrentLineContent();
        if (actual !== text) {
            throw new Error("verifyCurrentLineContent\n" + displayExpectedAndActualString(text, actual, /* quoted */ true));
        }
    }

    public verifyCurrentFileContent(text: string) {
        this.verifyFileContent(this.activeFile.fileName, text);
    }

    private verifyFileContent(fileName: string, text: string) {
        const actual = this.getFileContent(fileName);
        if (actual !== text) {
            throw new Error(`verifyFileContent failed:\n${showTextDiff(text, actual)}`);
        }
    }

    public verifyTextAtCaretIs(text: string) {
        const actual = this.getFileContent(this.activeFile.fileName).substring(this.currentCaretPosition, this.currentCaretPosition + text.length);
        if (actual !== text) {
            throw new Error("verifyTextAtCaretIs\n" + displayExpectedAndActualString(text, actual, /* quoted */ true));
        }
    }

    public verifyRangeIs(expectedText: string, includeWhiteSpace?: boolean) {
        this.verifyTextMatches(this.rangeText(this.getOnlyRange()), !!includeWhiteSpace, expectedText);
    }

    public getMarkerByName(markerName: string) {
        const markerPos = this.testData.markerPositions.get(markerName);
        if (markerPos === undefined) {
            throw new Error(`Unknown marker "${markerName}" Available markers: ${this.getMarkerNames().map(m => "\"" + m + "\"").join(", ")}`);
        }
        else {
            return markerPos;
        }
    }

    public setCancelled(numberOfCalls: number): void {
        this.cancellationToken.setCancelled(numberOfCalls);
    }

    public resetCancelled(): void {
        this.cancellationToken.resetCancelled();
    }

    private isConfig(file: FourSlashFile, ignoreCase: boolean): boolean {
        const comparer = getStringComparer(ignoreCase);
        return comparer(getBaseFileName(file.fileName), pythonSettingFilename) == Comparison.EqualTo;
    }

    private convertGlobalOptionsToConfigOptions(globalOptions: CompilerSettings): ConfigOptions {
        const srtRoot: string = GlobalMetadataOptionNames.projectRoot;
        const projectRoot = normalizeSlashes(globalOptions[srtRoot] ?? ".");
        const configOptions = new ConfigOptions(projectRoot);

        // add more global options as we need them

        // Always enable "test mode".
        configOptions.internalTestMode = true;
        return configOptions;
    }

    private getFileContent(fileName: string): string {
        const files = this.testData.files.filter(f => comparePaths(f.fileName, fileName, this.fs.ignoreCase) === Comparison.EqualTo);
        return files[0].content;
    }

    private convertPositionToOffset(fileName: string, position: LineAndColumn): number {
        return -1;
    }

    private convertOffsetToPosition(fileName: string, offset: number): LineAndColumn {
        return { line: 0, column: 0 };
    }

    private raiseError(message: string): never {
        throw new Error(this.messageAtLastKnownMarker(message));
    }

    private messageAtLastKnownMarker(message: string) {
        const locationDescription = this.lastKnownMarker ? this.lastKnownMarker : this.getLineColStringAtPosition(this.currentCaretPosition);
        return `At ${locationDescription}: ${message}`;
    }

    private checkPostEditInvariants() {
        // blank for now
    }

    private editScriptAndUpdateMarkers(fileName: string, editStart: number, editEnd: number, newText: string) {
        // this.languageServiceAdapterHost.editScript(fileName, editStart, editEnd, newText);
        for (const marker of this.testData.markers) {
            if (marker.fileName === fileName) {
                marker.position = updatePosition(marker.position, editStart, editEnd, newText);
            }
        }

        for (const range of this.testData.ranges) {
            if (range.fileName === fileName) {
                range.pos = updatePosition(range.pos, editStart, editEnd, newText);
                range.end = updatePosition(range.end, editStart, editEnd, newText);
            }
        }
        this.testData.rangesByText = undefined;
    }

    private removeWhitespace(text: string): string {
        return text.replace(/\s/g, "");
    }

    private createMultiMap<T>(): MultiMap<T> {
        const map = new Map<string, T[]>() as MultiMap<T>;
        map.add = multiMapAdd;
        map.remove = multiMapRemove;

        return map;

        function multiMapAdd<T>(this: MultiMap<T>, key: string, value: T) {
            let values = this.get(key);
            if (values) {
                values.push(value);
            }
            else {
                this.set(key, values = [value]);
            }
            return values;
        }

        function multiMapRemove<T>(this: MultiMap<T>, key: string, value: T) {
            const values = this.get(key);
            if (values) {
                values.forEach((v, i, arr) => { if (v === value) arr.splice(i, 1) });
                if (!values.length) {
                    this.delete(key);
                }
            }
        }
    }

    private rangeText({ fileName, pos, end }: Range): string {
        return this.getFileContent(fileName).slice(pos, end);
    }
    
    private getOnlyRange() {
        const ranges = this.getRanges();
        if (ranges.length !== 1) {
            this.raiseError("Exactly one range should be specified in the testfile.");
        }

        return ranges[0];
    }

    private verifyTextMatches(actualText: string, includeWhitespace: boolean, expectedText: string) {
        const removeWhitespace = (s: string): string => includeWhitespace ? s : this.removeWhitespace(s);
        if (removeWhitespace(actualText) !== removeWhitespace(expectedText)) {
            this.raiseError(`Actual range text doesn't match expected text.\n${showTextDiff(expectedText, actualText)}`);
        }
    }

    private getSelection(): TextRange {
        return TextRange.fromBounds(this.currentCaretPosition, this.selectionEnd === -1 ? this.currentCaretPosition : this.selectionEnd);
    }

    private getLineContent(index: number) {
        const text = this.getFileContent(this.activeFile.fileName);
        const pos = this.convertPositionToOffset(this.activeFile.fileName, { line: index, column: 0 });
        let startPos = pos, endPos = pos;

        while (startPos > 0) {
            const ch = text.charCodeAt(startPos - 1);
            if (ch === Char.CarriageReturn || ch === Char.LineFeed) {
                break;
            }

            startPos--;
        }

        while (endPos < text.length) {
            const ch = text.charCodeAt(endPos);

            if (ch === Char.CarriageReturn || ch === Char.LineFeed) {
                break;
            }

            endPos++;
        }

        return text.substring(startPos, endPos);
    }

    // Get the text of the entire line the caret is currently at
    private getCurrentLineContent() {
        return this.getLineContent(this.convertOffsetToPosition(
            this.activeFile.fileName,
            this.currentCaretPosition,
        ).line);
    }

    private findFile(indexOrName: string | number): FourSlashFile {
        if (typeof indexOrName === "number") {
            const index = indexOrName;
            if (index >= this.testData.files.length) {
                throw new Error(`File index (${index}) in openFile was out of range. There are only ${this.testData.files.length} files in this test.`);
            }
            else {
                return this.testData.files[index];
            }
        }
        else if (isString(indexOrName)) {
            const { file, availableNames } = this.tryFindFileWorker(indexOrName);
            if (!file) {
                throw new Error(`No test file named "${indexOrName}" exists. Available file names are: ${availableNames.join(", ")}`);
            }
            return file;
        }
        else {
            return debug.assertNever(indexOrName);
        }
    }

    private tryFindFileWorker(name: string): { readonly file: FourSlashFile | undefined; readonly availableNames: readonly string[]; } {
        name = normalizePath(name);

        // names are stored in the compiler with this relative path, this allows people to use goTo.file on just the fileName
        name = name.indexOf(path.sep) === -1 ? combinePaths(this.basePath, name) : name;

        let file: FourSlashFile | undefined = undefined;
        const availableNames: string[] = [];
        this.testData.files.forEach(f => {
            const fn = normalizePath(f.fileName);
            if (fn) {
                if (fn === name) {
                    file = f;
                }

                availableNames.push(fn);
            }
        });

        debug.assertDefined(file);
        return { file, availableNames };
    }

    private getLineColStringAtPosition(position: number, file: FourSlashFile = this.activeFile) {
        const pos = this.convertOffsetToPosition(file.fileName, position);
        return `line ${(pos.line + 1)}, col ${pos.column}`;
    }
}

function displayExpectedAndActualString(expected: string, actual: string, quoted = false) {
    const expectMsg = "\x1b[1mExpected\x1b[0m\x1b[31m";
    const actualMsg = "\x1b[1mActual\x1b[0m\x1b[31m";
    const expectedString = quoted ? "\"" + expected + "\"" : expected;
    const actualString = quoted ? "\"" + actual + "\"" : actual;
    return `\n${expectMsg}:\n${expectedString}\n\n${actualMsg}:\n${actualString}`;
}

function makeWhitespaceVisible(text: string) {
    return text.replace(/ /g, "\u00B7").replace(/\r/g, "\u00B6").replace(/\n/g, "\u2193\n").replace(/\t/g, "\u2192\   ");
}

function updatePosition(position: number, editStart: number, editEnd: number, { length }: string): number {
    // If inside the edit, return -1 to mark as invalid
    return position <= editStart ? position : position < editEnd ? -1 : position + length - + (editEnd - editStart);
}

function showTextDiff(expected: string, actual: string): string {
    // Only show whitespace if the difference is whitespace-only.
    if (differOnlyByWhitespace(expected, actual)) {
        expected = makeWhitespaceVisible(expected);
        actual = makeWhitespaceVisible(actual);
    }
    return displayExpectedAndActualString(expected, actual);
}

function differOnlyByWhitespace(a: string, b: string) {
    return stripWhitespace(a) === stripWhitespace(b);
}

function stripWhitespace(s: string): string {
    return s.replace(/\s/g, "");
}

export interface TextChange {
    span: TextRange;
    newText: string;
}