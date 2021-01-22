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

import { CancellationToken } from 'vscode-languageserver';

import { DeclarationType } from '../analyzer/declaration';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { isStubFile, SourceMapper } from '../analyzer/sourceMapper';
import { TypeEvaluator } from '../analyzer/typeEvaluator';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { convertPositionToOffset } from '../common/positionUtils';
import { DocumentRange, Position, rangesAreEqual } from '../common/textRange';
import { ParseNodeType } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';

export class DefinitionProvider {
    static getDefinitionsForPosition(
        sourceMapper: SourceMapper,
        parseResults: ParseResults,
        position: Position,
        evaluator: TypeEvaluator,
        token: CancellationToken
    ): DocumentRange[] | undefined {
        throwIfCancellationRequested(token);

        const offset = convertPositionToOffset(position, parseResults.tokenizerOutput.lines);
        if (offset === undefined) {
            return undefined;
        }

        const node = ParseTreeUtils.findNodeByOffset(parseResults.parseTree, offset);
        if (node === undefined) {
            return undefined;
        }

        const definitions: DocumentRange[] = [];

        if (node.nodeType === ParseNodeType.Name) {
            const declarations = evaluator.getDeclarationsForNameNode(node);
            if (declarations) {
                declarations.forEach((decl) => {
                    let resolvedDecl = evaluator.resolveAliasDeclaration(decl, /* resolveLocalNames */ true);
                    if (resolvedDecl && resolvedDecl.path) {
                        // If the decl is an unresolved import, skip it.
                        if (resolvedDecl.type === DeclarationType.Alias && resolvedDecl.isUnresolved) {
                            return;
                        }

                        // If the resolved decl is still an alias, it means it
                        // resolved to a module. We need to apply loader actions
                        // to determine its path.
                        if (
                            resolvedDecl.type === DeclarationType.Alias &&
                            resolvedDecl.symbolName &&
                            resolvedDecl.submoduleFallback &&
                            resolvedDecl.submoduleFallback.path
                        ) {
                            resolvedDecl = resolvedDecl.submoduleFallback;
                        }

                        this._addIfUnique(definitions, {
                            path: resolvedDecl.path,
                            range: resolvedDecl.range,
                        });

                        if (isStubFile(resolvedDecl.path)) {
                            const implDecls = sourceMapper.findDeclarations(resolvedDecl);
                            for (const implDecl of implDecls) {
                                if (implDecl && implDecl.path) {
                                    this._addIfUnique(definitions, {
                                        path: implDecl.path,
                                        range: implDecl.range,
                                    });
                                }
                            }
                        }
                    }
                });
            }
        }

        return definitions.length > 0 ? definitions : undefined;
    }

    private static _addIfUnique(definitions: DocumentRange[], itemToAdd: DocumentRange) {
        for (const def of definitions) {
            if (def.path === itemToAdd.path && rangesAreEqual(def.range, itemToAdd.range)) {
                return;
            }
        }

        definitions.push(itemToAdd);
    }
}
