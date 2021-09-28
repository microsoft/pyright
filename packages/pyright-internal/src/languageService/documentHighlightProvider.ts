/*
 * documentHighlightProvider.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Logic that maps a position within a Python program file into
 * one or more highlight types.
 */

import { CancellationToken, DocumentHighlight, DocumentHighlightKind } from 'vscode-languageserver';

import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { convertOffsetsToRange, convertPositionToOffset } from '../common/positionUtils';
import { Position, TextRange } from '../common/textRange';
import { ParseNodeType } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';
import { DocumentSymbolCollector } from './documentSymbolCollector';

export class DocumentHighlightProvider {
    static getDocumentHighlight(
        parseResults: ParseResults,
        position: Position,
        evaluator: TypeEvaluator,
        token: CancellationToken
    ): DocumentHighlight[] | undefined {
        throwIfCancellationRequested(token);

        const offset = convertPositionToOffset(position, parseResults.tokenizerOutput.lines);
        if (offset === undefined) {
            return undefined;
        }

        const node = ParseTreeUtils.findNodeByOffset(parseResults.parseTree, offset);
        if (node === undefined) {
            return undefined;
        }

        if (node.nodeType !== ParseNodeType.Name) {
            return undefined;
        }

        const results = DocumentSymbolCollector.collectFromNode(
            node,
            evaluator,
            token,
            parseResults.parseTree,
            /* treatModuleInImportAndFromImportSame */ true
        );

        return results.map((r) => ({
            kind:
                r.node.nodeType === ParseNodeType.Name && ParseTreeUtils.isWriteAccess(r.node)
                    ? DocumentHighlightKind.Write
                    : DocumentHighlightKind.Read,
            range: convertOffsetsToRange(r.range.start, TextRange.getEnd(r.range), parseResults.tokenizerOutput.lines),
        }));
    }
}
