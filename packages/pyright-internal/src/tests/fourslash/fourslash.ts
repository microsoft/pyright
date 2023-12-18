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
 * when run, helper variable will be bound to TestState (server\pyright\server\src\tests\harness\fourslash\testState.ts)
 * so make sure Fourslash type is in sync with TestState
 *
 * for how markup language and helper is used in fourslash tests, see these 2 tests
 * server\pyright\server\src\tests\fourSlashParser.test.ts
 * server\pyright\server\src\tests\testState.test.ts
 *
 * for debugging, open *.fourslash.ts test file you want to debug, and select "fourslash current file" as debug configuration
 * and set break point in one of TestState methods you are using in the test or set break point on "runCode" above
 * and hit F5.
 */

declare namespace _ {
    type CompletionItemKind =
        | 1
        | 2
        | 3
        | 4
        | 5
        | 6
        | 7
        | 8
        | 9
        | 10
        | 11
        | 12
        | 13
        | 14
        | 15
        | 16
        | 17
        | 18
        | 19
        | 20
        | 21
        | 22
        | 23
        | 24
        | 25;

    type FourSlashVerificationMode = 'exact' | 'included' | 'excluded';
    interface FourSlashCompletionItem {
        label: string;
        kind: CompletionItemKind | undefined;
        insertionText?: string;
        documentation?: string;
        detail?: string;
        textEdit?: TextEdit;
        additionalTextEdits?: TextEdit[];
        detailDescription?: string;
        commitCharacters?: string[];
    }

    interface FourSlashCallHierarchyItem {
        filePath: string;
        name: string;
        range: PositionRange;
    }

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

    interface Command {
        title: string;
        command: string;
        arguments?: any[];
    }

    interface Position {
        // Both line and column are zero-based
        line: number;
        character: number;
    }

    interface PositionRange {
        start: Position;
        end: Position;
    }

    interface TextEdit {
        range: PositionRange;
        newText: string;
    }

    interface DocumentRange {
        path: string;
        range: PositionRange;
    }

    interface TextEditAction {
        range: PositionRange;
        replacementText: string;
    }

    interface FileEditAction extends TextEditAction {
        filePath: string;
    }

    type DocumentHighlightKind = 1 | 2 | 3;

    interface DocumentHighlight {
        range: PositionRange;
        kind?: DocumentHighlightKind;
    }

    interface AbbreviationInfo {
        importFrom?: string;
        importName: string;
    }

    interface TextDocumentIdentifier {
        uri: string;
    }

    interface OptionalVersionedTextDocumentIdentifier extends TextDocumentIdentifier {
        version: number | null;
    }

    interface AnnotatedTextEdit extends TextEdit {
        annotationId: string;
    }

    interface TextDocumentEdit {
        textDocument: OptionalVersionedTextDocumentIdentifier;
        edits: (TextEdit | AnnotatedTextEdit)[];
    }

    interface FileOptions {
        overwrite?: boolean;
        ignoreIfExists?: boolean;
    }

    interface ResourceOperation {
        kind: string;
        annotationId?: string;
    }

    interface CreateFile extends ResourceOperation {
        kind: 'create';
        uri: string;
        options?: FileOptions;
    }

    interface RenameFile extends ResourceOperation {
        kind: 'rename';
        oldUri: string;
        newUri: string;
        options?: FileOptions;
    }

    interface DeleteFileOptions {
        recursive?: boolean;
        ignoreIfNotExists?: boolean;
    }

    interface DeleteFile extends ResourceOperation {
        kind: 'delete';
        uri: string;
        options?: DeleteFileOptions;
    }

    interface ChangeAnnotation {
        label: string;
        needsConfirmation?: boolean;
        description?: string;
    }

    interface WorkspaceEdit {
        changes?: {
            [uri: string]: TextEdit[];
        };
        documentChanges?: (TextDocumentEdit | CreateFile | RenameFile | DeleteFile)[];
        changeAnnotations?: {
            [id: string]: ChangeAnnotation;
        };
    }

    type MarkupKind = 'markdown' | 'plaintext';

    type DefinitionFilter = 'all' | 'preferSource' | 'preferStubs';

    interface Fourslash {
        getMappedFilePath(path: string): string;
        getDocumentHighlightKind(m?: Marker): DocumentHighlightKind | undefined;

        getMarkerName(m: Marker): string;
        getMarkerByName(markerName: string): Marker;
        getMarkerNames(): string[];
        getMarkers(): Marker[];

        getRanges(): Range[];
        getRangesInFile(fileName: string): Range[];
        getRangesByText(): Map<string, Range[]>;
        getFilteredRanges<T extends {}>(
            predicate: (m: Marker | undefined, d: T | undefined, text: string) => boolean
        ): Range[];
        getPositionRange(markerString: string): PositionRange;
        getPosition(markerString: string): Position;
        get BOF(): number;
        get EOF(): number;
        expandPositionRange(range: PositionRange, start: number, end: number): PositionRange;
        convertPositionRange(range: Range): PositionRange;
        convertPathToUri(path: string): string;
        getDirectoryPath(path: string): string;
        getPathSep(): string;
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

