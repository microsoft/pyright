/*
 * sourceFileInfo.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Class that represents information around single source file.
 */

import { SourceFile } from './sourceFile';
import * as extensibility from '../common/extensibility';

// Tracks information about each source file in a program,
// including the reason it was added to the program and any
// dependencies that it has on other files in the program.
export class SourceFileInfo implements extensibility.SourceFileInfo {
    private _writableData: WriteableData;
    private _preEditData?: WriteableData;

    readonly isCreatedInEditMode: boolean;

    constructor(
        readonly sourceFile: SourceFile,
        readonly isTypeshedFile: boolean,
        readonly isThirdPartyImport: boolean,
        readonly isThirdPartyPyTypedPresent: boolean,
        private readonly _editModeTracker: EditModeTracker,
        args: OptionalArguments = {}
    ) {
        this.isCreatedInEditMode = this._editModeTracker.isEditMode;

        this._writableData = this._createWriteableData(args);

        this._cachePreEditState();
    }

    get diagnosticsVersion() {
        return this._writableData.diagnosticsVersion;
    }

    get builtinsImport() {
        return this._writableData.builtinsImport;
    }

    // Information about the chained source file
    // Chained source file is not supposed to exist on file system but
    // must exist in the program's source file list. Module level
    // scope of the chained source file will be inserted before
    // current file's scope.
    get chainedSourceFile() {
        return this._writableData.chainedSourceFile;
    }

    get effectiveFutureImports() {
        return this._writableData.effectiveFutureImports;
    }

    // Information about why the file is included in the program
    // and its relation to other source files in the program.
    get isTracked() {
        return this._writableData.isTracked;
    }

    get isOpenByClient() {
        return this._writableData.isOpenByClient;
    }
    get uri() {
        return this.sourceFile.getUri();
    }

    get contents() {
        return this.sourceFile.getFileContent() ?? '';
    }

    get ipythonMode() {
        return this.sourceFile.getIPythonMode();
    }

    get isStubFile() {
        return this.sourceFile.isStubFile();
    }

    get isTypingStubFile() {
        return this.sourceFile.isTypingStubFile();
    }

    get hasTypeAnnotations() {
        const parseResults = this.sourceFile.getParserOutput();
        if (parseResults) {
            return parseResults.hasTypeAnnotations;
        }
        return false;
    }

    get imports(): readonly SourceFileInfo[] {
        return this._writableData.imports;
    }

    get importedBy(): readonly SourceFileInfo[] {
        return this._writableData.importedBy;
    }

    get shadows(): readonly SourceFileInfo[] {
        return this._writableData.shadows;
    }

    get shadowedBy(): readonly SourceFileInfo[] {
        return this._writableData.shadowedBy;
    }

    get clientVersion() {
        return this.sourceFile.getClientVersion();
    }

    set diagnosticsVersion(value: number | undefined) {
        this._cachePreEditState();
        this._writableData.diagnosticsVersion = value;
    }

    set builtinsImport(value: SourceFileInfo | undefined) {
        this._cachePreEditState();
        this._writableData.builtinsImport = value;
    }

    set chainedSourceFile(value: SourceFileInfo | undefined) {
        this._cachePreEditState();
        this._writableData.chainedSourceFile = value;
    }

    set effectiveFutureImports(value: ReadonlySet<string> | undefined) {
        this._cachePreEditState();
        this._writableData.effectiveFutureImports = value;
    }

    set isTracked(value: boolean) {
        this._cachePreEditState();
        this._writableData.isTracked = value;
    }

    set isOpenByClient(value: boolean) {
        this._cachePreEditState();
        this._writableData.isOpenByClient = value;
    }

    mutate(callback: (s: WriteableData) => void) {
        this._cachePreEditState();
        callback(this._writableData);
    }

    restore() {
        if (this._preEditData) {
            this._writableData = this._preEditData;
            this._preEditData = undefined;

            // Some states have changed. Force some of info to be re-calculated.
            this.sourceFile.dropParseAndBindInfo();
        }

        return this.sourceFile.restore();
    }

    private _cachePreEditState() {
        if (!this._editModeTracker.isEditMode || this._preEditData) {
            return;
        }

        this._preEditData = this._writableData;
        this._writableData = this._cloneWriteableData(this._writableData);

        this._editModeTracker.addMutatedFiles(this);
    }

    private _createWriteableData(args: OptionalArguments): WriteableData {
        return {
            isTracked: args.isTracked ?? false,
            isOpenByClient: args.isOpenByClient ?? false,
            builtinsImport: args.builtinsImport,
            chainedSourceFile: args.chainedSourceFile,
            diagnosticsVersion: args.diagnosticsVersion,
            effectiveFutureImports: args.effectiveFutureImports,
            imports: [],
            importedBy: [],
            shadows: [],
            shadowedBy: [],
        };
    }

    private _cloneWriteableData(data: WriteableData): WriteableData {
        return {
            isTracked: data.isTracked,
            isOpenByClient: data.isOpenByClient,
            builtinsImport: data.builtinsImport,
            chainedSourceFile: data.chainedSourceFile,
            diagnosticsVersion: data.diagnosticsVersion,
            effectiveFutureImports: data.effectiveFutureImports,
            imports: data.imports.slice(),
            importedBy: data.importedBy.slice(),
            shadows: data.shadows.slice(),
            shadowedBy: data.shadowedBy.slice(),
        };
    }
}

interface EditModeTracker {
    readonly isEditMode: boolean;
    addMutatedFiles(file: SourceFileInfo): void;
}

interface OptionalArguments {
    isTracked?: boolean;
    isOpenByClient?: boolean;
    diagnosticsVersion?: number | undefined;
    builtinsImport?: SourceFileInfo | undefined;
    chainedSourceFile?: SourceFileInfo | undefined;
    effectiveFutureImports?: ReadonlySet<string>;
}

interface WriteableData {
    // Reference to the source file
    // Information about the source file
    diagnosticsVersion?: number | undefined;

    builtinsImport?: SourceFileInfo | undefined;

    // Information about the chained source file
    // Chained source file is not supposed to exist on file system but
    // must exist in the program's source file list. Module level
    // scope of the chained source file will be inserted before
    // current file's scope.
    chainedSourceFile?: SourceFileInfo | undefined;

    effectiveFutureImports?: ReadonlySet<string>;

    // Information about why the file is included in the program
    // and its relation to other source files in the program.
    isTracked: boolean;
    isOpenByClient: boolean;
    imports: SourceFileInfo[];
    importedBy: SourceFileInfo[];
    shadows: SourceFileInfo[];
    shadowedBy: SourceFileInfo[];
}
