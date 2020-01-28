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
import { ImportResolver } from "../../../analyzer/importResolver";
import { Program } from "../../../analyzer/program";
import { convertPositionToOffset, convertOffsetToPosition } from "../../../common/positionUtils";

export interface TextChange {
    span: TextRange;
    newText: string;
}

export class TestState {
    private readonly _cancellationToken: TestCancellationToken;

    public readonly fs: vfs.FileSystem;
    public readonly importResolver: ImportResolver;
    public readonly configOptions: ConfigOptions;
    public readonly program: Program;

    // The current caret position in the active file
    public currentCaretPosition = 0;
    // The position of the end of the current selection, or -1 if nothing is selected
    public selectionEnd = -1;

    public lastKnownMarker = "";

    // The file that's currently 'opened'
    public activeFile!: FourSlashFile;

    constructor(private _basePath: string, public testData: FourSlashData) {
        const strIgnoreCase = GlobalMetadataOptionNames.ignoreCase;
        const ignoreCase = testData.globalOptions[strIgnoreCase]?.toUpperCase() === "TRUE";

        this._cancellationToken = new TestCancellationToken();
        let configOptions = this._convertGlobalOptionsToConfigOptions(this.testData.globalOptions);

        const files: vfs.FileSet = {};
        for (const file of testData.files) {
            // if one of file is configuration file, set config options from the given json
            if (this._isConfig(file, ignoreCase)) {
                let configJson: any;
                try {
                    configJson = JSON.parse(file.content);
                }
                catch (e) {
                    throw new Error(`Failed to parse test ${ file.fileName }: ${ e.message }`);
                }

                configOptions.initializeFromJson(configJson, new NullConsole());
            }
            else {
                files[file.fileName] = new vfs.File(file.content, { meta: file.fileOptions, encoding: "utf8" });
            }
        }


        const fs = createFromFileSystem(io.IO, ignoreCase, { cwd: _basePath, meta: testData.globalOptions });
        fs.apply(files);

        // this should be change to AnalyzerService rather than Program
        const importResolver = new ImportResolver(fs, configOptions);
        const program = new Program(importResolver, configOptions);
        program.setTrackedFiles(Object.keys(files));

        // make sure these states are consistent between these objects.
        // later make sure we just hold onto AnalyzerService and get all these
        // state from 1 analyzerService so that we always use same consistent states
        this.fs = fs;
        this.configOptions = configOptions;
        this.importResolver = importResolver;
        this.program = program;

        // Open the first file by default
        this.openFile(0);
    }

