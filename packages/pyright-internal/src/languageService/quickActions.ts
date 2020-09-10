/*
 * quickActions.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Provides support for miscellaneous quick actions.
 */

import { CancellationToken } from 'vscode-languageserver';

import {
    getTextEditsForAutoImportInsertion,
    getTextEditsForAutoImportSymbolAddition,
    getTopLevelImports,
    ImportGroup,
} from '../analyzer/importStatementUtils';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { Commands } from '../commands/commands';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { TextEditAction } from '../common/editAction';
import { convertOffsetToPosition } from '../common/positionUtils';
import { TextRange } from '../common/textRange';
import { ParseNode, ParseNodeType } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';
import { ImportSorter } from './importSorter';

export function performQuickAction(command: string, args: any[], parseResults: ParseResults, token: CancellationToken) {
    if (command === Commands.orderImports) {
        const importSorter = new ImportSorter(parseResults, token);
        return importSorter.sort();
    } else if (command === Commands.addMissingOptionalToParam) {
        if (args.length >= 1) {
            const nodeOffset = parseInt(args[0], 10);
            return _addMissingOptionalToParam(parseResults, nodeOffset, token);
        }
    }

    return [];
}

// Inserts text into the document to wrap an existing type annotation
// with "Optional[X]".
function _addMissingOptionalToParam(
    parseResults: ParseResults,
    offset: number,
    token: CancellationToken
): TextEditAction[] {
    throwIfCancellationRequested(token);

    let node: ParseNode | undefined = ParseTreeUtils.findNodeByOffset(parseResults.parseTree, offset);
    while (node) {
        if (node.nodeType === ParseNodeType.Parameter) {
            break;
        }

        node = node.parent;
    }

    if (!node || !node.typeAnnotation) {
        return [];
    }

    const editActions: TextEditAction[] = [];

    const startPos = convertOffsetToPosition(node.typeAnnotation.start, parseResults.tokenizerOutput.lines);
    const endPos = convertOffsetToPosition(TextRange.getEnd(node.typeAnnotation), parseResults.tokenizerOutput.lines);

    editActions.push({
        range: { start: startPos, end: startPos },
        replacementText: 'Optional[',
    });
    editActions.push({
        range: { start: endPos, end: endPos },
        replacementText: ']',
    });

    // Add the import statement if necessary.
    const importStatements = getTopLevelImports(parseResults.parseTree);
    const importStatement = importStatements.orderedImports.find((imp) => imp.moduleName === 'typing');

    // If there's an existing import statement, insert into it.
    if (importStatement && importStatement.node.nodeType === ParseNodeType.ImportFrom) {
        const additionalEditActions = getTextEditsForAutoImportSymbolAddition(
            'Optional',
            importStatement,
            parseResults
        );
        editActions.push(...additionalEditActions);
    } else {
        const additionalEditActions = getTextEditsForAutoImportInsertion(
            'Optional',
            importStatements,
            'typing',
            ImportGroup.BuiltIn,
            parseResults,
            startPos
        );
        editActions.push(...additionalEditActions);
    }

    return editActions;
}
