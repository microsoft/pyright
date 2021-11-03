/*
 * importAdder.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Provides code that figures out imports needed for symbols
 * used in the given range and apply them later.
 */

import { CancellationToken } from 'vscode-languageserver';

import { getFileInfo } from '../analyzer/analyzerNodeInfo';
import {
    Declaration,
    isAliasDeclaration,
    isClassDeclaration,
    isFunctionDeclaration,
    isParameterDeclaration,
    isVariableDeclaration,
    ModuleLoaderActions,
} from '../analyzer/declaration';
import {
    createSynthesizedAliasDeclaration,
    getNameFromDeclaration,
    isDefinedInFile,
} from '../analyzer/declarationUtils';
import { ImportResolver } from '../analyzer/importResolver';
import {
    getRelativeModuleName,
    getTextEditsForAutoImportInsertions,
    getTextEditsForAutoImportSymbolAddition,
    getTopLevelImports,
    ImportNameInfo,
    ImportNameWithModuleInfo,
    ImportStatements,
} from '../analyzer/importStatementUtils';
import {
    getDottedName,
    getDottedNameWithGivenNodeAsLastName,
    isLastNameOfDottedName,
} from '../analyzer/parseTreeUtils';
import { ParseTreeWalker } from '../analyzer/parseTreeWalker';
import { ScopeType } from '../analyzer/scope';
import { getScopeForNode } from '../analyzer/scopeUtils';
import { TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { addIfUnique, createMapFromItems, getOrAdd, removeArrayElements } from '../common/collectionUtils';
import { ConfigOptions } from '../common/configOptions';
import { TextEditAction } from '../common/editAction';
import { getDirectoryPath } from '../common/pathUtils';
import { convertOffsetToPosition } from '../common/positionUtils';
import { TextRange } from '../common/textRange';
import { ModuleNameNode, NameNode, ParseNode, ParseNodeType } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';

export interface ImportData {
    containsUnreferenceableSymbols: boolean;
    declarations: Map<Declaration, NameNode[]>;
}

export class ImportAdder {
    constructor(
        private _configOptions: ConfigOptions,
        private _importResolver: ImportResolver,
        private _evaluator: TypeEvaluator
    ) {}

    collectImportsForSymbolsUsed(parseResults: ParseResults, range: TextRange, token: CancellationToken): ImportData {
        const collector = new NameCollector(this._evaluator, parseResults, range, token);
        collector.walk(parseResults.parseTree);

        return {
            containsUnreferenceableSymbols: collector.containsUnreferenceableSymbols,
            declarations: collector.declsForSymbols,
        };
    }

    applyImports(
        result: ImportData,
        parseResults: ParseResults,
        insertionPosition: number,
        token: CancellationToken
    ): TextEditAction[] {
        throwIfCancellationRequested(token);

        const filePath = getFileInfo(parseResults.parseTree).filePath;
        const importStatements = getTopLevelImports(parseResults.parseTree);
        const execEnv = this._configOptions.findExecEnvironment(filePath);

        const importNameInfo: ImportNameWithModuleInfo[] = [];
        for (const decl of result.declarations.keys() ?? []) {
            const importInfo = this._getImportInfo(decl, filePath);
            if (!importInfo) {
                continue;
            }

            const moduleAndType = this._importResolver.getModuleNameForImport(importInfo.filePath, execEnv);
            if (!moduleAndType.moduleName) {
                if (!importInfo.nameInfo.name) {
                    continue;
                }

                // module can't be addressed by absolute path in "from import" statement.
                // ex) namespace package at [workspace root] or [workspace root]\__init__.py(i)
                // use relative path
                moduleAndType.moduleName = getRelativeModuleName(
                    this._importResolver.fileSystem,
                    filePath,
                    importInfo.filePath
                );
            }

            addIfUnique(
                importNameInfo,
                { module: moduleAndType, name: importInfo.nameInfo.name, alias: importInfo.nameInfo.alias },
                (a, b) => this._areSame(a, b)
            );
        }

        const edits: TextEditAction[] = [];
        const newNameInfo: ImportNameWithModuleInfo[] = [];
        for (const moduleAndInfo of createMapFromItems(importNameInfo, (i) => i.module.moduleName)) {
            if (!this._tryProcessExistingImports(moduleAndInfo, importStatements, parseResults, edits)) {
                newNameInfo.push(...moduleAndInfo[1]);
                continue;
            }
        }

        edits.push(
            ...getTextEditsForAutoImportInsertions(
                newNameInfo,
                importStatements,
                parseResults,
                convertOffsetToPosition(insertionPosition, parseResults.tokenizerOutput.lines)
            )
        );

        return edits;
    }

    private _tryProcessExistingImports(
        moduleAndInfo: [string, ImportNameWithModuleInfo[]],
        importStatements: ImportStatements,
        parseResults: ParseResults,
        edits: TextEditAction[]
    ) {
        for (const kindAndImports of createMapFromItems(
            importStatements.orderedImports.filter((i) => i.moduleName === moduleAndInfo[0]),
            (i) => (i.node.nodeType === ParseNodeType.Import ? 'import' : 'importFrom')
        )) {
            if (kindAndImports[0] === 'importFrom') {
                // We can't merge to "from module import *" statement.
                const imported = kindAndImports[1].filter(
                    (i) => i.node.nodeType === ParseNodeType.ImportFrom && !i.node.isWildcardImport
                );
                if (imported.length === 0) {
                    // No regular from import statement.
                    continue;
                }

                // get name info that don't exist in any of existing import statements.
                const info = moduleAndInfo[1].filter(
                    (m) =>
                        !imported.some(
                            (n) =>
                                n.node.nodeType === ParseNodeType.ImportFrom &&
                                n.node.imports.some((i) => i.name.value === m.name && i.alias?.value === m.alias)
                        )
                );
                edits.push(...getTextEditsForAutoImportSymbolAddition(info, imported[0], parseResults));
                return true;
            }

            if (kindAndImports[0] === 'import') {
                // import statement already exists. skip those module info.
                removeArrayElements(
                    moduleAndInfo[1],
                    (i) => !i.name && kindAndImports[1].some((n) => i.alias === n.subnode?.alias?.value)
                );
                continue;
            }
        }

        return false;
    }

    private _getImportInfo(
        decl: Declaration,
        destFilePath: string
    ): { filePath: string; nameInfo: ImportNameInfo } | undefined {
        if (isAliasDeclaration(decl)) {
            if (!decl.node) {
                // This is synthesized decl for implicit module case such as "import a.b"
                return { filePath: decl.path, nameInfo: {} };
            }

            if (decl.node.nodeType === ParseNodeType.ImportAs) {
                const importDecl = this._evaluator.getDeclarationsForNameNode(
                    decl.node.module.nameParts[decl.node.module.nameParts.length - 1]
                );

                if (!importDecl || importDecl.length === 0) {
                    // We have no idea where it came from.
                    // ex) from unknown import unknown
                    return undefined;
                }

                return {
                    filePath: importDecl[0].path,
                    nameInfo: { alias: decl.usesLocalName ? decl.node.alias?.value : undefined },
                };
            }

            if (decl.node.nodeType === ParseNodeType.ImportFromAs) {
                let path: string | undefined = decl.path;
                if (!path) {
                    // Check submodule case with no __init__
                    if (decl.submoduleFallback) {
                        path = getDirectoryPath(decl.submoduleFallback.path);
                    }
                }

                if (!path) {
                    // We have no idea where it came from.
                    // ex) from unknown import unknown
                    return undefined;
                }

                if (path === destFilePath && !decl.usesLocalName && !decl.submoduleFallback) {
                    // Don't create import for the symbol (not module) defined in the current file
                    // unless alias is used.
                    //
                    // We don't check insertion point since we don't create type alias for decl defined later
                    // anyway. but in future, we could consider either rewrite or creating type alias for symbols
                    // defined after insertion point.
                    return undefined;
                }

                return {
                    filePath: path,
                    nameInfo: {
                        name: decl.symbolName,
                        alias: decl.usesLocalName ? decl.node.alias?.value : undefined,
                    },
                };
            }

            if (decl.node.nodeType === ParseNodeType.ImportFrom) {
                return {
                    filePath: decl.path,
                    nameInfo: { name: decl.symbolName },
                };
            }
        }

        if (isVariableDeclaration(decl) || isFunctionDeclaration(decl) || isClassDeclaration(decl)) {
            const name = getNameFromDeclaration(decl);
            if (!name) {
                return undefined;
            }

            return {
                filePath: decl.path,
                nameInfo: { name },
            };
        }

        return undefined;
    }

    private _areSame(a: ImportNameWithModuleInfo, b: ImportNameWithModuleInfo) {
        return (
            a.alias === b.alias &&
            a.name === b.name &&
            a.module.importType === b.module.importType &&
            a.module.isLocalTypingsFile === b.module.isLocalTypingsFile &&
            a.module.moduleName === b.module.moduleName
        );
    }
}

class NameCollector extends ParseTreeWalker {
    private readonly _filePath: string;

    // Hold onto names that we need to move imports.
    readonly declsForSymbols = new Map<Declaration, NameNode[]>();
    containsUnreferenceableSymbols = false;

    constructor(
        private _evaluator: TypeEvaluator,
        private _parseResults: ParseResults,
        private _range: TextRange,
        private _token: CancellationToken
    ) {
        super();

        this._filePath = getFileInfo(this._parseResults.parseTree).filePath;

        // For now, we assume the given range is at right boundary such as statement, statements, expression or expressions.
        // In future, we might consider validating the range and adjusting it to the right boundary if needed.
    }

    override walk(node: ParseNode) {
        if (!TextRange.overlapsRange(this._range, node)) {
            return;
        }

        super.walk(node);
    }

    override visitModuleName(node: ModuleNameNode) {
        // We only care about references to module symbols. not decls.
        return false;
    }

    override visitName(name: NameNode) {
        throwIfCancellationRequested(this._token);

        // We process dotted name as a whole rather than
        // process each part of dotted name.
        if (!isLastNameOfDottedName(name)) {
            return false;
        }

        const dottedName = getDottedName(getDottedNameWithGivenNodeAsLastName(name));
        if (!dottedName) {
            // Not dotted name
            // ex) foo().[var]
            return false;
        }

        // See whether the first dotted name bound to symbols defined in current file.
        const firstName = dottedName[0];
        const firstNameDecls = this._getDeclarationsInModule(firstName);
        if (!firstNameDecls || firstNameDecls.length === 0) {
            return false;
        }

        // Simple case.
        // ex) import os
        //     [os]
        if (dottedName.length === 1) {
            this._handleName(firstName, firstNameDecls);
            return false;
        }

        for (const firstNameDecl of firstNameDecls) {
            if (!isAliasDeclaration(firstNameDecl) || firstNameDecl.node.nodeType !== ParseNodeType.ImportAs) {
                // decls we have is for symbols defined in current module.
                // ex) [foo]()
                this._handleName(firstName, [firstNameDecl]);
                continue;
            }

            // Import with alias
            // ex) import json.encoder as j
            if (firstNameDecl.usesLocalName) {
                this._handleName(firstName, [firstNameDecl]);
                continue;
            }

            // Special casing import statement with sub module ex) import a.[b]
            // It is complex for import a.[b] case since decl for [b] doesn't exist. so
            // when binding a.[b].foo(), we don't get decl for "import a.[b]", we need to
            // do some tree walk to find import a.[b] and synthesize decl for it.
            this._handleImplicitImports(firstNameDecl, dottedName, 1);
        }

        return false;
    }

    private _getDeclarationsInModule(name: NameNode) {
        return this._evaluator.getDeclarationsForNameNode(name)?.filter((d) => isDefinedInFile(d, this._filePath));
    }

    private _handleImplicitImports(
        aliasDecl: { path: string; implicitImports?: Map<string, ModuleLoaderActions> },
        dottedName: NameNode[],
        nameIndex: number
    ) {
        if (dottedName.length === nameIndex) {
            return;
        }

        if (!aliasDecl.implicitImports) {
            this._handleName(dottedName[nameIndex - 1], [createSynthesizedAliasDeclaration(aliasDecl.path)]);
            return;
        }

        const implicitImportDecl = aliasDecl.implicitImports.get(dottedName[nameIndex].value);
        if (!implicitImportDecl) {
            this._handleName(dottedName[nameIndex - 1], [createSynthesizedAliasDeclaration(aliasDecl.path)]);
            return;
        }

        this._handleImplicitImports(implicitImportDecl, dottedName, nameIndex + 1);
    }

    private _handleName(name: NameNode, decls: Declaration[]) {
        for (const decl of decls) {
            if (decl.node && TextRange.containsRange(this._range, decl.node)) {
                // Make sure our range doesn't already contain them.
                continue;
            }

            if (isParameterDeclaration(decl)) {
                // Parameter is not referenceable from import statement.
                this.containsUnreferenceableSymbols = true;
                continue;
            }

            if (isVariableDeclaration(decl) || isFunctionDeclaration(decl) || isClassDeclaration(decl)) {
                // For now, we will allow private variable to be referenced by import
                // so that user can fix it up once import is added.

                // We only support top level variables.
                const scope = getScopeForNode(name);
                if (!scope) {
                    this.containsUnreferenceableSymbols = true;
                    continue;
                }

                const result = scope.lookUpSymbolRecursive(name.value);
                if (!result || result.scope.type !== ScopeType.Module) {
                    this.containsUnreferenceableSymbols = true;
                    continue;
                }
            }

            this._addName(decl, name);
        }
    }

    private _addName(decl: Declaration, name: NameNode) {
        getOrAdd(this.declsForSymbols, decl, () => []).push(name);
    }
}
