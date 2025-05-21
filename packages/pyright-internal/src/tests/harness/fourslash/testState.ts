/*
 * testState.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * TestState wraps currently test states and provides a way to query and manipulate
 * the test states.
 */

import assert from 'assert';
import * as path from 'path';
import {
    CancellationToken,
    CodeAction,
    Command,
    CompletionItem,
    CompletionList,
    Diagnostic,
    DocumentHighlight,
    DocumentHighlightKind,
    ExecuteCommandParams,
    Location,
    MarkupContent,
    MarkupKind,
    TextEdit,
    WorkspaceEdit,
} from 'vscode-languageserver';

import { BackgroundAnalysisProgramFactory, InvalidatedReason } from '../../../analyzer/backgroundAnalysisProgram';
import { ImportResolver, ImportResolverFactory } from '../../../analyzer/importResolver';
import { PackageTypeReport } from '../../../analyzer/packageTypeReport';
import { PackageTypeVerifier } from '../../../analyzer/packageTypeVerifier';
import { findNodeByOffset } from '../../../analyzer/parseTreeUtils';
import { Program } from '../../../analyzer/program';
import { AnalyzerService } from '../../../analyzer/service';
import { CommandResult } from '../../../commands/commandResult';
import { Char } from '../../../common/charCodes';
import { CommandLineOptions } from '../../../common/commandLineOptions';
import { ConfigOptions, SignatureDisplayType } from '../../../common/configOptions';
import { ConsoleInterface, ConsoleWithLogLevel, NullConsole } from '../../../common/console';
import { Comparison, isNumber, isString } from '../../../common/core';
import * as debug from '../../../common/debug';
import { DiagnosticCategory } from '../../../common/diagnostic';
import { DocumentRange } from '../../../common/docRange';
import { PyrightDocStringService } from '../../../common/docStringService';
import { FileEditAction } from '../../../common/editAction';
import { ReadOnlyFileSystem } from '../../../common/fileSystem';
import { Host } from '../../../common/host';
import { LanguageServerInterface } from '../../../common/languageServerInterface';
import { getFileExtension, normalizePath, normalizeSlashes } from '../../../common/pathUtils';
import { convertOffsetToPosition, convertPositionToOffset } from '../../../common/positionUtils';
import { ServiceProvider } from '../../../common/serviceProvider';
import { createServiceProvider } from '../../../common/serviceProviderExtensions';
import { compareStringsCaseInsensitive, compareStringsCaseSensitive } from '../../../common/stringUtils';
import { Position, Range as PositionRange, TextRange, rangesAreEqual } from '../../../common/textRange';
import { TextRangeCollection } from '../../../common/textRangeCollection';
import { Uri } from '../../../common/uri/uri';
import { UriEx, getFileSpec } from '../../../common/uri/uriUtils';
import { convertToWorkspaceEdit } from '../../../common/workspaceEditUtils';
import { CallHierarchyProvider } from '../../../languageService/callHierarchyProvider';
import { CompletionOptions, CompletionProvider } from '../../../languageService/completionProvider';
import {
    DefinitionFilter,
    DefinitionProvider,
    TypeDefinitionProvider,
} from '../../../languageService/definitionProvider';
import { DocumentHighlightProvider } from '../../../languageService/documentHighlightProvider';
import { CollectionResult } from '../../../languageService/documentSymbolCollector';
import { HoverProvider } from '../../../languageService/hoverProvider';
import { convertDocumentRangesToLocation } from '../../../languageService/navigationUtils';
import { ReferencesProvider } from '../../../languageService/referencesProvider';
import { RenameProvider } from '../../../languageService/renameProvider';
import { SignatureHelpProvider } from '../../../languageService/signatureHelpProvider';
import { ParseNode } from '../../../parser/parseNodes';
import { ParseFileResults } from '../../../parser/parser';
import { Tokenizer } from '../../../parser/tokenizer';
import { PartialStubService } from '../../../partialStubService';
import { PyrightFileSystem } from '../../../pyrightFileSystem';
import { NormalWorkspace, WellKnownWorkspaceKinds, Workspace, createInitStatus } from '../../../workspaceFactory';
import { TestAccessHost } from '../testAccessHost';
import * as host from '../testHost';
import { stringify } from '../utils';
import { createFromFileSystem, distlibFolder, libFolder, typeshedFolder } from '../vfs/factory';
import * as vfs from '../vfs/filesystem';
import { parseTestData } from './fourSlashParser';
import {
    FourSlashData,
    FourSlashFile,
    Marker,
    MetadataOptionNames,
    MultiMap,
    Range,
    TestCancellationToken,
} from './fourSlashTypes';
import { TestFeatures, TestLanguageService } from './testLanguageService';
import {
    createVfsInfoFromFourSlashData,
    getMarkerByName,
    getMarkerName,
    getMarkerNames,
    getRangeByMarkerName,
} from './testStateUtils';
import { verifyWorkspaceEdit } from './workspaceEditTestUtils';

export interface TextChange {
    span: TextRange;
    newText: string;
}

export interface HostSpecificFeatures {
    importResolverFactory: ImportResolverFactory;
    backgroundAnalysisProgramFactory: BackgroundAnalysisProgramFactory;

    getCodeActionsForPosition(
        workspace: Workspace,
        fileUri: Uri,
        range: PositionRange,
        token: CancellationToken
    ): Promise<CodeAction[]>;

    execute(ls: LanguageServerInterface, params: ExecuteCommandParams, token: CancellationToken): Promise<any>;
}

// Make sure everything is in lower case since it has hard coded `isCaseSensitive`: true.
const testAccessHost = new TestAccessHost(UriEx.file(vfs.MODULE_PATH), [libFolder, distlibFolder]);

