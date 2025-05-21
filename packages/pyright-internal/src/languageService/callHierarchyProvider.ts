/*
 * callHierarchyProvider.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Logic that provides a list of callers or callees associated with
 * a position.
 */

import { CancellationToken, SymbolKind } from 'vscode-languageserver';
import {
    CallHierarchyIncomingCall,
    CallHierarchyItem,
    CallHierarchyOutgoingCall,
    Range,
} from 'vscode-languageserver-types';

import { Declaration, DeclarationType } from '../analyzer/declaration';
import * as DeclarationUtils from '../analyzer/declarationUtils';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { ParseTreeWalker } from '../analyzer/parseTreeWalker';
import { isUserCode } from '../analyzer/sourceFileInfoUtils';
import { TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import { MemberAccessFlags, doForEachSubtype, lookUpClassMember, lookUpObjectMember } from '../analyzer/typeUtils';
import { ClassType, isClassInstance, isFunction, isInstantiableClass } from '../analyzer/types';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { appendArray } from '../common/collectionUtils';
import { isDefined } from '../common/core';
import { ProgramView, ReferenceUseCase, SymbolUsageProvider } from '../common/extensibility';
import { ReadOnlyFileSystem } from '../common/fileSystem';
import { getSymbolKind } from '../common/lspUtils';
import { convertOffsetsToRange } from '../common/positionUtils';
import { ServiceKeys } from '../common/serviceKeys';
import { Position, rangesAreEqual } from '../common/textRange';
import { Uri } from '../common/uri/uri';
import { convertUriToLspUriString } from '../common/uri/uriUtils';
import { ReferencesProvider, ReferencesResult } from '../languageService/referencesProvider';
import { CallNode, MemberAccessNode, NameNode, ParseNode, ParseNodeType } from '../parser/parseNodes';
import { ParseFileResults } from '../parser/parser';
import { DocumentSymbolCollector } from './documentSymbolCollector';
import { canNavigateToFile } from './navigationUtils';

export class CallHierarchyProvider {
    private readonly _parseResults: ParseFileResults | undefined;

    constructor(
        private _program: ProgramView,
        private _fileUri: Uri,
        private _position: Position,
        private _token: CancellationToken
    ) {
        this._parseResults = this._program.getParseResults(this._fileUri);
    }

    onPrepare(): CallHierarchyItem[] | null {
        throwIfCancellationRequested(this._token);
        if (!this._parseResults) {
            return null;
        }

        const referencesResult = this._getDeclaration();
        if (!referencesResult || referencesResult.declarations.length === 0) {
            return null;
        }

        const { targetDecl, callItemUri, symbolName } = this._getTargetDeclaration(referencesResult);
        if (
            targetDecl.type !== DeclarationType.Function &&
            targetDecl.type !== DeclarationType.Class &&
            targetDecl.type !== DeclarationType.Alias
        ) {
            return null;
        }

        // make sure the alias is resolved to class or function
        if (targetDecl.type === DeclarationType.Alias) {
            const resolvedDecl = this._evaluator.resolveAliasDeclaration(targetDecl, true);
            if (!resolvedDecl) {
                return null;
            }

            if (resolvedDecl.type !== DeclarationType.Function && resolvedDecl.type !== DeclarationType.Class) {
                return null;
            }
        }

        const callItem: CallHierarchyItem = {
            name: symbolName,
            kind: getSymbolKind(targetDecl, this._evaluator, symbolName) ?? SymbolKind.Module,
            uri: convertUriToLspUriString(this._program.fileSystem, callItemUri),
            range: targetDecl.range,
            selectionRange: targetDecl.range,
        };

        if (!canNavigateToFile(this._program.fileSystem, Uri.parse(callItem.uri, this._program.serviceProvider))) {
            return null;
        }

        return [callItem];
    }

    getIncomingCalls(): CallHierarchyIncomingCall[] | null {
        throwIfCancellationRequested(this._token);
        if (!this._parseResults) {
            return null;
        }

        const referencesResult = this._getDeclaration();
        if (!referencesResult || referencesResult.declarations.length === 0) {
            return null;
        }

        const { targetDecl, symbolName } = this._getTargetDeclaration(referencesResult);

        const items: CallHierarchyIncomingCall[] = [];
        const sourceFiles =
            targetDecl.type === DeclarationType.Alias
                ? [this._program.getSourceFileInfo(this._fileUri)!]
                : this._program.getSourceFileInfoList();
        for (const curSourceFileInfo of sourceFiles) {
            if (isUserCode(curSourceFileInfo) || curSourceFileInfo.isOpenByClient) {
                const filePath = curSourceFileInfo.uri;
                const itemsToAdd = this._getIncomingCallsForDeclaration(filePath, symbolName, targetDecl);

                if (itemsToAdd) {
                    appendArray(items, itemsToAdd);
                }

                // This operation can consume significant memory, so check
                // for situations where we need to discard the type cache.
                this._program.handleMemoryHighUsage();
            }
        }

        if (items.length === 0) {
            return null;
        }

        return items.filter((item) =>
            canNavigateToFile(this._program.fileSystem, Uri.parse(item.from.uri, this._program.serviceProvider))
        );
    }

    getOutgoingCalls(): CallHierarchyOutgoingCall[] | null {
        throwIfCancellationRequested(this._token);
        if (!this._parseResults) {
            return null;
        }

        const referencesResult = this._getDeclaration();
        if (!referencesResult || referencesResult.declarations.length === 0) {
            return null;
        }

        const { targetDecl } = this._getTargetDeclaration(referencesResult);

        // Find the parse node root corresponding to the function or class.
        let parseRoot: ParseNode | undefined;
        const resolvedDecl = this._evaluator.resolveAliasDeclaration(targetDecl, /* resolveLocalNames */ true);
        if (!resolvedDecl) {
            return null;
        }

        if (resolvedDecl.type === DeclarationType.Function) {
            parseRoot = resolvedDecl.node;
        } else if (resolvedDecl.type === DeclarationType.Class) {
            // Look up the __init__ method for this class.
            const classType = this._evaluator.getTypeForDeclaration(resolvedDecl)?.type;
            if (classType && isInstantiableClass(classType)) {
                // Don't perform a recursive search of parent classes in this
                // case because we don't want to find an inherited __init__
                // method defined in a different module.
                const initMethodMember = lookUpClassMember(
                    classType,
                    '__init__',
                    MemberAccessFlags.SkipInstanceMembers |
                        MemberAccessFlags.SkipObjectBaseClass |
                        MemberAccessFlags.SkipBaseClasses
                );
                if (initMethodMember) {
                    const initMethodType = this._evaluator.getTypeOfMember(initMethodMember);
                    if (initMethodType && isFunction(initMethodType)) {
                        const initDecls = initMethodMember.symbol.getDeclarations();
                        if (initDecls && initDecls.length > 0) {
                            const primaryInitDecl = initDecls[0];
                            if (primaryInitDecl.type === DeclarationType.Function) {
                                parseRoot = primaryInitDecl.node;
                            }
                        }
                    }
                }
            }
        }

        if (!parseRoot) {
            return null;
        }

        const callFinder = new FindOutgoingCallTreeWalker(
            this._program.fileSystem,
            parseRoot,
            this._parseResults,
            this._evaluator,
            this._token
        );
        const outgoingCalls = callFinder.findCalls();
        if (outgoingCalls.length === 0) {
            return null;
        }

        return outgoingCalls.filter((item) =>
            canNavigateToFile(this._program.fileSystem, Uri.parse(item.to.uri, this._program.serviceProvider))
        );
    }

    private get _evaluator(): TypeEvaluator {
        return this._program.evaluator!;
    }

    private _getTargetDeclaration(referencesResult: ReferencesResult): {
        targetDecl: Declaration;
        callItemUri: Uri;
        symbolName: string;
    } {
        // If there's more than one declaration, pick the target one.
        // We'll always prefer one with a declared type, and we'll always
        // prefer later declarations.
        const declarations = referencesResult.declarations;
        const node = referencesResult.nodeAtOffset;
        let targetDecl = declarations[0];
        for (const decl of declarations) {
            if (DeclarationUtils.hasTypeForDeclaration(decl) || !DeclarationUtils.hasTypeForDeclaration(targetDecl)) {
                if (decl.type === DeclarationType.Function || decl.type === DeclarationType.Class) {
                    targetDecl = decl;

                    // If the specified node is an exact match, use this declaration
                    // as the primary even if it's not the last.
                    if (decl.node === node) {
                        break;
                    }
                }
            }
        }

        let symbolName;

        // Although the LSP specification requires a URI, we are using a file path
        // here because it is converted to the proper URI by the caller.
        // This simplifies our code and ensures compatibility with the LSP specification.
        let callItemUri: Uri;
        if (targetDecl.type === DeclarationType.Alias) {
            symbolName = (referencesResult.nodeAtOffset as NameNode).d.value;
            callItemUri = this._fileUri;
        } else {
            symbolName = DeclarationUtils.getNameFromDeclaration(targetDecl) || referencesResult.symbolNames[0];
            callItemUri = targetDecl.uri;
        }

        return { targetDecl, callItemUri, symbolName };
    }

    private _getIncomingCallsForDeclaration(
        fileUri: Uri,
        symbolName: string,
        declaration: Declaration
    ): CallHierarchyIncomingCall[] | undefined {
        throwIfCancellationRequested(this._token);

        const callFinder = new FindIncomingCallTreeWalker(this._program, fileUri, symbolName, declaration, this._token);

        const incomingCalls = callFinder.findCalls();
        return incomingCalls.length > 0 ? incomingCalls : undefined;
    }

    private _getDeclaration(): ReferencesResult | undefined {
        return ReferencesProvider.getDeclarationForPosition(
            this._program,
            this._fileUri,
            this._position,
            /* reporter */ undefined,
            ReferenceUseCase.References,
            this._token
        );
    }
}

class FindOutgoingCallTreeWalker extends ParseTreeWalker {
    private _outgoingCalls: CallHierarchyOutgoingCall[] = [];

    constructor(
        private _fs: ReadOnlyFileSystem,
        private _parseRoot: ParseNode,
        private _parseResults: ParseFileResults,
        private _evaluator: TypeEvaluator,
        private _cancellationToken: CancellationToken
    ) {
        super();
    }

    findCalls(): CallHierarchyOutgoingCall[] {
        this.walk(this._parseRoot);
        return this._outgoingCalls;
    }

    override visitCall(node: CallNode): boolean {
        throwIfCancellationRequested(this._cancellationToken);

        let nameNode: NameNode | undefined;

        if (node.d.leftExpr.nodeType === ParseNodeType.Name) {
            nameNode = node.d.leftExpr;
        } else if (node.d.leftExpr.nodeType === ParseNodeType.MemberAccess) {
            nameNode = node.d.leftExpr.d.member;
        }

        if (nameNode) {
            const declarations = this._evaluator.getDeclInfoForNameNode(nameNode)?.decls;

            if (declarations) {
                // TODO - it would be better if we could match the call to the
                // specific declaration (e.g. a specific overload of a property
                // setter vs getter). For now, add callees for all declarations.
                declarations.forEach((decl) => {
                    this._addOutgoingCallForDeclaration(nameNode!, decl);
                });
            }
        }

        return true;
    }

    override visitMemberAccess(node: MemberAccessNode): boolean {
        throwIfCancellationRequested(this._cancellationToken);

        // Determine whether the member corresponds to a property.
        // If so, we'll treat it as a function call for purposes of
        // finding outgoing calls.
        const leftHandType = this._evaluator.getType(node.d.leftExpr);
        if (leftHandType) {
            doForEachSubtype(leftHandType, (subtype) => {
                let baseType = subtype;

                // This could be a bound TypeVar (e.g. used for "self" and "cls").
                baseType = this._evaluator.makeTopLevelTypeVarsConcrete(baseType);

                if (!isClassInstance(baseType)) {
                    return;
                }

                const memberInfo = lookUpObjectMember(baseType, node.d.member.d.value);
                if (!memberInfo) {
                    return;
                }

                const memberType = this._evaluator.getTypeOfMember(memberInfo);
                const propertyDecls = memberInfo.symbol.getDeclarations();

                if (!memberType) {
                    return;
                }

                if (isClassInstance(memberType) && ClassType.isPropertyClass(memberType)) {
                    propertyDecls.forEach((decl) => {
                        this._addOutgoingCallForDeclaration(node.d.member, decl);
                    });
                }
            });
        }

        return true;
    }

    private _addOutgoingCallForDeclaration(nameNode: NameNode, declaration: Declaration) {
        const resolvedDecl = this._evaluator.resolveAliasDeclaration(declaration, /* resolveLocalNames */ true);
        if (!resolvedDecl) {
            return;
        }

        if (resolvedDecl.type !== DeclarationType.Function && resolvedDecl.type !== DeclarationType.Class) {
            return;
        }

        const callDest: CallHierarchyItem = {
            name: nameNode.d.value,
            kind: getSymbolKind(resolvedDecl, this._evaluator, nameNode.d.value) ?? SymbolKind.Module,
            uri: convertUriToLspUriString(this._fs, resolvedDecl.uri),
            range: resolvedDecl.range,
            selectionRange: resolvedDecl.range,
        };

        // Is there already a call recorded for this destination? If so,
        // we'll simply add a new range. Otherwise, we'll create a new entry.
        let outgoingCall: CallHierarchyOutgoingCall | undefined = this._outgoingCalls.find(
            (outgoing) => outgoing.to.uri === callDest.uri && rangesAreEqual(outgoing.to.range, callDest.range)
        );

        if (!outgoingCall) {
            outgoingCall = {
                to: callDest,
                fromRanges: [],
            };
            this._outgoingCalls.push(outgoingCall);
        }

        if (outgoingCall && outgoingCall.to.name !== nameNode.d.value) {
            // If both the function and its alias are called in the same function,
            // the name of the call item will be the resolved declaration name, not the alias.
            outgoingCall.to.name = DeclarationUtils.getNameFromDeclaration(resolvedDecl) ?? nameNode.d.value;
        }

        const fromRange: Range = convertOffsetsToRange(
            nameNode.start,
            nameNode.start + nameNode.length,
            this._parseResults.tokenizerOutput.lines
        );
        outgoingCall.fromRanges.push(fromRange);
    }
}

class FindIncomingCallTreeWalker extends ParseTreeWalker {
    private readonly _incomingCalls: CallHierarchyIncomingCall[] = [];
    private readonly _declarations: Declaration[] = [];

    private readonly _usageProviders: SymbolUsageProvider[];
    private readonly _parseResults: ParseFileResults;

    constructor(
        private readonly _program: ProgramView,
        private readonly _fileUri: Uri,
        private readonly _symbolName: string,
        private readonly _targetDeclaration: Declaration,
        private readonly _cancellationToken: CancellationToken
    ) {
        super();

        this._parseResults = this._program.getParseResults(this._fileUri)!;
        this._usageProviders = (this._program.serviceProvider.tryGet(ServiceKeys.symbolUsageProviderFactory) ?? [])
            .map((f) =>
                f.tryCreateProvider(ReferenceUseCase.References, [this._targetDeclaration], this._cancellationToken)
            )
            .filter(isDefined);

        this._declarations.push(this._targetDeclaration);
        this._usageProviders.forEach((p) => p.appendDeclarationsTo(this._declarations));
    }

    findCalls(): CallHierarchyIncomingCall[] {
        this.walk(this._parseResults.parserOutput.parseTree);
        return this._incomingCalls;
    }

    override visitCall(node: CallNode): boolean {
        throwIfCancellationRequested(this._cancellationToken);

        let nameNode: NameNode | undefined;
        if (node.d.leftExpr.nodeType === ParseNodeType.Name) {
            nameNode = node.d.leftExpr;
        } else if (node.d.leftExpr.nodeType === ParseNodeType.MemberAccess) {
            nameNode = node.d.leftExpr.d.member;
        }

        // Don't bother doing any more work if the name doesn't match.
        if (nameNode && nameNode.d.value === this._symbolName) {
            const declarations = this._getDeclarations(nameNode);
            if (declarations) {
                if (this._targetDeclaration.type === DeclarationType.Alias) {
                    const resolvedCurDecls = this._evaluator.resolveAliasDeclaration(
                        this._targetDeclaration,
                        /* resolveLocalNames */ true
                    );
                    if (
                        resolvedCurDecls &&
                        declarations.some((decl) => DeclarationUtils.areDeclarationsSame(decl!, resolvedCurDecls))
                    ) {
                        this._addIncomingCallForDeclaration(nameNode!);
                    }
                } else if (
                    declarations.some((decl) =>
                        this._declarations.some((t) => DeclarationUtils.areDeclarationsSame(decl, t))
                    )
                ) {
                    this._addIncomingCallForDeclaration(nameNode!);
                }
            }
        }

        return true;
    }

    override visitMemberAccess(node: MemberAccessNode): boolean {
        throwIfCancellationRequested(this._cancellationToken);

        if (node.d.member.d.value === this._symbolName) {
            // Determine whether the member corresponds to a property.
            // If so, we'll treat it as a function call for purposes of
            // finding outgoing calls.
            const leftHandType = this._evaluator.getType(node.d.leftExpr);
            if (leftHandType) {
                doForEachSubtype(leftHandType, (subtype) => {
                    let baseType = subtype;

                    // This could be a bound TypeVar (e.g. used for "self" and "cls").
                    baseType = this._evaluator.makeTopLevelTypeVarsConcrete(baseType);

                    if (!isClassInstance(baseType)) {
                        return;
                    }

                    const memberInfo = lookUpObjectMember(baseType, node.d.member.d.value);
                    if (!memberInfo) {
                        return;
                    }

                    const memberType = this._evaluator.getTypeOfMember(memberInfo);
                    const propertyDecls = memberInfo.symbol.getDeclarations();

                    if (!memberType) {
                        return;
                    }

                    if (
                        propertyDecls.some((decl) =>
                            DeclarationUtils.areDeclarationsSame(decl!, this._targetDeclaration)
                        )
                    ) {
                        this._addIncomingCallForDeclaration(node.d.member);
                    }
                });
            }
        }

        return true;
    }

    private get _evaluator(): TypeEvaluator {
        return this._program.evaluator!;
    }

    private _getDeclarations(node: NameNode) {
        const declarations = DocumentSymbolCollector.getDeclarationsForNode(
            this._program,
            node,
            /* resolveLocalName */ true,
            this._cancellationToken
        );

        const results = [...declarations];
        this._usageProviders.forEach((p) => p.appendDeclarationsAt(node, declarations, results));

        return results;
    }

    private _addIncomingCallForDeclaration(nameNode: NameNode) {
        let executionNode = ParseTreeUtils.getExecutionScopeNode(nameNode);
        while (executionNode && executionNode.nodeType === ParseNodeType.TypeParameterList) {
            executionNode = ParseTreeUtils.getExecutionScopeNode(executionNode);
        }

        if (!executionNode) {
            return;
        }

        let callSource: CallHierarchyItem;
        if (executionNode.nodeType === ParseNodeType.Module) {
            const moduleRange = convertOffsetsToRange(0, 0, this._parseResults.tokenizerOutput.lines);
            const fileName = this._program.fileSystem.getOriginalUri(this._fileUri).fileName;

            callSource = {
                name: `(module) ${fileName}`,
                kind: SymbolKind.Module,
                uri: convertUriToLspUriString(this._program.fileSystem, this._fileUri),
                range: moduleRange,
                selectionRange: moduleRange,
            };
        } else if (executionNode.nodeType === ParseNodeType.Lambda) {
            const lambdaRange = convertOffsetsToRange(
                executionNode.start,
                executionNode.start + executionNode.length,
                this._parseResults.tokenizerOutput.lines
            );

            callSource = {
                name: '(lambda)',
                kind: SymbolKind.Function,
                uri: convertUriToLspUriString(this._program.fileSystem, this._fileUri),
                range: lambdaRange,
                selectionRange: lambdaRange,
            };
        } else {
            const functionRange = convertOffsetsToRange(
                executionNode.d.name.start,
                executionNode.d.name.start + executionNode.d.name.length,
                this._parseResults.tokenizerOutput.lines
            );

            callSource = {
                name: executionNode.d.name.d.value,
                kind: SymbolKind.Function,
                uri: convertUriToLspUriString(this._program.fileSystem, this._fileUri),
                range: functionRange,
                selectionRange: functionRange,
            };
        }

        // Is there already a call recorded for this caller? If so,
        // we'll simply add a new range. Otherwise, we'll create a new entry.
        let incomingCall: CallHierarchyIncomingCall | undefined = this._incomingCalls.find(
            (incoming) => incoming.from.uri === callSource.uri && rangesAreEqual(incoming.from.range, callSource.range)
        );

        if (!incomingCall) {
            incomingCall = {
                from: callSource,
                fromRanges: [],
            };
            this._incomingCalls.push(incomingCall);
        }

        const fromRange: Range = convertOffsetsToRange(
            nameNode.start,
            nameNode.start + nameNode.length,
            this._parseResults.tokenizerOutput.lines
        );
        incomingCall.fromRanges.push(fromRange);
    }
}
