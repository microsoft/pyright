/*
 * renameModuleProvider.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Logic that updates affected references of a module rename/move.
 */

import { CancellationToken } from 'vscode-languageserver';

import { getFileInfo, getImportInfo } from '../analyzer/analyzerNodeInfo';
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
    getTopLevelImports,
    haveSameParentModule,
    ImportStatement,
    ImportStatements,
} from '../analyzer/importStatementUtils';
import {
    getDottedNameWithGivenNodeAsLastName,
    getFirstAncestorOrSelfOfKind,
    getFullStatementRange,
    getVariableDocStringNode,
    isFromImportAlias,
    isFromImportModuleName,
    isFromImportName,
    isImportAlias,
    isImportModuleName,
    isLastNameOfModuleName,
} from '../analyzer/parseTreeUtils';
import { ParseTreeWalker } from '../analyzer/parseTreeWalker';
import { ScopeType } from '../analyzer/scope';
import { isStubFile } from '../analyzer/sourceMapper';
import { isPrivateName } from '../analyzer/symbolNameUtils';
import { TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import { TypeCategory } from '../analyzer/types';
import { getOrAdd } from '../common/collectionUtils';
import { ConfigOptions, matchFileSpecs } from '../common/configOptions';
import { assert, assertNever } from '../common/debug';
import { FileEditAction } from '../common/editAction';
import { FileSystem } from '../common/fileSystem';
import {
    combinePaths,
    getDirectoryChangeKind,
    getDirectoryPath,
    getFileExtension,
    getFileName,
    isDirectory,
    isFile,
    resolvePaths,
    stripFileExtension,
} from '../common/pathUtils';
import { convertRangeToTextRange } from '../common/positionUtils';
import { TextEditTracker } from '../common/textEditTracker';
import { TextRange } from '../common/textRange';
import {
    ImportAsNode,
    ImportFromAsNode,
    ImportFromNode,
    isExpressionNode,
    MemberAccessNode,
    ModuleNameNode,
    ModuleNode,
    NameNode,
    ParseNode,
    ParseNodeType,
} from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';
import { CollectionResult, DocumentSymbolCollector, DocumentSymbolCollectorUseCase } from './documentSymbolCollector';

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

    static canMoveSymbol(configOptions: ConfigOptions, evaluator: TypeEvaluator, node: NameNode): boolean {
        const filePath = getFileInfo(node)?.filePath;
        if (!filePath || !matchFileSpecs(configOptions, filePath, /* isFile */ true)) {
            // We only support moving symbols from a user file.
            return false;
        }

        if (isPrivateName(node.value)) {
            return false;
        }

        const lookUpResult = evaluator.lookUpSymbolRecursive(node, node.value, /* honorCodeFlow */ false);
        if (lookUpResult === undefined || lookUpResult.scope.type !== ScopeType.Module) {
            // We only allow moving a symbol at the module level.
            return false;
        }

        // For now, we only supports module level variable, function and class.
        const declarations = lookUpResult.symbol.getDeclarations();
        if (declarations.length === 0) {
            return false;
        }

        return declarations.every((d) => {
            if (!TextRange.containsRange(d.node, node)) {
                return false;
            }

            if (isFunctionDeclaration(d) || isClassDeclaration(d)) {
                return true;
            }

            if (isVariableDeclaration(d)) {
                // We only support simple variable assignment.
                // ex) a = 1
                if (evaluator.isExplicitTypeAliasDeclaration(d)) {
                    return false;
                }

                if (d.inferredTypeSource && isExpressionNode(d.inferredTypeSource)) {
                    const type = evaluator.getType(d.inferredTypeSource);
                    if (type?.category === TypeCategory.TypeVar) {
                        return false;
                    }
                }

                // This make sure we are not one of these
                // ex) a = b = 1
                //     a, b = 1, 2
                if (
                    d.node.parent?.nodeType !== ParseNodeType.Assignment ||
                    d.node.parent?.parent?.nodeType !== ParseNodeType.StatementList
                ) {
                    return false;
                }

                if (d.node.start !== d.node.parent.start) {
                    return false;
                }

                return true;
            }

            return false;
        });
    }

    static getSymbolTextRange(parseResults: ParseResults, decl: Declaration): TextRange {
        if (isVariableDeclaration(decl)) {
            const assignment = getFirstAncestorOrSelfOfKind(decl.node, ParseNodeType.Assignment) ?? decl.node;
            const range = getFullStatementRange(assignment, parseResults);
            const textRange = convertRangeToTextRange(range, parseResults.tokenizerOutput.lines) ?? assignment;

            if (decl.docString !== undefined) {
                const docNode = getVariableDocStringNode(decl.node);
                if (docNode) {
                    TextRange.extend(textRange, docNode);
                }
            }

            return textRange;
        }

        return decl.node;
    }

    static getSymbolFullStatementTextRange(parseResults: ParseResults, decl: Declaration): TextRange {
        const statementNode = isVariableDeclaration(decl)
            ? getFirstAncestorOrSelfOfKind(decl.node, ParseNodeType.Assignment) ?? decl.node
            : decl.node;
        const range = getFullStatementRange(statementNode, parseResults, {
            includeTrailingBlankLines: true,
        });
        return convertRangeToTextRange(range, parseResults.tokenizerOutput.lines) ?? statementNode;
    }

    static getRenameModulePath(declarations: Declaration[]) {
        // If we have a decl with no node, we will prefer that decl over others.
        // The decl with no node is a synthesized alias decl created only for IDE case
        // that should point to the right module file.
        const bestDecl = declarations.find((d) => !d.node);
        if (bestDecl) {
            return bestDecl.path;
        }

        // Otherwise, prefer stub if we have one. or just return first decl.
        const declarationPaths = [...declarations.reduce((s, d) => s.add(d.path), new Set<string>())];
        const stubIndex = declarationPaths.findIndex((d) => isStubFile(d));
        if (stubIndex >= 0) {
            return declarationPaths[stubIndex];
        }

        return declarationPaths[0];
    }

    static getRenameModulePathInfo(declarationPath: string, newName: string) {
        const filePath = getFilePathToRename(declarationPath);
        const newFilePath = replaceFileName(filePath, newName);

        return { filePath, newFilePath };

        function getFilePathToRename(filePath: string) {
            const fileName = stripFileExtension(getFileName(filePath));
            if (fileName === '__init__') {
                return getDirectoryPath(filePath);
            }

            return filePath;
        }

        function replaceFileName(filePath: string, newName: string) {
            const ext = getFileExtension(filePath);
            const directory = getDirectoryPath(filePath);

            return combinePaths(directory, `${newName}${ext}`);
        }
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
                    .getSourceFilesFromStub(moduleFilePath, execEnv, /* mapCompiled */ false)
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
    private readonly _aliasIntroduced = new Set<ImportAsNode>();
    private readonly _textEditTracker = new TextEditTracker();

    private constructor(
        private _fs: FileSystem,
        private _evaluator: TypeEvaluator,
        private _moduleFilePath: string,
        newModuleFilePath: string,
        private _moduleNameAndType: ModuleNameAndType,
        private _newModuleNameAndType: ModuleNameAndType,
        private _type: UpdateType,
        public declarations: Declaration[],
        private _token: CancellationToken
    ) {
        // moduleName and newModuleName are always in the absolute path form.
        this._newModuleFilePath = resolvePaths(newModuleFilePath);

        this._moduleNames = this._moduleName.split('.');
        this._newModuleNames = this._newModuleName.split('.');

        this._onlyNameChanged = haveSameParentModule(this._moduleNames, this._newModuleNames);
        assert(this._type !== UpdateType.Folder || this._onlyNameChanged, 'We only support simple rename for folder');
    }

    get lastModuleName() {
        return this._moduleNames[this._moduleNames.length - 1];
    }

    get textEditTracker(): TextEditTracker {
        return this._textEditTracker;
    }

    getEdits(): FileEditAction[] {
        return this._textEditTracker.getEdits(this._token);
    }

    renameReferences(parseResults: ParseResults) {
        switch (this._type) {
            case UpdateType.Folder:
                return this._renameFolderReferences(parseResults);
            case UpdateType.File:
                return this._renameModuleReferences(parseResults);
            case UpdateType.Symbol:
                return this._updateSymbolReferences(parseResults);
            default:
                return assertNever(this._type, `${this._type} is unknown`);
        }
    }

    tryGetFirstSymbolUsage(parseResults: ParseResults, symbol?: { name: string; decls: Declaration[] }) {
        const name = symbol?.name ?? getNameFromDeclaration(this.declarations[0]) ?? '';
        const collector = new DocumentSymbolCollector(
            [name],
            symbol?.decls ?? this.declarations,
            this._evaluator!,
            this._token,
            parseResults.parseTree,
            /* treatModuleImportAndFromImportSame */ true,
            /* skipUnreachableCode */ false
        );

        for (const result of collector.collect().sort((r1, r2) => r1.range.start - r2.range.start)) {
            // We only care about symbol usages, not alias decl of the symbol.
            if (
                isImportModuleName(result.node) ||
                isImportAlias(result.node) ||
                isFromImportModuleName(result.node) ||
                isFromImportName(result.node) ||
                isFromImportAlias(result.node)
            ) {
                continue;
            }

            return result.range.start;
        }

        return undefined;
    }

    private _updateSymbolReferences(parseResults: ParseResults) {
        const filePath = getFileInfo(parseResults.parseTree).filePath;
        const isSource = filePath === this._moduleFilePath;

        const collector = new DocumentSymbolCollector(
            [getNameFromDeclaration(this.declarations[0]) || ''],
            this.declarations,
            this._evaluator!,
            this._token,
            parseResults.parseTree,
            /* treatModuleImportAndFromImportSame */ true,
            /* skipUnreachableCode */ false
        );

        // See if we need to insert new import statement
        const importStatements = getTopLevelImports(parseResults.parseTree, /* includeImplicitImports */ true);

        // See whether we have existing import statement for the same module
        // ex) import [moduleName] or from ... import [moduleName]
        const imported = importStatements.orderedImports.find((i) => i.moduleName === this._newModuleName);

        // Indicate whether current file has any usage of the symbol
        let hasSymbolUsage = false;

        const wildcardImports = new Map<ImportFromNode, Set<string>>();
        const importUsed = new Map<ImportAsNode | ImportFromAsNode, MemberAccessNode[]>();
        for (const result of collector.collect()) {
            const nodeFound = result.node;

            if (nodeFound.nodeType === ParseNodeType.String) {
                if (isSource) {
                    // Delete the symbol reference in __all__ if the file is the source file.
                    this._textEditTracker.addEditWithTextRange(parseResults, nodeFound, '');
                }
                continue;
            }

            if (isFromImportName(nodeFound)) {
                this._updateNameInFromImportForSymbolReferences(parseResults, importStatements, nodeFound);
                continue;
            }

            // Exclude symbol decl itself.
            hasSymbolUsage = isSource
                ? !this.declarations.some((d) => TextRange.containsRange(d.node, nodeFound))
                : true;

            const dottedName = getDottedNameWithGivenNodeAsLastName(nodeFound);
            if (dottedName === nodeFound || dottedName.nodeType !== ParseNodeType.MemberAccess) {
                this._collectWildcardImports(nodeFound, wildcardImports);

                // ex) from module import foo
                //     foo
                //     foo.method()
                continue;
            }

            this._collectSymbolReferencesPerImports(dottedName, importUsed);
        }

        if (isSource && hasSymbolUsage) {
            // If the original file has references to the symbol moved, we need to either
            // insert import statement or update existing one.
            const newModuleName =
                imported?.node.nodeType === ParseNodeType.ImportFrom
                    ? this._getNewModuleName(
                          filePath,
                          imported.node.module.leadingDots > 0,
                          /* isLastPartImportName */ false
                      )
                    : undefined;

            const options =
                imported?.node.nodeType === ParseNodeType.ImportFrom
                    ? {
                          currentFromImport: imported.node,
                          originalModuleName: this._moduleName,
                      }
                    : undefined;

            this._textEditTracker.addOrUpdateImport(
                parseResults,
                importStatements,
                { name: this._newModuleName, nameForImportFrom: newModuleName },
                getImportGroupFromModuleNameAndType(this._newModuleNameAndType),
                [{ name: getNameFromDeclaration(this.declarations[0])! }],
                options
            );
        }

        // Handle symbol references that are used off wildcard imports.
        this._processSymbolReferenceOffWildcardImports(parseResults, importStatements, wildcardImports);

        // Handle symbol references that are used off imported modules.
        this._processSymbolReferenceOffImports(parseResults, importStatements, imported, importUsed);
    }

    private _processSymbolReferenceOffImports(
        parseResults: ParseResults,
        importStatements: ImportStatements,
        imported: ImportStatement | undefined,
        importUsed: Map<ImportAsNode | ImportFromAsNode, MemberAccessNode[]>
    ) {
        const filePath = getFileInfo(parseResults.parseTree).filePath;
        const isDestination = filePath === this._newModuleFilePath;
        if (isDestination) {
            for (const [key, value] of importUsed) {
                if (this._canReplaceImportName(parseResults, key, value)) {
                    // We can remove existing import statement.
                    this._textEditTracker.deleteImportName(parseResults, key);
                }

                for (const node of value) {
                    this._textEditTracker.addEditWithTextRange(
                        parseResults,
                        TextRange.fromBounds(node.start, node.memberName.start),
                        ''
                    );
                }
            }
            return;
        }

        // Other files.
        for (const [key, value] of importUsed) {
            let referenceModuleName: string;
            if (this._canReplaceImportName(parseResults, key, value)) {
                const moduleName = this._getReferenceModuleName(importStatements, imported);
                if (key.nodeType === ParseNodeType.ImportAs) {
                    if (moduleName) {
                        referenceModuleName = moduleName;
                        this._textEditTracker.deleteImportName(parseResults, key);
                    } else {
                        referenceModuleName = key.alias ? key.alias.value : this._newModuleName;
                        this._textEditTracker.addEditWithTextRange(parseResults, key.module, this._newModuleName);
                    }
                } else {
                    if (moduleName) {
                        referenceModuleName = moduleName;
                        this._textEditTracker.deleteImportName(parseResults, key);
                    } else {
                        const fromNode = key.parent as ImportFromNode;
                        const newModuleName = this._getNewModuleName(
                            filePath,
                            fromNode.module.leadingDots > 0,
                            /* isLastPartImportName */ true
                        );

                        referenceModuleName = key.alias ? key.alias.value : this._newLastModuleName;
                        this._textEditTracker.addEditWithTextRange(parseResults, fromNode.module, newModuleName);
                        this._textEditTracker.addEditWithTextRange(parseResults, key.name, this._newLastModuleName);
                    }
                }
            } else {
                const moduleName = this._getReferenceModuleName(importStatements, imported);
                if (moduleName) {
                    referenceModuleName = moduleName;
                } else {
                    referenceModuleName = this._newModuleName;
                    this._textEditTracker.addOrUpdateImport(
                        parseResults,
                        importStatements,
                        { name: this._newModuleName },
                        getImportGroupFromModuleNameAndType(this._newModuleNameAndType)
                    );
                }
            }

            for (const node of value) {
                this._textEditTracker.addEditWithTextRange(parseResults, node.leftExpression, referenceModuleName);
            }
        }
    }

    private _processSymbolReferenceOffWildcardImports(
        parseResults: ParseResults,
        importStatements: ImportStatements,
        wildcardImports: Map<ImportFromNode, Set<string>>
    ) {
        const filePath = getFileInfo(parseResults.parseTree).filePath;
        const isDestination = filePath === this._newModuleFilePath;
        if (isDestination) {
            // Destination file contains the moved symbol decl. no need to insert
            // import statement for the symbol moved.
            return;
        }

        for (const [key, value] of wildcardImports) {
            const fromNode = key;
            const newModuleName = this._getNewModuleName(
                filePath,
                fromNode.module.leadingDots > 0,
                /* isLastPartImportName */ false
            );

            this._textEditTracker.addOrUpdateImport(
                parseResults,
                importStatements,
                { name: this._newModuleName, nameForImportFrom: newModuleName },
                getImportGroupFromModuleNameAndType(this._newModuleNameAndType),
                [...value].map((v) => ({ name: v })),
                {
                    currentFromImport: fromNode,
                    originalModuleName: this._moduleName,
                }
            );
        }
    }

    private _collectSymbolReferencesPerImports(
        dottedName: MemberAccessNode,
        importUsed: Map<ImportAsNode | ImportFromAsNode, MemberAccessNode[]>
    ) {
        const moduleName =
            dottedName.leftExpression.nodeType === ParseNodeType.MemberAccess
                ? dottedName.leftExpression.memberName
                : dottedName.leftExpression.nodeType === ParseNodeType.Name
                ? dottedName.leftExpression
                : undefined;
        if (!moduleName) {
            // ex) from module import foo
            //     getModule().foo
            return;
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
            return;
        }

        const importAs = moduleDecl[0].node as ImportAsNode | ImportFromAsNode;
        getOrAdd(importUsed, importAs, () => []).push(dottedName);
    }

    private _collectWildcardImports(nodeFound: NameNode, wildcardImports: Map<ImportFromNode, Set<string>>) {
        const nameDecls = this._evaluator.getDeclarationsForNameNode(nodeFound);
        const aliasDeclFromWildCardImport = nameDecls?.find(
            (d) => d.node.nodeType === ParseNodeType.ImportFrom && d.node.isWildcardImport
        );

        if (!aliasDeclFromWildCardImport || !isAliasDeclaration(aliasDeclFromWildCardImport)) {
            return;
        }

        // ex) from module import *
        //     foo()
        //     bar()
        getOrAdd(wildcardImports, aliasDeclFromWildCardImport.node, () => new Set<string>()).add(nodeFound.value);
    }

    private _updateNameInFromImportForSymbolReferences(
        parseResults: ParseResults,
        importStatements: ImportStatements,
        nodeFound: NameNode
    ) {
        const filePath = getFileInfo(parseResults.parseTree).filePath;
        const isDestination = filePath === this._newModuleFilePath;

        // ex) from ... import [symbol] ...
        const importFromAs = nodeFound.parent as ImportFromAsNode;
        const fromNode = importFromAs?.parent as ImportFromNode;

        const newModuleName = this._getNewModuleName(
            filePath,
            fromNode.module.leadingDots > 0,
            /* isLastPartImportName */ false
        );

        if (isDestination) {
            // If we have import statement for the symbol in the destination file,
            // we need to remove it.
            // ex) "from module import symbol, another_symbol" to
            //     "from module import another_symbol"
            this._textEditTracker.deleteImportName(parseResults, importFromAs);
            return;
        }

        if (fromNode.imports.length === 1) {
            // ex) "from [module] import symbol" to "from [module.changed] import symbol"
            this._textEditTracker.addEditWithTextRange(parseResults, fromNode.module, newModuleName);
            return;
        }

        // ex) "from module import symbol, another_symbol" to
        //     "from module import another_symbol" and "from module.changed import symbol"

        // Delete the existing import name including alias.
        this._textEditTracker.deleteImportName(parseResults, importFromAs);

        // For now, this won't merge absolute and relative path "from import" statement.
        const importNameInfo = {
            name: importFromAs.name.value,
            alias: importFromAs.alias?.value,
        };

        this._textEditTracker.addOrUpdateImport(
            parseResults,
            importStatements,
            { name: this._newModuleName, nameForImportFrom: newModuleName },
            getImportGroupFromModuleNameAndType(this._newModuleNameAndType),
            [importNameInfo],
            {
                currentFromImport: fromNode,
                originalModuleName: this._moduleName,
            }
        );
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
            /* resolveLocalName */ false,
            DocumentSymbolCollectorUseCase.Rename,
            this._token
        );
        if (declarations.length === 0) {
            return false;
        }

        const collector = new DocumentSymbolCollector(
            [nameToBind.value],
            declarations,
            this._evaluator!,
            this._token,
            parseResults.parseTree,
            /* treatModuleImportAndFromImportSame */ true,
            /* skipUnreachableCode */ false
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

            // other symbols from the module are used in the file.
            if (!symbolReferences.some((s) => TextRange.containsRange(s, result.node))) {
                return false;
            }
        }

        return true;
    }

    private _renameFolderReferences(parseResults: ParseResults) {
        const collector = new DocumentSymbolCollector(
            [this.lastModuleName],
            this.declarations,
            this._evaluator!,
            this._token,
            parseResults.parseTree,
            /* treatModuleImportAndFromImportSame */ true,
            /* skipUnreachableCode */ false
        );

        // We only support simple rename of folder. Change all occurrence of the old folder name
        // to new name.
        for (const result of collector.collect()) {
            this._textEditTracker.addEditWithTextRange(parseResults, result.range, this._newLastModuleName);
        }
    }

    private _renameModuleReferences(parseResults: ParseResults) {
        const collector = new DocumentSymbolCollector(
            [this.lastModuleName],
            this.declarations,
            this._evaluator!,
            this._token,
            parseResults.parseTree,
            /* treatModuleImportAndFromImportSame */ true,
            /* skipUnreachableCode */ false
        );

        const results = collector.collect();

        // Update module references first.
        this._updateModuleReferences(parseResults, results);

        // If the module file has moved, we need to update all relative paths used in the file to reflect the move.
        this._updateRelativeModuleNamePath(parseResults, results);
    }

    private _updateRelativeModuleNamePath(parseResults: ParseResults, results: CollectionResult[]) {
        const filePath = getFileInfo(parseResults.parseTree).filePath;
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
            this._textEditTracker.addEditWithTextRange(parseResults, edit.moduleName, edit.newModuleName);

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
                this._textEditTracker.deleteImportName(parseResults, importFromAs);
            }

            importStatements =
                importStatements ?? getTopLevelImports(parseResults.parseTree, /* includeImplicitImports */ false);

            // For now, this won't merge absolute and relative path "from import"
            // statement.
            this._textEditTracker.addOrUpdateImport(
                parseResults,
                importStatements,
                {
                    name: this._newModuleName,
                    nameForImportFrom: getRelativeModuleName(
                        this._fs,
                        this._newModuleFilePath,
                        this._newModuleFilePath,
                        /* ignoreFolderStructure */ false,
                        /* sourceIsFile */ true
                    ),
                },
                getImportGroupFromModuleNameAndType(this._newModuleNameAndType),
                edit.itemsToMove.map((i) => {
                    return { name: i.name.value, alias: i.alias?.value };
                }),
                {
                    currentFromImport: fromNode,
                    originalModuleName: this._moduleName,
                }
            );
        }
    }

    private _updateModuleReferences(parseResults: ParseResults, results: CollectionResult[]) {
        const filePath = getFileInfo(parseResults.parseTree).filePath;

        let importStatements: ImportStatements | undefined;
        for (const result of results) {
            const nodeFound = result.node;

            if (nodeFound.nodeType === ParseNodeType.String) {
                // ex) __all__ = ["[a]"]
                this._textEditTracker.addEditWithTextRange(parseResults, result.range, this._newLastModuleName);
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
                    this._textEditTracker.addEditWithTextRange(
                        parseResults,
                        moduleNameNode,
                        `${this._newModuleName} as ${this._newLastModuleName}`
                    );
                    continue;
                }

                // Otherwise, update whole module name to new name
                // ex) import [xxx.yyy] to import [aaa.bbb]
                this._textEditTracker.addEditWithTextRange(parseResults, moduleNameNode, this._newModuleName);
                continue;
            }

            if (isImportAlias(nodeFound)) {
                // ex) import xxx as [yyy] to import xxx as [zzz]
                this._textEditTracker.addEditWithTextRange(parseResults, result.range, this._newLastModuleName);
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
                    this._textEditTracker.addEditWithTextRange(
                        parseResults,
                        moduleNameNode,
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
                        this._textEditTracker.addEditWithTextRange(parseResults, edit.moduleName, edit.newModuleName);
                    }
                }

                // First, delete existing exported symbols from "from import" statement.
                for (const importFromAs of exportedSymbols) {
                    this._textEditTracker.deleteImportName(parseResults, importFromAs);
                }

                importStatements =
                    importStatements ?? getTopLevelImports(parseResults.parseTree, /* includeImplicitImports */ false);

                // For now, this won't merge absolute and relative path "from import"
                // statement.
                this._textEditTracker.addOrUpdateImport(
                    parseResults,
                    importStatements,
                    { name: this._newModuleName },
                    getImportGroupFromModuleNameAndType(this._newModuleNameAndType),
                    exportedSymbols.map((i) => {
                        const name =
                            results.findIndex((r) => r.node === i.name) >= 0 ? this._newLastModuleName : i.name.value;
                        const alias =
                            results.findIndex((r) => r.node === i.alias) >= 0
                                ? this._newLastModuleName
                                : i.alias?.value;

                        return { name, alias };
                    }),
                    {
                        currentFromImport: fromNode,
                        originalModuleName: this._moduleName,
                    }
                );
                continue;
            }

            if (isFromImportName(nodeFound)) {
                if (this._textEditTracker.isNodeRemoved(nodeFound)) {
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
                    this._textEditTracker.addEditWithTextRange(parseResults, result.range, this._newLastModuleName);
                    continue;
                }

                if (fromNode.imports.length === 1) {
                    // ex) from xxx import [yyy] to from [aaa.bbb] import [zzz]
                    this._textEditTracker.addEditWithTextRange(parseResults, fromNode.module, newModuleName);
                    this._textEditTracker.addEditWithTextRange(parseResults, result.range, this._newLastModuleName);
                } else {
                    // Delete the existing import name including alias.
                    const importFromAs = nodeFound.parent as ImportFromAsNode;

                    // Update module name if needed.
                    if (fromNode.module.leadingDots > 0) {
                        for (const edit of this._getNewRelativeModuleNamesForFileMoved(filePath, [fromNode.module])) {
                            this._textEditTracker.addEditWithTextRange(
                                parseResults,
                                edit.moduleName,
                                edit.newModuleName
                            );
                        }
                    }

                    this._textEditTracker.deleteImportName(parseResults, importFromAs);

                    importStatements =
                        importStatements ??
                        getTopLevelImports(parseResults.parseTree, /* includeImplicitImports */ false);

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

                    this._textEditTracker.addOrUpdateImport(
                        parseResults,
                        importStatements,
                        { name: this._newModuleName, nameForImportFrom: newModuleName },
                        getImportGroupFromModuleNameAndType(this._newModuleNameAndType),
                        [importNameInfo],
                        {
                            currentFromImport: fromNode,
                            originalModuleName: this._moduleName,
                        }
                    );
                }
                continue;
            }

            if (isFromImportAlias(nodeFound)) {
                if (this._textEditTracker.isNodeRemoved(nodeFound)) {
                    // alias is already removed.
                    continue;
                }

                // ex) from ccc import xxx as [yyy] to from ccc import xxx as [zzz]
                this._textEditTracker.addEditWithTextRange(parseResults, result.range, this._newLastModuleName);
                continue;
            }

            /** TODO: if we get more than 1 decls, flag it as attention needed */
            const decls = DocumentSymbolCollector.getDeclarationsForNode(
                nodeFound,
                this._evaluator,
                /* resolveLocalName */ false,
                DocumentSymbolCollectorUseCase.Rename,
                this._token
            ).filter((d) => isAliasDeclaration(d)) as AliasDeclaration[];

            if (this._onlyNameChanged) {
                // Simple case. only name has changed. but not path.
                // Just replace name to new symbol name.
                // ex) a.[b].foo() to a.[z].foo()
                this._textEditTracker.addEditWithTextRange(parseResults, result.range, this._newLastModuleName);
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
                    this._textEditTracker.addEditWithTextRange(parseResults, dottedName, this._newModuleName);
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
                this._textEditTracker.addEditWithTextRange(parseResults, dottedName, this._newModuleName);
                continue;
            }

            if (result.node.value !== this._newLastModuleName) {
                this._textEditTracker.addEditWithTextRange(parseResults, result.range, this._newLastModuleName);
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
                /* ignoreFolderStructure */ false,
                /* sourceIsFile */ true
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

    private get _moduleName() {
        return this._moduleNameAndType.moduleName;
    }

    private get _newLastModuleName() {
        return this._newModuleNames[this._newModuleNames.length - 1];
    }

    private get _newModuleName() {
        return this._newModuleNameAndType.moduleName;
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
