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
import { SourceMapper, isStubFile } from '../analyzer/sourceMapper';
import { TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import { doForEachSubtype } from '../analyzer/typeUtils';
import { TypeCategory, isOverloadedFunction } from '../analyzer/types';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { appendArray } from '../common/collectionUtils';
import { isDefined } from '../common/core';
import { ProgramView, ServiceProvider } from '../common/extensibility';
import { convertPositionToOffset } from '../common/positionUtils';
import { DocumentRange, Position, rangesAreEqual } from '../common/textRange';
import { ParseNode, ParseNodeType } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';
import { ServiceKeys } from '../common/serviceProviderExtensions';

export enum DefinitionFilter {
    All = 'all',
    PreferSource = 'preferSource',
    PreferStubs = 'preferStubs',
}

export function addDeclarationsToDefinitions(
    evaluator: TypeEvaluator,
    sourceMapper: SourceMapper,
    declarations: Declaration[] | undefined,
    definitions: DocumentRange[]
) {
    if (!declarations) {
        return;
    }

    declarations.forEach((decl) => {
        let resolvedDecl = evaluator.resolveAliasDeclaration(decl, /* resolveLocalNames */ true, {
            allowExternallyHiddenAccess: true,
        });

        if (!resolvedDecl || !resolvedDecl.path) {
            return;
        }

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

        _addIfUnique(definitions, {
            path: resolvedDecl.path,
            range: resolvedDecl.range,
        });

        if (isFunctionDeclaration(resolvedDecl)) {
            // Handle overloaded function case
            const functionType = evaluator.getTypeForDeclaration(resolvedDecl)?.type;
            if (functionType && isOverloadedFunction(functionType)) {
                for (const overloadDecl of functionType.overloads.map((o) => o.details.declaration).filter(isDefined)) {
                    _addIfUnique(definitions, {
                        path: overloadDecl.path,
                        range: overloadDecl.range,
                    });
                }
            }
        }

        if (!isStubFile(resolvedDecl.path)) {
            return;
        }

        if (resolvedDecl.type === DeclarationType.Alias) {
            // Add matching source module
            sourceMapper
                .findModules(resolvedDecl.path)
                .map((m) => getFileInfo(m)?.filePath)
                .filter(isDefined)
                .forEach((f) => _addIfUnique(definitions, _createModuleEntry(f)));
            return;
        }

        const implDecls = sourceMapper.findDeclarations(resolvedDecl);
        for (const implDecl of implDecls) {
            if (implDecl && implDecl.path) {
                _addIfUnique(definitions, {
                    path: implDecl.path,
                    range: implDecl.range,
                });
            }
        }
    });
}

export function filterDefinitions(filter: DefinitionFilter, definitions: DocumentRange[]) {
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

class DefinitionProviderBase {
    protected constructor(
        protected readonly sourceMapper: SourceMapper,
        protected readonly evaluator: TypeEvaluator,
        private readonly _serviceProvider: ServiceProvider | undefined,
        protected readonly node: ParseNode | undefined,
        protected readonly offset: number,
        private readonly _filter: DefinitionFilter,
        protected readonly token: CancellationToken
    ) {}

    getDefinitionsForNode(node: ParseNode, offset: number) {
        throwIfCancellationRequested(this.token);

        const definitions: DocumentRange[] = [];

        const factories = this._serviceProvider?.tryGet(ServiceKeys.symbolDefinitionProvider);
        if (factories) {
            factories.forEach((f) => {
                const declarations = f.tryGetDeclarations(node, offset, this.token);
                this.resolveDeclarations(declarations, definitions);
            });
        }

        // There should be only one 'definition', so only if extensions failed should we try again.
        if (definitions.length === 0) {
            if (node.nodeType === ParseNodeType.Name) {
                const declarations = this.evaluator.getDeclarationsForNameNode(node);
                this.resolveDeclarations(declarations, definitions);
            } else if (node.nodeType === ParseNodeType.String) {
                const declarations = this.evaluator.getDeclarationsForStringNode(node);
                this.resolveDeclarations(declarations, definitions);
            }
        }

        if (definitions.length === 0) {
            return undefined;
        }

        return filterDefinitions(this._filter, definitions);
    }

    protected resolveDeclarations(declarations: Declaration[] | undefined, definitions: DocumentRange[]) {
        addDeclarationsToDefinitions(this.evaluator, this.sourceMapper, declarations, definitions);
    }
}

export class DefinitionProvider extends DefinitionProviderBase {
    constructor(
        program: ProgramView,
        filePath: string,
        position: Position,
        filter: DefinitionFilter,
        token: CancellationToken
    ) {
        const sourceMapper = program.getSourceMapper(filePath, token);
        const parseResults = program.getParseResults(filePath);
        const { node, offset } = _tryGetNode(parseResults, position);

        super(sourceMapper, program.evaluator!, program.serviceProvider, node, offset, filter, token);
    }

    static getDefinitionsForNode(
        sourceMapper: SourceMapper,
        evaluator: TypeEvaluator,
        node: ParseNode,
        offset: number,
        token: CancellationToken
    ) {
        const provider = new DefinitionProviderBase(
            sourceMapper,
            evaluator,
            undefined,
            node,
            offset,
            DefinitionFilter.All,
            token
        );
        return provider.getDefinitionsForNode(node, offset);
    }

    getDefinitions(): DocumentRange[] | undefined {
        if (this.node === undefined) {
            return undefined;
        }

        return this.getDefinitionsForNode(this.node, this.offset);
    }
}

export class TypeDefinitionProvider extends DefinitionProviderBase {
    private readonly _filePath: string;

    constructor(program: ProgramView, filePath: string, position: Position, token: CancellationToken) {
        const sourceMapper = program.getSourceMapper(filePath, token, /*mapCompiled*/ false, /*preferStubs*/ true);
        const parseResults = program.getParseResults(filePath);
        const { node, offset } = _tryGetNode(parseResults, position);

        super(sourceMapper, program.evaluator!, program.serviceProvider, node, offset, DefinitionFilter.All, token);
        this._filePath = filePath;
    }

    getDefinitions(): DocumentRange[] | undefined {
        throwIfCancellationRequested(this.token);
        if (this.node === undefined) {
            return undefined;
        }

        const definitions: DocumentRange[] = [];

        if (this.node.nodeType === ParseNodeType.Name) {
            const type = this.evaluator.getType(this.node);

            if (type) {
                let declarations: Declaration[] = [];

                doForEachSubtype(type, (subtype) => {
                    if (subtype?.category === TypeCategory.Class) {
                        appendArray(
                            declarations,
                            this.sourceMapper.findClassDeclarationsByType(this._filePath, subtype)
                        );
                    }
                });

                // Fall back to Go To Definition if the type can't be found (ex. Go To Type Definition
                // was executed on a type name)
                if (declarations.length === 0) {
                    declarations = this.evaluator.getDeclarationsForNameNode(this.node) ?? [];
                }

                this.resolveDeclarations(declarations, definitions);
            }
        } else if (this.node.nodeType === ParseNodeType.String) {
            const declarations = this.evaluator.getDeclarationsForStringNode(this.node);
            this.resolveDeclarations(declarations, definitions);
        }

        if (definitions.length === 0) {
            return undefined;
        }

        return definitions;
    }
}

function _tryGetNode(parseResults: ParseResults | undefined, position: Position) {
    if (!parseResults) {
        return { node: undefined, offset: 0 };
    }

    const offset = convertPositionToOffset(position, parseResults.tokenizerOutput.lines);
    if (offset === undefined) {
        return { node: undefined, offset: 0 };
    }

    return { node: ParseTreeUtils.findNodeByOffset(parseResults.parseTree, offset), offset };
}

function _createModuleEntry(filePath: string): DocumentRange {
    return {
        path: filePath,
        range: {
            start: { line: 0, character: 0 },
            end: { line: 0, character: 0 },
        },
    };
}

function _addIfUnique(definitions: DocumentRange[], itemToAdd: DocumentRange) {
    for (const def of definitions) {
        if (def.path === itemToAdd.path && rangesAreEqual(def.range, itemToAdd.range)) {
            return;
        }
    }

    definitions.push(itemToAdd);
}
