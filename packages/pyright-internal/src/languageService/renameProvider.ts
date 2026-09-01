/*
 * renameProvider.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Logic that rename identifier on the given position and its references.
 */

import { CancellationToken, LSPErrorCodes, ResponseError, WorkspaceEdit } from 'vscode-languageserver';

import { Declaration } from '../analyzer/declaration';
import { isUserCode } from '../analyzer/sourceFileInfoUtils';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { assertNever } from '../common/debug';
import { FileEditAction } from '../common/editAction';
import { ProgramView, ReferenceUseCase, SourceFileInfo } from '../common/extensibility';
import { convertTextRangeToRange } from '../common/positionUtils';
import { Position, Range, TextRange } from '../common/textRange';
import { TextRangeCollection } from '../common/textRangeCollection';
import { Uri } from '../common/uri/uri';
import { convertToWorkspaceEdit } from '../common/workspaceEditUtils';
import { ReferencesProvider, ReferencesResult } from '../languageService/referencesProvider';
import { Localizer } from '../localization/localize';
import { ParseNode, ParseNodeType } from '../parser/parseNodes';
import { ParseFileResults } from '../parser/parser';

// Rename must never modify non-user code (library or stub files). A rename group can grow during the
// multi-file workspace walk -- protocol members and TypedDict keys that share a name are renamed as a
// group, and the related declarations only become known once their usages in other files are examined.
// That growth can pull in a declaration that lives in non-user code. Editing only the user-code
// occurrences would leave the symbol partially renamed and the code inconsistent, so we abort loudly --
// naming the exact declaration(s) that block the rename and why -- instead of returning a partial edit.
//
// `getSourceFileInfo` is passed as a callback so this helper works for both the sync `ProgramView` and the
// async program snapshot without coupling to either type.
export function assertRenameTargetsAreUserCode(
    getSourceFileInfo: (uri: Uri) => SourceFileInfo | undefined,
    declarations: readonly Declaration[],
    symbolName: string
): void {
    const nonUserDeclarations = declarations.filter((d) => !isUserCode(getSourceFileInfo(d.uri)));
    if (nonUserDeclarations.length === 0) {
        return;
    }

    const locations = nonUserDeclarations
        .map((d) => `  - ${d.uri.toUserVisibleString()}:${d.range.start.line + 1}`)
        .join('\n');

    throw new ResponseError(
        LSPErrorCodes.RequestFailed,
        Localizer.Rename.cannotRenameNonUserCode().format({ symbolName, locations })
    );
}

// Computes the prepareRename range for the symbol at the cursor. For a single parenthesized name
// (e.g. `(A)`), the parser widens the NameNode's range to span the surrounding parens (see
// `_parseTupleAtom`), while the identifier token keeps the bare-name extent. Use the token range so
// the rename prompt shows/replaces just the name rather than the parens (pylance-release #5372).
// Shared by the sync `RenameProvider` and the async aggregated rename provider to keep both paths
// identical.
export function getRenameSymbolRange(nodeAtOffset: ParseNode, lines: TextRangeCollection<TextRange>): Range {
    const rangeSource = nodeAtOffset.nodeType === ParseNodeType.Name ? nodeAtOffset.d.token : nodeAtOffset;
    return convertTextRangeToRange(rangeSource, lines);
}

export class RenameProvider {
    private readonly _parseResults: ParseFileResults | undefined;

    constructor(
        private _program: ProgramView,
        private _fileUri: Uri,
        private _position: Position,
        private _token: CancellationToken
    ) {
        this._parseResults = this._program.getParseResults(this._fileUri);
    }

    canRenameSymbol(isDefaultWorkspace: boolean, isUntitled: boolean): Range | null {
        throwIfCancellationRequested(this._token);
        if (!this._parseResults) {
            return null;
        }

        const referencesResult = this._getReferenceResult();
        if (!referencesResult) {
            return null;
        }

        const renameMode = RenameProvider.getRenameSymbolMode(
            this._program,
            this._fileUri,
            referencesResult,
            isDefaultWorkspace,
            isUntitled
        );
        if (renameMode === 'none') {
            return null;
        }

        // Return the range of the symbol.
        return getRenameSymbolRange(referencesResult.nodeAtOffset, this._parseResults.tokenizerOutput.lines);
    }

