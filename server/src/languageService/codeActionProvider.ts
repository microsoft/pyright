/*
 * codeActionProvider.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

import { CodeAction, CodeActionKind, Command } from 'vscode-languageserver';

import { Commands } from '../commands/commands';
import { AddMissingOptionalToParamAction, CreateTypeStubFileAction } from '../common/diagnostic';
import { Range } from '../common/textRange';
import { WorkspaceServiceInstance } from '../languageServerBase';

export class CodeActionProvider {
    static getCodeActionsForPosition(workspace: WorkspaceServiceInstance, filePath: string, range: Range) {
        const sortImportsCodeAction = CodeAction.create(
            'Organize Imports', Command.create('Organize Imports', Commands.orderImports),
            CodeActionKind.SourceOrganizeImports);
        const codeActions: CodeAction[] = [sortImportsCodeAction];

        if (!workspace.disableLanguageServices) {
            const diags = workspace.serviceInstance.getDiagnosticsForRange(filePath, range);
            const typeStubDiag = diags.find(d => {
                const actions = d.getActions();
                return actions && actions.find(a => a.action === Commands.createTypeStub);
            });

            if (typeStubDiag) {
                const action = typeStubDiag.getActions()!.find(
                    a => a.action === Commands.createTypeStub) as CreateTypeStubFileAction;
                if (action) {
                    const createTypeStubAction = CodeAction.create(
                        `Create Type Stub For ‘${ action.moduleName }’`,
                        Command.create('Create Type Stub', Commands.createTypeStub,
                            workspace.rootPath, action.moduleName, filePath),
                        CodeActionKind.QuickFix);
                    codeActions.push(createTypeStubAction);
                }
            }

            const addOptionalDiag = diags.find(d => {
                const actions = d.getActions();
                return actions && actions.find(a => a.action === Commands.addMissingOptionalToParam);
            });

            if (addOptionalDiag) {
                const action = addOptionalDiag.getActions()!.find(
                    a => a.action === Commands.addMissingOptionalToParam) as AddMissingOptionalToParamAction;
                if (action) {
                    const addMissingOptionalAction = CodeAction.create(
                        `Add 'Optional' to type annotation`,
                        Command.create(`Add 'Optional' to type annotation`, Commands.addMissingOptionalToParam,
                            action.offsetOfTypeNode),
                        CodeActionKind.QuickFix);
                    codeActions.push(addMissingOptionalAction);
                }
            }
        }

        return codeActions;
    }
}
