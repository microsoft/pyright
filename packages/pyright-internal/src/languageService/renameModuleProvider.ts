/*
 * renameModuleProvider.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Logic that updates affected references of a module rename/move.
 */

import { CancellationToken } from 'vscode-languageserver';

import { getImportInfo } from '../analyzer/analyzerNodeInfo';
import {
    AliasDeclaration,
    Declaration,
    isAliasDeclaration,
    isClassDeclaration,
    isFunctionDeclaration,
    isVariableDeclaration,
} from '../analyzer/declaration';
import { createSynthesizedAliasDeclaration, getNameFromDeclaration } from '../analyzer/declarationUtils';
import { createImportedModuleDescriptor, ImportResolver, ModuleNameAndType } from '../analyzer/importResolver';
import {
    getDirectoryLeadingDotsPointsTo,
    getImportGroupFromModuleNameAndType,
    getRelativeModuleName,
    getTextEditsForAutoImportInsertion,
    getTextEditsForAutoImportSymbolAddition,
    getTextRangeForImportNameDeletion,
    getTopLevelImports,
    ImportNameInfo,
    ImportStatement,
    ImportStatements,
} from '../analyzer/importStatementUtils';
import {
    getDottedNameWithGivenNodeAsLastName,
    getFirstAncestorOrSelfOfKind,
    getFullStatementRange,
    isFromImportAlias,
    isFromImportModuleName,
    isFromImportName,
    isImportAlias,
    isImportModuleName,
    isLastNameOfModuleName,
} from '../analyzer/parseTreeUtils';
import { ParseTreeWalker } from '../analyzer/parseTreeWalker';
import { isStubFile } from '../analyzer/sourceMapper';
import { TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import { getOrAdd, removeArrayElements } from '../common/collectionUtils';
import { ConfigOptions } from '../common/configOptions';
import { isString } from '../common/core';
import { assert, assertNever } from '../common/debug';
import { FileEditAction } from '../common/editAction';
import { FileSystem } from '../common/fileSystem';
import {
    combinePaths,
    getDirectoryChangeKind,
    getDirectoryPath,
    getFileName,
    isDirectory,
    isFile,
    resolvePaths,
    stripFileExtension,
} from '../common/pathUtils';
import { convertOffsetToPosition, convertTextRangeToRange } from '../common/positionUtils';
import { doRangesIntersect, extendRange, Range, rangesAreEqual, TextRange } from '../common/textRange';
import {
    ImportAsNode,
    ImportFromAsNode,
    ImportFromNode,
    ImportNode,
    isExpressionNode,
    MemberAccessNode,
    ModuleNameNode,
    ModuleNode,
    NameNode,
    ParseNode,
    ParseNodeType,
} from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';
import { CollectionResult, DocumentSymbolCollector } from './documentSymbolCollector';

enum UpdateType {
    File,
    Folder,
    Symbol,
}

export class RenameModuleProvider {
    static createForModule(
        importResolver: ImportResolver,
        configOptions: ConfigOptions,
        evaluator: TypeEvaluator,
        path: string,
        newPath: string,
        token: CancellationToken
    ): RenameModuleProvider | undefined {
        if (!importResolver.fileSystem.existsSync(path)) {
            return undefined;
        }

        if (isFile(importResolver.fileSystem, path)) {
            return this._create(importResolver, configOptions, evaluator, path, newPath, UpdateType.File, token);
        } else if (isDirectory(importResolver.fileSystem, path)) {
            // Make sure folder path is simple rename.
            if (getDirectoryChangeKind(importResolver.fileSystem, path, newPath) !== 'Renamed') {
                return undefined;
            }

            // We don't support namespace folder name. Currently, we don't have
            // a way to find namespace folder references.
            let fileNameForPackage = combinePaths(path, '__init__.pyi');
            if (!importResolver.fileSystem.existsSync(fileNameForPackage)) {
                fileNameForPackage = combinePaths(path, '__init__.py');
                if (!importResolver.fileSystem.existsSync(fileNameForPackage)) {
                    return undefined;
                }
            }

            return this._create(
                importResolver,
                configOptions,
                evaluator,
                fileNameForPackage,
                combinePaths(newPath, getFileName(fileNameForPackage)),
                UpdateType.Folder,
                token
            );
        }

        return undefined;
    }

    static createForSymbol(
        importResolver: ImportResolver,
        configOptions: ConfigOptions,
        evaluator: TypeEvaluator,
        path: string,
        newPath: string,
        declarations: Declaration[],
        token: CancellationToken
    ): RenameModuleProvider | undefined {
        if (!importResolver.fileSystem.existsSync(path)) {
            return undefined;
        }

        const filteredDecls = declarations.filter(
            (d) => isClassDeclaration(d) || isFunctionDeclaration(d) || isVariableDeclaration(d)
        );

        if (filteredDecls.length === 0) {
            return undefined;
        }

        return this._create(
            importResolver,
            configOptions,
            evaluator,
            path,
            newPath,
            UpdateType.Symbol,
            filteredDecls,
            token!
        );
    }

    private static _create(
        importResolver: ImportResolver,
        configOptions: ConfigOptions,
        evaluator: TypeEvaluator,
        moduleFilePath: string,
        newModuleFilePath: string,
        type: UpdateType,
        tokenOrDeclarations: Declaration[] | CancellationToken,
        token?: CancellationToken
    ): RenameModuleProvider | undefined {
        const execEnv = configOptions.findExecEnvironment(moduleFilePath);
        const moduleName = importResolver.getModuleNameForImport(moduleFilePath, execEnv);
        if (!moduleName.moduleName) {
            return undefined;
        }

        const newModuleName = importResolver.getModuleNameForImport(newModuleFilePath, execEnv);
        if (!newModuleName.moduleName) {
            return undefined;
        }

        token = CancellationToken.is(tokenOrDeclarations) ? tokenOrDeclarations : token;
        const declarations = CancellationToken.is(tokenOrDeclarations) ? [] : tokenOrDeclarations;
        if (declarations.length === 0) {
            // Create synthesized alias decls from the given file path. If the given file is for stub,
            // create one for the corresponding py file as well.
            declarations.push(createSynthesizedAliasDeclaration(moduleFilePath));
            if (isStubFile(moduleFilePath)) {
                // The resolveImport should make sure non stub file search to happen.
                importResolver.resolveImport(
                    moduleFilePath,
                    execEnv,
                    createImportedModuleDescriptor(moduleName.moduleName)
                );

                importResolver
                    .getSourceFilesFromStub(moduleFilePath, execEnv, /*mapCompiled*/ false)
                    .forEach((p) => declarations!.push(createSynthesizedAliasDeclaration(p)));
            }
        }

        return new RenameModuleProvider(
            importResolver.fileSystem,
            evaluator,
            moduleFilePath,
            newModuleFilePath,
            moduleName,
            newModuleName,
            type,
            declarations,
            token!
        );
    }

    private readonly _newModuleFilePath: string;
    private readonly _moduleNames: string[];
    private readonly _newModuleNames: string[];
    private readonly _onlyNameChanged: boolean;
    private readonly _results = new Map<string, FileEditAction[]>();
    private readonly _aliasIntroduced = new Set<ImportAsNode>();

    private constructor(
        private _fs: FileSystem,
        private _evaluator: TypeEvaluator,
        private _moduleFilePath: string,
        newModuleFilePath: string,
        private _moduleNameAndType: ModuleNameAndType,
        private _newModuleNameAndType: ModuleNameAndType,
        private _type: UpdateType,
        private _declarations: Declaration[],
        private _token: CancellationToken
    ) {
        // moduleName and newModuleName are always in the absolute path form.
        this._newModuleFilePath = resolvePaths(newModuleFilePath);

        this._moduleNames = this._moduleName.split('.');
        this._newModuleNames = this._newModuleName.split('.');

        if (this._moduleNames.length !== this._newModuleNames.length) {
            this._onlyNameChanged = false;
            return;
        }

        let i = 0;
        for (i = 0; i < this._moduleNames.length - 1; i++) {
            if (this._moduleNames[i] !== this._newModuleNames[i]) {
                break;
            }
        }

        this._onlyNameChanged = i === this._moduleNames.length - 1;
        assert(this._type !== UpdateType.Folder || this._onlyNameChanged, 'We only support simple rename for folder');
    }

    renameReferences(filePath: string, parseResults: ParseResults) {
        switch (this._type) {
            case UpdateType.Folder:
                return this._renameFolderReferences(filePath, parseResults);
            case UpdateType.File:
                return this._renameModuleReferences(filePath, parseResults);
            case UpdateType.Symbol:
                return this._updateSymbolReferences(filePath, parseResults);
            default:
                return assertNever(this._type, `${this._type} is unknown`);
        }
    }

    private _updateSymbolReferences(filePath: string, parseResults: ParseResults) {
        const collector = new DocumentSymbolCollector(
            getNameFromDeclaration(this._declarations[0]) ?? '',
            this._declarations,
            this._evaluator!,
            this._token,
            parseResults.parseTree,
            /*treatModuleImportAndFromImportSame*/ true
        );

        // See if we need to insert new import statement
        const importStatements = getTopLevelImports(parseResults.parseTree, /*includeImplicitImports*/ true);

        // See whether we have existing import statement for the same module
        // ex) import [moduleName] or from ... import [moduleName]
        const imported = importStatements.orderedImports.find((i) => i.moduleName === this._newModuleName);

        const nameRemoved = new Set<number>();
        const importUsed = new Map<ImportAsNode | ImportFromAsNode, MemberAccessNode[]>();
        for (const result of collector.collect()) {
            const nodeFound = result.node;

            if (nodeFound.nodeType === ParseNodeType.String) {
                // Ignore symbol appearing in the __all__. it should be handled
                // when decl is moved.
                continue;
            }

            if (isFromImportName(nodeFound)) {
                // ex) from ... import [symbol] ...
                const fromNode = nodeFound.parent?.parent as ImportFromNode;
                const newModuleName = this._getNewModuleName(
                    filePath,
                    fromNode.module.leadingDots > 0,
                    /* isLastPartImportName */ false
                );

                if (fromNode.imports.length === 1) {
                    // ex) "from [module] import symbol" to "from [module.changed] import symbol"
                    this._addResultWithTextRange(filePath, fromNode.module, parseResults, newModuleName);
                } else {
                    // ex) "from module import symbol, another_symbol" to
                    //     "from module import another_symbol" and "from module.changed import symbol"

                    // Delete the existing import name including alias.
                    const importFromAs = nodeFound.parent as ImportFromAsNode;
                    this._addFromImportNameDeletion(
                        filePath,
                        parseResults,
                        nameRemoved,
                        fromNode.imports,
                        importFromAs
                    );

                    // For now, this won't merge absolute and relative path "from import" statement.
                    const importNameInfo = {
                        name: importFromAs.name.value,
                        alias: importFromAs.alias?.value,
                    };

                    this._addResultEdits(
                        this._getTextEditsForNewOrExistingFromImport(
                            filePath,
                            fromNode,
                            parseResults,
                            nameRemoved,
                            importStatements,
                            newModuleName,
                            [importNameInfo]
                        )
                    );
                }

                continue;
            }

            const dottedName = getDottedNameWithGivenNodeAsLastName(nodeFound);
            if (dottedName === nodeFound || dottedName.nodeType !== ParseNodeType.MemberAccess) {
                // ex) from module import foo
                //     foo
                //     foo.method()
                //
                //     from module import *
                //     foo()
                //     bar()
                //
                //     we don't need to do anything for wild card case since
                //     we will preserve __all__ entries.
                continue;
            }

            const moduleName =
                dottedName.leftExpression.nodeType === ParseNodeType.MemberAccess
                    ? dottedName.leftExpression.memberName
                    : dottedName.leftExpression.nodeType === ParseNodeType.Name
                    ? dottedName.leftExpression
                    : undefined;
            if (!moduleName) {
                // ex) from module import foo
                //     getModule().foo
                continue;
            }

            const moduleDecl = this._evaluator
                .getDeclarationsForNameNode(moduleName)
                ?.filter(
                    (d) =>
                        isAliasDeclaration(d) &&
                        (d.node.nodeType === ParseNodeType.ImportAs || d.node.nodeType === ParseNodeType.ImportFromAs)
                );
            if (!moduleDecl || moduleDecl.length === 0) {
                // ex) from xxx import yyy
                //     yyy.property.foo
                continue;
            }

            const importAs = moduleDecl[0].node as ImportAsNode | ImportFromAsNode;
            getOrAdd(importUsed, importAs, () => []).push(dottedName);
            continue;
        }

        // Handle symbol references that are used off imported modules.
        for (const [key, value] of importUsed) {
            let referenceModuleName: string;
            if (this._canReplaceImportName(parseResults, key, value)) {
                const moduleName = this._getReferenceModuleName(importStatements, imported);
                if (key.nodeType === ParseNodeType.ImportAs) {
                    if (moduleName) {
                        referenceModuleName = moduleName;
                        this._addImportNameDeletion(
                            filePath,
                            parseResults,
                            nameRemoved,
                            (key.parent as ImportNode).list,
                            key
                        );
                    } else {
                        referenceModuleName = key.alias ? key.alias.value : this._newModuleName;
                        this._addResultWithTextRange(filePath, key.module, parseResults, this._newModuleName);
                    }
                } else {
                    if (moduleName) {
                        referenceModuleName = moduleName;
                        this._addFromImportNameDeletion(
                            filePath,
                            parseResults,
                            nameRemoved,
                            (key.parent as ImportFromNode).imports,
                            key
                        );
                    } else {
                        const fromNode = key.parent as ImportFromNode;
                        const newModuleName = this._getNewModuleName(
                            filePath,
                            fromNode.module.leadingDots > 0,
                            /* isLastPartImportName */ true
                        );

                        referenceModuleName = key.alias ? key.alias.value : this._newLastModuleName;
                        this._addResultWithTextRange(filePath, fromNode.module, parseResults, newModuleName);
                        this._addResultWithTextRange(filePath, key.name, parseResults, this._newLastModuleName);
                    }
                }
            } else {
                const moduleName = this._getReferenceModuleName(importStatements, imported);
                if (moduleName) {
                    referenceModuleName = moduleName;
                } else {
                    referenceModuleName = this._newModuleName;
                    this._addResultEdits(
                        getTextEditsForAutoImportInsertion(
                            [],
                            importStatements,
                            this._newModuleName,
                            getImportGroupFromModuleNameAndType(this._newModuleNameAndType),
                            parseResults,
                            convertOffsetToPosition(parseResults.parseTree.length, parseResults.tokenizerOutput.lines)
                        ).map((e) => ({ filePath, range: e.range, replacementText: e.replacementText }))
                    );
                }
            }

            for (const node of value) {
                this._addResultWithTextRange(filePath, node.leftExpression, parseResults, referenceModuleName);
            }
        }
    }

    private _getReferenceModuleName(
        importStatements: ImportStatements,
        imported: ImportStatement | undefined
    ): string | undefined {
        if (imported && imported.node.nodeType === ParseNodeType.Import) {
            return imported.subnode?.alias ? imported.subnode.alias.value : this._newModuleName;
        } else if (importStatements.implicitImports?.has(this._newModuleFilePath)) {
            const fromImportAs = importStatements.implicitImports.get(this._newModuleFilePath)!;
            return fromImportAs.alias ? fromImportAs.alias.value : fromImportAs.name.value;
        }

        return undefined;
    }

    private _canReplaceImportName(
        parseResults: ParseResults,
        importAs: ImportAsNode | ImportFromAsNode,
        symbolReferences: MemberAccessNode[]
    ): boolean {
        const nameToBind =
            importAs.alias ??
            (importAs.nodeType === ParseNodeType.ImportAs
                ? importAs.module.nameParts[importAs.module.nameParts.length - 1]
                : importAs.name);

        const declarations = DocumentSymbolCollector.getDeclarationsForNode(
            nameToBind,
            this._evaluator,
            /*resolveLocalName*/ false,
            this._token
        );
        if (declarations.length === 0) {
            return false;
        }

        const collector = new DocumentSymbolCollector(
            nameToBind.value,
            declarations,
            this._evaluator!,
            this._token,
            parseResults.parseTree,
            /*treatModuleImportAndFromImportSame*/ true
        );

        for (const result of collector.collect()) {
            if (
                isImportModuleName(result.node) ||
                isImportAlias(result.node) ||
                isFromImportModuleName(result.node) ||
                isFromImportName(result.node) ||
                isFromImportAlias(result.node)
            ) {
                // collector will report decls as well. ignore decls.
                continue;
            }

            if (!symbolReferences.some((s) => TextRange.containsRange(s, result.node))) {
                return false;
            }
        }

        return true;
    }

    private _renameFolderReferences(filePath: string, parseResults: ParseResults) {
        const collector = new DocumentSymbolCollector(
            this.lastModuleName,
            this._declarations,
            this._evaluator!,
            this._token,
            parseResults.parseTree,
            /*treatModuleImportAndFromImportSame*/ true
        );

        // We only support simple rename of folder. Change all occurrence of the old folder name
        // to new name.
        for (const result of collector.collect()) {
            this._addResultWithTextRange(filePath, result.range, parseResults, this._newLastModuleName);
        }
    }

    private _renameModuleReferences(filePath: string, parseResults: ParseResults) {
        const collector = new DocumentSymbolCollector(
            this.lastModuleName,
            this._declarations,
            this._evaluator!,
            this._token,
            parseResults.parseTree,
            /*treatModuleImportAndFromImportSame*/ true
        );

        const nameRemoved = new Set<number>();
        const results = collector.collect();

        // Update module references first.
        this._updateModuleReferences(filePath, parseResults, nameRemoved, results);

        // If the module file has moved, we need to update all relative paths used in the file to reflect the move.
        this._updateRelativeModuleNamePath(filePath, parseResults, nameRemoved, results);
    }

    private _updateRelativeModuleNamePath(
        filePath: string,
        parseResults: ParseResults,
        nameRemoved: Set<number>,
        results: CollectionResult[]
    ) {
        if (filePath !== this._moduleFilePath) {
            // We only update relative import paths for the file that has moved.
            return;
        }

        let importStatements: ImportStatements | undefined;

        // Filter out module name that is already re-written.
        for (const edit of this._getNewRelativeModuleNamesForFileMoved(
            filePath,
            ModuleNameCollector.collect(parseResults.parseTree).filter(
                (m) => !results.some((r) => TextRange.containsRange(m.parent!, r.node))
            )
        )) {
            this._addResultWithTextRange(filePath, edit.moduleName, parseResults, edit.newModuleName);

            if (!edit.itemsToMove) {
                continue;
            }

            // This could introduce multiple import statements for same modules with
            // different symbols per module name. Unfortunately, there is no easy way to
            // prevent it since we can't see changes made by other code until all changes
            // are committed. In future, if we support snapshot and diff between snapshots,
            // then we can support those complex code generations.
            const fromNode = edit.moduleName.parent as ImportFromNode;

            // First, delete existing exported symbols from "from import" statement.
            for (const importFromAs of edit.itemsToMove) {
                this._addFromImportNameDeletion(filePath, parseResults, nameRemoved, fromNode.imports, importFromAs);
            }

            importStatements =
                importStatements ?? getTopLevelImports(parseResults.parseTree, /*includeImplicitImports*/ false);

            // For now, this won't merge absolute and relative path "from import"
            // statement.
            this._addResultEdits(
                this._getTextEditsForNewOrExistingFromImport(
                    filePath,
                    fromNode,
                    parseResults,
                    nameRemoved,
                    importStatements,
                    getRelativeModuleName(
                        this._fs,
                        this._newModuleFilePath,
                        this._newModuleFilePath,
                        /*ignoreFolderStructure*/ false,
                        /*sourceIsFile*/ true
                    ),
                    edit.itemsToMove.map((i) => {
                        return { name: i.name.value, alias: i.alias?.value };
                    })
                )
            );
        }
    }

    private _updateModuleReferences(
        filePath: string,
        parseResults: ParseResults,
        nameRemoved: Set<number>,
        results: CollectionResult[]
    ) {
        let importStatements: ImportStatements | undefined;
        for (const result of results) {
            const nodeFound = result.node;

            if (nodeFound.nodeType === ParseNodeType.String) {
                // ex) __all__ = ["[a]"]
                this._addResultWithTextRange(filePath, result.range, parseResults, this._newLastModuleName);
                continue;
            }

            if (isImportModuleName(nodeFound)) {
                if (!isLastNameOfModuleName(nodeFound)) {
                    // It must be directory and we don't support folder rename.
                    continue;
                }

                const moduleNameNode = getFirstAncestorOrSelfOfKind(nodeFound, ParseNodeType.ModuleName)!;

                // * Enhancement * one case we don't handle is introducing new symbol in __all__
                // or converting "import" statement to "from import" statement.
                //
                // when the existing statement was "import x as x" and it is changed to
                // "import y.z as z". we either need to introduce "z" in __all__ or convert
                // "import y.z as z" to "from y import z as z" to make sure we keep the symbol
                // visibility same.
                //
                // when we convert "import x as x" to "from y import z as z", we need to handle
                // deletion of existing import statement or (x as x) and inserting/merging
                // new "from import" statement.

                // If original module name was single word and it becomes dotted name without alias,
                // then we introduce alias to keep references as a single word.
                // ex) import [xxx] to import [aaa.bbb as bbb]
                if (
                    moduleNameNode.nameParts.length === 1 &&
                    moduleNameNode.parent?.nodeType === ParseNodeType.ImportAs &&
                    !moduleNameNode.parent.alias &&
                    this._newModuleNames.length > 1
                ) {
                    this._aliasIntroduced.add(moduleNameNode.parent);

                    this._addResultWithTextRange(
                        filePath,
                        moduleNameNode,
                        parseResults,
                        `${this._newModuleName} as ${this._newLastModuleName}`
                    );
                    continue;
                }

                // Otherwise, update whole module name to new name
                // ex) import [xxx.yyy] to import [aaa.bbb]
                this._addResultWithTextRange(filePath, moduleNameNode, parseResults, this._newModuleName);
                continue;
            }

            if (isImportAlias(nodeFound)) {
                // ex) import xxx as [yyy] to import xxx as [zzz]
                this._addResultWithTextRange(filePath, result.range, parseResults, this._newLastModuleName);
                continue;
            }

            if (isFromImportModuleName(nodeFound)) {
                if (!isLastNameOfModuleName(nodeFound)) {
                    // It must be directory and we don't support folder rename.
                    continue;
                }

                const moduleNameNode = getFirstAncestorOrSelfOfKind(nodeFound, ParseNodeType.ModuleName)!;
                const fromNode = moduleNameNode.parent as ImportFromNode;

                // We need to check whether imports of this import statement has
                // any implicit submodule imports or not. If there is one, we need to
                // either split or leave it as it is.
                const exportedSymbols = [];
                const subModules = [];
                for (const importFromAs of fromNode.imports) {
                    if (this._isExportedSymbol(importFromAs.name)) {
                        exportedSymbols.push(importFromAs);
                    } else {
                        subModules.push(importFromAs);
                    }
                }

                if (subModules.length === 0) {
                    // We don't have any sub modules, we can change module name to new one.
                    // Update whole module name to new name.
                    // ex) from [xxx.yyy] import zzz to from [aaa.bbb] import zzz
                    this._addResultWithTextRange(
                        filePath,
                        moduleNameNode,
                        parseResults,
                        this._getNewModuleName(
                            filePath,
                            moduleNameNode.leadingDots > 0,
                            /* isLastPartImportName */ false
                        )
                    );
                    continue;
                }

                if (exportedSymbols.length === 0) {
                    // We only have sub modules. That means module name actually refers to
                    // folder name, not module (ex, __init__.py). Folder rename is done by
                    // different code path.
                    continue;
                }

                // Now, we need to split "from import" statement to 2.

                // Update module name if needed.
                if (fromNode.module.leadingDots > 0) {
                    for (const edit of this._getNewRelativeModuleNamesForFileMoved(filePath, [fromNode.module])) {
                        this._addResultWithTextRange(filePath, edit.moduleName, parseResults, edit.newModuleName);
                    }
                }

                // First, delete existing exported symbols from "from import" statement.
                for (const importFromAs of exportedSymbols) {
                    this._addFromImportNameDeletion(
                        filePath,
                        parseResults,
                        nameRemoved,
                        fromNode.imports,
                        importFromAs
                    );
                }

                importStatements =
                    importStatements ?? getTopLevelImports(parseResults.parseTree, /*includeImplicitImports*/ false);

                // For now, this won't merge absolute and relative path "from import"
                // statement.
                this._addResultEdits(
                    this._getTextEditsForNewOrExistingFromImport(
                        filePath,
                        fromNode,
                        parseResults,
                        nameRemoved,
                        importStatements,
                        this._newModuleName,
                        exportedSymbols.map((i) => {
                            const name =
                                results.findIndex((r) => r.node === i.name) >= 0
                                    ? this._newLastModuleName
                                    : i.name.value;
                            const alias =
                                results.findIndex((r) => r.node === i.alias) >= 0
                                    ? this._newLastModuleName
                                    : i.alias?.value;

                            return { name, alias };
                        })
                    )
                );
                continue;
            }

            if (isFromImportName(nodeFound)) {
                if (nameRemoved.has(nodeFound.id)) {
                    // Import name is already removed.
                    continue;
                }

                const fromNode = nodeFound.parent?.parent as ImportFromNode;
                const newModuleName = this._getNewModuleName(
                    filePath,
                    fromNode.module.leadingDots > 0,
                    /* isLastPartImportName */ true
                );

                // If the name bound to symbol re-exported, we don't need to update module name.
                // Existing logic should make sure re-exported symbol name work as before after
                // symbol rename.
                if (this._isExportedSymbol(nodeFound)) {
                    this._addResultWithTextRange(filePath, result.range, parseResults, this._newLastModuleName);
                    continue;
                }

                if (fromNode.imports.length === 1) {
                    // ex) from xxx import [yyy] to from [aaa.bbb] import [zzz]
                    this._addResultWithTextRange(filePath, fromNode.module, parseResults, newModuleName);
                    this._addResultWithTextRange(filePath, result.range, parseResults, this._newLastModuleName);
                } else {
                    // Delete the existing import name including alias.
                    const importFromAs = nodeFound.parent as ImportFromAsNode;

                    // Update module name if needed.
                    if (fromNode.module.leadingDots > 0) {
                        for (const edit of this._getNewRelativeModuleNamesForFileMoved(filePath, [fromNode.module])) {
                            this._addResultWithTextRange(filePath, edit.moduleName, parseResults, edit.newModuleName);
                        }
                    }

                    this._addFromImportNameDeletion(
                        filePath,
                        parseResults,
                        nameRemoved,
                        fromNode.imports,
                        importFromAs
                    );

                    importStatements =
                        importStatements ??
                        getTopLevelImports(parseResults.parseTree, /*includeImplicitImports*/ false);

                    // ex) from xxx import yyy, [zzz] to
                    //     from xxx import yyy
                    //     from [aaa.bbb] import [ccc]
                    // or
                    //     from aaa.bbb import ddd
                    //     from xxx import yyy, [zzz] to
                    //     from aaa.bbb import [ccc], ddd
                    //
                    // For now, this won't merge absolute and relative path "from import"
                    // statement.
                    const importNameInfo = {
                        name: this._newLastModuleName,
                        alias:
                            importFromAs.alias?.value === this.lastModuleName
                                ? this._newLastModuleName
                                : importFromAs.alias?.value,
                    };

                    this._addResultEdits(
                        this._getTextEditsForNewOrExistingFromImport(
                            filePath,
                            fromNode,
                            parseResults,
                            nameRemoved,
                            importStatements,
                            newModuleName,
                            [importNameInfo]
                        )
                    );
                }
                continue;
            }

            if (isFromImportAlias(nodeFound)) {
                if (nameRemoved.has(nodeFound.id)) {
                    // alias is already removed.
                    continue;
                }

                // ex) from ccc import xxx as [yyy] to from ccc import xxx as [zzz]
                this._addResultWithTextRange(filePath, result.range, parseResults, this._newLastModuleName);
                continue;
            }

            /** TODO: if we get more than 1 decls, flag it as attention needed */
            const decls = DocumentSymbolCollector.getDeclarationsForNode(
                nodeFound,
                this._evaluator,
                /*resolveLocalName*/ false,
                this._token
            ).filter((d) => isAliasDeclaration(d)) as AliasDeclaration[];

            if (this._onlyNameChanged) {
                // Simple case. only name has changed. but not path.
                // Just replace name to new symbol name.
                // ex) a.[b].foo() to a.[z].foo()
                this._addResultWithTextRange(filePath, result.range, parseResults, this._newLastModuleName);
                continue;
            }

            if (
                decls?.some(
                    (d) =>
                        !d.usesLocalName &&
                        (!d.node || d.node.nodeType === ParseNodeType.ImportAs) &&
                        !this._aliasIntroduced.has(d.node)
                )
            ) {
                const dottedName = getDottedNameWithGivenNodeAsLastName(nodeFound);
                if (dottedName.parent?.nodeType !== ParseNodeType.MemberAccess) {
                    // Replace whole dotted name with new module name.
                    this._addResultWithTextRange(filePath, dottedName, parseResults, this._newModuleName);
                    continue;
                }

                // Check whether name after me is sub module or not.
                // ex) a.b.[c]
                const nextNameDecl = this._evaluator.getDeclarationsForNameNode(dottedName.parent.memberName);
                if (!nextNameDecl || nextNameDecl.length === 0) {
                    // Next dotted name is sub module. That means dottedName actually refers to folder names, not modules.
                    // and We don't support renaming folder. So, leave things as they are.
                    // ex) import a.b.c
                    //     [a.b].[c]
                    continue;
                }

                // Next name is actual symbol. Replace whole name to new module name.
                // ex) import a.b.c
                //     [a.b.c].[foo]()
                this._addResultWithTextRange(filePath, dottedName, parseResults, this._newModuleName);
                continue;
            }

            if (result.node.value !== this._newLastModuleName) {
                this._addResultWithTextRange(filePath, result.range, parseResults, this._newLastModuleName);
                continue;
            }
        }
    }

    private _getNewRelativeModuleNamesForFileMoved(filePath: string, moduleNames: ModuleNameNode[]) {
        if (filePath !== this._moduleFilePath) {
            // We only update relative import paths for the file that has moved.
            return [];
        }

        const originalFileName = stripFileExtension(getFileName(filePath));
        const originalInit = originalFileName === '__init__';
        const originalDirectory = getDirectoryPath(filePath);

        const newNames: { moduleName: ModuleNameNode; newModuleName: string; itemsToMove?: ImportFromAsNode[] }[] = [];
        for (const moduleName of moduleNames) {
            // Filter out all absolute path.
            if (moduleName.leadingDots === 0) {
                continue;
            }

            const result = this._getNewModuleNameInfoForFileMoved(moduleName, originalInit, originalDirectory);
            if (!result) {
                continue;
            }

            const newModuleName = getRelativeModuleName(
                this._fs,
                result.src,
                result.dest,
                /*ignoreFolderStructure*/ false,
                /*sourceIsFile*/ true
            );

            newNames.push({ moduleName, newModuleName, itemsToMove: result.itemsToMove });
        }

        return newNames;
    }

    private _getNewModuleNameInfoForFileMoved(
        moduleName: ModuleNameNode,
        originalInit: boolean,
        originalDirectory: string
    ) {
        const importInfo = getImportInfo(moduleName);
        if (!importInfo) {
            return undefined;
        }

        let importPath = importInfo.resolvedPaths[importInfo.resolvedPaths.length - 1];
        if (!importPath) {
            // It is possible for the module name to point to namespace folder (no __init__).
            // See whether we can use some heuristic to get importPath
            if (moduleName.nameParts.length === 0) {
                const directory = getDirectoryLeadingDotsPointsTo(originalDirectory, moduleName.leadingDots);
                if (!directory) {
                    return undefined;
                }

                // Add fake __init__.py since we know this is namespace folder.
                importPath = combinePaths(directory, '__init__.py');
            } else {
                return undefined;
            }
        }

        // Check whether module is pointing to moved file itself and whether it is __init__
        if (this._moduleFilePath !== importPath || !originalInit) {
            return { src: this._newModuleFilePath, dest: importPath };
        }

        // Now, moduleName is pointing to __init__ which point to moved file itself.

        // We need to check whether imports of this import statement has
        // any implicit submodule imports or not. If there is one, we need to
        // either split or leave it as it is.
        const exportedSymbols = [];
        const subModules = [];
        for (const importFromAs of (moduleName.parent as ImportFromNode).imports) {
            if (this._isExportedSymbol(importFromAs.name)) {
                exportedSymbols.push(importFromAs);
            } else {
                subModules.push(importFromAs);
            }
        }

        // Point to itself.
        if (subModules.length === 0) {
            return { src: this._newModuleFilePath, dest: this._newModuleFilePath };
        }

        // "." is used to point folder location.
        if (exportedSymbols.length === 0) {
            return { src: this._newModuleFilePath, dest: this._moduleFilePath };
        }

        // now we need to split, provide split info as well.
        return {
            src: this._newModuleFilePath,
            dest: this._moduleFilePath,
            itemsToMove: [...exportedSymbols],
        };
    }

    private _isExportedSymbol(nameNode: NameNode): boolean {
        const decls = this._evaluator.getDeclarationsForNameNode(nameNode);
        if (!decls) {
            return false;
        }

        // If submoduleFallback exists, then, it points to submodule not symbol.
        return !decls.some((d) => isAliasDeclaration(d) && d.submoduleFallback);
    }

    private _getNewModuleName(currentFilePath: string, isRelativePath: boolean, isLastPartImportName: boolean) {
        const filePath = currentFilePath === this._moduleFilePath ? this._newModuleFilePath : currentFilePath;

        // If the existing code was using relative path, try to keep the relative path.
        const moduleName = isRelativePath
            ? getRelativeModuleName(
                  this._fs,
                  filePath,
                  this._newModuleFilePath,
                  isLastPartImportName,
                  /* sourceIsFile*/ true
              )
            : this._newModuleName;

        if (isLastPartImportName && moduleName.endsWith(this._newLastModuleName)) {
            const dotPrefix =
                moduleName === this._newLastModuleName
                    ? 0
                    : moduleName.length > this._newLastModuleName.length + 1
                    ? moduleName[moduleName.length - this._newLastModuleName.length - 2] !== '.'
                        ? 1
                        : 0
                    : 0;

            const length = moduleName.length - this._newLastModuleName.length - dotPrefix;

            //ex) x.y.z used in "from x.y import z"
            const newModuleName = moduleName.substr(0, length);
            return newModuleName.length > 0 ? newModuleName : '.';
        }

        // ex) x.y.z used in "from x.y.z import ..."
        return moduleName;
    }

    getEdits(): FileEditAction[] {
        const edits: FileEditAction[] = [];
        this._results.forEach((v) => edits.push(...v));

        return edits;
    }

    get lastModuleName() {
        return this._moduleNames[this._moduleNames.length - 1];
    }

    private get _moduleName() {
        return this._moduleNameAndType.moduleName;
    }

    private get _newLastModuleName() {
        return this._newModuleNames[this._newModuleNames.length - 1];
    }

    private get _newModuleName() {
        return this._newModuleNameAndType.moduleName;
    }

    private _addImportNameDeletion(
        filePath: string,
        parseResults: ParseResults,
        nameRemoved: Set<number>,
        imports: ImportAsNode[],
        importToDelete: ImportAsNode
    ) {
        this._addImportNameDeletionInternal(
            filePath,
            parseResults,
            nameRemoved,
            imports,
            importToDelete,
            ParseNodeType.Import
        );

        // Mark that we don't need to process these node again later.
        nameRemoved.add(importToDelete.module.id);
        importToDelete.module.nameParts.forEach((n) => nameRemoved.add(n.id));
        if (importToDelete.alias) {
            nameRemoved.add(importToDelete.alias.id);
        }
    }

    private _addFromImportNameDeletion(
        filePath: string,
        parseResults: ParseResults,
        nameRemoved: Set<number>,
        imports: ImportFromAsNode[],
        importToDelete: ImportFromAsNode
    ) {
        this._addImportNameDeletionInternal(
            filePath,
            parseResults,
            nameRemoved,
            imports,
            importToDelete,
            ParseNodeType.ImportFrom
        );

        // Mark that we don't need to process these node again later.
        nameRemoved.add(importToDelete.name.id);
        if (importToDelete.alias) {
            nameRemoved.add(importToDelete.alias.id);
        }
    }

    private _addImportNameDeletionInternal(
        filePath: string,
        parseResults: ParseResults,
        nameRemoved: Set<number>,
        imports: ImportFromAsNode[] | ImportAsNode[],
        importToDelete: ImportFromAsNode | ImportAsNode,
        importKind: ParseNodeType.ImportFrom | ParseNodeType.Import
    ) {
        const range = getTextRangeForImportNameDeletion(
            imports,
            imports.findIndex((v) => v === importToDelete)
        );

        this._addResultWithTextRange(filePath, range, parseResults, '');

        // Mark that we don't need to process these node again later.
        nameRemoved.add(importToDelete.id);

        // Check whether we have deleted all trailing import names.
        // If either no trailing import is deleted or handled properly
        // then, there is nothing to do. otherwise, either delete the whole statement
        // or remove trailing comma.
        // ex) from x import [y], z or from x import y[, z]
        let lastImportIndexNotDeleted = 0;
        for (
            lastImportIndexNotDeleted = imports.length - 1;
            lastImportIndexNotDeleted >= 0;
            lastImportIndexNotDeleted--
        ) {
            if (!nameRemoved.has(imports[lastImportIndexNotDeleted].id)) {
                break;
            }
        }

        if (lastImportIndexNotDeleted === -1) {
            // Whole statement is deleted. Remove the statement itself.
            // ex) [from x import a, b, c] or [import a]
            const importStatement = getFirstAncestorOrSelfOfKind(importToDelete, importKind);
            if (importStatement) {
                this._addResultWithRange(
                    filePath,
                    getFullStatementRange(importStatement, parseResults.tokenizerOutput),
                    ''
                );
            }
        } else if (lastImportIndexNotDeleted >= 0 && lastImportIndexNotDeleted < imports.length - 2) {
            // We need to delete trailing comma
            // ex) from x import a, [b, c]
            const start = TextRange.getEnd(imports[lastImportIndexNotDeleted]);
            const length = TextRange.getEnd(imports[lastImportIndexNotDeleted + 1]) - start;
            this._addResultWithTextRange(filePath, { start, length }, parseResults, '');
        }
    }

    private _addResultWithTextRange(filePath: string, range: TextRange, parseResults: ParseResults, newName: string) {
        const existing = parseResults.text.substr(range.start, range.length);
        if (existing === newName) {
            // No change. Return as it is.
            return;
        }

        this._addResultWithRange(filePath, convertTextRangeToRange(range, parseResults.tokenizerOutput.lines), newName);
    }

    private _addResultEdits(edits: FileEditAction[]) {
        edits.forEach((e) => this._addResultWithRange(e.filePath, e.range, e.replacementText));
    }

    private _getDeletionsForSpan(filePathOrEdit: string | FileEditAction[], range: Range) {
        if (isString(filePathOrEdit)) {
            filePathOrEdit = this._results.get(filePathOrEdit) ?? [];
        }

        return filePathOrEdit.filter((e) => e.replacementText === '' && doRangesIntersect(e.range, range));
    }

    private _removeEdits(filePathOrEdit: string | FileEditAction[], edits: FileEditAction[]) {
        if (isString(filePathOrEdit)) {
            filePathOrEdit = this._results.get(filePathOrEdit) ?? [];
        }

        removeArrayElements(filePathOrEdit, (f) => edits.findIndex((e) => e === f) >= 0);
    }

    private _addResultWithRange(filePath: string, range: Range, replacementText: string) {
        const edits = getOrAdd(this._results, filePath, () => []);
        if (replacementText === '') {
            // If it is a deletion, merge with overlapping deletion edit if there is any.
            const deletions = this._getDeletionsForSpan(edits, range);
            if (deletions.length > 0) {
                // Delete the existing ones.
                this._removeEdits(edits, deletions);

                // Extend range with deleted ones.
                extendRange(
                    range,
                    deletions.map((d) => d.range)
                );
            }
        }

        // Don't put duplicated edit. It can happen if code has duplicated module import.
        // ex) from a import b, b, c
        // If we need to introduce new "from import" statement for "b", we will add new statement twice.
        if (edits.some((e) => rangesAreEqual(e.range, range) && e.replacementText === replacementText)) {
            return;
        }

        edits.push({ filePath, range, replacementText });
    }

    private _getTextEditsForNewOrExistingFromImport(
        filePath: string,
        currentFromImport: ImportFromNode,
        parseResults: ParseResults,
        nameRemoved: Set<number>,
        importStatements: ImportStatements,
        moduleName: string,
        importNameInfo: ImportNameInfo[]
    ): FileEditAction[] {
        // See whether we have existing from import statement for the same module
        // ex) from [|moduleName|] import subModule
        const imported = importStatements.orderedImports.find((i) => i.moduleName === moduleName);
        if (imported && imported.node.nodeType === ParseNodeType.ImportFrom && !imported.node.isWildcardImport) {
            const edits = getTextEditsForAutoImportSymbolAddition(importNameInfo, imported, parseResults);
            if (imported.node !== currentFromImport) {
                // Add what we want to the existing "import from" statement as long as it is not the same import
                // node we are working on.
                return edits.map((e) => ({ filePath, range: e.range, replacementText: e.replacementText }));
            }

            // Check whether we can avoid creating a new statement. We can't just merge with existing one since
            // we could create invalid text edits (2 edits that change the same span, or invalid replacement text since
            // texts on the node has changed)
            if (this._onlyNameChanged && importNameInfo.length === 1 && edits.length === 1) {
                const deletions = this._getDeletionsForSpan(filePath, edits[0].range);
                if (deletions.length === 0) {
                    return [{ filePath, range: edits[0].range, replacementText: edits[0].replacementText }];
                } else {
                    const alias =
                        importNameInfo[0].alias === this._newLastModuleName
                            ? this.lastModuleName
                            : importNameInfo[0].alias;

                    const importName = currentFromImport.imports.find(
                        (i) => i.name.value === this.lastModuleName && i.alias?.value === alias
                    );
                    if (importName) {
                        this._removeEdits(filePath, deletions);
                        if (importName.alias) {
                            nameRemoved.delete(importName.alias.id);
                        }

                        return [
                            {
                                filePath,
                                range: convertTextRangeToRange(importName.name, parseResults.tokenizerOutput.lines),
                                replacementText: this._newLastModuleName,
                            },
                        ];
                    }
                }
            }
        }

        return getTextEditsForAutoImportInsertion(
            importNameInfo,
            importStatements,
            moduleName,
            getImportGroupFromModuleNameAndType(this._newModuleNameAndType),
            parseResults,
            convertOffsetToPosition(parseResults.parseTree.length, parseResults.tokenizerOutput.lines)
        ).map((e) => ({ filePath, range: e.range, replacementText: e.replacementText }));
    }
}

class ModuleNameCollector extends ParseTreeWalker {
    private readonly _result: ModuleNameNode[] = [];

    override walk(node: ParseNode): void {
        if (isExpressionNode(node)) {
            return;
        }

        super.walk(node);
    }

    override visitModuleName(node: ModuleNameNode) {
        this._result.push(node);
        return false;
    }

    public static collect(root: ModuleNode) {
        const collector = new ModuleNameCollector();
        collector.walk(root);

        return collector._result;
    }
}
