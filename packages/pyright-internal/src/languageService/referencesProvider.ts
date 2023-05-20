/*
 * referencesProvider.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Logic that finds all of the references to a symbol specified
 * by a location within a file.
 */

import { CancellationToken, Location, ResultProgressReporter } from 'vscode-languageserver';

import { Declaration, DeclarationType, isAliasDeclaration } from '../analyzer/declaration';
import { getNameFromDeclaration } from '../analyzer/declarationUtils';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { isUserCode } from '../analyzer/sourceFileInfoUtils';
import { Symbol } from '../analyzer/symbol';
import { isVisibleExternally } from '../analyzer/symbolUtils';
import { TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import { maxTypeRecursionCount } from '../analyzer/types';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { appendArray } from '../common/collectionUtils';
import { assertNever } from '../common/debug';
import { ProgramView } from '../common/extensibility';
import { convertOffsetToPosition, convertPositionToOffset } from '../common/positionUtils';
import { DocumentRange, Position, TextRange, doesRangeContain } from '../common/textRange';
import { NameNode, ParseNode, ParseNodeType } from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';
import { DocumentSymbolCollector, DocumentSymbolCollectorUseCase } from './documentSymbolCollector';
import { convertDocumentRangesToLocation } from './navigationUtils';

export type ReferenceCallback = (locations: DocumentRange[]) => void;

export class ReferencesResult {
    private readonly _locations: DocumentRange[] = [];

    readonly nonImportDeclarations: Declaration[];

    constructor(
        readonly requiresGlobalSearch: boolean,
        readonly nodeAtOffset: ParseNode,
        readonly symbolNames: string[],
        readonly declarations: Declaration[],
        readonly useCase: DocumentSymbolCollectorUseCase,
        private readonly _reporter?: ReferenceCallback
    ) {
        // Filter out any import decls. but leave one with alias.
        this.nonImportDeclarations = declarations.filter((d) => {
            if (!isAliasDeclaration(d)) {
                return true;
            }

            // We must have alias and decl node that point to import statement.
            if (!d.usesLocalName || !d.node) {
                return false;
            }

            // d.node can't be ImportFrom if usesLocalName is true.
            // but we are doing this for type checker.
            if (d.node.nodeType === ParseNodeType.ImportFrom) {
                return false;
            }

            // Extract alias for comparison (symbolNames.some can't know d is for an Alias).
            const alias = d.node.alias?.value;

            // Check alias and what we are renaming is same thing.
            if (!symbolNames.some((s) => s === alias)) {
                return false;
            }

            return true;
        });
    }

    get containsOnlyImportDecls(): boolean {
        return this.declarations.length > 0 && this.nonImportDeclarations.length === 0;
    }

    get locations(): readonly DocumentRange[] {
        return this._locations;
    }

    addLocations(...locs: DocumentRange[]) {
        if (locs.length === 0) {
            return;
        }

        if (this._reporter) {
            this._reporter(locs);
        }

        appendArray(this._locations, locs);
    }
}

export class FindReferencesTreeWalker {
    private _parseResults: ParseResults | undefined;

    constructor(
        private _program: ProgramView,
        private _filePath: string,
        private _referencesResult: ReferencesResult,
        private _includeDeclaration: boolean,
        private _cancellationToken: CancellationToken
    ) {
        this._parseResults = this._program.getParseResults(this._filePath);
    }

    findReferences(rootNode = this._parseResults?.parseTree) {
        const results: DocumentRange[] = [];
        if (!this._parseResults) {
            return results;
        }

        const collector = new DocumentSymbolCollector(
            this._program,
            this._referencesResult.symbolNames,
            this._referencesResult.declarations,
            this._cancellationToken,
            rootNode!,
            /* treatModuleInImportAndFromImportSame */ true,
            /* skipUnreachableCode */ false,
            this._referencesResult.useCase
        );

        for (const result of collector.collect()) {
            // Is it the same symbol?
            if (this._includeDeclaration || result.node !== this._referencesResult.nodeAtOffset) {
                results.push({
                    path: this._filePath,
                    range: {
                        start: convertOffsetToPosition(result.range.start, this._parseResults.tokenizerOutput.lines),
                        end: convertOffsetToPosition(
                            TextRange.getEnd(result.range),
                            this._parseResults.tokenizerOutput.lines
                        ),
                    },
                });
            }
        }

        return results;
    }
}

export class ReferencesProvider {
    constructor(private _program: ProgramView, private _token: CancellationToken) {
        // empty
    }

    reportReferences(
        filePath: string,
        position: Position,
        includeDeclaration: boolean,
        resultReporter?: ResultProgressReporter<Location[]>
    ) {
        const sourceFileInfo = this._program.getSourceFileInfo(filePath);
        if (!sourceFileInfo) {
            return;
        }

        const parseResults = this._program.getParseResults(filePath);
        if (!parseResults) {
            return;
        }

        const locations: Location[] = [];
        const reporter: ReferenceCallback = resultReporter
            ? (range) => resultReporter.report(convertDocumentRangesToLocation(this._program.fileSystem, range))
            : (range) => appendArray(locations, convertDocumentRangesToLocation(this._program.fileSystem, range));

        const invokedFromUserFile = isUserCode(sourceFileInfo);
        const referencesResult = ReferencesProvider.getDeclarationForPosition(
            this._program,
            filePath,
            position,
            reporter,
            DocumentSymbolCollectorUseCase.Reference,
            this._token
        );
        if (!referencesResult) {
            return;
        }

        // Do we need to do a global search as well?
        if (!referencesResult.requiresGlobalSearch) {
            this.addReferencesToResult(sourceFileInfo.sourceFile.getFilePath(), includeDeclaration, referencesResult);
        }

        for (const curSourceFileInfo of this._program.getSourceFileInfoList()) {
            throwIfCancellationRequested(this._token);

            // "Find all references" will only include references from user code
            // unless the file is explicitly opened in the editor or it is invoked from non user files.
            if (curSourceFileInfo.isOpenByClient || !invokedFromUserFile || isUserCode(curSourceFileInfo)) {
                // See if the reference symbol's string is located somewhere within the file.
                // If not, we can skip additional processing for the file.
                const fileContents = curSourceFileInfo.sourceFile.getFileContent();
                if (!fileContents || referencesResult.symbolNames.some((s) => fileContents.search(s) >= 0)) {
                    this.addReferencesToResult(
                        curSourceFileInfo.sourceFile.getFilePath(),
                        includeDeclaration,
                        referencesResult
                    );
                }

                // This operation can consume significant memory, so check
                // for situations where we need to discard the type cache.
                this._program.handleMemoryHighUsage();
            }
        }

        // Make sure to include declarations regardless where they are defined
        // if includeDeclaration is set.
        if (includeDeclaration) {
            for (const decl of referencesResult.declarations) {
                throwIfCancellationRequested(this._token);

                if (referencesResult.locations.some((l) => l.path === decl.path)) {
                    // Already included.
                    continue;
                }

                const declFileInfo = this._program.getSourceFileInfo(decl.path);
                if (!declFileInfo) {
                    // The file the declaration belongs to doesn't belong to the program.
                    continue;
                }

                const tempResult = new ReferencesResult(
                    referencesResult.requiresGlobalSearch,
                    referencesResult.nodeAtOffset,
                    referencesResult.symbolNames,
                    referencesResult.declarations,
                    referencesResult.useCase
                );

                this.addReferencesToResult(declFileInfo.sourceFile.getFilePath(), includeDeclaration, tempResult);
                for (const loc of tempResult.locations) {
                    // Include declarations only. And throw away any references
                    if (loc.path === decl.path && doesRangeContain(decl.range, loc.range)) {
                        referencesResult.addLocations(loc);
                    }
                }
            }
        }

        return locations;
    }

    addReferencesToResult(filePath: string, includeDeclaration: boolean, referencesResult: ReferencesResult): void {
        const parseResults = this._program.getParseResults(filePath);
        if (!parseResults) {
            return;
        }

        const refTreeWalker = new FindReferencesTreeWalker(
            this._program,
            filePath,
            referencesResult,
            includeDeclaration,
            this._token
        );

        referencesResult.addLocations(...refTreeWalker.findReferences());
    }

    static getDeclarationForNode(
        program: ProgramView,
        filePath: string,
        node: NameNode,
        reporter: ReferenceCallback | undefined,
        useCase: DocumentSymbolCollectorUseCase,
        token: CancellationToken
    ) {
        throwIfCancellationRequested(token);

        const declarations = DocumentSymbolCollector.getDeclarationsForNode(
            program,
            node,
            /* resolveLocalNames */ false,
            useCase,
            token
        );

        if (declarations.length === 0) {
            return undefined;
        }

        const requiresGlobalSearch = isVisibleOutside(program.evaluator!, filePath, node, declarations);
        const symbolNames = new Set(declarations.map((d) => getNameFromDeclaration(d)!).filter((n) => !!n));
        symbolNames.add(node.value);

        return new ReferencesResult(
            requiresGlobalSearch,
            node,
            Array.from(symbolNames.values()),
            declarations,
            useCase,
            reporter
        );
    }

    static getDeclarationForPosition(
        program: ProgramView,
        filePath: string,
        position: Position,
        reporter: ReferenceCallback | undefined,
        useCase: DocumentSymbolCollectorUseCase,
        token: CancellationToken
    ): ReferencesResult | undefined {
        throwIfCancellationRequested(token);
        const parseResults = program.getParseResults(filePath);
        if (!parseResults) {
            return undefined;
        }

        const offset = convertPositionToOffset(position, parseResults.tokenizerOutput.lines);
        if (offset === undefined) {
            return undefined;
        }

        const node = ParseTreeUtils.findNodeByOffset(parseResults.parseTree, offset);
        if (node === undefined) {
            return undefined;
        }

        // If this isn't a name node, there are no references to be found.
        if (node.nodeType !== ParseNodeType.Name) {
            return undefined;
        }

        return this.getDeclarationForNode(program, filePath, node, reporter, useCase, token);
    }
}

function isVisibleOutside(
    evaluator: TypeEvaluator,
    currentFilePath: string,
    node: NameNode,
    declarations: Declaration[]
) {
    const result = evaluator.lookUpSymbolRecursive(node, node.value, /* honorCodeFlow */ false);
    if (result && !isExternallyVisible(result.symbol)) {
        return false;
    }

    // A symbol's effective external visibility check is not enough to determine whether
    // the symbol is visible to the outside. Something like the local variable inside
    // a function will still say it is externally visible even if it can't be accessed from another module.
    // So, we also need to determine whether the symbol is declared within an evaluation scope
    // that is within the current file and cannot be imported directly from other modules.
    return declarations.some((decl) => {
        // If the declaration is outside of this file, a global search is needed.
        if (decl.path !== currentFilePath) {
            return true;
        }

        const evalScope = ParseTreeUtils.getEvaluationScopeNode(decl.node);

        // If the declaration is at the module level or a class level, it can be seen
        // outside of the current module, so a global search is needed.
        if (evalScope.nodeType === ParseNodeType.Module || evalScope.nodeType === ParseNodeType.Class) {
            return true;
        }

        // If the name node is a member variable, we need to do a global search.
        if (decl.node?.parent?.nodeType === ParseNodeType.MemberAccess && decl.node === decl.node.parent.memberName) {
            return true;
        }

        return false;
    });

    // Return true if the symbol is visible outside of current module, false if not.
    function isExternallyVisible(symbol: Symbol, recursionCount = 0): boolean {
        if (recursionCount > maxTypeRecursionCount) {
            return false;
        }

        recursionCount++;

        if (!isVisibleExternally(symbol)) {
            return false;
        }

        return symbol.getDeclarations().reduce<boolean>((isVisible, decl) => {
            if (!isVisible) {
                return false;
            }

            switch (decl.type) {
                case DeclarationType.Alias:
                case DeclarationType.Intrinsic:
                case DeclarationType.SpecialBuiltInClass:
                    return isVisible;

                case DeclarationType.Class:
                case DeclarationType.Function:
                    return isVisible && isContainerExternallyVisible(decl.node.name, recursionCount);

                case DeclarationType.Parameter:
                    return isVisible && isContainerExternallyVisible(decl.node.name!, recursionCount);

                case DeclarationType.TypeParameter:
                    return false;

                case DeclarationType.Variable:
                case DeclarationType.TypeAlias: {
                    if (decl.node.nodeType === ParseNodeType.Name) {
                        return isVisible && isContainerExternallyVisible(decl.node, recursionCount);
                    }

                    // Symbol without name is not visible outside.
                    return false;
                }

                default:
                    assertNever(decl);
            }
        }, /* visible */ true);
    }

    // Return true if the scope that contains the specified node is visible
    // outside of the current module, false if not.
    function isContainerExternallyVisible(node: NameNode, recursionCount: number) {
        const scopingNode = ParseTreeUtils.getEvaluationScopeNode(node);
        switch (scopingNode.nodeType) {
            case ParseNodeType.Class:
            case ParseNodeType.Function: {
                const name = scopingNode.name;
                const result = evaluator.lookUpSymbolRecursive(name, name.value, /* honorCodeFlow */ false);
                return result ? isExternallyVisible(result.symbol, recursionCount) : true;
            }

            case ParseNodeType.Lambda:
            case ParseNodeType.ListComprehension:
                // Symbols in this scope can't be visible outside.
                return false;

            case ParseNodeType.Module:
                return true;

            default:
                assertNever(scopingNode);
        }
    }
}
