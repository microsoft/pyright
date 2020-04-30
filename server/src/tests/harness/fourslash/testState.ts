/*
 * testState.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * TestState wraps currently test states and provides a way to query and manipulate
 * the test states.
 */

import * as assert from 'assert';
import Char from 'typescript-char';
import {
    CancellationToken,
    CodeAction,
    Command,
    CompletionItem,
    Diagnostic,
    ExecuteCommandParams,
    MarkupContent,
    TextEdit,
    WorkspaceEdit,
} from 'vscode-languageserver';

import { ImportResolver, ImportResolverFactory } from '../../../analyzer/importResolver';
import { Program } from '../../../analyzer/program';
import { AnalyzerService, configFileNames } from '../../../analyzer/service';
import { ConfigOptions } from '../../../common/configOptions';
import { ConsoleInterface, NullConsole } from '../../../common/console';
import { Comparison, isNumber, isString, toBoolean } from '../../../common/core';
import * as debug from '../../../common/debug';
import { createDeferred } from '../../../common/deferred';
import { DiagnosticCategory } from '../../../common/diagnostic';
import { FileEditAction } from '../../../common/editAction';
import {
    combinePaths,
    comparePaths,
    convertPathToUri,
    getBaseFileName,
    normalizePath,
    normalizeSlashes,
} from '../../../common/pathUtils';
import { convertOffsetToPosition, convertPositionToOffset } from '../../../common/positionUtils';
import { getStringComparer } from '../../../common/stringUtils';
import { DocumentRange, Position, Range as PositionRange, rangesAreEqual, TextRange } from '../../../common/textRange';
import { TextRangeCollection } from '../../../common/textRangeCollection';
import { LanguageServerInterface, WorkspaceServiceInstance } from '../../../languageServerBase';
import { convertHoverResults } from '../../../languageService/hoverProvider';
import { ParseResults } from '../../../parser/parser';
import { Tokenizer } from '../../../parser/tokenizer';
import * as host from '../host';
import { stringify } from '../utils';
import { createFromFileSystem } from '../vfs/factory';
import * as vfs from '../vfs/filesystem';
import {
    CompilerSettings,
    FourSlashData,
    FourSlashFile,
    GlobalMetadataOptionNames,
    Marker,
    MetadataOptionNames,
    MultiMap,
    Range,
    TestCancellationToken,
} from './fourSlashTypes';
import { TestFeatures, TestLanguageService } from './testLanguageService';

export interface TextChange {
    span: TextRange;
    newText: string;
}

export interface HostSpecificFeatures {
    importResolverFactory: ImportResolverFactory;

    getCodeActionsForPosition(
        workspace: WorkspaceServiceInstance,
        filePath: string,
        range: PositionRange,
        token: CancellationToken
    ): Promise<CodeAction[]>;

    execute(ls: LanguageServerInterface, params: ExecuteCommandParams, token: CancellationToken): Promise<any>;
}

export class TestState {
    private readonly _cancellationToken: TestCancellationToken;
    private readonly _files: string[] = [];
    private readonly _hostSpecificFeatures: HostSpecificFeatures;

    // indicate whether test is done or not
    private readonly _testDoneCallback?: jest.DoneCallback;
    private _markedDone = false;

    readonly fs: vfs.TestFileSystem;
    readonly workspace: WorkspaceServiceInstance;
    readonly console: ConsoleInterface;
    readonly asyncTest: boolean;

    // The current caret position in the active file
    currentCaretPosition = 0;
    // The position of the end of the current selection, or -1 if nothing is selected
    selectionEnd = -1;

    lastKnownMarker = '';

    // The file that's currently 'opened'
    activeFile!: FourSlashFile;

    constructor(
        basePath: string,
        public testData: FourSlashData,
        cb?: jest.DoneCallback,
        mountPaths?: Map<string, string>,
        hostSpecificFeatures?: HostSpecificFeatures
    ) {
        this._hostSpecificFeatures = hostSpecificFeatures ?? new TestFeatures();

        const nullConsole = new NullConsole();
        const ignoreCase = toBoolean(testData.globalOptions[GlobalMetadataOptionNames.ignoreCase]);

        this._cancellationToken = new TestCancellationToken();
        const configOptions = this._convertGlobalOptionsToConfigOptions(this.testData.globalOptions);

        const sourceFiles = [];
        const files: vfs.FileSet = {};
        for (const file of testData.files) {
            // if one of file is configuration file, set config options from the given json
            if (this._isConfig(file, ignoreCase)) {
                let configJson: any;
                try {
                    configJson = JSON.parse(file.content);
                } catch (e) {
                    throw new Error(`Failed to parse test ${file.fileName}: ${e.message}`);
                }

                configOptions.initializeFromJson(configJson, 'basic', nullConsole);
                this._applyTestConfigOptions(configOptions);
            } else {
                files[file.fileName] = new vfs.File(file.content, { meta: file.fileOptions, encoding: 'utf8' });

                if (!toBoolean(file.fileOptions[MetadataOptionNames.library])) {
                    sourceFiles.push(file.fileName);
                }
            }
        }

        this.console = nullConsole;
        this.fs = createFromFileSystem(
            host.HOST,
            ignoreCase,
            { cwd: basePath, files, meta: testData.globalOptions },
            mountPaths
        );
        this._files = sourceFiles;

        const service = this._createAnalysisService(
            nullConsole,
            this._hostSpecificFeatures.importResolverFactory,
            configOptions
        );

        this.workspace = {
            workspaceName: 'test workspace',
            rootPath: this.fs.getModulePath(),
            rootUri: convertPathToUri(this.fs.getModulePath()),
            serviceInstance: service,
            disableLanguageServices: false,
            disableOrganizeImports: false,
            isInitialized: createDeferred<boolean>(),
        };

        if (this._files.length > 0) {
            // Open the first file by default
            this.openFile(this._files[0]);
        }

        this.asyncTest = toBoolean(testData.globalOptions[GlobalMetadataOptionNames.asynctest]);
        this._testDoneCallback = cb;
    }

