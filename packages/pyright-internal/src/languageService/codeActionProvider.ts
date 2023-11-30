/*
 * codeActionProvider.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Handles 'code actions' requests from the client.
 */

import { CancellationToken, CodeAction, CodeActionKind, Command } from 'vscode-languageserver';

import { Commands } from '../commands/commands';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { ActionKind, CreateTypeStubFileAction, RenameShadowedFileAction } from '../common/diagnostic';
import { FileEditActions } from '../common/editAction';
import { getShortenedFileName } from '../common/pathUtils';
import { Range } from '../common/textRange';
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
        filePath: string,
        range: Range,
        kinds: CodeActionKind[] | undefined,
        token: CancellationToken
    ) {
        throwIfCancellationRequested(token);

        const codeActions: CodeAction[] = [];

        if (!this.mightSupport(kinds)) {
            // Early exit if code actions are going to be filtered anyway.
            return [];
        }

        if (!workspace.disableLanguageServices) {
            const diags = await workspace.service.getDiagnosticsForRange(filePath, range, token);
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
                        Command.create(
                            Localizer.CodeAction.createTypeStub(),
                            Commands.createTypeStub,
                            workspace.rootPath,
                            action.moduleName,
                            filePath
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
                        oldFile: getShortenedFileName(action.oldFile),
                        newFile: getShortenedFileName(action.newFile),
                    });
                    const fs = workspace.service.getImportResolver().fileSystem;
                    const editActions: FileEditActions = {
                        edits: [],
                        fileOperations: [
                            {
                                kind: 'rename',
                                oldFilePath: action.oldFile,
                                newFilePath: action.newFile,
                            },
                        ],
                    };
                    const workspaceEdit = convertToWorkspaceEdit(fs, editActions);
                    const renameAction = CodeAction.create(title, workspaceEdit, CodeActionKind.QuickFix);
                    codeActions.push(renameAction);
                }
            }
        }

        return codeActions;
    }
}
