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

import { getFileInfo } from '../analyzer/analyzerNodeInfo';
import { Declaration, DeclarationType, isFunctionDeclaration } from '../analyzer/declaration';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { isStubFile, SourceMapper } from '../analyzer/sourceMapper';
import { TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import { isOverloadedFunction, TypeCategory } from '../analyzer/types';
import { doForEachSubtype } from '../analyzer/typeUtils';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { isDefined } from '../common/core';
import { convertPositionToOffset } from '../common/positionUtils';
import { DocumentRange, Position, rangesAreEqual } from '../common/textRange';
import { ParseNodeType } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';

export enum DefinitionFilter {
    All = 'all',
    PreferSource = 'preferSource',
    PreferStubs = 'preferStubs',
}

export class DefinitionProvider {
    static getDefinitionsForPosition(
        sourceMapper: SourceMapper,
        parseResults: ParseResults,
        position: Position,
        filter: DefinitionFilter,
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
            DefinitionProvider._resolveDeclarations(declarations, evaluator, definitions, sourceMapper);
        }

        if (definitions.length === 0) {
            return undefined;
        }

        if (filter === DefinitionFilter.All) {
            return definitions;
        }

        // If go-to-declaration is supported, attempt to only show only pyi files in go-to-declaration
        // and none in go-to-definition, unless filtering would produce an empty list.
        const preferStubs = filter === DefinitionFilter.PreferStubs;
        const wantedFile = (v: DocumentRange) => preferStubs === isStubFile(v.path);
        if (definitions.find(wantedFile)) {
            return definitions.filter(wantedFile);
        }

        return definitions;
    }

    static getTypeDefinitionsForPosition(
        sourceMapper: SourceMapper,
        parseResults: ParseResults,
        position: Position,
        evaluator: TypeEvaluator,
        filePath: string,
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
            const type = evaluator.getType(node);

            if (type) {
                let declarations: Declaration[] = [];

                doForEachSubtype(type, (subtype) => {
                    if (subtype?.category === TypeCategory.Class) {
                        declarations.push(...sourceMapper.findClassDeclarationsByType(filePath, subtype));
                    }
                });

                // Fall back to Go To Definition if the type can't be found (ex. Go To Type Definition
                // was executed on a type name)
                if (declarations.length === 0) {
                    declarations = evaluator.getDeclarationsForNameNode(node) ?? [];
                }

                DefinitionProvider._resolveDeclarations(declarations, evaluator, definitions, sourceMapper);
            }
        }

        if (definitions.length === 0) {
            return undefined;
        }

        return definitions;
    }

    private static _resolveDeclarations(
        declarations: Declaration[] | undefined,
        evaluator: TypeEvaluator,
        definitions: DocumentRange[],
        sourceMapper: SourceMapper
    ) {
        if (declarations) {
            declarations.forEach((decl) => {
                let resolvedDecl = evaluator.resolveAliasDeclaration(
                    decl,
                    /* resolveLocalNames */ true,
                    /* allowExternallyHiddenAccess */ true
                );
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

                    if (isFunctionDeclaration(resolvedDecl)) {
                        // Handle overloaded function case
                        const functionType = evaluator.getTypeForDeclaration(resolvedDecl);
                        if (functionType && isOverloadedFunction(functionType)) {
                            for (const overloadDecl of functionType.overloads
                                .map((o) => o.details.declaration)
                                .filter(isDefined)) {
                                this._addIfUnique(definitions, {
                                    path: overloadDecl.path,
                                    range: overloadDecl.range,
                                });
                            }
                        }
                    }

                    if (isStubFile(resolvedDecl.path)) {
                        if (resolvedDecl.type === DeclarationType.Alias) {
                            // Add matching source module
                            sourceMapper
                                .findModules(resolvedDecl.path)
                                .map((m) => getFileInfo(m)?.filePath)
                                .filter(isDefined)
                                .forEach((f) => this._addIfUnique(definitions, this._createModuleEntry(f)));
                        } else {
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
                }
            });
        }
    }

    private static _createModuleEntry(filePath: string): DocumentRange {
        return {
            path: filePath,
            range: {
                start: { line: 0, character: 0 },
                end: { line: 0, character: 0 },
            },
        };
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