    get importResolver(): ImportResolver {
        return this.workspace.serviceInstance.getImportResolver();
    }

    get configOptions(): ConfigOptions {
        return this.workspace.serviceInstance.test_configOptions;
    }

    get program(): Program {
        return this.workspace.serviceInstance.test_program;
    }

    markTestDone(...args: any[]) {
        if (this._markedDone) {
            // test is already marked done
            return;
        }

        // call callback to mark the test is done
        if (this._testDoneCallback) {
            this._testDoneCallback(...args);
        }

        this._markedDone = true;
    }

    // Entry points from fourslash.ts
    goToMarker(nameOrMarker: string | Marker = '') {
        const marker = isString(nameOrMarker) ? this.getMarkerByName(nameOrMarker) : nameOrMarker;
        if (this.activeFile.fileName !== marker.fileName) {
            this.openFile(marker.fileName);
        }

        const content = this._getFileContent(marker.fileName);
        if (marker.position === -1 || marker.position > content.length) {
            throw new Error(`Marker "${nameOrMarker}" has been invalidated by unrecoverable edits to the file.`);
        }

        const mName = isString(nameOrMarker) ? nameOrMarker : this.getMarkerName(marker);
        this.lastKnownMarker = mName;
        this.goToPosition(marker.position);
    }

    goToEachMarker(markers: readonly Marker[], action: (marker: Marker, index: number) => void) {
        assert.ok(markers.length > 0);
        for (let i = 0; i < markers.length; i++) {
            this.goToMarker(markers[i]);
            action(markers[i], i);
        }
    }

    getMarkerName(m: Marker): string {
        let found: string | undefined;
        this.testData.markerPositions.forEach((marker, name) => {
            if (marker === m) {
                found = name;
            }
        });

        assert.ok(found);
        return found!;
    }

    getMarkerByName(markerName: string) {
        const markerPos = this.testData.markerPositions.get(markerName);
        if (markerPos === undefined) {
            throw new Error(
                `Unknown marker "${markerName}" Available markers: ${this.getMarkerNames()
                    .map((m) => '"' + m + '"')
                    .join(', ')}`
            );
        } else {
            return markerPos;
        }
    }

    getMarkers(): Marker[] {
        //  Return a copy of the list
        return this.testData.markers.slice(0);
    }

    getMarkerNames(): string[] {
        return [...this.testData.markerPositions.keys()];
    }

    getPositionRange(markerString: string) {
        const marker = this.getMarkerByName(markerString);
        const ranges = this.getRanges().filter((r) => r.marker === marker);
        if (ranges.length !== 1) {
            this._raiseError(`no matching range for ${markerString}`);
        }

        const range = ranges[0];
        return this.convertPositionRange(range);
    }

    convertPositionRange(range: Range) {
        return this._convertOffsetsToRange(range.fileName, range.pos, range.end);
    }

    goToPosition(positionOrLineAndColumn: number | Position) {
        const pos = isNumber(positionOrLineAndColumn)
            ? positionOrLineAndColumn
            : this._convertPositionToOffset(this.activeFile.fileName, positionOrLineAndColumn);
        this.currentCaretPosition = pos;
        this.selectionEnd = -1;
    }

    select(startMarker: string, endMarker: string) {
        const start = this.getMarkerByName(startMarker);
        const end = this.getMarkerByName(endMarker);

        assert.ok(start.fileName === end.fileName);
        if (this.activeFile.fileName !== start.fileName) {
            this.openFile(start.fileName);
        }
        this.goToPosition(start.position);
        this.selectionEnd = end.position;
    }

    selectAllInFile(fileName: string) {
        this.openFile(fileName);
        this.goToPosition(0);
        this.selectionEnd = this.activeFile.content.length;
    }

    selectRange(range: Range): void {
        this.goToRangeStart(range);
        this.selectionEnd = range.end;
    }