    renameSymbol(newName: string, isDefaultWorkspace: boolean, isUntitled: boolean): WorkspaceEdit | null {
        throwIfCancellationRequested(this._token);
        if (!this._parseResults) {
            return null;
        }

        const referencesResult = this._getReferenceResult();
        if (!referencesResult) {
            return null;
        }

        const referenceProvider = new ReferencesProvider(this._program, this._token);
        const renameMode = RenameProvider.getRenameSymbolMode(
            this._program,
            this._fileUri,
            referencesResult,
            isDefaultWorkspace,
            isUntitled
        );

        switch (renameMode) {
            case 'singleFileMode':
                referenceProvider.addReferencesToResult(this._fileUri, /* includeDeclaration */ true, referencesResult);
                break;

            case 'multiFileMode': {
                // Rename every reference across the workspace. Some symbols are renamed as a group
                // (protocol members and TypedDict keys that share a name), and the rest of the group
                // only becomes known once their usages in other files are examined. Collecting the
                // whole workspace in one walk pulls in those related declarations so the rename
                // covers the entire group.
                referenceProvider.collectWorkspaceReferences(referencesResult, /* includeDeclaration */ true, (info) =>
                    isUserCode(info)
                );

                // The group may have grown (during the walk) to include a declaration that lives in
                // non-user code. getRenameSymbolMode only verified the pre-walk seed was all user code,
                // so re-assert the invariant now and abort loudly rather than silently renaming only
                // the editable subset.
                assertRenameTargetsAreUserCode(
                    (uri) => this._program.getSourceFileInfo(uri),
                    referencesResult.declarations,
                    referencesResult.symbolNames[0] ?? newName
                );
                break;
            }

            case 'none':
                // Rename is not allowed.
                // ex) rename symbols from libraries.
                return null;

            default:
                assertNever(renameMode);
        }

        const edits: FileEditAction[] = [];
        referencesResult.results.forEach((result) => {
            // Special case the renames of keyword arguments.
            edits.push({
                fileUri: result.location.uri,
                range: result.location.range,
                replacementText: newName,
            });
        });

        return convertToWorkspaceEdit(this._program.fileSystem, { edits, fileOperations: [] });
    }

    static getRenameSymbolMode(
        program: ProgramView,
        fileUri: Uri,
        referencesResult: ReferencesResult,
        isDefaultWorkspace: boolean,
        isUntitled: boolean
    ) {
        const sourceFileInfo = program.getSourceFileInfo(fileUri)!;

        // We have 2 different cases
        // Single file mode.
        // 1. rename on default workspace (ex, standalone file mode).
        // 2. rename local symbols.
        // 3. rename symbols defined in the non user open file.
        //
        // and Multi file mode.
        // 1. rename public symbols defined in user files on regular workspace (ex, open folder mode).
        const userFile = isUserCode(sourceFileInfo);
        if (
            isDefaultWorkspace ||
            (userFile && !referencesResult.requiresGlobalSearch) ||
            (!userFile &&
                sourceFileInfo.isOpenByClient &&
                referencesResult.declarations.every((d) => program.getSourceFileInfo(d.uri) === sourceFileInfo))
        ) {
            return 'singleFileMode';
        }

        if (referencesResult.declarations.every((d) => isUserCode(program.getSourceFileInfo(d.uri)))) {
            return 'multiFileMode';
        }

        // Rename is not allowed.
        // ex) rename symbols from libraries.
        return 'none';
    }

    private _getReferenceResult() {
        const referencesResult = ReferencesProvider.getDeclarationForPosition(
            this._program,
            this._fileUri,
            this._position,
            /* reporter */ undefined,
            ReferenceUseCase.Rename,
            this._token
        );
        if (!referencesResult) {
            return undefined;
        }

        if (referencesResult.containsOnlyImportDecls) {
            return undefined;
        }

        if (referencesResult.nonImportDeclarations.length === 0) {
            // There is no symbol we can rename.
            return undefined;
        }

        // Use declarations that doesn't contain import decls.
        return new ReferencesResult(
            referencesResult.requiresGlobalSearch,
            referencesResult.nodeAtOffset,
            referencesResult.symbolNames,
            referencesResult.nonImportDeclarations,
            referencesResult.useCase,
            referencesResult.providers
        );
    }
}
