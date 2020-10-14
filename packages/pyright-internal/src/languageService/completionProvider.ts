/*
 * completionProvider.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Logic that maps a position within a Python program file into
 * a list of zero or more text completions that apply in the context.
 */

import {
    CancellationToken,
    CompletionItem,
    CompletionItemKind,
    CompletionList,
    MarkupKind,
    Range,
    TextEdit,
} from 'vscode-languageserver';

import { ImportLookup } from '../analyzer/analyzerFileInfo';
import * as AnalyzerNodeInfo from '../analyzer/analyzerNodeInfo';
import { Declaration, DeclarationType, FunctionDeclaration } from '../analyzer/declaration';
import { convertDocStringToMarkdown, convertDocStringToPlainText } from '../analyzer/docStringConversion';
import { ImportedModuleDescriptor, ImportResolver } from '../analyzer/importResolver';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { SourceMapper } from '../analyzer/sourceMapper';
import { Symbol, SymbolTable } from '../analyzer/symbol';
import * as SymbolNameUtils from '../analyzer/symbolNameUtils';
import { getLastTypedDeclaredForSymbol } from '../analyzer/symbolUtils';
import {
    getClassDocString,
    getFunctionDocStringFromDeclaration,
    getFunctionDocStringFromType,
    getModuleDocString,
    getOverloadedFunctionDocStrings,
} from '../analyzer/typeDocStringUtils';
import { CallSignatureInfo, TypeEvaluator } from '../analyzer/typeEvaluator';
import {
    ClassType,
    FunctionType,
    isClass,
    isModule,
    isNone,
    isObject,
    isTypeVar,
    isUnbound,
    isUnknown,
    ObjectType,
    Type,
    TypeBase,
    TypeCategory,
    UnknownType,
} from '../analyzer/types';
import {
    doForSubtypes,
    getConcreteTypeFromTypeVar,
    getDeclaringModulesForType,
    getMembersForClass,
    getMembersForModule,
    isProperty,
    makeTypeVarsConcrete,
    specializeType,
} from '../analyzer/typeUtils';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { ConfigOptions } from '../common/configOptions';
import { fail } from '../common/debug';
import { TextEditAction } from '../common/editAction';
import { convertOffsetToPosition, convertPositionToOffset } from '../common/positionUtils';
import * as StringUtils from '../common/stringUtils';
import { comparePositions, Position } from '../common/textRange';
import { TextRange } from '../common/textRange';
import {
    ErrorExpressionCategory,
    ErrorNode,
    ExpressionNode,
    FunctionNode,
    ImportFromNode,
    isExpressionNode,
    ModuleNameNode,
    NameNode,
    ParameterCategory,
    ParseNode,
    ParseNodeType,
    StringNode,
} from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';
import { AutoImporter, ModuleSymbolMap } from './autoImporter';
import { IndexResults } from './documentSymbolProvider';

const _keywords: string[] = [
    // Expression keywords
    'True',
    'False',
    'None',
    'and',
    'or',
    'await',
    'not',
    'is',
    'lambda',
    'yield',

    // Statement keywords
    'assert',
    'async',
    'break',
    'class',
    'continue',
    'def',
    'del',
    'elif',
    'else',
    'except',
    'finally',
    'for',
    'from',
    'global',
    'if',
    'import',
    'in',
    'nonlocal',
    'pass',
    'raise',
    'return',
    'try',
    'while',
    'yield',
];

enum SortCategory {
    // The order of the following is important. We use
    // this to order the completion suggestions.

    // A keyword that must be entered for the syntax to be correct.
    LikelyKeyword,

    // A module name recently used in an import statement.
    RecentImportModuleName,

    // A module name used in an import statement.
    ImportModuleName,

    // A literal string.
    LiteralValue,

    // A named parameter in a call expression.
    NamedParameter,

    // A keyword or symbol that was recently used for completion.
    RecentKeywordOrSymbol,

    // An auto-import symbol that was recently used for completion.
    RecentAutoImport,

    // A keyword in the python syntax.
    Keyword,

    // A normal symbol.
    NormalSymbol,

    // A symbol that starts with _ or __ (used only when there is
    // no matching filter).
    PrivateSymbol,

    // A symbol with a dunder name (e.g. __init__).
    DunderSymbol,

    // An auto-import symbol.
    AutoImport,
}

// Completion items can have arbitrary data hanging off them.
// This data allows the resolve handling to disambiguate
// which item was selected.
export interface CompletionItemData {
    filePath: string;
    workspacePath: string;
    position: Position;
    autoImportText?: string;
    symbolLabel?: string;
}

// ModuleContext attempts to gather info for unknown types
export interface ModuleContext {
    lastKnownModule?: string;
    lastKnownMemberName?: string;
    unknownMemberName?: string;
}

export interface CompletionResults {
    completionList: CompletionList | undefined;
    moduleContext?: ModuleContext;
}

interface RecentCompletionInfo {
    label: string;
    autoImportText: string;
}

// We'll use a somewhat-arbitrary cutoff value here to determine
// whether it's sufficiently similar.
const similarityLimit = 0.25;

// We'll remember this many completions in the MRU list.
const maxRecentCompletions = 128;

export class CompletionProvider {
    private static _mostRecentCompletions: RecentCompletionInfo[] = [];

    // If we're being asked to resolve a completion item, we run the
    // original completion algorithm and look for this symbol.
    private _itemToResolve: CompletionItem | undefined;

    constructor(
        private _workspacePath: string,
        private _parseResults: ParseResults,
        private _fileContents: string,
        private _importResolver: ImportResolver,
        private _position: Position,
        private _filePath: string,
        private _configOptions: ConfigOptions,
        private _importLookup: ImportLookup,
        private _evaluator: TypeEvaluator,
        private _format: MarkupKind,
        private _sourceMapper: SourceMapper,
        private _libraryMap: Map<string, IndexResults> | undefined,
        private _moduleSymbolsCallback: () => ModuleSymbolMap,
        private _cancellationToken: CancellationToken
    ) {}

