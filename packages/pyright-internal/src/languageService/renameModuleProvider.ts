/*
 * renameModuleProvider.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Logic that updates affected references of a module rename/move.
 */

import { dir } from 'console';
import { CancellationToken } from 'vscode-languageserver';

import { getImportInfo } from '../analyzer/analyzerNodeInfo';
import { AliasDeclaration, isAliasDeclaration } from '../analyzer/declaration';
import { createSynthesizedAliasDeclaration } from '../analyzer/declarationUtils';
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
import { assert } from '../common/debug';
import { FileEditAction } from '../common/editAction';
import { FileSystem } from '../common/fileSystem';
import {
    combinePaths,
    getDirectoryPath,
    getFileName,
    getRelativePathComponentsFromDirectory,
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
    isExpressionNode,
    ModuleNameNode,
    ModuleNode,
    NameNode,
    ParseNode,
    ParseNodeType,
} from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';
import { CollectionResult, DocumentSymbolCollector } from './documentSymbolCollector';

export class RenameModuleProvider {
    static create(
        importResolver: ImportResolver,
        configOptions: ConfigOptions,
        evaluator: TypeEvaluator,
        path: string,
        newPath: string,
        token: CancellationToken
    ) {
        if (!importResolver.fileSystem.existsSync(path)) {
            return undefined;
        }

        if (isFile(importResolver.fileSystem, path)) {
            return this._create(importResolver, configOptions, evaluator, path, newPath, /* folder */ false, token);
        } else if (isDirectory(importResolver.fileSystem, path)) {
            // Make sure folder path is simple rename.
            const relativePaths = getRelativePathComponentsFromDirectory(path, newPath, (f) =>
                importResolver.fileSystem.realCasePath(f)
            );

            // 3 means only last folder name has changed.
            if (relativePaths.length !== 3 || relativePaths[1] !== '..' || relativePaths[2] === '..') {
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
                /* isFolder */ true,
                token
            );
        }

        return undefined;
    }

