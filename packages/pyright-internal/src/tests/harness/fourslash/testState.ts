/*
 * testState.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * TestState wraps currently test states and provides a way to query and manipulate
 * the test states.
 */

import assert from 'assert';
import * as JSONC from 'jsonc-parser';
import Char from 'typescript-char';
import {
    AnnotatedTextEdit,
    CancellationToken,
    ChangeAnnotation,
    CodeAction,
    Command,
    CompletionItem,
    CreateFile,
    DeleteFile,
    Diagnostic,
    DocumentHighlight,
    DocumentHighlightKind,
    ExecuteCommandParams,
    MarkupContent,
    MarkupKind,
    OptionalVersionedTextDocumentIdentifier,
    RenameFile,
    TextDocumentEdit,
    TextEdit,
    WorkspaceEdit,
} from 'vscode-languageserver';

import { ImportResolver, ImportResolverFactory } from '../../../analyzer/importResolver';
import { findNodeByOffset } from '../../../analyzer/parseTreeUtils';
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
    getDirectoryPath,
    getFileExtension,
    getFileSpec,
    normalizePath,
    normalizeSlashes,
} from '../../../common/pathUtils';
import { convertOffsetToPosition, convertPositionToOffset } from '../../../common/positionUtils';
import { getStringComparer } from '../../../common/stringUtils';
import { DocumentRange, Position, Range as PositionRange, rangesAreEqual, TextRange } from '../../../common/textRange';
import { TextRangeCollection } from '../../../common/textRangeCollection';
import { LanguageServerInterface, WorkspaceServiceInstance } from '../../../languageServerBase';
import { AbbreviationInfo } from '../../../languageService/autoImporter';
import { DefinitionFilter } from '../../../languageService/definitionProvider';
import { convertHoverResults } from '../../../languageService/hoverProvider';
import { ParseNode } from '../../../parser/parseNodes';
import { ParseResults } from '../../../parser/parser';
import { Tokenizer } from '../../../parser/tokenizer';
import { PyrightFileSystem } from '../../../pyrightFileSystem';
import { TestAccessHost } from '../testAccessHost';
import * as host from '../testHost';
import { stringify } from '../utils';
import { createFromFileSystem, distlibFolder, libFolder, typeshedFolder } from '../vfs/factory';
import * as vfs from '../vfs/filesystem';
import { parseTestData } from './fourSlashParser';
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

    runIndexer(workspace: WorkspaceServiceInstance, noStdLib: boolean): void;
    getCodeActionsForPosition(
        workspace: WorkspaceServiceInstance,
        filePath: string,
        range: PositionRange,
        token: CancellationToken
    ): Promise<CodeAction[]>;

    execute(ls: LanguageServerInterface, params: ExecuteCommandParams, token: CancellationToken): Promise<any>;
}

const testAccessHost = new TestAccessHost(vfs.MODULE_PATH, [libFolder, distlibFolder]);

export class TestState {
    private readonly _cancellationToken: TestCancellationToken;
    private readonly _files: string[] = [];
    private readonly _hostSpecificFeatures: HostSpecificFeatures;