    getCompletionsForPosition(): CompletionResults | undefined {
        const offset = convertPositionToOffset(this._position, this._parseResults.tokenizerOutput.lines);
        if (offset === undefined) {
            return undefined;
        }

        let node = ParseTreeUtils.findNodeByOffset(this._parseResults.parseTree, offset);

        // See if we can get to a "better" node by backing up a few columns.
        // A "better" node is defined as one that's deeper than the current
        // node.
        const initialNode = node;
        const initialDepth = node ? ParseTreeUtils.getNodeDepth(node) : 0;

        if (!initialNode || initialNode.nodeType !== ParseNodeType.Name) {
            let curOffset = offset;
            while (curOffset >= 0) {
                curOffset--;

                // Stop scanning backward if we hit certain stop characters.
                const curChar = this._fileContents.substr(curOffset, 1);
                if (curChar === '(' || curChar === '\n') {
                    break;
                }

                const curNode = ParseTreeUtils.findNodeByOffset(this._parseResults.parseTree, curOffset);
                if (curNode && curNode !== initialNode) {
                    if (ParseTreeUtils.getNodeDepth(curNode) > initialDepth) {
                        node = curNode;
                    }
                    break;
                }
            }
        }

        if (node === undefined) {
            return undefined;
        }

        // Get the text on that line prior to the insertion point.
        const lineTextRange = this._parseResults.tokenizerOutput.lines.getItemAt(this._position.line);
        const textOnLine = this._fileContents.substr(lineTextRange.start, lineTextRange.length);
        const priorText = textOnLine.substr(0, this._position.character);
        const postText = textOnLine.substr(this._position.character);
        const priorWordIndex = priorText.search(/\w+$/);
        const priorWord = priorWordIndex >= 0 ? priorText.substr(priorWordIndex) : '';

        // Don't offer completions if we're within a comment.
        if (this._isWithinComment(offset, priorText)) {
            return undefined;
        }

        // See if the node is part of an error node. If so, that takes
        // precedence.
        let errorNode: ParseNode | undefined = node;
        while (errorNode) {
            if (errorNode.nodeType === ParseNodeType.Error) {
                break;
            }

            errorNode = errorNode.parent;
        }

        // Determine the context based on the parse node's type and
        // that of its ancestors.
        let curNode = errorNode || node;
        while (true) {
            throwIfCancellationRequested(this._cancellationToken);

            if (curNode.nodeType === ParseNodeType.String) {
                return this._getStringLiteralCompletions(curNode, priorWord, priorText, postText);
            }

            if (curNode.nodeType === ParseNodeType.StringList) {
                return undefined;
            }

            if (curNode.nodeType === ParseNodeType.ModuleName) {
                return this._getImportModuleCompletions(curNode);
            }

            if (curNode.nodeType === ParseNodeType.Error) {
                return this._getExpressionErrorCompletions(curNode, priorWord, priorText, postText);
            }

            if (curNode.nodeType === ParseNodeType.MemberAccess) {
                return this._getMemberAccessCompletions(curNode.leftExpression, priorWord);
            }

            if (curNode.nodeType === ParseNodeType.Name) {
                // Are we within a "from X import Y as Z" statement and
                // more specifically within the "Y"?
                if (curNode.parent && curNode.parent.nodeType === ParseNodeType.ModuleName) {
                    return this._getImportModuleCompletions(curNode.parent);
                } else if (curNode.parent && curNode.parent.nodeType === ParseNodeType.ImportFromAs) {
                    const parentNode = curNode.parent.parent;

                    if (parentNode && parentNode.nodeType === ParseNodeType.ImportFrom) {
                        if (curNode.parent.name === curNode) {
                            return this._getImportFromCompletions(parentNode, priorWord);
                        } else {
                            return this._getImportFromCompletions(parentNode, '');
                        }
                    }
                } else if (
                    curNode.parent &&
                    curNode.parent.nodeType === ParseNodeType.MemberAccess &&
                    curNode === curNode.parent.memberName
                ) {
                    return this._getMemberAccessCompletions(curNode.parent.leftExpression, priorWord);
                }
            }

            if (curNode.nodeType === ParseNodeType.ImportFrom) {
                return this._getImportFromCompletions(curNode, priorWord);
            }

            if (isExpressionNode(curNode)) {
                return this._getExpressionCompletions(curNode, priorWord, priorText, postText);
            }

            if (curNode.nodeType === ParseNodeType.Suite || curNode.nodeType === ParseNodeType.Module) {
                return this._getStatementCompletions(curNode, priorWord, priorText, postText);
            }

            if (!curNode.parent) {
                break;
            }

            curNode = curNode.parent;
        }

        return undefined;
    }

    // When the user selects a completion, this callback is invoked,
    // allowing us to record what was selected. This allows us to
    // build our MRU cache so we can better predict entries.
    resolveCompletionItem(completionItem: CompletionItem) {
        throwIfCancellationRequested(this._cancellationToken);

        const completionItemData = completionItem.data as CompletionItemData;

        const label = completionItem.label;
        let autoImportText = '';
        if (completionItemData.autoImportText) {
            autoImportText = completionItemData.autoImportText;
        }

        const curIndex = CompletionProvider._mostRecentCompletions.findIndex(
            (item) => item.label === label && item.autoImportText === autoImportText
        );

        if (curIndex > 0) {
            // If there's an existing entry with the same name that's not at the
            // beginning of the array, remove it.
            CompletionProvider._mostRecentCompletions = CompletionProvider._mostRecentCompletions.splice(curIndex, 1);
        }

        if (curIndex !== 0) {
            // Add to the start of the array.
            CompletionProvider._mostRecentCompletions.unshift({ label, autoImportText });
        }

        if (CompletionProvider._mostRecentCompletions.length > maxRecentCompletions) {
            // Prevent the MRU list from growing indefinitely.
            CompletionProvider._mostRecentCompletions.pop();
        }

        if (completionItemData.symbolLabel) {
            this._itemToResolve = completionItem;

            // Rerun the completion lookup. It will fill in additional information
            // about the item to be resolved. We'll ignore the rest of the returned
            // list. This is a bit wasteful, but all of that information should be
            // cached, so it's not as bad as it might seem.
            this.getCompletionsForPosition();
        }
    }

