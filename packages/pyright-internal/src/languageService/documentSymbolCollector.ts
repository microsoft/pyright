/*
 * documentSymbolCollector.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Collects symbols within the given tree that are semantically
 * equivalent to the requested symbol.
 */

import { CancellationToken } from 'vscode-languageserver';

import * as AnalyzerNodeInfo from '../analyzer/analyzerNodeInfo';
import {
    AliasDeclaration,
    Declaration,
    DeclarationType,
    FunctionDeclaration,
    isAliasDeclaration,
    isFunctionDeclaration,
} from '../analyzer/declaration';
import {
    areDeclarationsSame,
    createSynthesizedAliasDeclaration,
    getDeclarationsWithUsesLocalNameRemoved,
} from '../analyzer/declarationUtils';
import { getModuleNode, getStringNodeValueRange } from '../analyzer/parseTreeUtils';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { ParseTreeWalker } from '../analyzer/parseTreeWalker';
import { ScopeType } from '../analyzer/scope';
import * as ScopeUtils from '../analyzer/scopeUtils';
import { SourceFile } from '../analyzer/sourceFile';
import { isStubFile, SourceMapper } from '../analyzer/sourceMapper';
import { TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import { isInstantiableClass, TypeCategory } from '../analyzer/types';
import { ClassMemberLookupFlags, lookUpClassMember } from '../analyzer/typeUtils';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { appendArray } from '../common/collectionUtils';
import { assert } from '../common/debug';
import { DeclarationUseCase, Extensions } from '../common/extensibility';
import { TextRange } from '../common/textRange';
import {
    ClassNode,
    FunctionNode,
    ImportAsNode,
    NameNode,
    ParseNode,
    ParseNodeType,
    StringListNode,
    StringNode,
} from '../parser/parseNodes';

export type CollectionResult = {
    node: NameNode | StringNode;
    range: TextRange;
};

export enum DocumentSymbolCollectorUseCase {
    Rename,
    Reference,
}

// This walker looks for symbols that are semantically equivalent
// to the requested symbol.
export class DocumentSymbolCollector extends ParseTreeWalker {
    static collectFromNode(
        node: NameNode,
        evaluator: TypeEvaluator,
        cancellationToken: CancellationToken,
        startingNode?: ParseNode,
        treatModuleInImportAndFromImportSame = false,
        skipUnreachableCode = true,
        useCase = DocumentSymbolCollectorUseCase.Reference
    ): CollectionResult[] {
        const declarations = this.getDeclarationsForNode(
            node,
            evaluator,
            /* resolveLocalName */ true,
            useCase,
            cancellationToken
        );

        startingNode = startingNode ?? getModuleNode(node);
        if (!startingNode) {
            return [];
        }

        const collector = new DocumentSymbolCollector(
            [node.value],
            declarations,
            evaluator,
            cancellationToken,
            startingNode,
            treatModuleInImportAndFromImportSame,
            skipUnreachableCode,
            useCase
        );

        return collector.collect();
    }

    static getDeclarationsForNode(
        node: NameNode,
        evaluator: TypeEvaluator,
        resolveLocalName: boolean,
        useCase: DocumentSymbolCollectorUseCase,
        token: CancellationToken,
        sourceMapper?: SourceMapper,
        implicitlyImportedBy?: SourceFile[]
    ): Declaration[] {
        throwIfCancellationRequested(token);

        const declarations = this._getDeclarationsForNode(
            node,
            useCase,
            evaluator,
            token,
            /*skipUnreachableCode*/ false
        );

        // Add declarations from chained source files
        let builtinsScope = AnalyzerNodeInfo.getFileInfo(node).builtinsScope;
        while (builtinsScope && builtinsScope.type === ScopeType.Module) {
            const symbol = builtinsScope?.lookUpSymbol(node.value);
            if (symbol) {
                declarations.push(...symbol.getDeclarations());
            }

            builtinsScope = builtinsScope?.parent;
        }

        // Add declarations from files that implicitly import the target file.
        implicitlyImportedBy?.forEach((implicitImport) => {
            const parseTree = implicitImport.getParseResults()?.parseTree;
            if (parseTree) {
                const scope = AnalyzerNodeInfo.getScope(parseTree);
                const symbol = scope?.lookUpSymbol(node.value);
                if (symbol) {
                    declarations.push(...symbol.getDeclarations());
                }
            }
        });

        const resolvedDeclarations: Declaration[] = [];
        declarations.forEach((decl) => {
            const resolvedDecl = evaluator.resolveAliasDeclaration(decl, resolveLocalName);
            if (resolvedDecl) {
                resolvedDeclarations.push(resolvedDecl);

                if (sourceMapper && isStubFile(resolvedDecl.path)) {
                    const implDecls = sourceMapper.findDeclarations(resolvedDecl);
                    for (const implDecl of implDecls) {
                        if (implDecl && implDecl.path) {
                            this._addIfUnique(resolvedDeclarations, implDecl);
                        }
                    }
                }
            }
        });

        return resolvedDeclarations;
    }

    private _results: CollectionResult[] = [];
    private _dunderAllNameNodes = new Set<StringNode>();
    private _initFunction: FunctionNode | undefined;
    private _symbolNames: Set<string> = new Set<string>();

    constructor(
        symbolNames: string[],
        private _declarations: Declaration[],
        private _evaluator: TypeEvaluator,
        private _cancellationToken: CancellationToken,
        private _startingNode: ParseNode,
        private _treatModuleInImportAndFromImportSame = false,
        private _skipUnreachableCode = true,
        private _useCase = DocumentSymbolCollectorUseCase.Reference
    ) {
        super();

        // Start with the symbols passed in
        symbolNames.forEach((s) => this._symbolNames.add(s));

        // Don't report strings in __all__ right away, that will
        // break the assumption on the result ordering.
        this._setDunderAllNodes(this._startingNode);

        // Check if one of our symbols is __init__ and we
        // have a class declaration in the list and we are
        // computing symbols for references and not rename.
        const initDeclaration = _declarations.find(
            (d) => d.type === DeclarationType.Function && d.node.name.value === '__init__'
        );
        if (initDeclaration && _useCase === DocumentSymbolCollectorUseCase.Reference) {
            const classDeclaration = _declarations.find((d) => d.type === DeclarationType.Class);
            if (classDeclaration) {
                this._initFunction = initDeclaration.node as FunctionNode;
                this._symbolNames.add((classDeclaration.node as ClassNode).name.value);
            }
        }
    }

    collect() {
        this.walk(this._startingNode);
        return this._results;
    }

    override walk(node: ParseNode) {
        if (!this._skipUnreachableCode || !AnalyzerNodeInfo.isCodeUnreachable(node)) {
            super.walk(node);
        }
    }

    override visitName(node: NameNode): boolean {
        throwIfCancellationRequested(this._cancellationToken);

        // No need to do any more work if the symbol name doesn't match.
        if (!this._symbolNames.has(node.value)) {
            return false;
        }

        if (this._declarations.length > 0) {
            const declarations = DocumentSymbolCollector._getDeclarationsForNode(
                node,
                this._useCase,
                this._evaluator,
                this._cancellationToken,
                this._skipUnreachableCode
            );

            if (declarations && declarations.length > 0) {
                // Does this name share a declaration with the symbol of interest?
                if (declarations.some((decl) => this._resultsContainsDeclaration(decl, node))) {
                    this._addResult(node);
                }
            }
        } else {
            // There were no declarations
            this._addResult(node);
        }

        return false;
    }

    override visitStringList(node: StringListNode): boolean {
        // See if we have reference that matches this node.
        if (this._declarations.some((d) => d.node?.id === node.id)) {
            // Then the matching string should be included
            const matching = node.strings.find((s) => this._symbolNames.has(s.value));
            if (matching && matching.nodeType === ParseNodeType.String) {
                this._addResult(matching);
            }
        }
        return super.visitStringList(node);
    }

    override visitString(node: StringNode): boolean {
        throwIfCancellationRequested(this._cancellationToken);

        if (this._dunderAllNameNodes.has(node)) {
            this._addResult(node);
        }

        return false;
    }

    private _addResult(node: NameNode | StringNode) {
        const range: TextRange = node.nodeType === ParseNodeType.Name ? node : getStringNodeValueRange(node);
        this._results.push({ node, range });
    }

    private _isDeclarationAllowed(resolvedDecl: Declaration, referenceNode: ParseNode) {
        // Declaration is allowed if:
        // Matches one of our declarations.
        // and --
        // That match is the right kind.
        const match = this._declarations.find((decl) =>
            areDeclarationsSame(
                decl,
                resolvedDecl,
                this._treatModuleInImportAndFromImportSame,
                /* skipRangeForAliases */ true
            )
        );
        if (match) {
            // Special case for __init__ being one of our symbol names and we have a classname as the other.
            if (this._initFunction) {
                // If this is a method, must be an __init__ reference.
                if (match.type === DeclarationType.Function) {
                    return true;
                } else if (match.type === DeclarationType.Class) {
                    // If this is a class type match, only match on class calls.
                    // Meaning something like so:
                    // a = ClassA()
                    return referenceNode.parent?.nodeType === ParseNodeType.Call;
                }
                return false;
            }
            return true;
        }
        return false;
    }

    private _resultsContainsDeclaration(declaration: Declaration, referenceNode: ParseNode) {
        // Resolve the declaration.
        const resolvedDecl = this._evaluator.resolveAliasDeclaration(declaration, /* resolveLocalNames */ false);
        if (!resolvedDecl) {
            return false;
        }

        // The reference results declarations are already resolved, so we don't
        // need to call resolveAliasDeclaration on them.
        if (this._isDeclarationAllowed(resolvedDecl, referenceNode)) {
            return true;
        }

        // We didn't find the declaration using local-only alias resolution. Attempt
        // it again by fully resolving the alias.
        const resolvedDeclNonlocal = this._getResolveAliasDeclaration(resolvedDecl);
        if (!resolvedDeclNonlocal || resolvedDeclNonlocal === resolvedDecl) {
            return false;
        }

        return this._isDeclarationAllowed(resolvedDeclNonlocal, referenceNode);
    }

    private _getResolveAliasDeclaration(declaration: Declaration) {
        // TypeEvaluator.resolveAliasDeclaration only resolve alias in AliasDeclaration in the form of
        // "from x import y as [y]" but don't do thing for alias in "import x as [x]"
        // Here, alias should have same name as module name.
        if (isAliasDeclFromImportAsWithAlias(declaration)) {
            return getDeclarationsWithUsesLocalNameRemoved([declaration])[0];
        }

        const resolvedDecl = this._evaluator.resolveAliasDeclaration(declaration, /* resolveLocalNames */ true);
        return isAliasDeclFromImportAsWithAlias(resolvedDecl)
            ? getDeclarationsWithUsesLocalNameRemoved([resolvedDecl])[0]
            : resolvedDecl;

        function isAliasDeclFromImportAsWithAlias(decl?: Declaration): decl is AliasDeclaration {
            return (
                !!decl &&
                decl.type === DeclarationType.Alias &&
                decl.node &&
                decl.usesLocalName &&
                decl.node.nodeType === ParseNodeType.ImportAs
            );
        }
    }

    private _setDunderAllNodes(node: ParseNode) {
        if (node.nodeType !== ParseNodeType.Module) {
            return;
        }

        const dunderAllInfo = AnalyzerNodeInfo.getDunderAllInfo(node);
        if (!dunderAllInfo) {
            return;
        }

        const moduleScope = ScopeUtils.getScopeForNode(node);
        if (!moduleScope) {
            return;
        }

        dunderAllInfo.stringNodes.forEach((stringNode) => {
            if (!this._symbolNames.has(stringNode.value)) {
                return;
            }

            const symbolInScope = moduleScope.lookUpSymbolRecursive(stringNode.value);
            if (!symbolInScope) {
                return;
            }

            if (!symbolInScope.symbol.getDeclarations().some((d) => this._resultsContainsDeclaration(d, stringNode))) {
                return;
            }

            this._dunderAllNameNodes.add(stringNode);
        });
    }

    private static _addIfUnique(declarations: Declaration[], itemToAdd: Declaration) {
        for (const def of declarations) {
            if (
                areDeclarationsSame(
                    def,
                    itemToAdd,
                    /* treatModuleInImportAndFromImportSame */ false,
                    /* skipRangeForAliases */ true
                )
            ) {
                return;
            }
        }

        declarations.push(itemToAdd);
    }

    private static _getDeclarationsForInitNode(node: NameNode, evaluator: TypeEvaluator): Declaration[] {
        const parent = ParseTreeUtils.getEnclosingClassOrFunction(node.parent!);
        // See what type of __init__ we're at.
        if (parent?.nodeType === ParseNodeType.Class) {
            // This is a def for '__init__'. We should include the class name too.
            return this._getDeclarationsForNonModuleNameNode(parent.name, evaluator);
        } else if (
            node.parent?.nodeType === ParseNodeType.MemberAccess &&
            ((node.parent.leftExpression.nodeType === ParseNodeType.Call &&
                node.parent.leftExpression.leftExpression.nodeType === ParseNodeType.Name &&
                node.parent.leftExpression.leftExpression.value === 'super') ||
                (node.parent.leftExpression.nodeType === ParseNodeType.Name &&
                    node.parent.leftExpression.value === 'super'))
        ) {
            // We're on the 'super().__init__' call.
            const decls = evaluator.getDeclarationsForNameNode(node, /* skipUnreachableCode */ true);
            if (decls && decls.length > 0 && decls[0].node.parent) {
                // Parent node of the decl should be the class
                const classNode = ParseTreeUtils.getEnclosingClass(decls[0].node.parent);
                if (classNode) {
                    return this._getDeclarationsForNonModuleNameNode(classNode.name, evaluator);
                }
            }
        }

        return [];
    }

    private static _getDeclarationsForNode(
        node: NameNode,
        useCase: DocumentSymbolCollectorUseCase,
        evaluator: TypeEvaluator,
        token: CancellationToken,
        skipUnreachableCode = true
    ): Declaration[] {
        let result: Declaration[] = [];

        // This can handle symbols brought in by wildcard (import *) as long as the declarations that the symbol collector
        // compares against point to the actual alias declaration, not one that uses local name (ex, import alias)
        if (node.parent?.nodeType !== ParseNodeType.ModuleName) {
            result = this._getDeclarationsForNonModuleNameNode(node, evaluator, skipUnreachableCode);

            // Special case for __init__. Might be __init__ on a class.
            if (node.value === '__init__' && useCase === DocumentSymbolCollectorUseCase.Reference && node.parent) {
                result.push(...this._getDeclarationsForInitNode(node, evaluator));
            }
        } else {
            result = this._getDeclarationsForModuleNameNode(node, evaluator);
        }

        // Let extensions also add declarations.
        Extensions.getProgramExtensions(node).forEach((e) => {
            const declUseCase =
                useCase === DocumentSymbolCollectorUseCase.Rename
                    ? DeclarationUseCase.Rename
                    : DeclarationUseCase.References;
            const extras = e.declarationProviderExtension?.tryGetDeclarations(evaluator, node, declUseCase, token);
            if (extras && extras.length > 0) {
                result.push(...extras);
            }
        });

        return result;
    }

    private static _getDeclarationsForNonModuleNameNode(
        node: NameNode,
        evaluator: TypeEvaluator,
        skipUnreachableCode = true
    ): Declaration[] {
        assert(node.parent?.nodeType !== ParseNodeType.ModuleName);

        let decls = evaluator.getDeclarationsForNameNode(node, skipUnreachableCode) || [];
        if (node.parent?.nodeType === ParseNodeType.ImportFromAs) {
            // Make sure we get the decl for this specific "from import" statement
            decls = decls.filter((d) => d.node === node.parent);
        }

        // If we can't get decl, see whether we can get type from the node.
        // Some might have synthesized type for the node such as subModule in import X.Y statement.
        if (decls.length === 0) {
            const type = evaluator.getType(node);
            if (type?.category === TypeCategory.Module) {
                // Synthesize decl for the module.
                return [createSynthesizedAliasDeclaration(type.filePath)];
            }
        }

        // We would like to make X in import X and import X.Y as Y to match, but path for
        // X in import X and one in import X.Y as Y might not match since path in X.Y will point
        // to X.Y rather than X if import statement has an alias.
        // so, for such case, we put synthesized one so we can treat X in both statement same.
        for (const aliasDecl of decls.filter((d) => isAliasDeclaration(d) && !d.loadSymbolsFromPath)) {
            const node = (aliasDecl as AliasDeclaration).node;
            if (node.nodeType === ParseNodeType.ImportFromAs) {
                // from ... import X case, decl in the submodule fallback has the path.
                continue;
            }

            decls.push(...(evaluator.getDeclarationsForNameNode(node.module.nameParts[0], skipUnreachableCode) || []));
        }

        // For now, we only support function overriding.
        for (const decl of decls.filter(
            (d) => isFunctionDeclaration(d) && d.isMethod && d.node.name.value.length > 0
        )) {
            const methodDecl = decl as FunctionDeclaration;
            const enclosingClass = ParseTreeUtils.getEnclosingClass(methodDecl.node);
            const classResults = enclosingClass ? evaluator.getTypeOfClass(enclosingClass) : undefined;
            if (!classResults) {
                continue;
            }

            // Skip init and new as being overloads. They're not really overloads.
            if (methodDecl.node.name.value === '__init__' || methodDecl.node.name.value === '__new__') {
                continue;
            }

            for (const mroClass of classResults.classType.details.mro) {
                if (isInstantiableClass(mroClass)) {
                    const currentMember = lookUpClassMember(mroClass, methodDecl.node.name.value);
                    const baseMember = lookUpClassMember(
                        mroClass,
                        methodDecl.node.name.value,
                        ClassMemberLookupFlags.SkipOriginalClass
                    );
                    if (currentMember && !baseMember) {
                        // Found base decl of the overridden method. Hold onto the decls.
                        currentMember.symbol
                            .getDeclarations()
                            .filter((d) => isFunctionDeclaration(d) && d.isMethod)
                            .forEach((d) => this._addIfUnique(decls, d));
                    }
                }
            }
        }

        return decls;
    }

    private static _getDeclarationsForModuleNameNode(node: NameNode, evaluator: TypeEvaluator): Declaration[] {
        assert(node.parent?.nodeType === ParseNodeType.ModuleName);

        // We don't have symbols corresponding to ModuleName in our system since those
        // are not referenceable. but in "find all reference", we want to match those
        // if it refers to the same module file. Code below handles different kind of
        // ModuleName cases.
        const moduleName = node.parent;
        if (
            moduleName.parent?.nodeType === ParseNodeType.ImportAs ||
            moduleName.parent?.nodeType === ParseNodeType.ImportFrom
        ) {
            const index = moduleName.nameParts.findIndex((n) => n === node);

            // Special case, first module name part.
            if (index === 0) {
                // 1. import X or from X import ...
                const decls: Declaration[] = [];

                // First, we need to put decls for module names type evaluator synthesized so that
                // we can match both "import X" and "from X import ..."
                decls.push(
                    ...(evaluator
                        .getDeclarationsForNameNode(moduleName.nameParts[0])
                        ?.filter((d) => isAliasDeclaration(d)) || [])
                );

                if (decls.length === 0 || moduleName.parent.nodeType !== ParseNodeType.ImportAs) {
                    return decls;
                }

                // If module name belong to "import xxx" not "from xxx", then see whether
                // we can get regular decls (decls created from binder, not synthesized from type eval)
                // from symbol as well.
                // ex, import X as x
                const isImportAsWithAlias =
                    moduleName.nameParts.length === 1 &&
                    moduleName.parent.nodeType === ParseNodeType.ImportAs &&
                    !!moduleName.parent.alias;

                // if "import" has alias, symbol is assigned to alias, not the module.
                const importName = isImportAsWithAlias
                    ? (moduleName.parent as ImportAsNode).alias!.value
                    : moduleName.nameParts[0].value;

                // And we also need to re-use "decls for X" binder has created
                // so that it matches with decls type evaluator returns for "references for X".
                // ex) import X or from .X import ... in init file and etc.
                const symbolWithScope = ScopeUtils.getScopeForNode(node)?.lookUpSymbolRecursive(importName);
                if (symbolWithScope && moduleName.nameParts.length === 1) {
                    let declsFromSymbol: Declaration[] = [];

                    appendArray(
                        declsFromSymbol,
                        symbolWithScope.symbol.getDeclarations().filter((d) => isAliasDeclaration(d))
                    );

                    // If symbols are re-used, then find one that belong to this import statement.
                    if (declsFromSymbol.length > 1) {
                        declsFromSymbol = declsFromSymbol.filter((d) => {
                            d = d as AliasDeclaration;

                            if (d.firstNamePart !== undefined) {
                                // For multiple import statements with sub modules, decl can be re-used.
                                // ex) import X.Y and import X.Z or from .X import ... in init file.
                                // Decls for X will be reused for both import statements, and node will point
                                // to first import statement. For those case, use firstNamePart instead to check.
                                return d.firstNamePart === moduleName.nameParts[0].value;
                            }

                            return d.node === moduleName.parent;
                        });
                    }

                    // ex, import X as x
                    // We have decls for the alias "x" not the module name "X". Convert decls for the "X"
                    if (isImportAsWithAlias) {
                        declsFromSymbol = getDeclarationsWithUsesLocalNameRemoved(declsFromSymbol);
                    }

                    decls.push(...declsFromSymbol);
                }

                return decls;
            }

            if (index > 0) {
                // 2. import X.Y or from X.Y import ....
                // For submodule "Y", we just use synthesized decls from type evaluator.
                // Decls for these sub module don't actually exist in the system. Instead, symbol for Y in
                // "import X.Y" hold onto synthesized module type (without any decl).
                // And "from X.Y import ..." doesn't have any symbol associated module names.
                // they can't be referenced in the module.
                return evaluator.getDeclarationsForNameNode(moduleName.nameParts[index]) || [];
            }

            return [];
        }

        return [];
    }
}