    private static _create(
        importResolver: ImportResolver,
        configOptions: ConfigOptions,
        evaluator: TypeEvaluator,
        moduleFilePath: string,
        newModuleFilePath: string,
        isFolder: boolean,
        token: CancellationToken
    ) {
        const execEnv = configOptions.findExecEnvironment(moduleFilePath);
        const moduleName = importResolver.getModuleNameForImport(moduleFilePath, execEnv);
        if (!moduleName.moduleName) {
            return undefined;
        }

        const newModuleName = importResolver.getModuleNameForImport(newModuleFilePath, execEnv);
        if (!newModuleName.moduleName) {
            return undefined;
        }

        // Create synthesized alias decls from the given file path. If the given file is for stub,
        // create one for the corresponding py file as well.
        const moduleDecls = [createSynthesizedAliasDeclaration(moduleFilePath)];
        if (isStubFile(moduleFilePath)) {
            // The resolveImport should make sure non stub file search to happen.
            importResolver.resolveImport(
                moduleFilePath,
                execEnv,
                createImportedModuleDescriptor(moduleName.moduleName)
            );

            importResolver
                .getSourceFilesFromStub(moduleFilePath, execEnv, /*mapCompiled*/ false)
                .forEach((p) => moduleDecls.push(createSynthesizedAliasDeclaration(p)));
        }

        return new RenameModuleProvider(
            importResolver.fileSystem,
            evaluator,
            moduleFilePath,
            newModuleFilePath,
            moduleName,
            newModuleName,
            isFolder,
            moduleDecls,
            token
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
        private _isFolder: boolean,
        private _moduleDecls: AliasDeclaration[],
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
        assert(!this._isFolder || this._onlyNameChanged, 'We only support simple rename for folder');
    }

    renameReferences(filePath: string, parseResults: ParseResults) {
        if (this._isFolder) {
            return this._renameFolderReferences(filePath, parseResults);
        } else {
            return this._renameModuleReferences(filePath, parseResults);
        }
    }

    private _renameFolderReferences(filePath: string, parseResults: ParseResults) {
        const collector = new DocumentSymbolCollector(
            this.symbolName,
            this._moduleDecls,
            this._evaluator!,
            this._token,
            parseResults.parseTree,
            /*treatModuleImportAndFromImportSame*/ true
        );

        // We only support simple rename of folder. Change all occurrence of the old folder name
        // to new name.
        for (const result of collector.collect()) {
            this._addResultWithTextRange(filePath, result.range, parseResults, this._newSymbolName);
        }
    }

    private _renameModuleReferences(filePath: string, parseResults: ParseResults) {
        const collector = new DocumentSymbolCollector(
            this.symbolName,
            this._moduleDecls,
            this._evaluator!,
            this._token,
            parseResults.parseTree,
            /*treatModuleImportAndFromImportSame*/ true
        );

        const results = collector.collect();

        // Update module references first.
        this._updateModuleReferences(filePath, parseResults, results);

        // If the module file has moved, we need to update all relative paths used in the file to reflect the move.
        this._updateRelativeModuleNamePath(filePath, parseResults, results);
    }

    private _updateRelativeModuleNamePath(filePath: string, parseResults: ParseResults, results: CollectionResult[]) {
        if (filePath !== this._moduleFilePath) {
            // We only update relative import paths for the file that has moved.
            return;
        }

        // Filter out module name that is already re-written.
        for (const edit of this._getNewRelativeModuleNamesForFileMoved(
            filePath,
            ModuleNameCollector.collect(parseResults.parseTree).filter(
                (m) => !results.some((r) => TextRange.containsRange(m.parent!, r.node))
            )
        )) {
            this._addResultWithTextRange(filePath, edit.moduleName, parseResults, edit.newModuleName);
        }
    }

    private _updateModuleReferences(filePath: string, parseResults: ParseResults, results: CollectionResult[]) {
        const nameRemoved = new Set<NameNode>();
        let importStatements: ImportStatements | undefined;
        for (const result of results) {
            const nodeFound = result.node;

            if (nodeFound.nodeType === ParseNodeType.String) {
                // ex) __all__ = ["[a]"]
                this._addResultWithTextRange(filePath, result.range, parseResults, this._newSymbolName);
                continue;
            }

            if (isImportModuleName(nodeFound)) {
                if (!isLastNameOfModuleName(nodeFound)) {
                    // It must be directory and we don't support folder rename.
                    continue;
                }

                const moduleNameNode = getFirstAncestorOrSelfOfKind(
                    nodeFound,
                    ParseNodeType.ModuleName
                ) as ModuleNameNode;

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
                        `${this._newModuleName} as ${this._newSymbolName}`
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
                this._addResultWithTextRange(filePath, result.range, parseResults, this._newSymbolName);
                continue;
            }

            if (isFromImportModuleName(nodeFound)) {
                if (!isLastNameOfModuleName(nodeFound)) {
                    // It must be directory and we don't support folder rename.
                    continue;
                }

                const moduleNameNode = getFirstAncestorOrSelfOfKind(
                    nodeFound,
                    ParseNodeType.ModuleName
                ) as ModuleNameNode;

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

                // First, delete existing exported symbols from "from import" statement.
                for (const importFromAs of exportedSymbols) {
                    this._addImportNameDeletion(filePath, parseResults, nameRemoved, fromNode.imports, importFromAs);
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
                                results.findIndex((r) => r.node === i.name) >= 0 ? this._newSymbolName : i.name.value;
                            const alias =
                                results.findIndex((r) => r.node === i.alias) >= 0
                                    ? this._newSymbolName
                                    : i.alias?.value;

                            return { name, alias };
                        })
                    )
                );
                continue;
            }