    readonly testFS: vfs.TestFileSystem;
    readonly fs: PyrightFileSystem;
    readonly workspace: WorkspaceServiceInstance;
    readonly console: ConsoleInterface;
    readonly rawConfigJson: any | undefined;

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
        mountPaths?: Map<string, string>,
        hostSpecificFeatures?: HostSpecificFeatures
    ) {
        this._hostSpecificFeatures = hostSpecificFeatures ?? new TestFeatures();

        const nullConsole = new NullConsole();
        const ignoreCase = toBoolean(testData.globalOptions[GlobalMetadataOptionNames.ignoreCase]);

        this._cancellationToken = new TestCancellationToken();
        const configOptions = this._convertGlobalOptionsToConfigOptions(this.testData.globalOptions, mountPaths);

        const sourceFiles = [];
        const files: vfs.FileSet = {};
        for (const file of testData.files) {
            // if one of file is configuration file, set config options from the given json
            if (this._isConfig(file, ignoreCase)) {
                try {
                    this.rawConfigJson = JSONC.parse(file.content);
                } catch (e: any) {
                    throw new Error(`Failed to parse test ${file.fileName}: ${e.message}`);
                }

                configOptions.initializeFromJson(this.rawConfigJson, 'basic', nullConsole, testAccessHost);
                this._applyTestConfigOptions(configOptions);
            } else {
                files[file.fileName] = new vfs.File(file.content, { meta: file.fileOptions, encoding: 'utf8' });

                if (!toBoolean(file.fileOptions[MetadataOptionNames.library])) {
                    sourceFiles.push(file.fileName);
                }
            }
        }

        this.console = nullConsole;
        this.testFS = createFromFileSystem(
            host.HOST,
            ignoreCase,
            { cwd: basePath, files, meta: testData.globalOptions },
            mountPaths
        );

        this.fs = new PyrightFileSystem(this.testFS);
        this._files = sourceFiles;

        const service = this._createAnalysisService(
            nullConsole,
            this._hostSpecificFeatures.importResolverFactory,
            configOptions
        );

        this.workspace = {
            workspaceName: 'test workspace',
            rootPath: this.fs.getModulePath(),
            rootUri: convertPathToUri(this.fs, this.fs.getModulePath()),
            serviceInstance: service,
            disableLanguageServices: false,
            disableOrganizeImports: false,
            isInitialized: createDeferred<boolean>(),
        };

        const indexer = toBoolean(testData.globalOptions[GlobalMetadataOptionNames.indexer]);
        const indexerWithoutStdLib = toBoolean(testData.globalOptions[GlobalMetadataOptionNames.indexerWithoutStdLib]);
        if (indexer || indexerWithoutStdLib) {
            configOptions.indexing = true;
            this._hostSpecificFeatures.runIndexer(this.workspace, indexerWithoutStdLib);
        }

        if (this._files.length > 0) {
            // Open the first file by default
            this.openFile(this._files[0]);
        }

        for (const filePath of this._files) {
            const file = files[filePath] as vfs.File;
            if (file.meta?.[MetadataOptionNames.ipythonMode]) {
                this.program.getSourceFile(filePath)?.test_enableIPythonMode(true);
            }
        }
    }

    get importResolver(): ImportResolver {
        return this.workspace.serviceInstance.getImportResolver();
    }

    get configOptions(): ConfigOptions {
        return this.workspace.serviceInstance.getConfigOptions();
    }

    get program(): Program {
        return this.workspace.serviceInstance.test_program;
    }

    cwd() {
        return this.testFS.cwd();
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

    getMappedFilePath(path: string): string {
        this.importResolver.ensurePartialStubPackages(this.configOptions.findExecEnvironment(path));
        return this.fs.getMappedFilePath(path);
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
            this.raiseError(`no matching range for ${markerString}`);
        }

        const range = ranges[0];
        return this.convertPositionRange(range);
    }

    expandPositionRange(range: PositionRange, start: number, end: number) {
        return {
            start: { line: range.start.line, character: range.start.character - start },
            end: { line: range.end.line, character: range.end.character + end },
        };
    }

    convertPositionRange(range: Range) {
        return this.convertOffsetsToRange(range.fileName, range.pos, range.end);
    }

    convertPathToUri(path: string) {
        return convertPathToUri(this.fs, path);
    }

    getDirectoryPath(path: string) {
        return getDirectoryPath(path);
    }

    goToPosition(positionOrLineAndColumn: number | Position) {
        const pos = isNumber(positionOrLineAndColumn)
            ? positionOrLineAndColumn
            : this.convertPositionToOffset(this.activeFile.fileName, positionOrLineAndColumn);
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
        const lineStart = this.convertPositionToOffset(this.activeFile.fileName, { line: index, character: 0 });
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
        const result = this.createMultiMap<Range>(this.getRanges(), (r) => this._rangeText(r));
        this.testData.rangesByText = result;

        return result;
    }

    getFilteredRanges<T extends {}>(
        predicate: (m: Marker | undefined, d: T | undefined, text: string) => boolean
    ): Range[] {
        return this.getRanges().filter((r) => predicate(r.marker, r.marker?.data as T | undefined, this._rangeText(r)));
    }

    getRangeByMarkerName(markerName: string): Range | undefined {
        const marker = this.getMarkerByName(markerName);
        return this.getRanges().find((r) => r.marker === marker);
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
    openFile(indexOrName: number | string): void {
        const fileToOpen: FourSlashFile = this._findFile(indexOrName);
        fileToOpen.fileName = normalizeSlashes(fileToOpen.fileName);
        this.activeFile = fileToOpen;

        this.program.setFileOpened(this.activeFile.fileName, 1, [{ text: fileToOpen.content }]);
    }

    openFiles(indexOrNames: (number | string)[]): void {
        for (const indexOrName of indexOrNames) {
            this.openFile(indexOrName);
        }
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
        const startPos = this.convertPositionToOffset(this.activeFile.fileName, { line: startIndex, character: 0 });
        const endPos = this.convertPositionToOffset(this.activeFile.fileName, {
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
        const rangePerFile = this.createMultiMap<Range>(this.getRanges(), (r) => r.fileName);

        if (!hasDiagnostics(resultPerFile) && rangePerFile.size === 0) {
            // no errors and no error is expected. we are done
            return;
        }

        for (const [file, ranges] of rangePerFile.entries()) {
            const rangesPerCategory = this.createMultiMap<Range>(ranges, (r) => {
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

            if (!rangesPerCategory.has('information')) {
                rangesPerCategory.set('information', []);
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
                        : category === 'information'
                        ? result.information
                        : this.raiseError(`unexpected category ${category}`);

                if (expected.length !== actual.length) {
                    this.raiseError(
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
                        this.raiseError(`doesn't contain expected range: ${stringify(range)}`);
                    }

                    // if map is provided, check message as well
                    if (map) {
                        const name = this.getMarkerName(range.marker!);
                        const message = map[name].message;

                        if (matches.filter((d) => message === d.message).length !== 1) {
                            this.raiseError(
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
            this.raiseError(`these diagnostics were unexpected: ${stringify(resultPerFile)}`);
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

    async verifyCodeActions(
        map: {
            [marker: string]: { codeActions: { title: string; kind: string; command: Command }[] };
        },
        verifyCodeActionCount?: boolean
    ): Promise<any> {
        // make sure we don't use cache built from other tests
        this.workspace.serviceInstance.invalidateAndForceReanalysis();
        this._analyze();

        for (const range of this.getRanges()) {
            const name = this.getMarkerName(range.marker!);
            if (!map[name]) {
                continue;
            }

            const codeActions = await this._getCodeActions(range);
            if (verifyCodeActionCount) {
                if (codeActions.length !== map[name].codeActions.length) {
                    this.raiseError(
                        `doesn't contain expected result: ${stringify(map[name])}, actual: ${stringify(codeActions)}`
                    );
                }
            }

            for (const expected of map[name].codeActions) {
                const expectedCommand = {
                    title: expected.command.title,
                    command: expected.command.command,
                    arguments: convertToString(expected.command.arguments),
                };

                const matches = codeActions.filter((a) => {
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
                    this.raiseError(
                        `doesn't contain expected result: ${stringify(expected)}, actual: ${stringify(codeActions)}`
                    );
                }
            }
        }

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
            { command: command.command, arguments: command.arguments || [] },
            CancellationToken.None
        );

        if (command.command === 'pyright.createtypestub') {
            await this._verifyFiles(files);
        } else if (command.command === 'pyright.organizeimports') {
            // Organize imports command can be used on only one file at a time,
            // so there is no looping over "commandResult" or "files".
            const workspaceEditResult = commandResult as WorkspaceEdit;
            const uri = Object.keys(workspaceEditResult.changes!)[0];
            const textEdit = workspaceEditResult.changes![uri][0];
            const actualText = textEdit.newText;
            const expectedText: string = Object.values(files)[0];

            if (actualText !== expectedText) {
                this.raiseError(
                    `doesn't contain expected result: ${stringify(expectedText)}, actual: ${stringify(actualText)}`
                );
            }
        }
        return commandResult;
    }

    protected verifyWorkspaceEdit(expected: WorkspaceEdit, actual: WorkspaceEdit) {
        if (actual.changes) {
            this._verifyTextEditMap(expected.changes!, actual.changes);
        } else {
            assert(!expected.changes);
        }

        if (actual.documentChanges) {
            this._verifyDocumentEdits(expected.documentChanges!, actual.documentChanges);
        } else {
            assert(!expected.documentChanges);
        }

        if (actual.changeAnnotations) {
            this._verifyChangeAnnotations(expected.changeAnnotations!, actual.changeAnnotations);
        } else {
            assert(!expected.changeAnnotations);
        }
    }

    private _verifyChangeAnnotations(
        expected: { [id: string]: ChangeAnnotation },
        actual: { [id: string]: ChangeAnnotation }
    ) {
        assert.strictEqual(Object.entries(expected).length, Object.entries(actual).length);

        for (const key of Object.keys(expected)) {
            const expectedAnnotation = expected[key];
            const actualAnnotation = actual[key];

            // We need to improve it to test localized strings.
            assert.strictEqual(expectedAnnotation.label, actualAnnotation.label);
            assert.strictEqual(expectedAnnotation.description, actualAnnotation.description);

            assert.strictEqual(expectedAnnotation.needsConfirmation, actualAnnotation.needsConfirmation);
        }
    }

    private _textDocumentAreSame(
        expected: OptionalVersionedTextDocumentIdentifier,
        actual: OptionalVersionedTextDocumentIdentifier
    ) {
        return expected.version === actual.version && expected.uri === actual.uri;
    }

    private _verifyDocumentEdits(
        expected: (TextDocumentEdit | CreateFile | RenameFile | DeleteFile)[],
        actual: (TextDocumentEdit | CreateFile | RenameFile | DeleteFile)[]
    ) {
        assert.strictEqual(expected.length, actual.length);

        for (const op of expected) {
            assert(
                actual.some((a) => {
                    const expectedKind = TextDocumentEdit.is(op) ? 'edit' : op.kind;
                    const actualKind = TextDocumentEdit.is(a) ? 'edit' : a.kind;
                    if (expectedKind !== actualKind) {
                        return false;
                    }

                    switch (expectedKind) {
                        case 'edit': {
                            const expectedEdit = op as TextDocumentEdit;
                            const actualEdit = a as TextDocumentEdit;

                            if (!this._textDocumentAreSame(expectedEdit.textDocument, actualEdit.textDocument)) {
                                return false;
                            }

                            return this._textEditsAreSame(expectedEdit.edits, actualEdit.edits);
                        }
                        case 'create': {
                            const expectedOp = op as CreateFile;
                            const actualOp = a as CreateFile;
                            return (
                                expectedOp.kind === actualOp.kind &&
                                expectedOp.annotationId === actualOp.annotationId &&
                                expectedOp.uri === actualOp.uri &&
                                expectedOp.options?.ignoreIfExists === actualOp.options?.ignoreIfExists &&
                                expectedOp.options?.overwrite === actualOp.options?.overwrite
                            );
                        }
                        case 'rename': {
                            const expectedOp = op as RenameFile;
                            const actualOp = a as RenameFile;
                            return (
                                expectedOp.kind === actualOp.kind &&
                                expectedOp.annotationId === actualOp.annotationId &&
                                expectedOp.oldUri === actualOp.oldUri &&
                                expectedOp.newUri === actualOp.newUri &&
                                expectedOp.options?.ignoreIfExists === actualOp.options?.ignoreIfExists &&
                                expectedOp.options?.overwrite === actualOp.options?.overwrite
                            );
                        }
                        case 'delete': {
                            const expectedOp = op as DeleteFile;
                            const actualOp = a as DeleteFile;
                            return (
                                expectedOp.annotationId === actualOp.annotationId &&
                                expectedOp.kind === actualOp.kind &&
                                expectedOp.uri === actualOp.uri &&
                                expectedOp.options?.ignoreIfNotExists === actualOp.options?.ignoreIfNotExists &&
                                expectedOp.options?.recursive === actualOp.options?.recursive
                            );
                        }
                        default:
                            debug.assertNever(expectedKind);
                    }
                })
            );
        }
    }

    private _verifyTextEditMap(expected: { [uri: string]: TextEdit[] }, actual: { [uri: string]: TextEdit[] }) {
        assert.strictEqual(Object.entries(expected).length, Object.entries(actual).length);

        for (const key of Object.keys(expected)) {
            assert(this._textEditsAreSame(expected[key], actual[key]));
        }
    }

    private _textEditsAreSame(
        expectedEdits: (TextEdit | AnnotatedTextEdit)[],
        actualEdits: (TextEdit | AnnotatedTextEdit)[]
    ) {
        if (expectedEdits.length !== actualEdits.length) {
            return false;
        }

        for (const edit of expectedEdits) {
            if (actualEdits.some((a) => this._textEditAreSame(edit, a))) {
                return true;
            }
        }

        return false;
    }

    private _textEditAreSame(expected: TextEdit, actual: TextEdit) {
        if (!rangesAreEqual(expected.range, actual.range)) {
            return false;
        }

        if (expected.newText !== actual.newText) {
            return false;
        }

        const expectedAnnotation = AnnotatedTextEdit.is(expected) ? expected.annotationId : '';
        const actualAnnotation = AnnotatedTextEdit.is(actual) ? actual.annotationId : '';
        return expectedAnnotation === actualAnnotation;
    }

    async verifyInvokeCodeAction(
        map: {
            [marker: string]: { title: string; files?: { [filePath: string]: string }; edits?: TextEdit[] };
        },
        verifyCodeActionCount?: boolean
    ): Promise<any> {
        this._analyze();

        for (const range of this.getRanges()) {
            const name = this.getMarkerName(range.marker!);
            if (!map[name]) {
                continue;
            }

            const ls = new TestLanguageService(this.workspace, this.console, this.fs);

            const codeActions = await this._getCodeActions(range);
            if (verifyCodeActionCount) {
                if (codeActions.length !== Object.keys(map).length) {
                    this.raiseError(
                        `doesn't contain expected result: ${stringify(map[name])}, actual: ${stringify(codeActions)}`
                    );
                }
            }

            const matches = codeActions.filter((c) => c.title === map[name].title);
            if (matches.length === 0) {
                this.raiseError(
                    `doesn't contain expected result: ${stringify(map[name])}, actual: ${stringify(codeActions)}`
                );
            }

            for (const codeAction of matches) {
                const results = await this._hostSpecificFeatures.execute(
                    ls,
                    {
                        command: codeAction.command!.command,
                        arguments: codeAction.command?.arguments || [],
                    },
                    CancellationToken.None
                );

                if (map[name].edits) {
                    const workspaceEdits = results as WorkspaceEdit;
                    for (const edits of Object.values(workspaceEdits.changes!)) {
                        for (const edit of edits) {
                            if (map[name].edits!.filter((e) => this._editsAreEqual(e, edit)).length !== 1) {
                                this.raiseError(
                                    `doesn't contain expected result: ${stringify(map[name])}, actual: ${stringify(
                                        edits
                                    )}`
                                );
                            }
                        }
                    }
                }
            }

            if (map[name].files) {
                await this._verifyFiles(map[name].files!);
            }
        }
    }

    verifyHover(kind: MarkupKind, map: { [marker: string]: string }): void {
        // Do not force analyze, it can lead to test passing while it doesn't work in product
        for (const range of this.getRanges()) {
            const name = this.getMarkerName(range.marker!);
            const expected = map[name];
            if (expected === undefined) {
                continue;
            }

            const rangePos = this.convertOffsetsToRange(range.fileName, range.pos, range.end);

            const actual = convertHoverResults(
                kind,
                this.program.getHoverForPosition(range.fileName, rangePos.start, kind, CancellationToken.None)
            );
            assert.ok(actual);

            assert.deepEqual(actual!.range, rangePos);

            if (MarkupContent.is(actual!.contents)) {
                assert.equal(actual!.contents.value, expected);
                assert.equal(actual!.contents.kind, kind);
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

    async verifyCompletion(
        verifyMode: _.FourSlashCompletionVerificationMode,
        docFormat: MarkupKind,
        map: {
            [marker: string]: {
                completions: _.FourSlashCompletionItem[];
                memberAccessInfo?: {
                    lastKnownModule?: string;
                    lastKnownMemberName?: string;
                    unknownMemberName?: string;
                };
            };
        },
        abbrMap?: { [abbr: string]: AbbreviationInfo }
    ): Promise<void> {
        this._analyze();

        for (const marker of this.getMarkers()) {
            const markerName = this.getMarkerName(marker);
            if (!map[markerName]) {
                continue;
            }

            const filePath = marker.fileName;
            const expectedCompletions = map[markerName].completions;
            const completionPosition = this.convertOffsetToPosition(filePath, marker.position);

            const options = { format: docFormat, snippet: true, lazyEdit: true, autoImport: true };
            const nameMap = abbrMap ? new Map<string, AbbreviationInfo>(Object.entries(abbrMap)) : undefined;
            const result = await this.workspace.serviceInstance.getCompletionsForPosition(
                filePath,
                completionPosition,
                this.workspace.rootPath,
                options,
                nameMap,
                CancellationToken.None
            );

            if (result?.completionList) {
                if (verifyMode === 'exact') {
                    if (result.completionList.items.length !== expectedCompletions.length) {
                        assert.fail(
                            `${markerName} - Expected ${expectedCompletions.length} items but received ${
                                result.completionList.items.length
                            }. Actual completions:\n${stringify(result.completionList.items.map((r) => r.label))}`
                        );
                    }
                }

                for (let i = 0; i < expectedCompletions.length; i++) {
                    const expected = expectedCompletions[i];
                    const actualIndex = result.completionList.items.findIndex(
                        (a) => a.label === expected.label && (expected.kind ? a.kind === expected.kind : true)
                    );
                    if (actualIndex >= 0) {
                        if (verifyMode === 'excluded') {
                            // we're not supposed to find the completions passed to the test
                            assert.fail(
                                `${markerName} - Completion item with label "${
                                    expected.label
                                }" unexpected. Actual completions:\n${stringify(
                                    result.completionList.items.map((r) => r.label)
                                )}`
                            );
                        }

                        const actual: CompletionItem = result.completionList.items[actualIndex];

                        if (expected.additionalTextEdits !== undefined) {
                            if (actual.additionalTextEdits === undefined) {
                                this.workspace.serviceInstance.resolveCompletionItem(
                                    filePath,
                                    actual,
                                    options,
                                    nameMap,
                                    CancellationToken.None
                                );
                            }
                        }

                        this.verifyCompletionItem(expected, actual);

                        if (expected.documentation !== undefined) {
                            if (actual.documentation === undefined) {
                                this.workspace.serviceInstance.resolveCompletionItem(
                                    filePath,
                                    actual,
                                    options,
                                    nameMap,
                                    CancellationToken.None
                                );
                            }

                            if (MarkupContent.is(actual.documentation)) {
                                assert.strictEqual(actual.documentation.value, expected.documentation);
                                assert.strictEqual(actual.documentation.kind, docFormat);
                            } else {
                                assert.fail(
                                    `${markerName} - Unexpected type of contents object "${actual.documentation}", should be MarkupContent.`
                                );
                            }
                        }

                        result.completionList.items.splice(actualIndex, 1);
                    } else {
                        if (verifyMode === 'included' || verifyMode === 'exact') {
                            // we're supposed to find all items passed to the test
                            assert.fail(
                                `${markerName} - Completion item with label "${
                                    expected.label
                                }" expected. Actual completions:\n${stringify(
                                    result.completionList.items.map((r) => r.label)
                                )}`
                            );
                        }
                    }
                }

                if (verifyMode === 'exact') {
                    if (result.completionList.items.length !== 0) {
                        // we removed every item we found, there should not be any remaining
                        assert.fail(
                            `${markerName} - Completion items unexpected: ${stringify(
                                result.completionList.items.map((r) => r.label)
                            )}`
                        );
                    }
                }
            } else {
                if (verifyMode !== 'exact' || expectedCompletions.length > 0) {
                    assert.fail(`${markerName} - Failed to get completions`);
                }
            }

            if (map[markerName].memberAccessInfo !== undefined && result?.memberAccessInfo !== undefined) {
                const expectedModule = map[markerName].memberAccessInfo?.lastKnownModule;
                const expectedType = map[markerName].memberAccessInfo?.lastKnownMemberName;
                const expectedName = map[markerName].memberAccessInfo?.unknownMemberName;
                if (
                    result?.memberAccessInfo?.lastKnownModule !== expectedModule ||
                    result?.memberAccessInfo?.lastKnownMemberName !== expectedType ||
                    result?.memberAccessInfo?.unknownMemberName !== expectedName
                ) {
                    assert.fail(
                        `${markerName} - Expected completion results memberAccessInfo with \n    lastKnownModule: "${expectedModule}"\n    lastKnownMemberName: "${expectedType}"\n    unknownMemberName: "${expectedName}"\n  Actual memberAccessInfo:\n    lastKnownModule: "${
                            result.memberAccessInfo?.lastKnownModule ?? ''
                        }"\n    lastKnownMemberName: "${
                            result.memberAccessInfo?.lastKnownMemberName ?? ''
                        }\n    unknownMemberName: "${result.memberAccessInfo?.unknownMemberName ?? ''}" `
                    );
                }
            }
        }
    }

    verifySignature(
        docFormat: MarkupKind,
        map: {
            [marker: string]: {
                noSig?: boolean;
                signatures?: {
                    label: string;
                    parameters: string[];
                    documentation?: string;
                }[];
                activeParameters?: (number | undefined)[];
                callHasParameters?: boolean;
            };
        }
    ): void {
        this._analyze();

        for (const marker of this.getMarkers()) {
            const fileName = marker.fileName;
            const name = this.getMarkerName(marker);

            if (!(name in map)) {
                continue;
            }

            const expected = map[name];
            const position = this.convertOffsetToPosition(fileName, marker.position);

            const actual = this.program.getSignatureHelpForPosition(
                fileName,
                position,
                docFormat,
                CancellationToken.None
            );

            if (expected.noSig) {
                assert.equal(actual, undefined);
                continue;
            }

            assert.ok(actual);
            assert.ok(actual!.signatures);
            assert.ok(expected.activeParameters);
            assert.equal(actual!.signatures.length, expected.activeParameters.length);

            actual!.signatures.forEach((sig, index) => {
                const expectedSig = expected.signatures![index];
                assert.equal(sig.label, expectedSig.label);

                assert.ok(sig.parameters);
                const actualParameters: string[] = [];

                sig.parameters!.forEach((p) => {
                    actualParameters.push(sig.label.substring(p.startOffset, p.endOffset));
                });

                assert.deepEqual(actualParameters, expectedSig.parameters);

                if (expectedSig.documentation === undefined) {
                    assert.equal(sig.documentation, undefined);
                } else {
                    assert.deepEqual(sig.documentation, {
                        kind: docFormat,
                        value: expectedSig.documentation,
                    });
                }
            });

            assert.deepEqual(
                actual!.signatures.map((sig) => sig.activeParameter),
                expected.activeParameters
            );

            if (expected.callHasParameters !== undefined) {
                assert.equal(actual.callHasParameters, expected.callHasParameters);
            }
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

            const position = this.convertOffsetToPosition(fileName, marker.position);

            const actual: DocumentRange[] = [];
            this.program.reportReferencesForPosition(
                fileName,
                position,
                true,
                (locs) => actual.push(...locs),
                CancellationToken.None
            );

            assert.strictEqual(actual?.length ?? 0, expected.length, `${name} has failed`);

            for (const r of expected) {
                assert.equal(actual?.filter((d) => this._deepEqual(d, r)).length, 1);
            }
        }
    }

    getDocumentHighlightKind(m?: Marker): DocumentHighlightKind | undefined {
        const kind = m?.data ? ((m.data as any).kind as string) : undefined;
        switch (kind) {
            case 'text':
                return DocumentHighlightKind.Text;
            case 'read':
                return DocumentHighlightKind.Read;
            case 'write':
                return DocumentHighlightKind.Write;
            default:
                return undefined;
        }
    }

    verifyHighlightReferences(map: {
        [marker: string]: {
            references: DocumentHighlight[];
        };
    }) {
        this._analyze();

        for (const name of Object.keys(map)) {
            const marker = this.getMarkerByName(name);
            const fileName = marker.fileName;

            const expected = map[name].references;

            const position = this.convertOffsetToPosition(fileName, marker.position);
            const actual = this.program.getDocumentHighlight(fileName, position, CancellationToken.None);

            assert.equal(actual?.length ?? 0, expected.length);

            for (const r of expected) {
                const match = actual?.filter((h) => this._deepEqual(h.range, r.range));
                assert.equal(match?.length, 1);

                if (r.kind) {
                    assert.equal(match![0].kind, r.kind);
                }
            }
        }
    }

    verifyFindDefinitions(
        map: {
            [marker: string]: {
                definitions: DocumentRange[];
            };
        },
        filter: DefinitionFilter = DefinitionFilter.All
    ) {
        this._analyze();

        for (const marker of this.getMarkers()) {
            const fileName = marker.fileName;
            const name = this.getMarkerName(marker);

            if (!(name in map)) {
                continue;
            }

            const expected = map[name].definitions;

            const position = this.convertOffsetToPosition(fileName, marker.position);
            const actual = this.program.getDefinitionsForPosition(fileName, position, filter, CancellationToken.None);

            assert.equal(actual?.length ?? 0, expected.length);

            for (const r of expected) {
                assert.equal(actual?.filter((d) => this._deepEqual(d, r)).length, 1);
            }
        }
    }

    verifyFindTypeDefinitions(map: {
        [marker: string]: {
            definitions: DocumentRange[];
        };
    }) {
        this._analyze();

        for (const marker of this.getMarkers()) {
            const fileName = marker.fileName;
            const name = this.getMarkerName(marker);

            if (!(name in map)) {
                continue;
            }

            const expected = map[name].definitions;

            const position = this.convertOffsetToPosition(fileName, marker.position);
            const actual = this.program.getTypeDefinitionsForPosition(fileName, position, CancellationToken.None);

            assert.strictEqual(actual?.length ?? 0, expected.length, name);

            for (const r of expected) {
                assert.strictEqual(actual?.filter((d) => this._deepEqual(d, r)).length, 1, name);
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

            const position = this.convertOffsetToPosition(fileName, marker.position);
            const actual = this.program.renameSymbolAtPosition(
                fileName,
                position,
                expected.newName,
                /* isDefaultWorkspace */ false,
                CancellationToken.None
            );

            assert.equal(actual?.length ?? 0, expected.changes.length);

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

    private _convertGlobalOptionsToConfigOptions(
        globalOptions: CompilerSettings,
        mountPaths?: Map<string, string>
    ): ConfigOptions {
        const srtRoot: string = GlobalMetadataOptionNames.projectRoot;
        const projectRoot = normalizeSlashes(globalOptions[srtRoot] ?? vfs.MODULE_PATH);
        const configOptions = new ConfigOptions(projectRoot);

        // add more global options as we need them
        return this._applyTestConfigOptions(configOptions, mountPaths);
    }

    private _applyTestConfigOptions(configOptions: ConfigOptions, mountPaths?: Map<string, string>) {
        // Always enable "test mode".
        configOptions.internalTestMode = true;

        // Always analyze all files
        configOptions.checkOnlyOpenFiles = false;

        // make sure we set typing path
        if (configOptions.stubPath === undefined) {
            configOptions.stubPath = normalizePath(combinePaths(vfs.MODULE_PATH, 'typings'));
        }

        configOptions.include.push(getFileSpec(configOptions.projectRoot, '.'));
        configOptions.exclude.push(getFileSpec(configOptions.projectRoot, typeshedFolder));
        configOptions.exclude.push(getFileSpec(configOptions.projectRoot, distlibFolder));
        configOptions.exclude.push(getFileSpec(configOptions.projectRoot, libFolder));

        if (mountPaths) {
            for (const mountPath of mountPaths.keys()) {
                configOptions.exclude.push(getFileSpec(configOptions.projectRoot, mountPath));
            }
        }

        return configOptions;
    }

    private _getFileContent(fileName: string): string {
        const files = this.testData.files.filter(
            (f) => comparePaths(f.fileName, fileName, this.testFS.ignoreCase) === Comparison.EqualTo
        );
        return files[0].content;
    }

    protected convertPositionToOffset(fileName: string, position: Position): number {
        const lines = this._getTextRangeCollection(fileName);
        return convertPositionToOffset(position, lines)!;
    }

    protected convertOffsetToPosition(fileName: string, offset: number): Position {
        const lines = this._getTextRangeCollection(fileName);

        return convertOffsetToPosition(offset, lines);
    }

    protected convertOffsetsToRange(fileName: string, startOffset: number, endOffset: number): PositionRange {
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

    protected raiseError(message: string): never {
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

    protected createMultiMap<T>(values?: T[], getKey?: (t: T) => string): MultiMap<T> {
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

    protected _rangeText({ fileName, pos, end }: Range): string {
        return this._getFileContent(fileName).slice(pos, end);
    }

    private _getOnlyRange() {
        const ranges = this.getRanges();
        if (ranges.length !== 1) {
            this.raiseError('Exactly one range should be specified in the test file.');
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
            this.raiseError(
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
        const pos = this.convertPositionToOffset(this.activeFile.fileName, { line: index, character: 0 });
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
            this.convertOffsetToPosition(this.activeFile.fileName, this.currentCaretPosition).line
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

    private _tryFindFileWorker(name: string): {
        readonly file: FourSlashFile | undefined;
        readonly availableNames: readonly string[];
    } {
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
        const pos = this.convertOffsetToPosition(file.fileName, position);
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
                    information: diagnostics.filter((diag) => diag.category === DiagnosticCategory.Information),
                };
                return [filePath, value] as [string, typeof value];
            } else {
                this.raiseError(`Source file not found for ${this._files[index]}`);
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
        const service = new AnalyzerService(
            'test service',
            this.fs,
            nullConsole,
            () => testAccessHost,
            importResolverFactory,
            configOptions
        );

        // directly set files to track rather than using fileSpec from config
        // to discover those files from file system
        service.test_program.setTrackedFiles(
            this._files.filter((path) => {
                const fileExtension = getFileExtension(path).toLowerCase();
                return fileExtension === '.py' || fileExtension === '.pyi';
            })
        );

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
            await new Promise<void>((res) =>
                setTimeout(() => {
                    res();
                }, 200)
            );
        }
    }

    private _getCodeActions(range: Range) {
        const file = range.fileName;
        const textRange = {
            start: this.convertOffsetToPosition(file, range.pos),
            end: this.convertOffsetToPosition(file, range.end),
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
                this.raiseError(
                    `doesn't contain expected result: ${stringify(expected)}, actual: ${stringify(actual)}`
                );
            }
        }
    }

    private _editsAreEqual(actual: TextEdit | undefined, expected: TextEdit | undefined) {
        if (actual === expected) {
            return true;
        }

        if (actual === undefined || expected === undefined) {
            return false;
        }

        return rangesAreEqual(actual.range, expected.range) && actual.newText === expected.newText;
    }

    private _verifyEdit(actual: TextEdit | undefined, expected: TextEdit | undefined) {
        if (!this._editsAreEqual(actual, expected)) {
            this.raiseError(`doesn't contain expected result: ${stringify(expected)}, actual: ${stringify(actual)}`);
        }
    }

    private _verifyEdits(actual: TextEdit[] | undefined, expected: TextEdit[] | undefined) {
        actual = actual ?? [];
        expected = expected ?? [];

        let extra = expected.slice(0);
        let left = actual.slice(0);

        for (const item of actual) {
            extra = extra.filter((e) => !this._editsAreEqual(e, item));
        }

        for (const item of expected) {
            left = left.filter((e) => !this._editsAreEqual(e, item));
        }

        if (extra.length > 0 || left.length > 0) {
            this.raiseError(`doesn't contain expected result: ${stringify(extra)}, actual: ${stringify(left)}`);
        }
    }

    protected verifyCompletionItem(expected: _.FourSlashCompletionItem, actual: CompletionItem) {
        assert.strictEqual(actual.label, expected.label);
        assert.strictEqual(actual.detail, expected.detail);
        assert.strictEqual(actual.kind, expected.kind);

        assert.strictEqual(actual.insertText, expected.insertionText);
        this._verifyEdit(actual.textEdit as TextEdit, expected.textEdit);
        this._verifyEdits(actual.additionalTextEdits, expected.additionalTextEdits);
    }
}

export function parseAndGetTestState(code: string, projectRoot = '/', anonymousFileName = 'unnamedFile.py') {
    const data = parseTestData(normalizeSlashes(projectRoot), code, anonymousFileName);
    const state = new TestState(normalizeSlashes('/'), data);

    return { data, state };
}

export function getNodeForRange(codeOrState: string | TestState, markerName = 'marker'): ParseNode {
    const state = isString(codeOrState) ? parseAndGetTestState(codeOrState).state : codeOrState;
    const range = state.getRangeByMarkerName(markerName);
    assert(range);

    const textRange = TextRange.fromBounds(range.pos, range.end);

    const node = getNodeAtMarker(state, markerName);
    let current: ParseNode | undefined = node;
    while (current) {
        if (TextRange.containsRange(current, textRange)) {
            return current;
        }

        current = current.parent;
    }

    return node;
}

export function getNodeAtMarker(codeOrState: string | TestState, markerName = 'marker'): ParseNode {
    const state = isString(codeOrState) ? parseAndGetTestState(codeOrState).state : codeOrState;
    const marker = state.getMarkerByName(markerName);

    const sourceFile = state.program.getBoundSourceFile(marker.fileName);
    assert(sourceFile);

    const parserResults = sourceFile.getParseResults();
    assert(parserResults);

    const node = findNodeByOffset(parserResults.parseTree, marker.position);
    assert(node);

    return node;
}
