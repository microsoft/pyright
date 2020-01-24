/*
* definitionProvider.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Logic that maps a position within a Python program file into
* a "definition" of the item that is referred to at that position.
* For example, if the location is within an import name, the
* definition is the top of the resolved import file.
*/

import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { TypeEvaluator } from '../analyzer/typeEvaluator';
import { LineAndColumn, DocumentLineAndColumnRange, rangesAreEqual } from '../common/textRange';
import { convertPositionToOffset } from '../common/positionUtils';
import { ParseNodeType } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';

export class DefinitionProvider {
    static getDefinitionsForPosition(parseResults: ParseResults, position: LineAndColumn,
            evaluator: TypeEvaluator): DocumentLineAndColumnRange[] | undefined {

        const offset = convertPositionToOffset(position, parseResults.tokenizerOutput.lines);
        if (offset === undefined) {
            return undefined;
        }

        const node = ParseTreeUtils.findNodeByOffset(parseResults.parseTree, offset);
        if (node === undefined) {
            return undefined;
        }

        const definitions: DocumentLineAndColumnRange[] = [];

        if (node.nodeType === ParseNodeType.Name) {
            const declarations = evaluator.getDeclarationsForNameNode(node);
            if (declarations) {
                declarations.forEach(decl => {
                    const resolvedDecl = evaluator.resolveAliasDeclaration(decl);
                    if (resolvedDecl && resolvedDecl.path) {
                        this._addIfUnique(definitions, {
                            path: resolvedDecl.path,
                            range: resolvedDecl.range
                        });
                    }
                });
            }
        }

        return definitions.length > 0 ? definitions : undefined;
    }

    private static _addIfUnique(definitions: DocumentLineAndColumnRange[], itemToAdd: DocumentLineAndColumnRange) {
        for (const def of definitions) {
            if (def.path === itemToAdd.path && rangesAreEqual(def.range, itemToAdd.range)) {
                return;
            }
        }

        definitions.push(itemToAdd);
    }
}