            if (isFromImportName(nodeFound)) {
                if (nameRemoved.has(nodeFound)) {
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
                    this._addResultWithTextRange(filePath, result.range, parseResults, this._newSymbolName);
                    continue;
                }

                if (fromNode.imports.length === 1) {
                    // ex) from xxx import [yyy] to from [aaa.bbb] import [zzz]
                    this._addResultWithTextRange(filePath, fromNode.module, parseResults, newModuleName);
                    this._addResultWithTextRange(filePath, result.range, parseResults, this._newSymbolName);
                } else {
                    // Delete the existing import name including alias.
                    const importFromAs = nodeFound.parent as ImportFromAsNode;

                    // Update module name if needed.
                    if (fromNode.module.leadingDots > 0) {
                        for (const edit of this._getNewRelativeModuleNamesForFileMoved(filePath, [fromNode.module])) {
                            this._addResultWithTextRange(filePath, edit.moduleName, parseResults, edit.newModuleName);
                        }
                    }

                    this._addImportNameDeletion(filePath, parseResults, nameRemoved, fromNode.imports, importFromAs);

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
                        name: this._newSymbolName,
                        alias:
                            importFromAs.alias?.value === this.symbolName
                                ? this._newSymbolName
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
                if (nameRemoved.has(nodeFound)) {
                    // alias is already removed.
                    continue;
                }

                // ex) from ccc import xxx as [yyy] to from ccc import xxx as [zzz]
                this._addResultWithTextRange(filePath, result.range, parseResults, this._newSymbolName);
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
                this._addResultWithTextRange(filePath, result.range, parseResults, this._newSymbolName);
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

            if (result.node.value !== this._newSymbolName) {
                this._addResultWithTextRange(filePath, result.range, parseResults, this._newSymbolName);
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

        const newNames: { moduleName: ModuleNameNode; newModuleName: string }[] = [];
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
                result.file
            );

            newNames.push({ moduleName, newModuleName });
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
            return { src: this._newModuleFilePath, dest: importPath, file: true };
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
            return { src: this._newModuleFilePath, dest: this._newModuleFilePath, file: true };
        }

        // "." is used to point folder location.
        if (exportedSymbols.length === 0) {
            return { src: this._newModuleFilePath, dest: this._moduleFilePath, file: true };
        }

        // now we need to split.
        return undefined;
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

        if (isLastPartImportName && moduleName.endsWith(this._newSymbolName)) {
            const dotPrefix =
                moduleName === this._newSymbolName
                    ? 0
                    : moduleName.length > this._newSymbolName.length + 1
                    ? moduleName[moduleName.length - this._newSymbolName.length - 2] !== '.'
                        ? 1
                        : 0
                    : 0;

            const length = moduleName.length - this._newSymbolName.length - dotPrefix;

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

    get symbolName() {
        return this._moduleNames[this._moduleNames.length - 1];
    }

    private get _moduleName() {
        return this._moduleNameAndType.moduleName;
    }

    private get _newModuleName() {
        return this._newModuleNameAndType.moduleName;
    }

    private get _newSymbolName() {
        return this._newModuleNames[this._newModuleNames.length - 1];
    }

    private _addImportNameDeletion(
        filePath: string,
        parseResults: ParseResults,
        nameRemoved: Set<NameNode>,
        imports: ImportFromAsNode[],
        importToDelete: ImportFromAsNode
    ) {
        const range = getTextRangeForImportNameDeletion(
            imports,
            imports.findIndex((v) => v === importToDelete)
        );

        this._addResultWithTextRange(filePath, range, parseResults, '');

        // Mark that we don't need to process these node again later.
        nameRemoved.add(importToDelete.name);
        if (importToDelete.alias) {
            nameRemoved.add(importToDelete.alias);
        }

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
            if (!nameRemoved.has(imports[lastImportIndexNotDeleted].name)) {
                break;
            }
        }

        if (lastImportIndexNotDeleted === -1) {
            // Whole statement is deleted. Remove the statement itself.
            // ex) [from x import a, b, c]
            const fromImport = getFirstAncestorOrSelfOfKind(importToDelete, ParseNodeType.ImportFrom);
            if (fromImport) {
                this._addResultWithRange(filePath, getFullStatementRange(fromImport, parseResults.tokenizerOutput), '');
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
        nameRemoved: Set<NameNode>,
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
                        importNameInfo[0].alias === this._newSymbolName ? this.symbolName : importNameInfo[0].alias;

                    const importName = currentFromImport.imports.find(
                        (i) => i.name.value === this.symbolName && i.alias?.value === alias
                    );
                    if (importName) {
                        this._removeEdits(filePath, deletions);
                        if (importName.alias) {
                            nameRemoved.delete(importName.alias);
                        }

                        return [
                            {
                                filePath,
                                range: convertTextRangeToRange(importName.name, parseResults.tokenizerOutput.lines),
                                replacementText: this._newSymbolName,
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