    // Entry points from fourslash.ts
    public goToMarker(nameOrMarker: string | Marker = "") {
        const marker = isString(nameOrMarker) ? this.getMarkerByName(nameOrMarker) : nameOrMarker;
        if (this.activeFile.fileName !== marker.fileName) {
            this.openFile(marker.fileName);
        }

        const content = this._getFileContent(marker.fileName);
        if (marker.position === -1 || marker.position > content.length) {
            throw new Error(`Marker "${ nameOrMarker }" has been invalidated by unrecoverable edits to the file.`);
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
            : this._convertPositionToOffset(this.activeFile.fileName, positionOrLineAndColumn);
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
        const lineStart = this._convertPositionToOffset(this.activeFile.fileName, { line: index, column: 0 });
        const lineEnd = lineStart + this._getLineContent(index).length;
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
        const result = this._createMultiMap<Range>();
        this.testData.rangesByText = result;
        for (const range of this.getRanges()) {
            const text = this._rangeText(range);
            result.add(text, range);
        }
        return result;
    }

    public goToBOF() {
        this.goToPosition(0);
    }

    public goToEOF() {
        const len = this._getFileContent(this.activeFile.fileName).length;
        this.goToPosition(len);
    }

    public moveCaretRight(count = 1) {
        this.currentCaretPosition += count;
        this.currentCaretPosition = Math.min(this.currentCaretPosition, this._getFileContent(this.activeFile.fileName).length);
        this.selectionEnd = -1;
    }

    // Opens a file given its 0-based index or fileName
    public openFile(indexOrName: number | string, content?: string): void {
        const fileToOpen: FourSlashFile = this._findFile(indexOrName);
        fileToOpen.fileName = normalizeSlashes(fileToOpen.fileName);
        this.activeFile = fileToOpen;

        // Let the host know that this file is now open
        // this.languageServiceAdapterHost.openFile(fileToOpen.fileName, content);
    }

    public printCurrentFileState(showWhitespace: boolean, makeCaretVisible: boolean) {
        for (const file of this.testData.files) {
            const active = (this.activeFile === file);
            io.IO.log(`=== Script (${ file.fileName }) ${ (active ? "(active, cursor at |)" : "") } ===`);
            let content = this._getFileContent(file.fileName);
            if (active) {
                content = content.substr(0, this.currentCaretPosition) + (makeCaretVisible ? "|" : "") + content.substr(this.currentCaretPosition);
            }
            if (showWhitespace) {
                content = this._makeWhitespaceVisible(content);
            }
            io.IO.log(content);
        }
    }

    public deleteChar(count = 1) {
        let offset = this.currentCaretPosition;
        const ch = "";

        const checkCadence = (count >> 2) + 1;

        for (let i = 0; i < count; i++) {
            this._editScriptAndUpdateMarkers(this.activeFile.fileName, offset, offset + 1, ch);

            if (i % checkCadence === 0) {
                this._checkPostEditInvariants();
            }
        }

        this._checkPostEditInvariants();
    }

    public replace(start: number, length: number, text: string) {
        this._editScriptAndUpdateMarkers(this.activeFile.fileName, start, start + length, text);
        this._checkPostEditInvariants();
    }

    public deleteLineRange(startIndex: number, endIndexInclusive: number) {
        const startPos = this._convertPositionToOffset(this.activeFile.fileName, { line: startIndex, column: 0 });
        const endPos = this._convertPositionToOffset(this.activeFile.fileName, { line: endIndexInclusive + 1, column: 0 });
        this.replace(startPos, endPos - startPos, "");
    }

    public deleteCharBehindMarker(count = 1) {
        let offset = this.currentCaretPosition;
        const ch = "";
        const checkCadence = (count >> 2) + 1;

        for (let i = 0; i < count; i++) {
            this.currentCaretPosition--;
            offset--;
            this._editScriptAndUpdateMarkers(this.activeFile.fileName, offset, offset + 1, ch);

            if (i % checkCadence === 0) {
                this._checkPostEditInvariants();
            }

            // Don't need to examine formatting because there are no formatting changes on backspace.
        }

        this._checkPostEditInvariants();
    }

    // Enters lines of text at the current caret position
    public type(text: string) {
        let offset = this.currentCaretPosition;
        const selection = this._getSelection();
        this.replace(selection.start, selection.length, "");

        for (let i = 0; i < text.length; i++) {
            const ch = text.charAt(i);
            this._editScriptAndUpdateMarkers(this.activeFile.fileName, offset, offset, ch);

            this.currentCaretPosition++;
            offset++;
        }

        this._checkPostEditInvariants();
    }

    // Enters text as if the user had pasted it
    public paste(text: string) {
        this._editScriptAndUpdateMarkers(this.activeFile.fileName, this.currentCaretPosition, this.currentCaretPosition, text);
        this._checkPostEditInvariants();
    }

    public verifyCaretAtMarker(markerName = "") {
        const pos = this.getMarkerByName(markerName);
        if (pos.fileName !== this.activeFile.fileName) {
            throw new Error(`verifyCaretAtMarker failed - expected to be in file "${ pos.fileName }", but was in file "${ this.activeFile.fileName }"`);
        }
        if (pos.position !== this.currentCaretPosition) {
            throw new Error(`verifyCaretAtMarker failed - expected to be at marker "/*${ markerName }*/, but was at position ${ this.currentCaretPosition }(${ this._getLineColStringAtPosition(this.currentCaretPosition) })`);
        }
    }

    public verifyCurrentLineContent(text: string) {
        const actual = this._getCurrentLineContent();
        if (actual !== text) {
            throw new Error("verifyCurrentLineContent\n" + this._displayExpectedAndActualString(text, actual, /* quoted */ true));
        }
    }

    public verifyCurrentFileContent(text: string) {
        this._verifyFileContent(this.activeFile.fileName, text);
    }

    public verifyTextAtCaretIs(text: string) {
        const actual = this._getFileContent(this.activeFile.fileName).substring(this.currentCaretPosition, this.currentCaretPosition + text.length);
        if (actual !== text) {
            throw new Error("verifyTextAtCaretIs\n" + this._displayExpectedAndActualString(text, actual, /* quoted */ true));
        }
    }

    public verifyRangeIs(expectedText: string, includeWhiteSpace?: boolean) {
        this._verifyTextMatches(this._rangeText(this._getOnlyRange()), !!includeWhiteSpace, expectedText);
    }

    public getMarkerByName(markerName: string) {
        const markerPos = this.testData.markerPositions.get(markerName);
        if (markerPos === undefined) {
            throw new Error(`Unknown marker "${ markerName }" Available markers: ${ this.getMarkerNames().map(m => "\"" + m + "\"").join(", ") }`);
        }
        else {
            return markerPos;
        }
    }

    public setCancelled(numberOfCalls: number): void {
        this._cancellationToken.setCancelled(numberOfCalls);
    }

    public resetCancelled(): void {
        this._cancellationToken.resetCancelled();
    }

    private _isConfig(file: FourSlashFile, ignoreCase: boolean): boolean {
        const comparer = getStringComparer(ignoreCase);
        return comparer(getBaseFileName(file.fileName), pythonSettingFilename) == Comparison.EqualTo;
    }

    private _convertGlobalOptionsToConfigOptions(globalOptions: CompilerSettings): ConfigOptions {
        const srtRoot: string = GlobalMetadataOptionNames.projectRoot;
        const projectRoot = normalizeSlashes(globalOptions[srtRoot] ?? ".");
        const configOptions = new ConfigOptions(projectRoot);

        // add more global options as we need them

        // Always enable "test mode".
        configOptions.internalTestMode = true;
        return configOptions;
    }

    private _getFileContent(fileName: string): string {
        const files = this.testData.files.filter(f => comparePaths(f.fileName, fileName, this.fs.ignoreCase) === Comparison.EqualTo);
        return files[0].content;
    }

    private _convertPositionToOffset(fileName: string, position: LineAndColumn): number {
        const result = this._getParseResult(fileName);
        return convertPositionToOffset(position, result.tokenizerOutput.lines)!;
    }

    private _convertOffsetToPosition(fileName: string, offset: number): LineAndColumn {
        const result = this._getParseResult(fileName);

        return convertOffsetToPosition(offset, result.tokenizerOutput.lines);
    }

    private _getParseResult(fileName: string) {
        const file = this.program.getSourceFile(fileName)!;
        file.parse(this.configOptions, this.importResolver);
        return file.getParseResults()!;
    }

    private _raiseError(message: string): never {
        throw new Error(this._messageAtLastKnownMarker(message));
    }

    private _messageAtLastKnownMarker(message: string) {
        const locationDescription = this.lastKnownMarker ? this.lastKnownMarker : this._getLineColStringAtPosition(this.currentCaretPosition);
        return `At ${ locationDescription }: ${ message }`;
    }

    private _checkPostEditInvariants() {
        // blank for now
    }

    private _editScriptAndUpdateMarkers(fileName: string, editStart: number, editEnd: number, newText: string) {
        // this.languageServiceAdapterHost.editScript(fileName, editStart, editEnd, newText);
        for (const marker of this.testData.markers) {
            if (marker.fileName === fileName) {
                marker.position = this._updatePosition(marker.position, editStart, editEnd, newText);
            }
        }

        for (const range of this.testData.ranges) {
            if (range.fileName === fileName) {
                range.pos = this._updatePosition(range.pos, editStart, editEnd, newText);
                range.end = this._updatePosition(range.end, editStart, editEnd, newText);
            }
        }
        this.testData.rangesByText = undefined;
    }

    private _removeWhitespace(text: string): string {
        return text.replace(/\s/g, "");
    }

    private _createMultiMap<T>(): MultiMap<T> {
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

    private _rangeText({ fileName, pos, end }: Range): string {
        return this._getFileContent(fileName).slice(pos, end);
    }

    private _getOnlyRange() {
        const ranges = this.getRanges();
        if (ranges.length !== 1) {
            this._raiseError("Exactly one range should be specified in the testfile.");
        }

        return ranges[0];
    }

    private _verifyFileContent(fileName: string, text: string) {
        const actual = this._getFileContent(fileName);
        if (actual !== text) {
            throw new Error(`verifyFileContent failed:\n${ this._showTextDiff(text, actual) }`);
        }
    }

    private _verifyTextMatches(actualText: string, includeWhitespace: boolean, expectedText: string) {
        const removeWhitespace = (s: string): string => includeWhitespace ? s : this._removeWhitespace(s);
        if (removeWhitespace(actualText) !== removeWhitespace(expectedText)) {
            this._raiseError(`Actual range text doesn't match expected text.\n${ this._showTextDiff(expectedText, actualText) }`);
        }
    }

    private _getSelection(): TextRange {
        return TextRange.fromBounds(this.currentCaretPosition, this.selectionEnd === -1 ? this.currentCaretPosition : this.selectionEnd);
    }

    private _getLineContent(index: number) {
        const text = this._getFileContent(this.activeFile.fileName);
        const pos = this._convertPositionToOffset(this.activeFile.fileName, { line: index, column: 0 });
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
    private _getCurrentLineContent() {
        return this._getLineContent(this._convertOffsetToPosition(
            this.activeFile.fileName,
            this.currentCaretPosition,
        ).line);
    }

    private _findFile(indexOrName: string | number): FourSlashFile {
        if (typeof indexOrName === "number") {
            const index = indexOrName;
            if (index >= this.testData.files.length) {
                throw new Error(`File index (${ index }) in openFile was out of range. There are only ${ this.testData.files.length } files in this test.`);
            }
            else {
                return this.testData.files[index];
            }
        }
        else if (isString(indexOrName)) {
            const { file, availableNames } = this._tryFindFileWorker(indexOrName);
            if (!file) {
                throw new Error(`No test file named "${ indexOrName }" exists. Available file names are: ${ availableNames.join(", ") }`);
            }
            return file;
        }
        else {
            return debug.assertNever(indexOrName);
        }
    }

    private _tryFindFileWorker(name: string): { readonly file: FourSlashFile | undefined; readonly availableNames: readonly string[]; } {
        name = normalizePath(name);

        // names are stored in the compiler with this relative path, this allows people to use goTo.file on just the fileName
        name = name.indexOf(path.sep) === -1 ? combinePaths(this._basePath, name) : name;

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

    private _getLineColStringAtPosition(position: number, file: FourSlashFile = this.activeFile) {
        const pos = this._convertOffsetToPosition(file.fileName, position);
        return `line ${ (pos.line + 1) }, col ${ pos.column }`;
    }

    private _showTextDiff(expected: string, actual: string): string {
        // Only show whitespace if the difference is whitespace-only.
        if (this._differOnlyByWhitespace(expected, actual)) {
            expected = this._makeWhitespaceVisible(expected);
            actual = this._makeWhitespaceVisible(actual);
        }
        return this._displayExpectedAndActualString(expected, actual);
    }

    private _differOnlyByWhitespace(a: string, b: string) {
        return this._removeWhitespace(a) === this._removeWhitespace(b);
    }

    private _displayExpectedAndActualString(expected: string, actual: string, quoted = false) {
        const expectMsg = "\x1b[1mExpected\x1b[0m\x1b[31m";
        const actualMsg = "\x1b[1mActual\x1b[0m\x1b[31m";
        const expectedString = quoted ? "\"" + expected + "\"" : expected;
        const actualString = quoted ? "\"" + actual + "\"" : actual;
        return `\n${ expectMsg }:\n${ expectedString }\n\n${ actualMsg }:\n${ actualString }`;
    }

    private _makeWhitespaceVisible(text: string) {
        return text.replace(/ /g, "\u00B7").replace(/\r/g, "\u00B6").replace(/\n/g, "\u2193\n").replace(/\t/g, "\u2192\   ");
    }

    private _updatePosition(position: number, editStart: number, editEnd: number, { length }: string): number {
        // If inside the edit, return -1 to mark as invalid
        return position <= editStart ? position : position < editEnd ? -1 : position + length - + (editEnd - editStart);
    }
}