    private _isWithinComment(offset: number, priorText: string): boolean {
        const tokenIndex = this._parseResults.tokenizerOutput.tokens.getItemAtPosition(offset);
        if (tokenIndex < 0) {
            return false;
        }

        const token = this._parseResults.tokenizerOutput.tokens.getItemAt(tokenIndex);

        // If we're in the middle of a token, we're not in a comment.
        if (offset > token.start && offset < TextRange.getEnd(token)) {
            return false;
        }

        // See if the text that precedes the current position contains
        // a '#' character.
        return !!priorText.match(/#/);
    }

    private _getExpressionErrorCompletions(
        node: ErrorNode,
        priorWord: string,
        priorText: string,
        postText: string
    ): CompletionResults | undefined {
        // Is the error due to a missing member access name? If so,
        // we can evaluate the left side of the member access expression
        // to determine its type and offer suggestions based on it.
        switch (node.category) {
            case ErrorExpressionCategory.MissingIn: {
                return this._createSingleKeywordCompletionList('in');
            }

            case ErrorExpressionCategory.MissingElse: {
                return this._createSingleKeywordCompletionList('else');
            }

            case ErrorExpressionCategory.MissingExpression:
            case ErrorExpressionCategory.MissingIndexOrSlice:
            case ErrorExpressionCategory.MissingDecoratorCallName: {
                return this._getExpressionCompletions(node, priorWord, priorText, postText);
            }

            case ErrorExpressionCategory.MissingMemberAccessName: {
                if (node.child && isExpressionNode(node.child)) {
                    return this._getMemberAccessCompletions(node.child, priorWord);
                }
                break;
            }

            case ErrorExpressionCategory.MissingFunctionParameterList: {
                if (node.child && node.child.nodeType === ParseNodeType.Name) {
                    // Determine if the partial name is a method that's overriding
                    // a method in a base class.
                    return this._getMethodOverrideCompletions(node.child);
                }
                break;
            }
        }

        return undefined;
    }

    private _createSingleKeywordCompletionList(keyword: string): CompletionResults {
        const completionItem = CompletionItem.create(keyword);
        completionItem.kind = CompletionItemKind.Keyword;
        completionItem.sortText = this._makeSortText(SortCategory.LikelyKeyword, keyword);
        const completionList = CompletionList.create([completionItem]);
        return { completionList };
    }

    private _getMethodOverrideCompletions(partialName: NameNode): CompletionResults | undefined {
        const enclosingClass = ParseTreeUtils.getEnclosingClass(partialName, true);
        if (!enclosingClass) {
            return undefined;
        }

        const classResults = this._evaluator.getTypeOfClass(enclosingClass);
        if (!classResults) {
            return undefined;
        }

        // Get symbols in reverse-MRO, but leave omit the class itself.
        const symbolTable = new Map<string, Symbol>();
        for (let i = classResults.classType.details.mro.length - 1; i > 0; i--) {
            const mroClass = classResults.classType.details.mro[i];
            if (isClass(mroClass)) {
                getMembersForClass(mroClass, symbolTable, false);
            }
        }

        const completionList = CompletionList.create();

        symbolTable.forEach((symbol, name) => {
            const decl = getLastTypedDeclaredForSymbol(symbol);
            if (decl && decl.type === DeclarationType.Function) {
                const isSimilar = StringUtils.computeCompletionSimilarity(partialName.value, name) > similarityLimit;
                if (isSimilar) {
                    const range: Range = {
                        start: { line: this._position.line, character: this._position.character - partialName.length },
                        end: { line: this._position.line, character: this._position.character },
                    };

                    const methodSignature = this._printMethodSignature(decl.node) + ':';
                    const textEdit = TextEdit.replace(range, methodSignature);
                    this._addSymbol(name, symbol, partialName.value, completionList, undefined, textEdit);
                }
            }
        });

        return { completionList };
    }

    private _printMethodSignature(node: FunctionNode): string {
        const paramList = node.parameters
            .map((param, index) => {
                let paramString = '';
                if (param.category === ParameterCategory.VarArgList) {
                    paramString += '*';
                } else if (param.category === ParameterCategory.VarArgDictionary) {
                    paramString += '**';
                }

                if (param.name) {
                    paramString += param.name.value;
                }

                const paramTypeAnnotation = this._evaluator.getTypeAnnotationForParameter(node, index);
                if (paramTypeAnnotation) {
                    paramString += ': ' + ParseTreeUtils.printExpression(paramTypeAnnotation);
                }

                return paramString;
            })
            .join(', ');

        let methodSignature = node.name.value + '(' + paramList + ')';

        if (node.returnTypeAnnotation) {
            methodSignature += ' -> ' + ParseTreeUtils.printExpression(node.returnTypeAnnotation);
        } else if (node.functionAnnotationComment) {
            methodSignature +=
                ' -> ' + ParseTreeUtils.printExpression(node.functionAnnotationComment.returnTypeAnnotation);
        }

        return methodSignature;
    }

    private _getMemberAccessCompletions(
        leftExprNode: ExpressionNode,
        priorWord: string
    ): CompletionResults | undefined {
        let leftType = this._evaluator.getType(leftExprNode);
        const symbolTable = new Map<string, Symbol>();
        const completionList = CompletionList.create();
        let lastKnownModule: ModuleContext | undefined;

        if (leftType) {
            if (isTypeVar(leftType)) {
                // If the left is a constrained TypeVar, treat it as a union for the
                // purposes of providing completion suggestions.
                leftType = getConcreteTypeFromTypeVar(leftType, /* convertConstraintsToUnion */ true);
            }

            doForSubtypes(leftType, (subtype) => {
                const specializedSubtype = makeTypeVarsConcrete(subtype);

                if (isObject(specializedSubtype)) {
                    getMembersForClass(specializedSubtype.classType, symbolTable, /* includeInstanceVars */ true);
                } else if (isClass(specializedSubtype)) {
                    getMembersForClass(specializedSubtype, symbolTable, /* includeInstanceVars */ false);
                } else if (isModule(specializedSubtype)) {
                    getMembersForModule(specializedSubtype, symbolTable);
                } else if (
                    specializedSubtype.category === TypeCategory.Function ||
                    specializedSubtype.category === TypeCategory.OverloadedFunction
                ) {
                    const functionClass = this._evaluator.getBuiltInType(leftExprNode, 'function');
                    if (functionClass && isClass(functionClass)) {
                        getMembersForClass(functionClass, symbolTable, /* includeInstanceVars */ true);
                    }
                } else if (isNone(subtype)) {
                    const objectClass = this._evaluator.getBuiltInType(leftExprNode, 'object');
                    if (objectClass && isClass(objectClass)) {
                        getMembersForClass(objectClass, symbolTable, TypeBase.isInstance(subtype));
                    }
                }

                return undefined;
            });

            const specializedLeftType = makeTypeVarsConcrete(leftType);
            const objectThrough: ObjectType | undefined = isObject(specializedLeftType)
                ? specializedLeftType
                : undefined;
            this._addSymbolsForSymbolTable(symbolTable, (_) => true, priorWord, objectThrough, completionList);

            // If we dont know this type, look for a module we should stub
            if (!leftType || isUnknown(leftType) || isUnbound(leftType)) {
                lastKnownModule = this._getLastKnownModule(leftExprNode, leftType);
            }
        }

        return { completionList, moduleContext: lastKnownModule };
    }

    private _getLastKnownModule(leftExprNode: ExpressionNode, leftType: Type | undefined): ModuleContext | undefined {
        let curNode: ExpressionNode | undefined = leftExprNode;
        let curType: Type | undefined = leftType;
        let unknownMemberName: string | undefined =
            leftExprNode.nodeType === ParseNodeType.MemberAccess ? leftExprNode?.memberName.value : undefined;

        // Walk left of the expression scope till we find a known type. A.B.Unknown.<-- return B.
        while (curNode) {
            if (curNode.nodeType === ParseNodeType.Call || curNode.nodeType === ParseNodeType.MemberAccess) {
                // Move left
                curNode = curNode.leftExpression;

                // First time in the loop remember the name of the unknown type.
                if (unknownMemberName === undefined) {
                    unknownMemberName =
                        curNode.nodeType === ParseNodeType.MemberAccess ? curNode?.memberName.value ?? '' : '';
                }
            } else {
                curNode = undefined;
            }

            if (curNode) {
                curType = this._evaluator.getType(curNode);

                // Breakout if we found a known type.
                if (curType !== undefined && !isUnknown(curType) && !isUnbound(curType)) {
                    break;
                }
            }
        }

        const context: ModuleContext = {};
        if (curType && !isUnknown(curType) && !isUnbound(curType) && curNode) {
            const moduleNamesForType = getDeclaringModulesForType(curType);

            // For union types we only care about non 'typing' modules.
            context.lastKnownModule = moduleNamesForType.find((n) => n !== 'typing');

            if (curNode.nodeType === ParseNodeType.MemberAccess) {
                context.lastKnownMemberName = curNode.memberName.value;
            } else if (curNode.nodeType === ParseNodeType.Name && isClass(curType)) {
                context.lastKnownMemberName = curType.details.name;
            } else if (curNode.nodeType === ParseNodeType.Name && isObject(curType)) {
                context.lastKnownMemberName = curType.classType.details.name;
            }

            context.unknownMemberName = unknownMemberName;
        }

        return context;
    }

    private _getStatementCompletions(
        parseNode: ParseNode,
        priorWord: string,
        priorText: string,
        postText: string
    ): CompletionResults | undefined {
        // For now, use the same logic for expressions and statements.
        return this._getExpressionCompletions(parseNode, priorWord, priorText, postText);
    }

    private _getExpressionCompletions(
        parseNode: ParseNode,
        priorWord: string,
        priorText: string,
        postText: string
    ): CompletionResults | undefined {
        // If the user typed a "." as part of a number, don't present
        // any completion options.
        if (parseNode.nodeType === ParseNodeType.Number) {
            return undefined;
        }

        const completionList = CompletionList.create();

        // Add call argument completions.
        this._addCallArgumentCompletions(parseNode, priorWord, priorText, postText, completionList);

        // Add symbols that are in scope.
        this._addSymbols(parseNode, priorWord, completionList);

        // Add keywords.
        this._findMatchingKeywords(_keywords, priorWord).map((keyword) => {
            const completionItem = CompletionItem.create(keyword);
            completionItem.kind = CompletionItemKind.Keyword;
            completionList.items.push(completionItem);
            completionItem.sortText = this._makeSortText(SortCategory.Keyword, keyword);
        });

        // Add auto-import suggestions from other modules.
        // Ignore this check for privates, since they are not imported.
        if (this._configOptions.autoImportCompletions && !priorWord.startsWith('_') && !this._itemToResolve) {
            this._getAutoImportCompletions(priorWord, completionList);
        }

        // Add literal values if appropriate.
        if (parseNode.nodeType === ParseNodeType.Error) {
            if (parseNode.category === ErrorExpressionCategory.MissingIndexOrSlice) {
                this._getIndexStringLiteral(parseNode, completionList);
            } else if (parseNode.category === ErrorExpressionCategory.MissingExpression) {
                if (parseNode.parent && parseNode.parent.nodeType === ParseNodeType.Assignment) {
                    const declaredTypeOfTarget = this._evaluator.getDeclaredTypeForExpression(
                        parseNode.parent.leftExpression
                    );

                    if (declaredTypeOfTarget) {
                        this._addLiteralValuesForTargetType(declaredTypeOfTarget, priorText, postText, completionList);
                    }
                }
            }
        }

        return { completionList };
    }

    private _addCallArgumentCompletions(
        parseNode: ParseNode,
        priorWord: string,
        priorText: string,
        postText: string,
        completionList: CompletionList
    ) {
        // If we're within the argument list of a call, add parameter names.
        const offset = convertPositionToOffset(this._position, this._parseResults.tokenizerOutput.lines)!;
        const signatureInfo = this._evaluator.getCallSignatureInfo(
            parseNode,
            offset,
            this._parseResults.tokenizerOutput.tokens
        );

        if (signatureInfo) {
            // Are we past the call expression and within the argument list?
            const callNameEnd = convertOffsetToPosition(
                signatureInfo.callNode.leftExpression.start + signatureInfo.callNode.leftExpression.length,
                this._parseResults.tokenizerOutput.lines
            );

            if (comparePositions(this._position, callNameEnd) > 0) {
                this._addNamedParameters(signatureInfo, priorWord, completionList);

                // Add literals that apply to this parameter.
                this._addLiteralValuesForArgument(signatureInfo, priorText, postText, completionList);
            }
        }
    }

    private _addLiteralValuesForArgument(
        signatureInfo: CallSignatureInfo,
        priorText: string,
        postText: string,
        completionList: CompletionList
    ) {
        signatureInfo.signatures.forEach((signature) => {
            if (!signature.activeParam) {
                return undefined;
            }

            const type = signature.type;
            const paramIndex = type.details.parameters.indexOf(signature.activeParam);

            if (paramIndex < 0) {
                return undefined;
            }

            const paramType = type.details.parameters[paramIndex].type;
            this._addLiteralValuesForTargetType(paramType, priorText, postText, completionList);
            return undefined;
        });
    }

    private _addLiteralValuesForTargetType(
        type: Type,
        priorText: string,
        postText: string,
        completionList: CompletionList
    ) {
        const quoteValue = this._getQuoteValueFromPriorText(priorText);
        doForSubtypes(type, (subtype) => {
            if (isObject(subtype)) {
                if (ClassType.isBuiltIn(subtype.classType, 'str')) {
                    if (subtype.classType.literalValue !== undefined) {
                        this._addStringLiteralToCompletionList(
                            subtype.classType.literalValue as string,
                            quoteValue.stringValue,
                            postText,
                            quoteValue.quoteCharacter,
                            completionList
                        );
                    }
                }
            }

            return undefined;
        });
    }

    private _getStringLiteralCompletions(
        parseNode: StringNode,
        priorWord: string,
        priorText: string,
        postText: string
    ): CompletionResults | undefined {
        let parentNode: ParseNode | undefined = parseNode.parent;
        if (!parentNode || parentNode.nodeType !== ParseNodeType.StringList || parentNode.strings.length > 1) {
            return undefined;
        }

        parentNode = parentNode.parent;
        if (!parentNode) {
            return undefined;
        }

        const completionList = CompletionList.create();

        if (parentNode.nodeType === ParseNodeType.IndexItems) {
            parentNode = parentNode.parent;
            if (!parentNode || parentNode.nodeType !== ParseNodeType.Index) {
                return undefined;
            }

            const baseType = this._evaluator.getType(parentNode.baseExpression);
            if (!baseType || !isObject(baseType)) {
                return undefined;
            }

            // We currently handle only TypedDict objects.
            const classType = baseType.classType;
            if (!ClassType.isTypedDictClass(classType)) {
                return;
            }

            const entries = this._evaluator.getTypedDictMembersForClass(classType);
            const quoteValue = this._getQuoteValueFromPriorText(priorText);

            entries.forEach((_, key) => {
                this._addStringLiteralToCompletionList(
                    key,
                    quoteValue.stringValue,
                    postText,
                    quoteValue.quoteCharacter,
                    completionList
                );
            });
        } else if (parentNode.nodeType === ParseNodeType.Assignment) {
            const declaredTypeOfTarget = this._evaluator.getDeclaredTypeForExpression(parentNode.leftExpression);

            if (declaredTypeOfTarget) {
                this._addLiteralValuesForTargetType(declaredTypeOfTarget, priorText, postText, completionList);
            }
        } else {
            this._addCallArgumentCompletions(parseNode, priorWord, priorText, postText, completionList);
        }

        return { completionList };
    }

    // Given a string of text that precedes the current insertion point,
    // determines which portion of it is the first part of a string literal
    // (either starting with a single or double quote). Returns the quote
    // type and the string literal value after the starting quote.
    private _getQuoteValueFromPriorText(priorText: string) {
        const lastSingleQuote = priorText.lastIndexOf("'");
        const lastDoubleQuote = priorText.lastIndexOf('"');

        let quoteCharacter = this._parseResults.tokenizerOutput.predominantSingleQuoteCharacter;
        let stringValue = undefined;

        if (lastSingleQuote > lastDoubleQuote) {
            quoteCharacter = "'";
            stringValue = priorText.substr(lastSingleQuote + 1);
        } else if (lastDoubleQuote > lastSingleQuote) {
            quoteCharacter = '"';
            stringValue = priorText.substr(lastDoubleQuote + 1);
        }

        return { stringValue, quoteCharacter };
    }

    private _getIndexStringLiteral(parseNode: ErrorNode, completionList: CompletionList) {
        if (!parseNode.parent || parseNode.parent.nodeType !== ParseNodeType.IndexItems) {
            return;
        }

        const parentNode = parseNode.parent;
        if (!parentNode.parent || parentNode.parent.nodeType !== ParseNodeType.Index) {
            return;
        }

        const baseType = this._evaluator.getType(parentNode.parent.baseExpression);
        if (!baseType || !isObject(baseType)) {
            return;
        }

        // We currently handle only TypedDict objects.
        const classType = baseType.classType;
        if (!ClassType.isTypedDictClass(classType)) {
            return;
        }

        const entries = this._evaluator.getTypedDictMembersForClass(classType);
        entries.forEach((_, key) => {
            this._addStringLiteralToCompletionList(
                key,
                undefined,
                undefined,
                this._parseResults.tokenizerOutput.predominantSingleQuoteCharacter,
                completionList
            );
        });
    }

    private _addStringLiteralToCompletionList(
        value: string,
        priorString: string | undefined,
        postText: string | undefined,
        quoteCharacter: string,
        completionList: CompletionList
    ) {
        const isSimilar = StringUtils.computeCompletionSimilarity(priorString || '', value) > similarityLimit;
        if (isSimilar) {
            const valueWithQuotes = `${quoteCharacter}${value}${quoteCharacter}`;
            const completionItem = CompletionItem.create(valueWithQuotes);

            completionItem.kind = CompletionItemKind.Text;
            completionItem.sortText = this._makeSortText(SortCategory.LiteralValue, valueWithQuotes);
            let rangeStartCol = this._position.character;
            if (priorString !== undefined) {
                rangeStartCol -= priorString.length + 1;
            }

            // If the text after the insertion point is the closing quote,
            // replace it.
            let rangeEndCol = this._position.character;
            if (postText !== undefined) {
                if (postText.startsWith(quoteCharacter)) {
                    rangeEndCol++;
                }
            }

            const range: Range = {
                start: { line: this._position.line, character: rangeStartCol },
                end: { line: this._position.line, character: rangeEndCol },
            };
            completionItem.textEdit = TextEdit.replace(range, valueWithQuotes);

            completionList.items.push(completionItem);
        }
    }

    private _getAutoImportCompletions(priorWord: string, completionList: CompletionList) {
        const moduleSymbolMap = this._moduleSymbolsCallback();
        const autoImporter = new AutoImporter(
            this._configOptions.findExecEnvironment(this._filePath),
            this._importResolver,
            this._parseResults,
            this._position,
            completionList.items.filter((i) => !i.data?.autoImport).map((i) => i.label),
            moduleSymbolMap,
            this._libraryMap
        );

        for (const result of autoImporter.getAutoImportCandidates(
            priorWord,
            similarityLimit,
            undefined,
            this._cancellationToken
        )) {
            if (result.symbol) {
                this._addSymbol(
                    result.name,
                    result.symbol,
                    priorWord,
                    completionList,
                    result.source,
                    undefined,
                    result.edits
                );
            } else {
                this._addNameToCompletionList(
                    result.name,
                    result.kind ?? CompletionItemKind.Module,
                    priorWord,
                    completionList,
                    undefined,
                    '',
                    result.source
                        ? `\`\`\`\nfrom ${result.source} import ${result.name}\n\`\`\``
                        : `\`\`\`\nimport ${result.name}\n\`\`\``,
                    undefined,
                    result.edits
                );
            }
        }
    }

    private _getImportFromCompletions(
        importFromNode: ImportFromNode,
        priorWord: string
    ): CompletionResults | undefined {
        // Don't attempt to provide completions for "from X import *".
        if (importFromNode.isWildcardImport) {
            return undefined;
        }

        // Access the imported module information, which is hanging
        // off the ImportFromNode.
        const importInfo = AnalyzerNodeInfo.getImportInfo(importFromNode.module);
        if (!importInfo) {
            return undefined;
        }

        const completionList = CompletionList.create();

        const resolvedPath =
            importInfo.resolvedPaths.length > 0 ? importInfo.resolvedPaths[importInfo.resolvedPaths.length - 1] : '';

        const lookupResults = this._importLookup(resolvedPath);
        if (lookupResults) {
            this._addSymbolsForSymbolTable(
                lookupResults.symbolTable,
                (name) => {
                    // Don't suggest symbols that have already been imported.
                    return !importFromNode.imports.find((imp) => imp.name.value === name);
                },
                priorWord,
                undefined,
                completionList
            );
        }

        // Add the implicit imports.
        importInfo.implicitImports.forEach((implImport) => {
            if (!importFromNode.imports.find((imp) => imp.name.value === implImport.name)) {
                this._addNameToCompletionList(implImport.name, CompletionItemKind.Module, priorWord, completionList);
            }
        });

        return { completionList };
    }

    private _findMatchingKeywords(keywordList: string[], partialMatch: string): string[] {
        return keywordList.filter((keyword) => {
            if (partialMatch) {
                return StringUtils.computeCompletionSimilarity(partialMatch, keyword) > similarityLimit;
            } else {
                return true;
            }
        });
    }

    private _addNamedParameters(signatureInfo: CallSignatureInfo, priorWord: string, completionList: CompletionList) {
        const argNameMap = new Map<string, string>();

        signatureInfo.signatures.forEach((signature) => {
            this._addNamedParametersToMap(signature.type, argNameMap);
        });

        // Remove any named parameters that are already provided.
        signatureInfo.callNode.arguments!.forEach((arg) => {
            if (arg.name) {
                argNameMap.delete(arg.name.value);
            }
        });

        // Add the remaining unique parameter names to the completion list.
        argNameMap.forEach((argName) => {
            const similarity = StringUtils.computeCompletionSimilarity(priorWord, argName);

            if (similarity > similarityLimit) {
                const completionItem = CompletionItem.create(argName + '=');
                completionItem.kind = CompletionItemKind.Variable;

                const completionItemData: CompletionItemData = {
                    workspacePath: this._workspacePath,
                    filePath: this._filePath,
                    position: this._position,
                };
                completionItem.data = completionItemData;
                completionItem.sortText = this._makeSortText(SortCategory.NamedParameter, argName);

                completionList.items.push(completionItem);
            }
        });
    }

    private _addNamedParametersToMap(type: FunctionType, paramMap: Map<string, string>) {
        type.details.parameters.forEach((param) => {
            if (param.name && !param.isNameSynthesized) {
                // Don't add private or protected names. These are assumed
                // not to be named parameters.
                if (!SymbolNameUtils.isPrivateOrProtectedName(param.name)) {
                    paramMap.set(param.name, param.name);
                }
            }
        });
    }

    private _addSymbols(node: ParseNode, priorWord: string, completionList: CompletionList) {
        let curNode: ParseNode | undefined = node;

        while (curNode) {
            // Does this node have a scope associated with it?
            let scope = AnalyzerNodeInfo.getScope(curNode);
            if (scope) {
                while (scope) {
                    this._addSymbolsForSymbolTable(scope.symbolTable, () => true, priorWord, undefined, completionList);
                    scope = scope.parent;
                }

                // If this is a class scope, add symbols from parent classes.
                if (curNode.nodeType === ParseNodeType.Class) {
                    const classType = this._evaluator.getTypeOfClass(curNode);
                    if (classType && isClass(classType.classType)) {
                        classType.classType.details.mro.forEach((baseClass, index) => {
                            if (isClass(baseClass)) {
                                this._addSymbolsForSymbolTable(
                                    baseClass.details.fields,
                                    (name) => {
                                        const symbol = baseClass.details.fields.get(name);
                                        if (!symbol || !symbol.isClassMember()) {
                                            return false;
                                        }

                                        // Return only variables, not methods or classes.
                                        return symbol
                                            .getDeclarations()
                                            .some((decl) => decl.type === DeclarationType.Variable);
                                    },
                                    priorWord,
                                    undefined,
                                    completionList
                                );
                            }
                        });
                    }
                }
                break;
            }

            curNode = curNode.parent;
        }
    }

    private _addSymbolsForSymbolTable(
        symbolTable: SymbolTable,
        includeSymbolCallback: (name: string) => boolean,
        priorWord: string,
        objectThrough: ObjectType | undefined,
        completionList: CompletionList
    ) {
        symbolTable.forEach((symbol, name) => {
            // If there are no declarations or the symbol is not
            // exported from this scope, don't include it in the
            // suggestion list.
            if (!symbol.isExternallyHidden() && includeSymbolCallback(name)) {
                // Don't add a symbol more than once. It may have already been
                // added from an inner scope's symbol table.
                if (!completionList.items.some((item) => item.label === name)) {
                    this._addSymbol(
                        name,
                        symbol,
                        priorWord,
                        completionList,
                        undefined,
                        undefined,
                        undefined,
                        objectThrough
                    );
                }
            }
        });
    }

    private _addSymbol(
        name: string,
        symbol: Symbol,
        priorWord: string,
        completionList: CompletionList,
        autoImportSource?: string,
        textEdit?: TextEdit,
        additionalTextEdits?: TextEditAction[],
        objectThrough?: ObjectType
    ) {
        let primaryDecl = getLastTypedDeclaredForSymbol(symbol);
        if (!primaryDecl) {
            const declarations = symbol.getDeclarations();
            if (declarations.length > 0) {
                primaryDecl = declarations[declarations.length - 1];
            }
        }

        if (primaryDecl) {
            let itemKind: CompletionItemKind = CompletionItemKind.Variable;

            primaryDecl = this._evaluator.resolveAliasDeclaration(primaryDecl, /* resolveLocalNames */ true);
            if (primaryDecl) {
                itemKind = this._convertDeclarationTypeToItemKind(primaryDecl);

                // Are we resolving a completion item? If so, see if this symbol
                // is the one that we're trying to match.
                if (this._itemToResolve) {
                    const completionItemData = this._itemToResolve.data as CompletionItemData;

                    if (completionItemData.symbolLabel === name) {
                        // This call can be expensive to perform on every completion item
                        // that we return, so we do it lazily in the "resolve" callback.
                        const type = this._evaluator.getEffectiveTypeOfSymbol(symbol);
                        if (type) {
                            let typeDetail: string | undefined;
                            let documentation: string | undefined;

                            switch (primaryDecl.type) {
                                case DeclarationType.Intrinsic:
                                case DeclarationType.Variable:
                                case DeclarationType.Parameter:
                                    typeDetail =
                                        name + ': ' + this._evaluator.printType(type, /* expandTypeAlias */ false);
                                    break;

                                case DeclarationType.Function: {
                                    const functionType = objectThrough
                                        ? this._evaluator.bindFunctionToClassOrObject(objectThrough, type, false)
                                        : type;
                                    if (functionType) {
                                        if (isProperty(functionType) && objectThrough) {
                                            const propertyType =
                                                this._evaluator.getGetterTypeFromProperty(
                                                    functionType.classType,
                                                    /* inferTypeIfNeeded */ true
                                                ) || UnknownType.create();
                                            typeDetail =
                                                name +
                                                ': ' +
                                                this._evaluator.printType(propertyType, /* expandTypeAlias */ false) +
                                                ' (property)';
                                        } else if (functionType.category === TypeCategory.OverloadedFunction) {
                                            typeDetail = functionType.overloads
                                                .map(
                                                    (overload) =>
                                                        name +
                                                        this._evaluator.printType(overload, /* expandTypeAlias */ false)
                                                )
                                                .join('\n');
                                        } else {
                                            typeDetail =
                                                name +
                                                ': ' +
                                                this._evaluator.printType(functionType, /* expandTypeAlias */ false);
                                        }
                                    }
                                    break;
                                }
                                case DeclarationType.Class:
                                case DeclarationType.SpecialBuiltInClass: {
                                    typeDetail = 'class ' + name + '()';
                                    break;
                                }

                                case DeclarationType.Alias: {
                                    typeDetail = name;
                                    if (primaryDecl.path) {
                                        const lookupResults = this._importLookup(primaryDecl.path);
                                        if (lookupResults) {
                                            documentation = lookupResults.docString;
                                        }
                                    }
                                    break;
                                }

                                default: {
                                    typeDetail = name;
                                    break;
                                }
                            }

                            if (isModule(type)) {
                                documentation = getModuleDocString(type, primaryDecl, this._sourceMapper);
                            } else if (isClass(type)) {
                                documentation = getClassDocString(type, primaryDecl, this._sourceMapper);
                            } else if (type.category === TypeCategory.Function) {
                                documentation = getFunctionDocStringFromType(type, this._sourceMapper);
                            } else if (type.category === TypeCategory.OverloadedFunction) {
                                documentation = getOverloadedFunctionDocStrings(
                                    type,
                                    primaryDecl,
                                    this._sourceMapper
                                ).find((doc) => doc);
                            } else if (primaryDecl.type === DeclarationType.Function) {
                                // @property functions
                                documentation = getFunctionDocStringFromDeclaration(primaryDecl, this._sourceMapper);
                            }

                            if (this._format === MarkupKind.Markdown) {
                                let markdownString = '```python\n' + typeDetail + '\n```\n';

                                if (documentation) {
                                    markdownString += '---\n';
                                    markdownString += convertDocStringToMarkdown(documentation);
                                }

                                this._itemToResolve.documentation = {
                                    kind: MarkupKind.Markdown,
                                    value: markdownString,
                                };
                            } else if (this._format === MarkupKind.PlainText) {
                                let plainTextString = typeDetail + '\n';

                                if (documentation) {
                                    plainTextString += '\n';
                                    plainTextString += convertDocStringToPlainText(documentation);
                                }

                                this._itemToResolve.documentation = {
                                    kind: MarkupKind.PlainText,
                                    value: plainTextString,
                                };
                            } else {
                                fail(`Unsupported markup type: ${this._format}`);
                            }
                        }
                    }
                }
            }

            let autoImportText: string | undefined;
            if (autoImportSource) {
                if (this._format === MarkupKind.Markdown) {
                    autoImportText = `\`\`\`\nfrom ${autoImportSource} import ${name}\n\`\`\``;
                } else if (this._format === MarkupKind.PlainText) {
                    autoImportText = `from ${autoImportSource} import ${name}`;
                } else {
                    fail(`Unsupported markup type: ${this._format}`);
                }
            }

            this._addNameToCompletionList(
                name,
                itemKind,
                priorWord,
                completionList,
                undefined,
                undefined,
                autoImportText,
                textEdit,
                additionalTextEdits
            );
        } else {
            // Does the symbol have no declaration but instead has a synthesized type?
            const synthesizedType = symbol.getSynthesizedType();
            if (synthesizedType) {
                const itemKind: CompletionItemKind = CompletionItemKind.Variable;
                this._addNameToCompletionList(
                    name,
                    itemKind,
                    priorWord,
                    completionList,
                    undefined,
                    undefined,
                    undefined,
                    textEdit,
                    additionalTextEdits
                );
            }
        }
    }

    private _addNameToCompletionList(
        name: string,
        itemKind: CompletionItemKind,
        filter: string,
        completionList: CompletionList,
        typeDetail?: string,
        documentation?: string,
        autoImportText?: string,
        textEdit?: TextEdit,
        additionalTextEdits?: TextEditAction[]
    ) {
        const similarity = StringUtils.computeCompletionSimilarity(filter, name);

        if (similarity > similarityLimit) {
            const completionItem = CompletionItem.create(name);
            completionItem.kind = itemKind;

            const completionItemData: CompletionItemData = {
                workspacePath: this._workspacePath,
                filePath: this._filePath,
                position: this._position,
            };
            completionItem.data = completionItemData;

            if (autoImportText) {
                // Force auto-import entries to the end.
                completionItem.sortText = this._makeSortText(SortCategory.AutoImport, name, autoImportText);
                completionItemData.autoImportText = autoImportText;
                completionItem.detail = 'Auto-import';
            } else if (SymbolNameUtils.isDunderName(name)) {
                // Force dunder-named symbols to appear after all other symbols.
                completionItem.sortText = this._makeSortText(SortCategory.DunderSymbol, name);
            } else if (filter === '' && SymbolNameUtils.isPrivateOrProtectedName(name)) {
                // Distinguish between normal and private symbols only if there is
                // currently no filter text. Once we get a single character to filter
                // upon, we'll no longer differentiate.
                completionItem.sortText = this._makeSortText(SortCategory.PrivateSymbol, name);
            } else {
                completionItem.sortText = this._makeSortText(SortCategory.NormalSymbol, name);
            }

            completionItemData.symbolLabel = name;

            if (this._format === MarkupKind.Markdown) {
                let markdownString = '';

                if (autoImportText) {
                    markdownString += autoImportText + '\n\n';
                }

                if (typeDetail) {
                    markdownString += '```python\n' + typeDetail + '\n```\n';
                }

                if (documentation) {
                    markdownString += '---\n';
                    markdownString += convertDocStringToMarkdown(documentation);
                }

                markdownString = markdownString.trimEnd();

                if (markdownString) {
                    completionItem.documentation = {
                        kind: MarkupKind.Markdown,
                        value: markdownString,
                    };
                }
            } else if (this._format === MarkupKind.PlainText) {
                let plainTextString = '';

                if (autoImportText) {
                    plainTextString += autoImportText + '\n\n';
                }

                if (typeDetail) {
                    plainTextString += typeDetail + '\n';
                }

                if (documentation) {
                    plainTextString += '\n' + convertDocStringToPlainText(documentation);
                }

                plainTextString = plainTextString.trimEnd();

                if (plainTextString) {
                    completionItem.documentation = {
                        kind: MarkupKind.PlainText,
                        value: plainTextString,
                    };
                }
            } else {
                fail(`Unsupported markup type: ${this._format}`);
            }

            if (textEdit) {
                completionItem.textEdit = textEdit;
            }

            if (additionalTextEdits) {
                completionItem.additionalTextEdits = additionalTextEdits.map((te) => {
                    const textEdit: TextEdit = {
                        range: {
                            start: { line: te.range.start.line, character: te.range.start.character },
                            end: { line: te.range.end.line, character: te.range.end.character },
                        },
                        newText: te.replacementText,
                    };
                    return textEdit;
                });
            }

            completionList.items.push(completionItem);
        }
    }

    private _getRecentListIndex(name: string, autoImportText: string) {
        return CompletionProvider._mostRecentCompletions.findIndex(
            (item) => item.label === name && item.autoImportText === autoImportText
        );
    }

    private _makeSortText(sortCategory: SortCategory, name: string, autoImportText = ''): string {
        const recentListIndex = this._getRecentListIndex(name, autoImportText);

        // If the label is in the recent list, modify the category
        // so it appears higher in our list.
        if (recentListIndex >= 0) {
            if (sortCategory === SortCategory.AutoImport) {
                sortCategory = SortCategory.RecentAutoImport;
            } else if (sortCategory === SortCategory.ImportModuleName) {
                sortCategory = SortCategory.RecentImportModuleName;
            } else if (
                sortCategory === SortCategory.Keyword ||
                sortCategory === SortCategory.NormalSymbol ||
                sortCategory === SortCategory.PrivateSymbol ||
                sortCategory === SortCategory.DunderSymbol
            ) {
                sortCategory = SortCategory.RecentKeywordOrSymbol;
            }
        }

        // Generate a sort string of the format
        //    XX.YYYY.name
        // where XX is the sort category
        // and YYYY is the index of the item in the MRU list
        return this._formatInteger(sortCategory, 2) + '.' + this._formatInteger(recentListIndex, 4) + '.' + name;
    }

    private _formatInteger(val: number, digits: number): string {
        const charCodeZero = '0'.charCodeAt(0);

        let result = '';
        for (let i = 0; i < digits; i++) {
            // Prepend the next digit.
            let digit = Math.floor(val % 10);
            if (digit < 0) {
                digit = 9;
            }
            result = String.fromCharCode(digit + charCodeZero) + result;
            val = Math.floor(val / 10);
        }

        return result;
    }

    private _convertDeclarationTypeToItemKind(declaration: Declaration): CompletionItemKind {
        const resolvedDeclaration = this._evaluator.resolveAliasDeclaration(declaration, /* resolveLocalNames */ true);
        if (!resolvedDeclaration) {
            return CompletionItemKind.Variable;
        }

        switch (resolvedDeclaration.type) {
            case DeclarationType.Intrinsic:
                return resolvedDeclaration.intrinsicType === 'class'
                    ? CompletionItemKind.Class
                    : CompletionItemKind.Variable;

            case DeclarationType.Parameter:
                return CompletionItemKind.Variable;

            case DeclarationType.Variable:
                return resolvedDeclaration.isConstant || resolvedDeclaration.isFinal
                    ? CompletionItemKind.Constant
                    : CompletionItemKind.Variable;

            case DeclarationType.Function: {
                if (this._isPossiblePropertyDeclaration(resolvedDeclaration)) {
                    const functionType = this._evaluator.getTypeOfFunction(resolvedDeclaration.node);
                    if (functionType && isProperty(functionType.decoratedType)) {
                        return CompletionItemKind.Property;
                    }
                }
                return resolvedDeclaration.isMethod ? CompletionItemKind.Method : CompletionItemKind.Function;
            }

            case DeclarationType.Class:
            case DeclarationType.SpecialBuiltInClass:
                return CompletionItemKind.Class;

            case DeclarationType.Alias:
                return CompletionItemKind.Module;
        }
    }

    private _getImportModuleCompletions(node: ModuleNameNode): CompletionResults {
        const execEnvironment = this._configOptions.findExecEnvironment(this._filePath);
        const moduleDescriptor: ImportedModuleDescriptor = {
            leadingDots: node.leadingDots,
            hasTrailingDot: node.hasTrailingDot,
            nameParts: node.nameParts.map((part) => part.value),
            importedSymbols: [],
        };

        const completions = this._importResolver.getCompletionSuggestions(
            this._filePath,
            execEnvironment,
            moduleDescriptor,
            similarityLimit
        );

        const completionList = CompletionList.create();

        // If we're in the middle of a "from X import Y" statement, offer
        // the "import" keyword as a completion.
        if (
            !node.hasTrailingDot &&
            node.parent &&
            node.parent.nodeType === ParseNodeType.ImportFrom &&
            node.parent.missingImportKeyword
        ) {
            const keyword = 'import';
            const completionItem = CompletionItem.create(keyword);
            completionItem.kind = CompletionItemKind.Keyword;
            completionList.items.push(completionItem);
            completionItem.sortText = this._makeSortText(SortCategory.Keyword, keyword);
        }

        completions.forEach((completionName) => {
            const completionItem = CompletionItem.create(completionName);
            completionItem.kind = CompletionItemKind.Module;
            completionList.items.push(completionItem);
            completionItem.sortText = this._makeSortText(SortCategory.ImportModuleName, completionName);
        });

        return { completionList };
    }

    private _isPossiblePropertyDeclaration(decl: FunctionDeclaration) {
        // Do cheap check using only nodes that will cover 99.9% cases
        // before doing more expensive type evaluation.
        return decl.isMethod && decl.node.decorators.length > 0;
    }
}