    selectLine(index: number) {
        const lineStart = this._convertPositionToOffset(this.activeFile.fileName, { line: index, character: 0 });
        const lineEnd = lineStart + this._getLineContent(index).length;
        this.selectRange({ fileName: this.activeFile.fileName, pos: lineStart, end: lineEnd });
    }

    goToEachRange(action: (range: Range) => void) {
        const ranges = this.getRanges();
        assert.ok(ranges.length > 0);
        for (const range of ranges) {
            this.selectRange(range);
            action(range);
        }
    }

    goToRangeStart({ fileName, pos }: Range) {
        this.openFile(fileName);
        this.goToPosition(pos);
    }

    getRanges(): Range[] {
        return this.testData.ranges;
    }

    getRangesInFile(fileName = this.activeFile.fileName) {
        return this.getRanges().filter((r) => r.fileName === fileName);
    }

    getRangesByText(): Map<string, Range[]> {
        if (this.testData.rangesByText) {
            return this.testData.rangesByText;
        }
        const result = this._createMultiMap<Range>(this.getRanges(), (r) => this._rangeText(r));
        this.testData.rangesByText = result;

        return result;
    }

    goToBOF() {
        this.goToPosition(0);
    }

    goToEOF() {
        const len = this._getFileContent(this.activeFile.fileName).length;
        this.goToPosition(len);
    }

    moveCaretRight(count = 1) {
        this.currentCaretPosition += count;
        this.currentCaretPosition = Math.min(
            this.currentCaretPosition,
            this._getFileContent(this.activeFile.fileName).length
        );
        this.selectionEnd = -1;
    }

    // Opens a file given its 0-based index or fileName
    openFile(indexOrName: number | string, content?: string): void {
        const fileToOpen: FourSlashFile = this._findFile(indexOrName);
        fileToOpen.fileName = normalizeSlashes(fileToOpen.fileName);
        this.activeFile = fileToOpen;

        this.program.setFileOpened(this.activeFile.fileName, 1, fileToOpen.content);
    }

    printCurrentFileState(showWhitespace: boolean, makeCaretVisible: boolean) {
        for (const file of this.testData.files) {
            const active = this.activeFile === file;
            host.HOST.log(`=== Script (${file.fileName}) ${active ? '(active, cursor at |)' : ''} ===`);
            let content = this._getFileContent(file.fileName);
            if (active) {
                content =
                    content.substr(0, this.currentCaretPosition) +
                    (makeCaretVisible ? '|' : '') +
                    content.substr(this.currentCaretPosition);
            }
            if (showWhitespace) {
                content = this._makeWhitespaceVisible(content);
            }
            host.HOST.log(content);
        }
    }

    deleteChar(count = 1) {
        const offset = this.currentCaretPosition;
        const ch = '';

        const checkCadence = (count >> 2) + 1;

        for (let i = 0; i < count; i++) {
            this._editScriptAndUpdateMarkers(this.activeFile.fileName, offset, offset + 1, ch);

            if (i % checkCadence === 0) {
                this._checkPostEditInvariants();
            }
        }

        this._checkPostEditInvariants();
    }

    replace(start: number, length: number, text: string) {
        this._editScriptAndUpdateMarkers(this.activeFile.fileName, start, start + length, text);
        this._checkPostEditInvariants();
    }

    deleteLineRange(startIndex: number, endIndexInclusive: number) {
        const startPos = this._convertPositionToOffset(this.activeFile.fileName, { line: startIndex, character: 0 });
        const endPos = this._convertPositionToOffset(this.activeFile.fileName, {
            line: endIndexInclusive + 1,
            character: 0,
        });
        this.replace(startPos, endPos - startPos, '');
    }

