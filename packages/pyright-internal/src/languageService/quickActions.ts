/*
 * quickActions.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Provides support for miscellaneous quick actions.
 */

import { CancellationToken } from 'vscode-languageserver';

import { Commands } from '../commands/commands';
import { ProgramView } from '../common/extensibility';
import { ImportSorter } from './importSorter';

export function performQuickAction(
    programView: ProgramView,
    filePath: string,
    command: string,
    args: any[],
    token: CancellationToken
) {
    const sourceFileInfo = programView.getSourceFileInfo(filePath);

    // This command should be called only for open files, in which
    // case we should have the file contents already loaded.
    if (!sourceFileInfo || !sourceFileInfo.isOpenByClient) {
        return [];
    }

    // If we have no completed analysis job, there's nothing to do.
    const parseResults = programView.getParseResults(filePath);
    if (!parseResults) {
        return [];
    }

    if (command === Commands.orderImports) {
        const importSorter = new ImportSorter(parseResults, token);
        return importSorter.sort();
    }

    return [];
}