export class TestState {
    private readonly _cancellationToken: TestCancellationToken;
    private readonly _vfsFiles: vfs.FileSet;
    protected readonly files: string[] = [];
    private readonly _hostSpecificFeatures: HostSpecificFeatures;

    readonly testFS: vfs.TestFileSystem;
    readonly fs: PyrightFileSystem;
    readonly workspace: NormalWorkspace;
    readonly console: ConsoleInterface;
    readonly rawConfigJson: any | undefined;
    readonly serviceProvider: ServiceProvider;

    // The current caret position in the active file
    currentCaretPosition = 0;
    // The position of the end of the current selection, or -1 if nothing is selected
    selectionEnd = -1;

    lastKnownMarker = '';

    // The file that's currently 'opened'
    activeFile!: FourSlashFile;

    constructor(
        projectRoot: string,
        public testData: FourSlashData,
        mountPaths?: Map<string, string>,
        hostSpecificFeatures?: HostSpecificFeatures,
        testFS?: vfs.TestFileSystem,
        // Setting delayFileInitialization to true enables derived class constructors to execute
        // before any files are opened. When set to true, initializeFiles() must be called separately
        // after construction completes.
        delayFileInitialization = false
    ) {
        const vfsInfo = createVfsInfoFromFourSlashData(projectRoot, testData);
        this._vfsFiles = vfsInfo.files;

        this.testFS =
            testFS ??
            createFromFileSystem(
                host.HOST,
                vfsInfo.ignoreCase,
                { cwd: vfsInfo.projectRoot, files: vfsInfo.files, meta: testData.globalOptions },
                mountPaths
            );

        this.fs = new PyrightFileSystem(this.testFS);
        this.console = new ConsoleWithLogLevel(new NullConsole(), 'test');
        const ps = new PartialStubService(this.fs);
        this.serviceProvider = createServiceProvider(this.testFS, this.fs, this.console, ps);

        this._cancellationToken = new TestCancellationToken();
        this._hostSpecificFeatures = hostSpecificFeatures ?? new TestFeatures();

        this.files = vfsInfo.sourceFileNames;

        this.rawConfigJson = vfsInfo.rawConfigJson;
        const configOptions = this._convertGlobalOptionsToConfigOptions(vfsInfo.projectRoot, mountPaths);

        if (this.rawConfigJson) {
            const configDirUri = Uri.file(projectRoot, this.serviceProvider);
            configOptions.initializeTypeCheckingMode('standard');
            configOptions.initializeFromJson(this.rawConfigJson, configDirUri, this.serviceProvider, testAccessHost);
            configOptions.setupExecutionEnvironments(this.rawConfigJson, configDirUri, this.serviceProvider.console());
            this._applyTestConfigOptions(configOptions);
        }

        const service = this.createAnalysisService(
            this.console,
            this._hostSpecificFeatures.importResolverFactory,
            this._hostSpecificFeatures.backgroundAnalysisProgramFactory,
            configOptions,
            testAccessHost
        );

        this.workspace = {
            workspaceName: 'test workspace',
            rootUri: Uri.file(vfsInfo.projectRoot, this.serviceProvider),
            kinds: [WellKnownWorkspaceKinds.Test],
            service: service,
            disableLanguageServices: false,
            disableTaggedHints: false,
            disableOrganizeImports: false,
            disableWorkspaceSymbol: false,
            isInitialized: createInitStatus(),
            searchPathsToWatch: [],
        };

        if (!delayFileInitialization) {
            this.initializeFiles();
        }
    }

    get importResolver(): ImportResolver {
        return this.workspace.service.getImportResolver();
    }

    get configOptions(): ConfigOptions {
        return this.workspace.service.getConfigOptions();
    }

    get program(): Program {
        return this.workspace.service.test_program;
    }

    // eslint-disable-next-line @typescript-eslint/naming-convention
    get BOF(): number {
        return 0;
    }

    // eslint-disable-next-line @typescript-eslint/naming-convention
    get EOF(): number {
        return this.getFileContent(this.activeFile.fileName).length;
    }

    initializeFiles() {
        if (this.files.length > 0) {
            // Open the first file by default
            this.openFile(this.files[0]);
        }

        for (const filePath of this.files) {
            const file = this._vfsFiles[filePath] as vfs.File;
            if (file.meta?.[MetadataOptionNames.ipythonMode]) {
                this.program.getSourceFile(Uri.file(filePath, this.serviceProvider))?.test_enableIPythonMode(true);
            }
            if (file.meta?.[MetadataOptionNames.chainedTo]) {
                const chainedTo = file.meta[MetadataOptionNames.chainedTo] as string;
                const to = this.program.getSourceFile(Uri.file(chainedTo, this.serviceProvider));
                if (to) {
                    this.program.updateChainedUri(Uri.file(filePath, this.serviceProvider), to.getUri());
                }
            }
        }
    }

    dispose() {
        this.workspace.service.dispose();
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

        const content = this.getFileContent(marker.fileName);
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
        const uri = Uri.file(path, this.serviceProvider);
        this.importResolver.ensurePartialStubPackages(this.configOptions.findExecEnvironment(uri));
        return this.fs.getMappedUri(uri).getFilePath();
    }

    getMarkerName(m: Marker): string {
        return getMarkerName(this.testData, m);
    }

    getMarkerByName(markerName: string) {
        return getMarkerByName(this.testData, markerName);
    }

    getMarkers(): Marker[] {
        //  Return a copy of the list
        return this.testData.markers.slice(0);
    }