    deleteCharBehindMarker(count = 1) {
        let offset = this.currentCaretPosition;
        const ch = '';
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
    type(text: string) {
        let offset = this.currentCaretPosition;
        const selection = this._getSelection();
        this.replace(selection.start, selection.length, '');

        for (let i = 0; i < text.length; i++) {
            const ch = text.charAt(i);
            this._editScriptAndUpdateMarkers(this.activeFile.fileName, offset, offset, ch);

            this.currentCaretPosition++;
            offset++;
        }

        this._checkPostEditInvariants();
    }

    // Enters text as if the user had pasted it
    paste(text: string) {
        this._editScriptAndUpdateMarkers(
            this.activeFile.fileName,
            this.currentCaretPosition,
            this.currentCaretPosition,
            text
        );
        this._checkPostEditInvariants();
    }

    verifyDiagnostics(map?: { [marker: string]: { category: string; message: string } }): void {
        this._analyze();

        // organize things per file
        const resultPerFile = this._getDiagnosticsPerFile();
        const rangePerFile = this._createMultiMap<Range>(this.getRanges(), (r) => r.fileName);

        if (!hasDiagnostics(resultPerFile) && rangePerFile.size === 0) {
            // no errors and no error is expected. we are done
            return;
        }

        for (const [file, ranges] of rangePerFile.entries()) {
            const rangesPerCategory = this._createMultiMap<Range>(ranges, (r) => {
                if (map) {
                    const name = this.getMarkerName(r.marker!);
                    return map[name].category;
                }

                return (r.marker!.data! as any).category as string;
            });

            if (!rangesPerCategory.has('error')) {
                rangesPerCategory.set('error', []);
            }

            if (!rangesPerCategory.has('warning')) {
                rangesPerCategory.set('warning', []);
            }

            const result = resultPerFile.get(file)!;
            resultPerFile.delete(file);

            for (const [category, expected] of rangesPerCategory.entries()) {
                const lines = result.parseResults!.tokenizerOutput.lines;
                const actual =
                    category === 'error'
                        ? result.errors
                        : category === 'warning'
                        ? result.warnings
                        : this._raiseError(`unexpected category ${category}`);

                if (expected.length !== actual.length) {
                    this._raiseError(
                        `contains unexpected result - expected: ${stringify(expected)}, actual: ${stringify(actual)}`
                    );
                }

                for (const range of expected) {
                    const rangeSpan = TextRange.fromBounds(range.pos, range.end);
                    const matches = actual.filter((d) => {
                        const diagnosticSpan = TextRange.fromBounds(
                            convertPositionToOffset(d.range.start, lines)!,
                            convertPositionToOffset(d.range.end, lines)!
                        );
                        return this._deepEqual(diagnosticSpan, rangeSpan);
                    });

                    if (matches.length === 0) {
                        this._raiseError(`doesn't contain expected range: ${stringify(range)}`);
                    }

                    // if map is provided, check message as well
                    if (map) {
                        const name = this.getMarkerName(range.marker!);
                        const message = map[name].message;

                        if (matches.filter((d) => message === d.message).length !== 1) {
                            this._raiseError(
                                `message doesn't match: ${message} of ${name} - ${stringify(
                                    range
                                )}, actual: ${stringify(matches)}`
                            );
                        }
                    }
                }
            }
        }

        if (hasDiagnostics(resultPerFile)) {
            this._raiseError(`these diagnostics were unexpected: ${stringify(resultPerFile)}`);
        }

        function hasDiagnostics(
            resultPerFile: Map<
                string,
                {
                    filePath: string;
                    parseResults: ParseResults | undefined;
                    errors: Diagnostic[];
                    warnings: Diagnostic[];
                }
            >
        ) {
            for (const entry of resultPerFile.values()) {
                if (entry.errors.length + entry.warnings.length > 0) {
                    return true;
                }
            }

            return false;
        }
    }

    async verifyCodeActions(map: {
        [marker: string]: { codeActions: { title: string; kind: string; command: Command }[] };
    }): Promise<any> {
        this._analyze();

        for (const range of this.getRanges()) {
            const name = this.getMarkerName(range.marker!);
            for (const expected of map[name].codeActions) {
                const actual = await this._getCodeActions(range);

                const expectedCommand = {
                    title: expected.command.title,
                    command: expected.command.command,
                    arguments: convertToString(expected.command.arguments),
                };

                const matches = actual.filter((a) => {
                    const actualCommand = a.command
                        ? {
                              title: a.command.title,
                              command: a.command.command,
                              arguments: convertToString(a.command.arguments),
                          }
                        : undefined;

                    return (
                        a.title === expected.title &&
                        a.kind! === expected.kind &&
                        this._deepEqual(actualCommand, expectedCommand)
                    );
                });

                if (matches.length !== 1) {
                    this._raiseError(
                        `doesn't contain expected result: ${stringify(expected)}, actual: ${stringify(actual)}`
                    );
                }
            }
        }

        this.markTestDone();

        function convertToString(args: any[] | undefined): string[] | undefined {
            return args?.map((a) => {
                if (isString(a)) {
                    return normalizeSlashes(a);
                }

                return JSON.stringify(a);
            });
        }
    }

    async verifyCommand(command: Command, files: { [filePath: string]: string }): Promise<any> {
        this._analyze();

        const commandResult = await this._hostSpecificFeatures.execute(
            new TestLanguageService(this.workspace, this.console, this.fs),
            { command: command.command, arguments: command.arguments },
            CancellationToken.None
        );

        if (command.command === 'pyright.createtypestub') {
            await this._verifyFiles(files);
        } else if (command.command === 'pyright.organizeimports') {
            //organize imports command can only be used on 1 file at a time, so there is no looping over "commandResult" or "files"
            const actualText = (commandResult as TextEdit[])[0].newText;
            const expectedText: string = Object.values(files)[0];

            if (actualText != expectedText) {
                this._raiseError(
                    `doesn't contain expected result: ${stringify(expectedText)}, actual: ${stringify(actualText)}`
                );
            }
        }

        this.markTestDone();
    }

    async verifyInvokeCodeAction(map: {
        [marker: string]: { title: string; files?: { [filePath: string]: string }; edits?: TextEdit[] };
    }): Promise<any> {
        this._analyze();

        for (const range of this.getRanges()) {
            const name = this.getMarkerName(range.marker!);
            if (!map[name]) {
                continue;
            }

            const ls = new TestLanguageService(this.workspace, this.console, this.fs);

            const codeActions = await this._getCodeActions(range);
            for (const codeAction of codeActions.filter((c) => c.title === map[name].title)) {
                const results = await this._hostSpecificFeatures.execute(
                    ls,
                    {
                        command: codeAction.command!.command,
                        arguments: codeAction.command?.arguments,
                    },
                    CancellationToken.None
                );

                if (map[name].edits) {
                    const workspaceEdits = results as WorkspaceEdit;
                    for (const edits of Object.values(workspaceEdits.changes!)) {
                        for (const edit of edits) {
                            assert(
                                map[name].edits!.filter(
                                    (e) => rangesAreEqual(e.range, edit.range) && e.newText === edit.newText
                                ).length === 1
                            );
                        }
                    }
                }
            }

            if (map[name].files) {
                await this._verifyFiles(map[name].files!);
            }
        }

        this.markTestDone();
    }

    verifyHover(map: { [marker: string]: { value: string; kind: string } }): void {
        this._analyze();

        for (const range of this.getRanges()) {
            const name = this.getMarkerName(range.marker!);
            const expected = map[name];

            const rangePos = this._convertOffsetsToRange(range.fileName, range.pos, range.end);

            const actual = convertHoverResults(
                this.program.getHoverForPosition(range.fileName, rangePos.start, CancellationToken.None)
            );
            assert.ok(actual);

            assert.deepEqual(actual!.range, rangePos);

            if (MarkupContent.is(actual!.contents)) {
                assert.equal(actual!.contents.value, expected.value);
                assert.equal(actual!.contents.kind, expected.kind);
            } else {
                assert.fail(`Unexpected type of contents object "${actual!.contents}", should be MarkupContent.`);
            }
        }
    }

    verifyCaretAtMarker(markerName = '') {
        const pos = this.getMarkerByName(markerName);
        if (pos.fileName !== this.activeFile.fileName) {
            throw new Error(
                `verifyCaretAtMarker failed - expected to be in file "${pos.fileName}", but was in file "${this.activeFile.fileName}"`
            );
        }
        if (pos.position !== this.currentCaretPosition) {
            throw new Error(
                `verifyCaretAtMarker failed - expected to be at marker "/*${markerName}*/, but was at position ${
                    this.currentCaretPosition
                }(${this._getLineColStringAtPosition(this.currentCaretPosition)})`
            );
        }
    }

    verifyCurrentLineContent(text: string) {
        const actual = this._getCurrentLineContent();
        if (actual !== text) {
            throw new Error(
                'verifyCurrentLineContent\n' + this._displayExpectedAndActualString(text, actual, /* quoted */ true)
            );
        }
    }

    verifyCurrentFileContent(text: string) {
        this._verifyFileContent(this.activeFile.fileName, text);
    }

    verifyTextAtCaretIs(text: string) {
        const actual = this._getFileContent(this.activeFile.fileName).substring(
            this.currentCaretPosition,
            this.currentCaretPosition + text.length
        );
        if (actual !== text) {
            throw new Error(
                'verifyTextAtCaretIs\n' + this._displayExpectedAndActualString(text, actual, /* quoted */ true)
            );
        }
    }

    verifyRangeIs(expectedText: string, includeWhiteSpace?: boolean) {
        this._verifyTextMatches(this._rangeText(this._getOnlyRange()), !!includeWhiteSpace, expectedText);
    }

    verifyCompletion(
        verifyMode: 'exact' | 'included' | 'excluded',
        map: { [marker: string]: { completions: { label: string; documentation?: { kind: string; value: string } }[] } }
    ) {
        this._analyze();

        for (const marker of this.getMarkers()) {
            const filePath = marker.fileName;
            const expectedCompletions = map[this.getMarkerName(marker)].completions;
            const completionPosition = this._convertOffsetToPosition(filePath, marker.position);

            const result = this.program.getCompletionsForPosition(
                filePath,
                completionPosition,
                this.workspace.rootPath,
                CancellationToken.None
            );

            if (result) {
                if (verifyMode === 'exact') {
                    if (result.items.length !== expectedCompletions.length) {
                        assert.fail(
                            `Expected ${expectedCompletions.length} items but received ${
                                result.items.length
                            }. Actual completions:\n${stringify(result.items.map((r) => r.label))}`
                        );
                    }
                }

                for (let i = 0; i < expectedCompletions.length; i++) {
                    const expected = expectedCompletions[i];
                    const actualIndex = result.items.findIndex((a) => a.label === expected.label);
                    if (actualIndex >= 0) {
                        if (verifyMode === 'excluded') {
                            // we're not supposed to find the completions passed to the test
                            assert.fail(
                                `Completion item with label "${
                                    expected.label
                                }" unexpected. Actual completions:\n${stringify(result.items.map((r) => r.label))}`
                            );
                        }

                        const actual: CompletionItem = result.items[actualIndex];
                        assert.equal(actual.label, expected.label);
                        if (expectedCompletions[i].documentation !== undefined) {
                            if (actual.documentation === undefined) {
                                this.program.resolveCompletionItem(filePath, actual, CancellationToken.None);
                            }

                            if (MarkupContent.is(actual.documentation)) {
                                assert.equal(actual.documentation.value, expected.documentation?.value);
                                assert.equal(actual.documentation.kind, expected.documentation?.kind);
                            } else {
                                assert.fail(
                                    `Unexpected type of contents object "${actual.documentation}", should be MarkupContent.`
                                );
                            }
                        }

                        result.items.splice(actualIndex, 1);
                    } else {
                        if (verifyMode === 'included' || verifyMode === 'exact') {
                            // we're supposed to find all items passed to the test
                            assert.fail(
                                `Completion item with label "${
                                    expected.label
                                }" expected. Actual completions:\n${stringify(result.items.map((r) => r.label))}`
                            );
                        }
                    }
                }

                if (verifyMode === 'exact') {
                    if (result.items.length !== 0) {
                        // we removed every item we found, there should not be any remaining
                        assert.fail(`Completion items unexpected: ${stringify(result.items.map((r) => r.label))}`);
                    }
                }
            } else {
                assert.fail('Failed to get completions');
            }
        }
    }

    verifySignature(map: {
        [marker: string]: {
            noSig?: boolean;
            signatures?: {
                label: string;
                parameters: string[];
            }[];
            activeSignature?: number;
            activeParameter?: number;
        };
    }): void {
        this._analyze();

        for (const marker of this.getMarkers()) {
            const fileName = marker.fileName;
            const name = this.getMarkerName(marker);

            if (!(name in map)) {
                continue;
            }

            const expected = map[name];
            const position = this._convertOffsetToPosition(fileName, marker.position);

            const actual = this.program.getSignatureHelpForPosition(fileName, position, CancellationToken.None);

            if (expected.noSig) {
                assert.equal(actual, undefined);
                continue;
            }

            assert.ok(actual);
            assert.ok(actual!.signatures);

            actual!.signatures.forEach((sig, index) => {
                const expectedSig = expected.signatures![index];
                assert.equal(sig.label, expectedSig.label);

                assert.ok(sig.parameters);
                const actualParameters: string[] = [];

                sig.parameters!.forEach((p) => {
                    actualParameters.push(sig.label.substring(p.startOffset, p.endOffset));
                });

                assert.deepEqual(actualParameters, expectedSig.parameters);
            });

            assert.equal(actual!.activeSignature, expected.activeSignature);
            assert.equal(actual!.activeParameter, expected.activeParameter);
        }
    }

    verifyFindAllReferences(map: {
        [marker: string]: {
            references: DocumentRange[];
        };
    }) {
        this._analyze();

        for (const marker of this.getMarkers()) {
            const fileName = marker.fileName;
            const name = this.getMarkerName(marker);

            if (!(name in map)) {
                continue;
            }

            const expected = map[name].references;

            const position = this._convertOffsetToPosition(fileName, marker.position);
            const actual = this.program.getReferencesForPosition(fileName, position, true, CancellationToken.None);

            assert.equal(expected.length, actual?.length ?? 0);

            for (const r of expected) {
                assert.equal(actual?.filter((d) => this._deepEqual(d, r)).length, 1);
            }
        }
    }

    verifyRename(map: {
        [marker: string]: {
            newName: string;
            changes: FileEditAction[];
        };
    }) {
        this._analyze();

        for (const marker of this.getMarkers()) {
            const fileName = marker.fileName;
            const name = this.getMarkerName(marker);

            if (!(name in map)) {
                continue;
            }

            const expected = map[name];

            const position = this._convertOffsetToPosition(fileName, marker.position);
            const actual = this.program.renameSymbolAtPosition(
                fileName,
                position,
                expected.newName,
                CancellationToken.None
            );

            assert.equal(expected.changes.length, actual?.length ?? 0);

            for (const c of expected.changes) {
                assert.equal(actual?.filter((e) => this._deepEqual(e, c)).length, 1);
            }
        }
    }

    setCancelled(numberOfCalls: number): void {
        this._cancellationToken.setCancelled(numberOfCalls);
    }

    resetCancelled(): void {
        this._cancellationToken.resetCancelled();
    }

    private _isConfig(file: FourSlashFile, ignoreCase: boolean): boolean {
        const comparer = getStringComparer(ignoreCase);
        return configFileNames.some((f) => comparer(getBaseFileName(file.fileName), f) === Comparison.EqualTo);
    }

    private _convertGlobalOptionsToConfigOptions(globalOptions: CompilerSettings): ConfigOptions {
        const srtRoot: string = GlobalMetadataOptionNames.projectRoot;
        const projectRoot = normalizeSlashes(globalOptions[srtRoot] ?? vfs.MODULE_PATH);
        const configOptions = new ConfigOptions(projectRoot);

        // add more global options as we need them

        return this._applyTestConfigOptions(configOptions);
    }

    private _applyTestConfigOptions(configOptions: ConfigOptions) {
        // Always enable "test mode".
        configOptions.internalTestMode = true;

        // Always analyze all files
        configOptions.checkOnlyOpenFiles = false;

        // run test in venv mode under root so that
        // under test we can point to local lib folder
        configOptions.venvPath = vfs.MODULE_PATH;
        configOptions.defaultVenv = vfs.MODULE_PATH;

        // make sure we set typing path
        if (configOptions.typingsPath === undefined) {
            configOptions.typingsPath = normalizePath(combinePaths(vfs.MODULE_PATH, 'typings'));
        }

        return configOptions;
    }

    private _getFileContent(fileName: string): string {
        const files = this.testData.files.filter(
            (f) => comparePaths(f.fileName, fileName, this.fs.ignoreCase) === Comparison.EqualTo
        );
        return files[0].content;
    }

    private _convertPositionToOffset(fileName: string, position: Position): number {
        const lines = this._getTextRangeCollection(fileName);
        return convertPositionToOffset(position, lines)!;
    }

    private _convertOffsetToPosition(fileName: string, offset: number): Position {
        const lines = this._getTextRangeCollection(fileName);

        return convertOffsetToPosition(offset, lines);
    }

    private _convertOffsetsToRange(fileName: string, startOffset: number, endOffset: number): PositionRange {
        const lines = this._getTextRangeCollection(fileName);

        return {
            start: convertOffsetToPosition(startOffset, lines),
            end: convertOffsetToPosition(endOffset, lines),
        };
    }

    private _getParseResult(fileName: string) {
        const file = this.program.getBoundSourceFile(fileName)!;
        return file.getParseResults()!;
    }

    private _getTextRangeCollection(fileName: string): TextRangeCollection<TextRange> {
        if (fileName in this._files) {
            return this._getParseResult(fileName).tokenizerOutput.lines;
        }

        // slow path
        const fileContents = this.fs.readFileSync(fileName, 'utf8');
        const tokenizer = new Tokenizer();
        return tokenizer.tokenize(fileContents).lines;
    }

    private _raiseError(message: string): never {
        throw new Error(this._messageAtLastKnownMarker(message));
    }

    private _messageAtLastKnownMarker(message: string) {
        const locationDescription = this.lastKnownMarker
            ? this.lastKnownMarker
            : this._getLineColStringAtPosition(this.currentCaretPosition);
        return `At ${locationDescription}: ${message}`;
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
        return text.replace(/\s/g, '');
    }

    private _createMultiMap<T>(values?: T[], getKey?: (t: T) => string): MultiMap<T> {
        const map = new Map<string, T[]>() as MultiMap<T>;
        map.add = multiMapAdd;
        map.remove = multiMapRemove;

        if (values && getKey) {
            for (const value of values) {
                map.add(getKey(value), value);
            }
        }

        return map;

        function multiMapAdd<T>(this: MultiMap<T>, key: string, value: T) {
            let values = this.get(key);
            if (values) {
                values.push(value);
            } else {
                this.set(key, (values = [value]));
            }
            return values;
        }

        function multiMapRemove<T>(this: MultiMap<T>, key: string, value: T) {
            const values = this.get(key);
            if (values) {
                values.forEach((v, i, arr) => {
                    if (v === value) {
                        arr.splice(i, 1);
                    }
                });
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
            this._raiseError('Exactly one range should be specified in the test file.');
        }

        return ranges[0];
    }

    private _verifyFileContent(fileName: string, text: string) {
        const actual = this._getFileContent(fileName);
        if (actual !== text) {
            throw new Error(`verifyFileContent failed:\n${this._showTextDiff(text, actual)}`);
        }
    }

    private _verifyTextMatches(actualText: string, includeWhitespace: boolean, expectedText: string) {
        const removeWhitespace = (s: string): string => (includeWhitespace ? s : this._removeWhitespace(s));
        if (removeWhitespace(actualText) !== removeWhitespace(expectedText)) {
            this._raiseError(
                `Actual range text doesn't match expected text.\n${this._showTextDiff(expectedText, actualText)}`
            );
        }
    }

    private _getSelection(): TextRange {
        return TextRange.fromBounds(
            this.currentCaretPosition,
            this.selectionEnd === -1 ? this.currentCaretPosition : this.selectionEnd
        );
    }

    private _getLineContent(index: number) {
        const text = this._getFileContent(this.activeFile.fileName);
        const pos = this._convertPositionToOffset(this.activeFile.fileName, { line: index, character: 0 });
        let startPos = pos;
        let endPos = pos;

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
        return this._getLineContent(
            this._convertOffsetToPosition(this.activeFile.fileName, this.currentCaretPosition).line
        );
    }

    private _findFile(indexOrName: string | number): FourSlashFile {
        if (typeof indexOrName === 'number') {
            const index = indexOrName;
            if (index >= this.testData.files.length) {
                throw new Error(
                    `File index (${index}) in openFile was out of range. There are only ${this.testData.files.length} files in this test.`
                );
            } else {
                return this.testData.files[index];
            }
        } else if (isString(indexOrName)) {
            const { file, availableNames } = this._tryFindFileWorker(indexOrName);
            if (!file) {
                throw new Error(
                    `No test file named "${indexOrName}" exists. Available file names are: ${availableNames.join(', ')}`
                );
            }
            return file;
        } else {
            return debug.assertNever(indexOrName);
        }
    }

    private _tryFindFileWorker(
        name: string
    ): { readonly file: FourSlashFile | undefined; readonly availableNames: readonly string[] } {
        name = normalizePath(name);

        let file: FourSlashFile | undefined;
        const availableNames: string[] = [];
        this.testData.files.forEach((f) => {
            const fn = normalizePath(f.fileName);
            if (fn) {
                if (fn === name) {
                    file = f;
                }

                availableNames.push(fn);
            }
        });

        assert.ok(file);
        return { file, availableNames };
    }

    private _getLineColStringAtPosition(position: number, file: FourSlashFile = this.activeFile) {
        const pos = this._convertOffsetToPosition(file.fileName, position);
        return `line ${pos.line + 1}, col ${pos.character}`;
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
        const expectMsg = '\x1b[1mExpected\x1b[0m\x1b[31m';
        const actualMsg = '\x1b[1mActual\x1b[0m\x1b[31m';
        const expectedString = quoted ? '"' + expected + '"' : expected;
        const actualString = quoted ? '"' + actual + '"' : actual;
        return `\n${expectMsg}:\n${expectedString}\n\n${actualMsg}:\n${actualString}`;
    }

    private _makeWhitespaceVisible(text: string) {
        return text
            .replace(/ /g, '\u00B7')
            .replace(/\r/g, '\u00B6')
            .replace(/\n/g, '\u2193\n')
            .replace(/\t/g, '\u2192   ');
    }

    private _updatePosition(position: number, editStart: number, editEnd: number, { length }: string): number {
        // If inside the edit, return -1 to mark as invalid
        return position <= editStart ? position : position < editEnd ? -1 : position + length - +(editEnd - editStart);
    }

    private _analyze() {
        while (this.program.analyze()) {
            // Continue to call analyze until it completes. Since we're not
            // specifying a timeout, it should complete the first time.
        }
    }

    private _getDiagnosticsPerFile() {
        const sourceFiles = this._files.map((f) => this.program.getSourceFile(f));
        const results = sourceFiles.map((sourceFile, index) => {
            if (sourceFile) {
                const diagnostics = sourceFile.getDiagnostics(this.configOptions) || [];
                const filePath = sourceFile.getFilePath();
                const value = {
                    filePath,
                    parseResults: sourceFile.getParseResults(),
                    errors: diagnostics.filter((diag) => diag.category === DiagnosticCategory.Error),
                    warnings: diagnostics.filter((diag) => diag.category === DiagnosticCategory.Warning),
                };
                return [filePath, value] as [string, typeof value];
            } else {
                this._raiseError(`Source file not found for ${this._files[index]}`);
            }
        });

        return new Map<string, typeof results[0][1]>(results);
    }

    private _createAnalysisService(
        nullConsole: ConsoleInterface,
        importResolverFactory: ImportResolverFactory,
        configOptions: ConfigOptions
    ) {
        // we do not initiate automatic analysis or file watcher in test.
        const service = new AnalyzerService('test service', this.fs, nullConsole, importResolverFactory, configOptions);

        // directly set files to track rather than using fileSpec from config
        // to discover those files from file system
        service.test_program.setTrackedFiles(this._files);

        return service;
    }

    private _deepEqual(a: any, e: any) {
        try {
            // NOTE: find better way.
            assert.deepStrictEqual(a, e);
        } catch {
            return false;
        }

        return true;
    }

    private async _waitForFile(filePath: string) {
        while (!this.fs.existsSync(filePath)) {
            await new Promise((res) =>
                setTimeout(() => {
                    res();
                }, 200)
            );
        }
    }

    private _getCodeActions(range: Range) {
        const file = range.fileName;
        const textRange = {
            start: this._convertOffsetToPosition(file, range.pos),
            end: this._convertOffsetToPosition(file, range.end),
        };

        return this._hostSpecificFeatures.getCodeActionsForPosition(
            this.workspace,
            file,
            textRange,
            CancellationToken.None
        );
    }

    private async _verifyFiles(files: { [filePath: string]: string }) {
        for (const filePath of Object.keys(files)) {
            const expected = files[filePath];
            const normalizedFilePath = normalizeSlashes(filePath);

            // wait until the file exists
            await this._waitForFile(normalizedFilePath);

            const actual = this.fs.readFileSync(normalizedFilePath, 'utf8');
            if (actual !== expected) {
                this._raiseError(
                    `doesn't contain expected result: ${stringify(expected)}, actual: ${stringify(actual)}`
                );
            }
        }
    }
}
