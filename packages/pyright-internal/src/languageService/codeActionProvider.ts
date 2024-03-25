/*
 * codeActionProvider.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Handles 'code actions' requests from the client.
 */

import { CancellationToken, CodeAction, CodeActionKind } from 'vscode-languageserver';

import { Commands } from '../commands/commands';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { createCommand } from '../common/commandUtils';
import { ActionKind, CreateTypeStubFileAction, RenameShadowedFileAction } from '../common/diagnostic';
import { FileEditActions } from '../common/editAction';
import { Range } from '../common/textRange';
import { Uri } from '../common/uri/uri';
import { convertToWorkspaceEdit } from '../common/workspaceEditUtils';
import { Localizer } from '../localization/localize';
import { Workspace } from '../workspaceFactory';

export class CodeActionProvider {
    static mightSupport(kinds: CodeActionKind[] | undefined): boolean {
        if (!kinds || kinds.length === 0) {
            return true;
        }

        // Only support quick fix actions
        return kinds.some((s) => s.startsWith(CodeActionKind.QuickFix));
    }

    static async getCodeActionsForPosition(
        workspace: Workspace,
        fileUri: Uri,
        range: Range,
        kinds: CodeActionKind[] | undefined,
        token: CancellationToken
    ) {
        throwIfCancellationRequested(token);

        const codeActions: CodeAction[] = [];
        if (!workspace.rootUri || workspace.disableLanguageServices) {
            return codeActions;
        }

        if (!this.mightSupport(kinds)) {
            // Early exit if code actions are going to be filtered anyway.
            return codeActions;
        }

        const diags = await workspace.service.getDiagnosticsForRange(fileUri, range, token);
        const typeStubDiag = diags.find((d) => {
            const actions = d.getActions();
            return actions && actions.find((a) => a.action === Commands.createTypeStub);
        });

        if (typeStubDiag) {
            const action = typeStubDiag
                .getActions()!
                .find((a) => a.action === Commands.createTypeStub) as CreateTypeStubFileAction;
            if (action) {
                const createTypeStubAction = CodeAction.create(
                    Localizer.CodeAction.createTypeStubFor().format({ moduleName: action.moduleName }),
                    createCommand(
                        Localizer.CodeAction.createTypeStub(),
                        Commands.createTypeStub,
                        workspace.rootUri.toString(),
                        action.moduleName,
                        fileUri.toString()
                    ),
                    CodeActionKind.QuickFix
                );
                codeActions.push(createTypeStubAction);
            }
        }

        const renameShadowed = diags.find((d) => {
            const actions = d.getActions();
            return actions && actions.find((a) => a.action === ActionKind.RenameShadowedFileAction);
        });
        if (renameShadowed) {
            const action = renameShadowed
                .getActions()!
                .find((a) => a.action === ActionKind.RenameShadowedFileAction) as RenameShadowedFileAction;
            if (action) {
                const title = Localizer.CodeAction.renameShadowedFile().format({
                    oldFile: action.oldUri.getShortenedFileName(),
                    newFile: action.newUri.getShortenedFileName(),
                });
                const editActions: FileEditActions = {
                    edits: [],
                    fileOperations: [
                        {
                            kind: 'rename',
                            oldFileUri: action.oldUri,
                            newFileUri: action.newUri,
                        },
                    ],
                };
                const workspaceEdit = convertToWorkspaceEdit(workspace.service.fs, editActions);
                const renameAction = CodeAction.create(title, workspaceEdit, CodeActionKind.QuickFix);
                codeActions.push(renameAction);
            }
        }

        return codeActions;
    }
}