    getMarkerNames(): string[] {
        return getMarkerNames(this.testData);
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

    getPosition(markerString: string): Position {
        const marker = this.getMarkerByName(markerString);
        const ranges = this.getRanges().filter((r) => r.marker === marker);
        if (ranges.length !== 1) {
            this.raiseError(`no matching range for ${markerString}`);
        }
        return this.convertOffsetToPosition(marker.fileName, marker.position);
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

    getPathSep() {
        return path.sep;
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
        this.selectRange({
            fileName: this.activeFile.fileName,
            fileUri: this.activeFile.fileUri,
            pos: lineStart,
            end: lineEnd,
        });
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
        const result = this.createMultiMap<Range>(this.getRanges(), (r) => this.rangeText(r));
        this.testData.rangesByText = result;

        return result;
    }

    getFilteredRanges<T extends {}>(
        predicate: (m: Marker | undefined, d: T | undefined, text: string) => boolean
    ): Range[] {
        return this.getRanges().filter((r) => predicate(r.marker, r.marker?.data as T | undefined, this.rangeText(r)));
    }

    getRangeByMarkerName(markerName: string): Range | undefined {
        return getRangeByMarkerName(this.testData, markerName);
    }

    goToBOF() {
        this.goToPosition(this.BOF);
    }

    goToEOF() {
        this.goToPosition(this.EOF);
    }

    moveCaretRight(count = 1) {
        this.currentCaretPosition += count;
        this.currentCaretPosition = Math.min(
            this.currentCaretPosition,
            this.getFileContent(this.activeFile.fileName).length
        );
        this.selectionEnd = -1;
    }

    // Opens a file given its 0-based index or fileName
    openFile(indexOrName: number | string): FourSlashFile {
        const fileToOpen: FourSlashFile = this.findFile(indexOrName);
        fileToOpen.fileName = normalizeSlashes(fileToOpen.fileName);
        this.activeFile = fileToOpen;

        this.program.setFileOpened(this.activeFile.fileUri, 1, fileToOpen.content);

        return fileToOpen;
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
            let content = this.getFileContent(file.fileName);
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
        this.analyze();

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
            if (!result.parseResults) {
                this.raiseError(`parse results not found for ${file}`);
            }
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
                        : category === 'unused'
                        ? result.unused
                        : category === 'none'
                        ? []
                        : this.raiseError(`unexpected category ${category}`);

                if (expected.length !== actual.length && category !== 'none') {
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

                    // If the map is provided, it might say
                    // a marker should have none.
                    const name = map ? this.getMarkerName(range.marker!) : '';
                    const message = map ? map[name].message : undefined;
                    const expectMatches = !!message;

                    if (expectMatches && matches.length === 0) {
                        this.raiseError(`doesn't contain expected range: ${stringify(range)}`);
                    } else if (!expectMatches && matches.length !== 0) {
                        this.raiseError(`${name} should not contain any matches`);
                    }

                    // if map is provided, check message as well
                    if (message) {
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
                    fileUri: Uri;
                    parseResults: ParseFileResults | undefined;
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
        verifyMode: _.FourSlashVerificationMode,
        map: {
            [marker: string]: {
                codeActions: { title: string; kind: string; command?: Command; edit?: WorkspaceEdit }[];
            };
        }
    ): Promise<any> {
        // make sure we don't use cache built from other tests
        this.workspace.service.invalidateAndForceReanalysis(InvalidatedReason.Reanalyzed);
        this.analyze();

        // calling `analyze` should have parse and bind all or open user files. make sure that's true at least for open files.
        for (const info of this.program.getOpened()) {
            if (!info.sourceFile.getModuleSymbolTable()) {
                this.console.error(`Module symbol missing?: ${info.uri}, bound: ${!info.sourceFile.isBindingRequired}`);

                // Make sure it is bound.
                this.program.getBoundSourceFile(info.uri);
            }
        }

        // Local copy to use in capture.
        const serviceProvider = this.serviceProvider;
        for (const range of this.getRanges()) {
            const name = this.getMarkerName(range.marker!);
            if (!map[name]) {
                continue;
            }

            const uri = Uri.file(range.fileName, this.serviceProvider);
            const sourceFile = this.program.getSourceFile(uri);
            if (!sourceFile) {
                this.raiseError(`source file not found: ${range.fileName}`);
            }
            const diagnostics = sourceFile.getDiagnostics(this.configOptions) || [];

            const codeActions = await this._getCodeActions(range);
            if (verifyMode === 'exact') {
                if (codeActions.length !== map[name].codeActions.length) {
                    this.raiseError(
                        `doesn't contain expected result: ${stringify(map[name])}, actual: ${stringify(codeActions)}`
                    );
                }
            }

            for (const expected of map[name].codeActions) {
                let expectedCommand: Command | undefined;
                if (expected.command) {
                    expectedCommand = {
                        title: expected.command.title,
                        command: expected.command.command,
                        arguments: convertToString(expected.command.arguments),
                    };
                }

                const matches = codeActions.filter((a) => {
                    const actualCommand = a.command
                        ? {
                              title: a.command.title,
                              command: a.command.command,
                              arguments: convertToString(a.command.arguments),
                          }
                        : undefined;

                    const actualEdit = a.edit;

                    return (
                        a.title === expected.title &&
                        a.kind! === expected.kind &&
                        (expectedCommand ? this._deepEqual(actualCommand, expectedCommand) : true) &&
                        (expected.edit ? this._deepEqual(actualEdit, expected.edit) : true)
                    );
                });

                if (verifyMode === 'excluded' && matches.length > 0) {
                    this.raiseError(`unexpected result: ${stringify(map[name])}`);
                } else if (verifyMode !== 'excluded' && matches.length !== 1) {
                    const uri = Uri.file('test2.py', this.serviceProvider);
                    const sourceFile = this.program.getSourceFile(uri);
                    const symbolsInTest2 = sourceFile
                        ? ', symbols in test2.py: ' +
                          Array.from(sourceFile.getModuleSymbolTable()?.keys() ?? []).join(',')
                        : '';

                    this.raiseError(
                        `doesn't contain expected result: ${stringify(expected)}, actual: ${stringify(
                            codeActions
                        )}, diagnostics: ${stringify(diagnostics)}${symbolsInTest2}`
                    );
                }
            }
        }

        function convertToString(args: any[] | undefined): string[] | undefined {
            if (args) {
                // Trim `undefined` from the args.
                while (args.length > 0) {
                    if (args[args.length - 1] === undefined) {
                        args.pop();
                    } else {
                        break;
                    }
                }
            }

            return args?.map((a) => {
                if (isString(a)) {
                    // Might be a URI. For comparison purposes in a test, convert it into a
                    // file path.
                    if (a.startsWith('file://')) {
                        return normalizeSlashes(Uri.parse(a, serviceProvider).getFilePath());
                    }
                    return normalizeSlashes(a);
                }

                return JSON.stringify(a);
            });
        }
    }

    async verifyCommand(command: Command, files: { [filePath: string]: string }): Promise<any> {
        this.analyze();

        // Convert command arguments to file Uri strings. That's the expected input for command arguments.
        const convertedArgs = command.arguments?.map((arg) => {
            if (typeof arg === 'string' && (arg.endsWith('.py') || arg.endsWith('.pyi'))) {
                return Uri.file(arg, this.serviceProvider).toString();
            }
            return arg;
        });
        command.arguments = convertedArgs;

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

    verifyWorkspaceEdit(expected: WorkspaceEdit, actual: WorkspaceEdit, marker?: string) {
        return verifyWorkspaceEdit(expected, actual, marker);
    }

    async verifyInvokeCodeAction(
        map: {
            [marker: string]: { title: string; files?: { [filePath: string]: string }; edits?: TextEdit[] };
        },
        verifyCodeActionCount?: boolean
    ): Promise<any> {
        this.analyze();

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
                        `doesn't contain expected result count: ${stringify(map[name])}, actual: ${stringify(
                            codeActions
                        )}`
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
                    const workspaceEdits = CommandResult.is(results) ? results.edits : (results as WorkspaceEdit);
                    for (const edits of Object.values(workspaceEdits.changes!)) {
                        for (const edit of edits) {
                            if (map[name].edits!.filter((e) => this._editsAreEqual(e, edit)).length !== 1) {
                                this.raiseError(
                                    `${name} doesn't contain expected result: ${stringify(
                                        map[name]
                                    )}, actual: ${stringify(edits)}`
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

    verifyHover(kind: MarkupKind, map: { [marker: string]: string | null }): void {
        // Do not force analyze, it can lead to test passing while it doesn't work in product
        for (const range of this.getRanges()) {
            const name = this.getMarkerName(range.marker!);
            const expected = map[name];
            if (expected === undefined) {
                continue;
            }

            const rangePos = this.convertOffsetsToRange(range.fileName, range.pos, range.end);
            const provider = new HoverProvider(
                this.program,
                range.fileUri,
                rangePos.start,
                kind,
                CancellationToken.None
            );
            const actual = provider.getHover();

            // if expected is null then there should be nothing shown on hover
            if (expected === null) {
                assert.equal(actual, undefined);
                continue;
            }

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
        const actual = this.getFileContent(this.activeFile.fileName).substring(
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
        this._verifyTextMatches(this.rangeText(this._getOnlyRange()), !!includeWhiteSpace, expectedText);
    }

    async verifyCompletion(
        verifyMode: _.FourSlashVerificationMode,
        docFormat: MarkupKind,
        map: {
            [marker: string]: {
                completions: _.FourSlashCompletionItem[];
            };
        },
        abbrMap?: {
            [abbr: string]: {
                readonly importFrom?: string;
                readonly importName: string;
            };
        }
    ): Promise<void> {
        this.analyze();

        for (const marker of this.getMarkers()) {
            const markerName = this.getMarkerName(marker);
            if (!map[markerName]) {
                continue;
            }

            this.lastKnownMarker = markerName;

            const expectedCompletions = map[markerName].completions;
            const provider = this.getCompletionResults(this, marker, docFormat, abbrMap);
            const results = provider.getCompletions();
            if (results) {
                if (verifyMode === 'exact') {
                    if (results.items.length !== expectedCompletions.length) {
                        assert.fail(
                            `${markerName} - Expected ${expectedCompletions.length} items but received ${
                                results.items.length
                            }. Actual completions:\n${stringify(results.items.map((r) => r.label))}`
                        );
                    }
                }

                for (let i = 0; i < expectedCompletions.length; i++) {
                    const expected = expectedCompletions[i];
                    const actualIndex = results.items.findIndex(
                        (a) =>
                            a.label === expected.label &&
                            (expected.kind ? a.kind === expected.kind : true) &&
                            (expected.detail ? a.detail === expected.detail : true) &&
                            (expected.documentation && MarkupContent.is(a.documentation)
                                ? a.documentation.value === expected.documentation
                                : true)
                    );
                    if (actualIndex >= 0) {
                        if (verifyMode === 'excluded') {
                            // we're not supposed to find the completions passed to the test
                            assert.fail(
                                `${markerName} - Completion item with label "${
                                    expected.label
                                }" unexpected. Actual completions:\n${stringify(results.items.map((r) => r.label))}`
                            );
                        }

                        const actual: CompletionItem = results.items[actualIndex];

                        if (expected.additionalTextEdits !== undefined) {
                            if (actual.additionalTextEdits === undefined) {
                                provider.resolveCompletionItem(actual);
                            }
                        }

                        this.verifyCompletionItem(expected, actual);

                        if (expected.documentation !== undefined) {
                            if (actual.documentation === undefined && actual.data) {
                                provider.resolveCompletionItem(actual);
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

                        results.items.splice(actualIndex, 1);
                    } else {
                        if (verifyMode === 'included' || verifyMode === 'exact') {
                            // we're supposed to find all items passed to the test
                            assert.fail(
                                `${markerName} - Completion item with label "${
                                    expected.label
                                }" expected. Actual completions:\n${stringify(results.items.map((r) => r.label))}`
                            );
                        }
                    }
                }

                if (verifyMode === 'exact') {
                    if (results.items.length !== 0) {
                        // we removed every item we found, there should not be any remaining
                        assert.fail(
                            `${markerName} - Completion items unexpected: ${stringify(
                                results.items.map((r) => r.label)
                            )}`
                        );
                    }
                }
            } else {
                if (verifyMode !== 'exact' || expectedCompletions.length > 0) {
                    assert.fail(`${markerName} - Failed to get completions`);
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
        this.analyze();

        for (const marker of this.getMarkers()) {
            const fileName = marker.fileName;
            const name = this.getMarkerName(marker);

            if (!(name in map)) {
                continue;
            }

            const expected = map[name];
            const position = this.convertOffsetToPosition(fileName, marker.position);

            const actual = new SignatureHelpProvider(
                this.program,
                Uri.file(fileName, this.serviceProvider),
                position,
                docFormat,
                /* hasSignatureLabelOffsetCapability */ true,
                /* hasActiveParameterCapability */ true,
                /* context */ undefined,
                new PyrightDocStringService(),
                CancellationToken.None
            ).getSignatureHelp();

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
                    actualParameters.push(isString(p.label) ? p.label : sig.label.substring(p.label[0], p.label[1]));
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
                const isActive = (sig: { parameters: string[] }) =>
                    !expected.callHasParameters && !sig.parameters?.length;

                const activeSignature = expected.signatures?.findIndex(isActive) ?? undefined;
                assert.equal(actual.activeSignature, activeSignature);
            }
        }
    }

    verifyFindAllReferences(
        map: {
            [marker: string]: {
                references: DocumentRange[];
            };
        },
        createDocumentRange?: (fileUri: Uri, result: CollectionResult, parseResults: ParseFileResults) => DocumentRange,
        convertToLocation?: (fs: ReadOnlyFileSystem, ranges: DocumentRange) => Location | undefined
    ) {
        this.analyze();

        for (const name of this.getMarkerNames()) {
            const marker = this.getMarkerByName(name);
            const fileName = marker.fileName;

            if (!(name in map)) {
                continue;
            }

            let expected = map[name].references;
            expected = expected.map((c) => {
                return {
                    ...c,
                    uri: c.uri ?? Uri.file((c as any).path, this.serviceProvider),
                };
            });

            const position = this.convertOffsetToPosition(fileName, marker.position);

            const actual = new ReferencesProvider(
                this.program,
                CancellationToken.None,
                createDocumentRange,
                convertToLocation
            ).reportReferences(Uri.file(fileName, this.serviceProvider), position, /* includeDeclaration */ true);
            assert.strictEqual(actual?.length ?? 0, expected.length, `${name} has failed`);

            for (const r of convertDocumentRangesToLocation(this.program.fileSystem, expected, convertToLocation)) {
                assert.equal(actual?.filter((d) => this._deepEqual(d, r)).length, 1);
            }
        }
    }

    verifyShowCallHierarchyGetIncomingCalls(map: {
        [marker: string]: {
            items: _.FourSlashCallHierarchyItem[];
        };
    }) {
        this.analyze();

        for (const marker of this.getMarkers()) {
            const fileName = marker.fileName;
            const name = this.getMarkerName(marker);

            if (!(name in map)) {
                continue;
            }

            const expectedFilePath = map[name].items.map((x) => x.filePath);
            const expectedRange = map[name].items.map((x) => x.range);
            const expectedName = map[name].items.map((x) => x.name);

            const position = this.convertOffsetToPosition(fileName, marker.position);
            const actual = new CallHierarchyProvider(
                this.program,
                Uri.file(fileName, this.serviceProvider),
                position,
                CancellationToken.None
            ).getIncomingCalls();

            assert.strictEqual(actual?.length ?? 0, expectedFilePath.length, `${name} has failed`);
            assert.strictEqual(actual?.length ?? 0, expectedRange.length, `${name} has failed`);
            assert.strictEqual(actual?.length ?? 0, expectedName.length, `${name} has failed`);

            if (actual) {
                for (const a of actual) {
                    assert.strictEqual(expectedRange?.filter((e) => this._deepEqual(a.from.range, e)).length, 1);
                    assert.strictEqual(expectedName?.filter((e) => this._deepEqual(a.from.name, e)).length, 1);
                    assert.ok(
                        expectedFilePath?.filter((e) =>
                            this._deepEqual(a.from.uri, Uri.file(e, this.serviceProvider).toString())
                        ).length >= 1
                    );
                }
            }
        }
    }

    verifyShowCallHierarchyGetOutgoingCalls(map: {
        [marker: string]: {
            items: _.FourSlashCallHierarchyItem[];
        };
    }) {
        this.analyze();

        for (const marker of this.getMarkers()) {
            const fileName = marker.fileName;
            const name = this.getMarkerName(marker);

            if (!(name in map)) {
                continue;
            }

            const expectedFilePath = map[name].items.map((x) => x.filePath);
            const expectedRange = map[name].items.map((x) => x.range);
            const expectedName = map[name].items.map((x) => x.name);

            const position = this.convertOffsetToPosition(fileName, marker.position);
            const actual = new CallHierarchyProvider(
                this.program,
                Uri.file(fileName, this.serviceProvider),
                position,
                CancellationToken.None
            ).getOutgoingCalls();

            assert.strictEqual(actual?.length ?? 0, expectedFilePath.length, `${name} has failed`);
            assert.strictEqual(actual?.length ?? 0, expectedRange.length, `${name} has failed`);
            assert.strictEqual(actual?.length ?? 0, expectedName.length, `${name} has failed`);
            if (actual) {
                for (const a of actual) {
                    assert.strictEqual(expectedRange?.filter((e) => this._deepEqual(a.to.range, e)).length, 1);
                    assert.strictEqual(expectedName?.filter((e) => this._deepEqual(a.to.name, e)).length, 1);
                    assert.ok(
                        expectedFilePath?.filter((e) =>
                            this._deepEqual(a.to.uri, Uri.file(e, this.serviceProvider).toString())
                        ).length >= 1
                    );
                }
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
        this.analyze();

        for (const name of Object.keys(map)) {
            const marker = this.getMarkerByName(name);
            const fileName = marker.fileName;

            const expected = map[name].references;

            const position = this.convertOffsetToPosition(fileName, marker.position);
            const actual = new DocumentHighlightProvider(
                this.program,
                Uri.file(fileName, this.serviceProvider),
                position,
                CancellationToken.None
            ).getDocumentHighlight();

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

    fixupDefinitionsToMatchExpected(actual: DocumentRange[] | undefined): any {
        return actual?.map((a) => {
            const { uri, ...restOfActual } = a;
            return {
                ...restOfActual,
                path: uri.getFilePath(),
            };
        });
    }

    verifyFindDefinitions(
        map: {
            [marker: string]: {
                definitions: DocumentRange[];
            };
        },
        filter: DefinitionFilter = DefinitionFilter.All
    ) {
        this.analyze();

        for (const marker of this.getMarkers()) {
            const fileName = marker.fileName;
            const name = this.getMarkerName(marker);

            if (!(name in map)) {
                continue;
            }

            const expected = map[name].definitions;
            const uri = Uri.file(fileName, this.serviceProvider);
            // If we're going to def from a file, act like it's open.
            if (!this.program.getSourceFileInfo(uri)) {
                const file = this.testData.files.find((v) => v.fileName === fileName);
                if (file) {
                    this.program.setFileOpened(uri, file.version, file.content);
                }
            }

            const position = this.convertOffsetToPosition(fileName, marker.position);
            let actual = new DefinitionProvider(
                this.program,
                uri,
                position,
                filter,
                CancellationToken.None
            ).getDefinitions();

            assert.equal(actual?.length ?? 0, expected.length, `No definitions found for marker "${name}"`);
            actual = this.fixupDefinitionsToMatchExpected(actual!);

            for (const r of expected) {
                assert.equal(
                    actual?.filter((d) => this._deepEqual(d, r)).length,
                    1,
                    `No match found for ${JSON.stringify(r)} from marker ${name}`
                );
            }
        }
    }

    verifyFindTypeDefinitions(map: {
        [marker: string]: {
            definitions: DocumentRange[];
        };
    }) {
        this.analyze();

        for (const marker of this.getMarkers()) {
            const fileName = marker.fileName;
            const name = this.getMarkerName(marker);

            if (!(name in map)) {
                continue;
            }

            const expected = map[name].definitions;

            const position = this.convertOffsetToPosition(fileName, marker.position);
            let actual = new TypeDefinitionProvider(
                this.program,
                Uri.file(fileName, this.serviceProvider),
                position,
                CancellationToken.None
            ).getDefinitions();
            actual = this.fixupDefinitionsToMatchExpected(actual!);

            assert.strictEqual(actual?.length ?? 0, expected.length, name);

            for (const r of expected) {
                assert.strictEqual(actual?.filter((d) => this._deepEqual(d, r)).length, 1, name);
            }
        }
    }

    verifyRename(
        map: {
            [marker: string]: {
                newName: string;
                changes: FileEditAction[];
            };
        },
        isUntitled = false
    ) {
        this.analyze();

        for (const marker of this.getMarkers()) {
            const fileName = marker.fileName;
            const name = this.getMarkerName(marker);

            if (!(name in map)) {
                continue;
            }

            const expected = map[name];
            expected.changes = expected.changes.map((c) => {
                return {
                    ...c,
                    fileUri: c.fileUri ?? Uri.file((c as any).filePath, this.serviceProvider),
                };
            });

            const position = this.convertOffsetToPosition(fileName, marker.position);
            const actual = new RenameProvider(
                this.program,
                isUntitled
                    ? Uri.parse(`untitled:${fileName.replace(/\\/g, '/')}`, this.serviceProvider)
                    : Uri.file(fileName, this.serviceProvider),
                position,
                CancellationToken.None
            ).renameSymbol(expected.newName, /* isDefaultWorkspace */ false, isUntitled);

            verifyWorkspaceEdit(
                convertToWorkspaceEdit(this.program.fileSystem, { edits: expected.changes, fileOperations: [] }),
                actual ?? { documentChanges: [] }
            );
        }
    }

    verifyTypeVerifierResults(
        packageName: string,
        ignoreUnknownTypesFromImports: boolean,
        verboseOutput: boolean,
        expected: PackageTypeReport
    ) {
        const commandLineOptions = new CommandLineOptions(
            this.configOptions.projectRoot.getFilePath(),
            /* fromLanguageServer */ false
        );
        commandLineOptions.configSettings.verboseOutput = verboseOutput;
        const verifier = new PackageTypeVerifier(
            this.serviceProvider,
            testAccessHost,
            commandLineOptions,
            packageName,
            ignoreUnknownTypesFromImports
        );
        const report = verifier.verify();

        assert.strictEqual(report.generalDiagnostics.length, expected.generalDiagnostics.length);
        assert.strictEqual(report.missingClassDocStringCount, expected.missingClassDocStringCount);
        assert.strictEqual(report.missingDefaultParamCount, expected.missingDefaultParamCount);
        assert.strictEqual(report.missingFunctionDocStringCount, expected.missingFunctionDocStringCount);
        assert.strictEqual(report.moduleName, expected.moduleName);
        assert.strictEqual(report.packageName, expected.packageName);
        assert.deepStrictEqual(Array.from(report.symbols.keys()), Array.from(expected.symbols.keys()));
    }

    setCancelled(numberOfCalls: number): void {
        this._cancellationToken.setCancelled(numberOfCalls);
    }

    resetCancelled(): void {
        this._cancellationToken.resetCancelled();
    }

    convertPositionToOffset(fileName: string, position: Position): number {
        const lines = this._getTextRangeCollection(fileName);
        return convertPositionToOffset(position, lines)!;
    }

    convertOffsetToPosition(fileName: string, offset: number): Position {
        const lines = this._getTextRangeCollection(fileName);

        return convertOffsetToPosition(offset, lines);
    }

    analyze() {
        while (this.program.analyze()) {
            // Continue to call analyze until it completes. Since we're not
            // specifying a timeout, it should complete the first time.
        }
    }

    protected findFile(indexOrName: string | number): FourSlashFile {
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

    protected getCompletionResults(
        state: TestState,
        marker: Marker,
        docFormat: MarkupKind,
        abbrMap?: {
            [abbr: string]: {
                readonly importFrom?: string;
                readonly importName: string;
            };
        }
    ): { getCompletions(): CompletionList | null; resolveCompletionItem(item: CompletionItem): void } {
        const filePath = marker.fileName;
        const completionPosition = this.convertOffsetToPosition(filePath, marker.position);

        const options: CompletionOptions = {
            format: docFormat,
            snippet: true,
            lazyEdit: false,
        };

        const provider = new CompletionProvider(
            this.program,
            Uri.file(filePath, this.serviceProvider),
            completionPosition,
            options,
            CancellationToken.None
        );

        return {
            getCompletions: () => provider.getCompletions(),
            resolveCompletionItem: (i) => provider.resolveCompletionItem(i),
        };
    }

    protected getFileContent(fileName: string): string {
        const files = this.testData.files.filter((f) =>
            this.testFS.ignoreCase
                ? compareStringsCaseInsensitive(f.fileName, fileName) === Comparison.EqualTo
                : compareStringsCaseSensitive(f.fileName, fileName) === Comparison.EqualTo
        );
        return files[0].content;
    }

    protected convertOffsetsToRange(fileName: string, startOffset: number, endOffset: number): PositionRange {
        const lines = this._getTextRangeCollection(fileName);

        return {
            start: convertOffsetToPosition(startOffset, lines),
            end: convertOffsetToPosition(endOffset, lines),
        };
    }

    protected raiseError(message: string): never {
        throw new Error(this._messageAtLastKnownMarker(message));
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

    protected rangeText({ fileName, pos, end }: Range): string {
        return this.getFileContent(fileName).slice(pos, end);
    }

    protected verifyCompletionItem(expected: _.FourSlashCompletionItem, actual: CompletionItem) {
        assert.strictEqual(actual.label, expected.label);
        assert.strictEqual(actual.detail, expected.detail);
        assert.strictEqual(actual.kind, expected.kind);

        assert.strictEqual(actual.insertText, expected.insertionText);
        this._verifyEdit(actual.textEdit as TextEdit, expected.textEdit);
        this._verifyEdits(actual.additionalTextEdits, expected.additionalTextEdits);

        if (expected.detailDescription !== undefined) {
            assert.strictEqual(actual.labelDetails?.description, expected.detailDescription);
        }

        if (expected.commitCharacters !== undefined) {
            expect(expected.commitCharacters.sort()).toEqual(actual.commitCharacters?.sort() ?? []);
        }
    }

    protected createAnalysisService(
        nullConsole: ConsoleInterface,
        importResolverFactory: ImportResolverFactory,
        backgroundAnalysisProgramFactory: BackgroundAnalysisProgramFactory,
        configOptions: ConfigOptions,
        host: Host
    ) {
        // we do not initiate automatic analysis or file watcher in test.
        const service = new AnalyzerService('test service', this.serviceProvider, {
            console: nullConsole,
            hostFactory: () => host,
            importResolverFactory,
            backgroundAnalysisProgramFactory,
            configOptions,
            fileSystem: this.fs,
            libraryReanalysisTimeProvider: () => 0,
        });

        // directly set files to track rather than using fileSpec from config
        // to discover those files from file system
        service.test_program.setTrackedFiles(
            this.files
                .filter((path) => {
                    const fileExtension = getFileExtension(path).toLowerCase();
                    return fileExtension === '.py' || fileExtension === '.pyi';
                })
                .map((path) => Uri.file(path, this.serviceProvider))
                .filter((path) => service.isTracked(path))
        );

        return service;
    }

    private _convertGlobalOptionsToConfigOptions(projectRoot: string, mountPaths?: Map<string, string>): ConfigOptions {
        const configOptions = new ConfigOptions(Uri.file(projectRoot, this.serviceProvider));

        // add more global options as we need them
        const newConfigOptions = this._applyTestConfigOptions(configOptions, mountPaths);

        // default tests to run use compact signatures.
        newConfigOptions.functionSignatureDisplay = SignatureDisplayType.compact;

        return newConfigOptions;
    }

    private _applyTestConfigOptions(configOptions: ConfigOptions, mountPaths?: Map<string, string>) {
        // Always enable "test mode".
        configOptions.internalTestMode = true;

        // Always analyze all files
        configOptions.checkOnlyOpenFiles = false;

        // make sure we set typing path
        if (configOptions.stubPath === undefined) {
            configOptions.stubPath = Uri.file(vfs.MODULE_PATH, this.serviceProvider).combinePaths('typings');
        }

        configOptions.include.push(getFileSpec(configOptions.projectRoot, '.'));
        configOptions.exclude.push(getFileSpec(configOptions.projectRoot, typeshedFolder.getFilePath()));
        configOptions.exclude.push(getFileSpec(configOptions.projectRoot, distlibFolder.getFilePath()));
        configOptions.exclude.push(getFileSpec(configOptions.projectRoot, libFolder.getFilePath()));

        if (mountPaths) {
            for (const mountPath of mountPaths.keys()) {
                configOptions.exclude.push(getFileSpec(configOptions.projectRoot, mountPath));
            }
        }

        if (configOptions.functionSignatureDisplay === undefined) {
            configOptions.functionSignatureDisplay === SignatureDisplayType.compact;
        }

        return configOptions;
    }

    private _getParserOutput(fileName: string) {
        const file = this.program.getBoundSourceFile(Uri.file(fileName, this.serviceProvider))!;
        return file?.getParseResults();
    }

    private _getTextRangeCollection(fileName: string): TextRangeCollection<TextRange> {
        if (this.files.includes(fileName)) {
            const tokenizerOutput = this._getParserOutput(fileName)?.tokenizerOutput;
            if (tokenizerOutput) {
                return tokenizerOutput.lines;
            }
        }

        // slow path
        const fileContents = this.fs.readFileSync(Uri.file(fileName, this.serviceProvider), 'utf8');
        const tokenizer = new Tokenizer();
        return tokenizer.tokenize(fileContents).lines;
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
        let fileContent = this.getFileContent(fileName);
        fileContent = fileContent.slice(0, editStart) + newText + fileContent.slice(editEnd);
        const uri = Uri.file(fileName, this.serviceProvider);

        this.testFS.writeFileSync(uri, fileContent, 'utf8');
        const newVersion = (this.program.getSourceFile(uri)?.getClientVersion() ?? -1) + 1;
        this.program.setFileOpened(uri, newVersion, fileContent);

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

    private _getOnlyRange() {
        const ranges = this.getRanges();
        if (ranges.length !== 1) {
            this.raiseError('Exactly one range should be specified in the test file.');
        }

        return ranges[0];
    }

    private _verifyFileContent(fileName: string, text: string) {
        const actual = this.getFileContent(fileName);
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
        const text = this.getFileContent(this.activeFile.fileName);
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

    private _getDiagnosticsPerFile() {
        const sourceFiles = this.files.map((f) => this.program.getSourceFile(Uri.file(f, this.serviceProvider)));
        const results = sourceFiles.map((sourceFile, index) => {
            if (sourceFile) {
                const diagnostics = sourceFile.getDiagnostics(this.configOptions) || [];
                const fileUri = sourceFile.getUri();
                if (sourceFile.isParseRequired()) {
                    sourceFile.parse(
                        this.program.configOptions,
                        this.program.importResolver,
                        sourceFile.getFileContent()
                    );
                }
                const value = {
                    fileUri,
                    parseResults: sourceFile.getParseResults(),
                    errors: diagnostics.filter((diag) => diag.category === DiagnosticCategory.Error),
                    warnings: diagnostics.filter((diag) => diag.category === DiagnosticCategory.Warning),
                    information: diagnostics.filter((diag) => diag.category === DiagnosticCategory.Information),
                    unused: diagnostics.filter((diag) => diag.category === DiagnosticCategory.UnusedCode),
                };

                // Don't use the uri key, but rather the file name, because other spots
                // in the test data assume file paths.
                return [this.files[index], value] as [string, typeof value];
            } else {
                this.raiseError(`Source file not found for ${this.files[index]}`);
            }
        });

        return new Map<string, (typeof results)[0][1]>(results);
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
        const uri = Uri.file(filePath, this.serviceProvider);
        while (!this.fs.existsSync(uri)) {
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
            range.fileUri,
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

            const actual = this.fs.readFileSync(Uri.file(normalizedFilePath, this.serviceProvider), 'utf8');
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
}

export function parseAndGetTestState(
    code: string,
    projectRoot = '/',
    anonymousFileName = 'unnamedFile.py',
    testFS?: vfs.TestFileSystem
) {
    const data = parseTestData(normalizeSlashes(projectRoot), code, anonymousFileName);
    const state = new TestState(
        normalizeSlashes('/'),
        data,
        /* mountPath */ undefined,
        /* hostSpecificFeatures */ undefined,
        testFS
    );

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

    const sourceFile = state.program.getBoundSourceFile(marker.fileUri);
    assert(sourceFile);

    const parserResults = sourceFile.getParseResults();
    assert(parserResults);

    const node = findNodeByOffset(parserResults.parserOutput.parseTree, marker.position);
    assert(node);

    return node;
}
