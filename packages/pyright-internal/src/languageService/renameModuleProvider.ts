/*
 * renameModuleProvider.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Logic that updates affected references of a module rename/move.
 */

import { CancellationToken } from 'vscode-languageserver';

import { AliasDeclaration, isAliasDeclaration } from '../analyzer/declaration';
import { createSynthesizedAliasDeclaration } from '../analyzer/declarationUtils';
import { createImportedModuleDescriptor, ImportResolver, ModuleNameAndType } from '../analyzer/importResolver';
import {
    getImportGroupFromModuleNameAndType,
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
import { isStubFile } from '../analyzer/sourceMapper';
import { TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import { getOrAdd, removeArrayElements } from '../common/collectionUtils';
import { ConfigOptions } from '../common/configOptions';
import { isString } from '../common/core';
import { FileEditAction } from '../common/editAction';
import { FileSystem } from '../common/fileSystem';
import {
    getDirectoryPath,
    getFileName,
    getRelativePathComponentsFromDirectory,
    stripFileExtension,
} from '../common/pathUtils';
import { convertOffsetToPosition, convertTextRangeToRange } from '../common/positionUtils';
import { doRangesIntersect, extendRange, Range, rangesAreEqual, TextRange } from '../common/textRange';
import {
    ImportAsNode,
    ImportFromAsNode,
    ImportFromNode,
    ModuleNameNode,
    NameNode,
    ParseNodeType,
} from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';
import { DocumentSymbolCollector } from './documentSymbolCollector';

export class RenameModuleProvider {
    static create(
        importResolver: ImportResolver,
        configOptions: ConfigOptions,
        evaluator: TypeEvaluator,
        moduleFilePath: string,
        newModuleFilePath: string,
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
            newModuleFilePath,
            moduleName,
            newModuleName,
            moduleDecls,
            token
        );
    }

    private readonly _moduleNames: string[];
    private readonly _newModuleNames: string[];
    private readonly _onlyNameChanged: boolean;
    private readonly _results = new Map<string, FileEditAction[]>();

    private readonly _aliasIntroduced = new Set<ImportAsNode>();

    private constructor(
        private _fs: FileSystem,
        private _evaluator: TypeEvaluator,
        private _newModuleFilePath: string,
        private _moduleNameAndType: ModuleNameAndType,
        private _newModuleNameAndType: ModuleNameAndType,
        private _moduleDecls: AliasDeclaration[],
        private _token: CancellationToken
    ) {
        // moduleName and newModuleName are always in the absolute path form.
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
    }

    renameModuleReferences(filePath: string, parseResults: ParseResults) {
        const collector = new DocumentSymbolCollector(
            this.symbolName,
            this._moduleDecls,
            this._evaluator!,
            this._token,
            parseResults.parseTree,
            /*treatModuleImportAndFromImportSame*/ true
        );

        const results = collector.collect();

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
                    this._addResultWithTextRange(filePath, moduleNameNode, parseResults, this._newModuleName);
                    continue;
                }

                if (exportedSymbols.length === 0) {
                    // We only have sub modules. That means module name actually refers to
                    // folder name, not module (ex, __init__.py). Since we don't support
                    // renaming folder, leave things as they are.
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
                const newModuleName = this._getNewModuleName(filePath, fromNode.module);

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

    private _isExportedSymbol(nameNode: NameNode): boolean {
        const decls = this._evaluator.getDeclarationsForNameNode(nameNode);
        if (!decls) {
            return false;
        }

        // If submoduleFallback exists, then, it points to submodule not symbol.
        return !decls.some((d) => isAliasDeclaration(d) && d.submoduleFallback);
    }

    private _getNewModuleName(currentFilePath: string, moduleName: ModuleNameNode) {
        if (moduleName.leadingDots === 0) {
            const newModuleName = this._newModuleName.substr(
                0,
                this._newModuleName.length - this._newSymbolName.length - 1
            );
            return newModuleName.length > 0 ? newModuleName : '.';
        }

        // If the existing code was using relative path, try to keep the relative path.
        const relativePaths = getRelativePathComponentsFromDirectory(
            getDirectoryPath(currentFilePath),
            getDirectoryPath(this._newModuleFilePath),
            (f) => this._fs.realCasePath(f)
        );

        // Both file paths are pointing to user files. So we don't need to worry about
        // relative path pointing to library files.
        let relativeModuleName = '.';
        for (let i = 1; i < relativePaths.length; i++) {
            const relativePath = relativePaths[i];
            if (relativePath === '..') {
                relativeModuleName += '.';
            } else {
                relativeModuleName += relativePath;
            }

            if (relativePath !== '..' && i !== relativePaths.length - 1) {
                relativeModuleName += '.';
            }
        }

        // __init__ makes the folder itself not file inside of the folder part of
        // module path. Move up one more level.
        const fileName = stripFileExtension(getFileName(this._newModuleFilePath));
        if (fileName === '__init__') {
            relativeModuleName += '.';
        }

        return relativeModuleName;
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
