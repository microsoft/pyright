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
import {
    ActionKind,
    AddMissingOptionalToParamAction,
    CreateTypeStubFileAction,
    RenameShadowedFileAction,
} from '../common/diagnostic';
import { FileEditActions } from '../common/editAction';
import { convertPathToUri, getShortenedFileName } from '../common/pathUtils';
import { Range } from '../common/textRange';
import { convertToWorkspaceEdit } from '../common/workspaceEditUtils';
import { WorkspaceServiceInstance } from '../languageServerBase';
import { Localizer } from '../localization/localize';

export class CodeActionProvider {
    static async getCodeActionsForPosition(
        workspace: WorkspaceServiceInstance,
        filePath: string,
        range: Range,
        kinds: CodeActionKind[] | undefined,
        token: CancellationToken
    ) {
        throwIfCancellationRequested(token);

        const codeActions: CodeAction[] = [];

        if (!workspace.disableLanguageServices) {
            const diags = await workspace.serviceInstance.getDiagnosticsForRange(filePath, range, token);
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
                            workspace.path,
                            action.moduleName,
                            filePath
                        ),
                        CodeActionKind.QuickFix
                    );
                    codeActions.push(createTypeStubAction);
                }
            }

            const addOptionalDiag = diags.find((d) => {
                const actions = d.getActions();
                return actions && actions.find((a) => a.action === Commands.addMissingOptionalToParam);
            });

            if (addOptionalDiag) {
                const action = addOptionalDiag
                    .getActions()!
                    .find((a) => a.action === Commands.addMissingOptionalToParam) as AddMissingOptionalToParamAction;
                if (action) {
                    const fs = workspace.serviceInstance.getImportResolver().fileSystem;
                    const addMissingOptionalAction = CodeAction.create(
                        Localizer.CodeAction.addOptionalToAnnotation(),
                        Command.create(
                            Localizer.CodeAction.addOptionalToAnnotation(),
                            Commands.addMissingOptionalToParam,
                            convertPathToUri(fs, filePath),
                            action.offsetOfTypeNode
                        ),
                        CodeActionKind.QuickFix
                    );
                    codeActions.push(addMissingOptionalAction);
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
                    const fs = workspace.serviceInstance.getImportResolver().fileSystem;
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