        openFile(indexOrName: number | string): void;
        openFiles(indexOrNames: (number | string)[]): void;

        verifyDiagnostics(map?: { [marker: string]: { category: string; message: string | undefined } }): void;
        verifyCodeActions(
            verifyMode: FourSlashVerificationMode,
            map: {
                [marker: string]: {
                    codeActions: { title: string; kind: string; command?: Command; edit?: WorkspaceEdit }[];
                };
            }
        ): Promise<any>;
        verifyCommand(command: Command, files: { [filePath: string]: string }): Promise<any>;
        verifyInvokeCodeAction(
            map: {
                [marker: string]: { title: string; files?: { [filePath: string]: string }; edits?: TextEdit[] };
            },
            verifyCodeActionCount?: boolean
        ): Promise<any>;
        verifyHover(kind: string, map: { [marker: string]: string | null }): void;
        verifyCompletion(
            verifyMode: FourSlashVerificationMode,
            docFormat: MarkupKind,
            map: {
                [marker: string]: {
                    completions: FourSlashCompletionItem[];
                    memberAccessInfo?: {
                        lastKnownModule?: string;
                        lastKnownMemberName?: string;
                        unknownMemberName?: string;
                    };
                };
            },
            abbrMap?: { [abbr: string]: AbbreviationInfo }
        ): Promise<void>;
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
        ): void;
        verifyFindAllReferences(map: {
            [marker: string]: {
                references: DocumentRange[];
            };
        }): void;
        verifyShowCallHierarchyGetIncomingCalls(map: {
            [marker: string]: {
                items: FourSlashCallHierarchyItem[];
            };
        }): void;
        verifyShowCallHierarchyGetOutgoingCalls(map: {
            [marker: string]: {
                items: FourSlashCallHierarchyItem[];
            };
        }): void;
        verifyHighlightReferences(map: {
            [marker: string]: {
                references: DocumentHighlight[];
            };
        }): void;
        verifyFindDefinitions(
            map: {
                [marker: string]: {
                    definitions: DocumentRange[];
                };
            },
            filter?: DefinitionFilter
        ): void;
        verifyFindTypeDefinitions(map: {
            [marker: string]: {
                definitions: DocumentRange[];
            };
        }): void;
        verifyRename(
            map: {
                [marker: string]: {
                    newName: string;
                    changes: FileEditAction[];
                };
            },
            isUntitled?: boolean
        ): void;
        verifyTypeVerifierResults(
            packageName: string,
            ignoreUnknownTypesFromImports: boolean,
            verboseOutput: boolean,
            expected: object
        ): void;

        replace(start: number, length: number, text: string): void;

        /* not tested yet
        paste(text: string): void;
        type(text: string): void;
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

    export interface InlayHint {
        label: string;
        position?: _.Position;
        kind?: Consts.InlayHintKind;
        tooltip?: string;
        paddingLeft?: boolean;
        paddingRight?: boolean;
        textEdits?: TextEdit[];
    }
}

declare var helper: _.Fourslash;

declare namespace Consts {
    export namespace MarkupKind {
        export const PlainText = 'plaintext';
        export const Markdown = 'markdown';
    }

    export namespace CodeActionKind {
        export const QuickFix = 'quickfix';
        export const Refactor = 'refactor';
    }

    export enum Commands {
        createTypeStub = 'pyright.createtypestub',
        restartServer = 'pyright.restartserver',
        orderImports = 'pyright.organizeimports',
    }

    namespace DocumentHighlightKind {
        /**
         * A textual occurrence.
         */
        const Text: 1;
        /**
         * Read-access of a symbol, like reading a variable.
         */
        const Read: 2;
        /**
         * Write-access of a symbol, like writing to a variable.
         */
        const Write: 3;
    }

    namespace CompletionItemKind {
        const Text: 1;
        const Method: 2;
        const Function: 3;
        const Constructor: 4;
        const Field: 5;
        const Variable: 6;
        const Class: 7;
        const Interface: 8;
        const Module: 9;
        const Property: 10;
        const Unit: 11;
        const Value: 12;
        const Enum: 13;
        const Keyword: 14;
        const Snippet: 15;
        const Color: 16;
        const File: 17;
        const Reference: 18;
        const Folder: 19;
        const EnumMember: 20;
        const Constant: 21;
        const Struct: 22;
        const Event: 23;
        const Operator: 24;
        const TypeParameter: 25;
    }

    namespace InlayHintKind {
        const Type = 1;
        const Parameter = 2;
        function is(value: number): value is InlayHintKind;
    }

    export type InlayHintKind = 1 | 2;

    export const IndexValueDetail = 'Index value';
}
