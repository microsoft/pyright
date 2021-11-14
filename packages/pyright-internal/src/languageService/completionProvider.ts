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
    InsertTextFormat,
    MarkupKind,
    Range,
    TextEdit,
} from 'vscode-languageserver';

import { ImportLookup } from '../analyzer/analyzerFileInfo';
import * as AnalyzerNodeInfo from '../analyzer/analyzerNodeInfo';
import {
    Declaration,
    DeclarationType,
    FunctionDeclaration,
    isFunctionDeclaration,
    VariableDeclaration,
} from '../analyzer/declaration';
import { isDefinedInFile } from '../analyzer/declarationUtils';
import { convertDocStringToMarkdown, convertDocStringToPlainText } from '../analyzer/docStringConversion';
import { ImportedModuleDescriptor, ImportResolver } from '../analyzer/importResolver';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { getCallNodeAndActiveParameterIndex } from '../analyzer/parseTreeUtils';
import { getScopeForNode } from '../analyzer/scopeUtils';
import { isStubFile, SourceMapper } from '../analyzer/sourceMapper';
import { Symbol, SymbolTable } from '../analyzer/symbol';
import * as SymbolNameUtils from '../analyzer/symbolNameUtils';
import { getLastTypedDeclaredForSymbol } from '../analyzer/symbolUtils';
import { getTypedDictMembersForClass } from '../analyzer/typedDicts';
import {
    getClassDocString,
    getModuleDocString,
    getOverloadedFunctionDocStringsInherited,
    getPropertyDocStringInherited,
    getVariableDocString,
} from '../analyzer/typeDocStringUtils';
import { CallSignatureInfo, TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import { printLiteralValue } from '../analyzer/typePrinter';
import {
    ClassType,
    FunctionType,
    getTypeAliasInfo,
    isClass,
    isClassInstance,
    isFunction,
    isInstantiableClass,
    isModule,
    isNone,
    isOverloadedFunction,
    isUnbound,
    isUnknown,
    Type,
    TypeBase,
    UnknownType,
} from '../analyzer/types';
import {
    doForEachSubtype,
    getDeclaringModulesForType,
    getMembersForClass,
    getMembersForModule,
    isLiteralType,
    isLiteralTypeOrUnion,
    isProperty,
} from '../analyzer/typeUtils';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { ConfigOptions, ExecutionEnvironment } from '../common/configOptions';
import * as debug from '../common/debug';
import { fail } from '../common/debug';
import { TextEditAction } from '../common/editAction';
import { convertOffsetToPosition, convertPositionToOffset } from '../common/positionUtils';
import { PythonVersion } from '../common/pythonVersion';
import * as StringUtils from '../common/stringUtils';
import { comparePositions, Position } from '../common/textRange';
import { TextRange } from '../common/textRange';
import { TextRangeCollection } from '../common/textRangeCollection';
import { Duration } from '../common/timing';
import {
    ArgumentCategory,
    DecoratorNode,
    DictionaryKeyEntryNode,
    DictionaryNode,
    ErrorExpressionCategory,
    ErrorNode,
    ExpressionNode,
    ImportFromNode,
    IndexNode,
    isExpressionNode,
    ModuleNameNode,
    NameNode,
    ParameterCategory,
    ParameterNode,
    ParseNode,
    ParseNodeType,
    SetNode,
    StringNode,
} from '../parser/parseNodes';
import { ParseResults } from '../parser/parser';
import { StringToken, StringTokenFlags, Token, TokenType } from '../parser/tokenizerTypes';
import { AbbreviationInfo, AutoImporter, AutoImportResult, ModuleSymbolMap } from './autoImporter';
import { DocumentSymbolCollector } from './documentSymbolCollector';
import { IndexResults } from './documentSymbolProvider';
import { getAutoImportText, getFunctionDocStringFromType, getOverloadedFunctionTooltip } from './tooltipUtils';

namespace Keywords {
    const base: string[] = [
        // Expression keywords
        'True',
        'False',
        'None',
        'and',
        'or',
        'not',
        'is',
        'lambda',
        'yield',

        // Statement keywords
        'assert',
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
        'with',
    ];

    const python3_5: string[] = [...base, 'async', 'await'];

    const python3_10: string[] = [...python3_5, 'case', 'match'];

    export function forVersion(version: PythonVersion): string[] {
        if (version >= PythonVersion.V3_10) {
            return python3_10;
        }
        if (version >= PythonVersion.V3_5) {
            return python3_5;
        }
        return base;
    }
}

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

    // An enum member.
    EnumMember,

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
    autoImportText?: string | undefined;
    symbolLabel?: string | undefined;
    funcParensDisabled?: boolean | undefined;
}

// MemberAccessInfo attempts to gather info for unknown types
export interface MemberAccessInfo {
    lastKnownModule?: string | undefined;
    lastKnownMemberName?: string | undefined;
    unknownMemberName?: string | undefined;
}

export interface AutoImportInfo {
    indexUsed: boolean;
    totalTimeInMS: number;

    moduleTimeInMS: number;
    indexTimeInMS: number;
    importAliasTimeInMS: number;

    itemCount: number;
    symbolCount: number;
    indexCount: number;
    importAliasCount: number;

    additionTimeInMS: number;
}

export interface ExtensionInfo {
    correlationId: string;
    selectedItemTelemetryTimeInMS: number;
    itemTelemetryTimeInMS: number;
    totalTimeInMS: number;
}

export interface CompletionResults {
    completionList: CompletionList | undefined;
    memberAccessInfo?: MemberAccessInfo | undefined;
    autoImportInfo?: AutoImportInfo | undefined;
    extensionInfo?: ExtensionInfo | undefined;
}

export interface CompletionOptions {
    format: MarkupKind;
    snippet: boolean;
    lazyEdit: boolean;
}

export type AbbreviationMap = Map<string, AbbreviationInfo>;

export interface AutoImportMaps {
    nameMap?: AbbreviationMap | undefined;
    libraryMap?: Map<string, IndexResults> | undefined;
    getModuleSymbolsMap: () => ModuleSymbolMap;
}

interface RecentCompletionInfo {
    label: string;
    autoImportText: string;
}

interface Edits {
    format?: InsertTextFormat | undefined;
    textEdit?: TextEdit | undefined;
    additionalTextEdits?: TextEditAction[] | undefined;
}

interface SymbolDetail {
    funcParensDisabled?: boolean | undefined;
    autoImportSource?: string | undefined;
    autoImportAlias?: string | undefined;
    boundObjectOrClass?: ClassType | undefined;
    edits?: Edits | undefined;
}

interface CompletionDetail {
    funcParensDisabled?: boolean | undefined;
    typeDetail?: string | undefined;
    documentation?: string | undefined;
    autoImportText?: string | undefined;
    edits?: Edits | undefined;
    sortText?: string | undefined;
    itemDetail?: string | undefined;
}

export const autoImportDetail = 'Auto-import';
export const dictionaryKeyDetail = 'Dictionary key';

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

    private _execEnv: ExecutionEnvironment;

    // Indicate whether invocation is inside of string literal.
    private _insideStringLiteral = false;

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
        private _options: CompletionOptions,
        private _sourceMapper: SourceMapper,
        private _autoImportMaps: AutoImportMaps | undefined,
        private _cancellationToken: CancellationToken
    ) {
        this._execEnv = this._configOptions.findExecEnvironment(this._filePath);
    }

    getCompletionsForPosition(): CompletionResults | undefined {
        const offset = convertPositionToOffset(this._position, this._parseResults.tokenizerOutput.lines);
        if (offset === undefined) {
            return undefined;
        }

        const token = ParseTreeUtils.getTokenOverlapping(this._parseResults.tokenizerOutput.tokens, offset);
        if (token?.type === TokenType.String) {
            this._insideStringLiteral = TextRange.contains(token, offset)
                ? true
                : (token as StringToken).flags & StringTokenFlags.Unterminated
                ? true
                : false;
        }

        let node = ParseTreeUtils.findNodeByOffset(this._parseResults.parseTree, offset);

        // See if we can get to a "better" node by backing up a few columns.
        // A "better" node is defined as one that's deeper than the current
        // node.
        const initialNode = node;
        const initialDepth = node ? ParseTreeUtils.getNodeDepth(node) : 0;

        if (!initialNode || initialNode.nodeType !== ParseNodeType.Name) {
            let curOffset = offset;
            let sawComma = false;

            while (curOffset >= 0) {
                curOffset--;

                // Stop scanning backward if we hit certain stop characters.
                const curChar = this._fileContents.substr(curOffset, 1);
                if (curChar === '(' || curChar === '\n' || curChar === '}') {
                    break;
                }
                if (curChar === ',') {
                    sawComma = true;
                }

                const curNode = ParseTreeUtils.findNodeByOffset(this._parseResults.parseTree, curOffset);
                if (curNode && curNode !== initialNode) {
                    if (ParseTreeUtils.getNodeDepth(curNode) > initialDepth) {
                        node = curNode;

                        // If we're at the end of a list with a hanging comma, handle the
                        // special case of "from x import y, ".
                        if (sawComma && node.parent?.nodeType === ParseNodeType.ImportFromAs) {
                            node = node.parent;
                        }
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
        if (this._isWithinComment(offset)) {
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
                return this._getLiteralCompletions(curNode, priorWord, priorText, postText);
            }

            if (curNode.nodeType === ParseNodeType.StringList || curNode.nodeType === ParseNodeType.FormatString) {
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

            if (curNode.nodeType === ParseNodeType.Dictionary) {
                const completionList = CompletionList.create();
                if (this._addTypedDictKeys(curNode, /* stringNode */ undefined, priorText, postText, completionList)) {
                    return { completionList };
                }
            }

            const dictionaryEntry = ParseTreeUtils.getFirstAncestorOrSelfOfKind(
                curNode,
                ParseNodeType.DictionaryKeyEntry
            );
            if (dictionaryEntry) {
                if (dictionaryEntry.parent?.nodeType === ParseNodeType.Dictionary) {
                    const dictionaryNode = dictionaryEntry.parent;
                    if (dictionaryNode.trailingCommaToken && dictionaryNode.trailingCommaToken.start < offset) {
                        const completionList = CompletionList.create();
                        if (
                            this._addTypedDictKeys(
                                dictionaryNode,
                                /* stringNode */ undefined,
                                priorText,
                                postText,
                                completionList
                            )
                        ) {
                            return { completionList };
                        }
                    }
                }
            }

            if (curNode.nodeType === ParseNodeType.Name) {
                // This condition is little different than others since it does its own
                // tree walk up to find context and let outer tree walk up to proceed if it can't find
                // one to show completion.
                const result = this._tryGetNameCompletions(curNode, offset, priorWord);
                if (result || result === undefined) {
                    return result;
                }
            }

            if (curNode.nodeType === ParseNodeType.ImportFrom) {
                return this._getImportFromCompletions(curNode, priorWord);
            }

            if (isExpressionNode(curNode)) {
                return this._getExpressionCompletions(curNode, priorWord, priorText, postText);
            }

            if (curNode.nodeType === ParseNodeType.Suite) {
                if (
                    curNode.parent &&
                    curNode.parent.nodeType === ParseNodeType.Except &&
                    !curNode.parent.name &&
                    curNode.parent.typeExpression &&
                    TextRange.getEnd(curNode.parent.typeExpression) < offset &&
                    offset <= curNode.parent.exceptSuite.start
                ) {
                    // except Exception as [<empty>]
                    return undefined;
                }

                if (
                    curNode.parent &&
                    curNode.parent.nodeType === ParseNodeType.Class &&
                    (!curNode.parent.name || !curNode.parent.name.value) &&
                    curNode.parent.arguments.length === 0 &&
                    offset <= curNode.parent.suite.start
                ) {
                    // class [<empty>]
                    return undefined;
                }

                return this._getStatementCompletions(curNode, priorWord, priorText, postText);
            }

            if (curNode.nodeType === ParseNodeType.Module) {
                return this._getStatementCompletions(curNode, priorWord, priorText, postText);
            }

            if (
                curNode.nodeType === ParseNodeType.Parameter &&
                curNode.length === 0 &&
                curNode.parent &&
                curNode.parent.nodeType === ParseNodeType.Lambda
            ) {
                // lambda [<empty>] or lambda x, [<empty>]
                return undefined;
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

            if (!completionItemData.autoImportText) {
                // Rerun the completion lookup. It will fill in additional information
                // about the item to be resolved. We'll ignore the rest of the returned
                // list. This is a bit wasteful, but all of that information should be
                // cached, so it's not as bad as it might seem.
                this.getCompletionsForPosition();
            } else if (!completionItem.additionalTextEdits) {
                const completionList = CompletionList.create();
                const completionResults = { completionList };

                this._addAutoImportCompletions(
                    completionItemData.symbolLabel,
                    /* similarityLimit */ 1,
                    /* lazyEdit */ false,
                    completionResults
                );
            }
        }
    }

    private _tryGetNameCompletions(curNode: NameNode, offset: number, priorWord: string) {
        if (!curNode.parent) {
            return false;
        }

        if (curNode.parent.nodeType === ParseNodeType.ImportAs && curNode.parent.alias === curNode) {
            // Are we within a "import Y as [Z]"?
            return undefined;
        }

        if (curNode.parent.nodeType === ParseNodeType.ModuleName) {
            // Are we within a "import Y as [<empty>]"?
            if (
                curNode.parent.parent &&
                curNode.parent.parent.nodeType === ParseNodeType.ImportAs &&
                !curNode.parent.parent.alias &&
                TextRange.getEnd(curNode.parent.parent) < offset
            ) {
                return undefined;
            }

            // Are we within a "from X import Y as Z" statement and
            // more specifically within the "Y"?
            return this._getImportModuleCompletions(curNode.parent);
        }

        if (curNode.parent.nodeType === ParseNodeType.ImportFromAs) {
            if (curNode.parent.alias === curNode) {
                // Are we within a "from X import Y as [Z]"?
                return undefined;
            }

            const parentNode = curNode.parent.parent;
            if (parentNode && parentNode.nodeType === ParseNodeType.ImportFrom) {
                // Are we within a "from X import Y as [<empty>]"?
                if (!curNode.parent.alias && TextRange.getEnd(curNode.parent) < offset) {
                    return undefined;
                }

                if (curNode.parent.name === curNode) {
                    return this._getImportFromCompletions(parentNode, priorWord);
                }

                return this._getImportFromCompletions(parentNode, '');
            }

            return false;
        }

        if (curNode.parent.nodeType === ParseNodeType.MemberAccess && curNode === curNode.parent.memberName) {
            return this._getMemberAccessCompletions(curNode.parent.leftExpression, priorWord);
        }

        if (curNode.parent.nodeType === ParseNodeType.Except && curNode === curNode.parent.name) {
            return undefined;
        }

        if (curNode.parent.nodeType === ParseNodeType.Function && curNode === curNode.parent.name) {
            if (curNode.parent.decorators?.some((d) => this._isOverload(d))) {
                return this._getMethodOverloadsCompletions(priorWord, curNode);
            }

            return undefined;
        }

        if (curNode.parent.nodeType === ParseNodeType.Parameter && curNode === curNode.parent.name) {
            return undefined;
        }

        if (curNode.parent.nodeType === ParseNodeType.Class && curNode === curNode.parent.name) {
            return undefined;
        }

        if (
            curNode.parent.nodeType === ParseNodeType.For &&
            TextRange.contains(curNode.parent.targetExpression, curNode.start)
        ) {
            return undefined;
        }

        if (
            curNode.parent.nodeType === ParseNodeType.ListComprehensionFor &&
            TextRange.contains(curNode.parent.targetExpression, curNode.start)
        ) {
            return undefined;
        }

        return false;
    }

    private _isWithinComment(offset: number): boolean {
        const token = getTokenAfter(offset, this._parseResults.tokenizerOutput.tokens);
        if (!token) {
            // If we're in the middle of a token, we're not in a comment.
            return false;
        }

        return token.comments?.some((c) => TextRange.overlaps(c, offset)) ?? false;

        function getTokenAfter(offset: number, tokens: TextRangeCollection<Token>) {
            const tokenIndex = tokens.getItemAtPosition(offset);
            if (tokenIndex < 0) {
                return undefined;
            }

            let token = tokens.getItemAt(tokenIndex);
            // If we're in the middle of a token, we can't be within a comment.
            if (offset > token.start && offset < token.start + token.length) {
                return undefined;
            }

            // Multiple zero length tokens can occupy same position.
            // But comment is associated with the first one. loop
            // backward to find the first token if position is same.
            for (let i = tokenIndex - 1; i >= 0; i--) {
                const prevToken = tokens.getItemAt(i);
                if (token.start !== prevToken.start) {
                    break;
                }

                token = prevToken;
            }

            if (offset <= token.start) {
                return token;
            }

            // If offset > token.start, tokenIndex + 1 < tokens.length
            // should be always true.
            debug.assert(tokenIndex + 1 < tokens.length);
            return tokens.getItemAt(tokenIndex + 1);
        }
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
            case ErrorExpressionCategory.MissingDecoratorCallName: {
                return this._getExpressionCompletions(node, priorWord, priorText, postText);
            }

            case ErrorExpressionCategory.MissingIndexOrSlice: {
                let completionResults = this._getLiteralCompletions(node, priorWord, priorText, postText);

                if (!completionResults || !completionResults.completionList) {
                    completionResults = this._getExpressionCompletions(node, priorWord, priorText, postText);
                }

                return completionResults;
            }

            case ErrorExpressionCategory.MissingMemberAccessName: {
                if (node.child && isExpressionNode(node.child)) {
                    return this._getMemberAccessCompletions(node.child, priorWord);
                }
                break;
            }

            case ErrorExpressionCategory.MissingFunctionParameterList: {
                if (node.child && node.child.nodeType === ParseNodeType.Name) {
                    if (node.decorators?.some((d) => this._isOverload(d))) {
                        return this._getMethodOverloadsCompletions(priorWord, node.child);
                    }

                    // Determine if the partial name is a method that's overriding
                    // a method in a base class.
                    return this._getMethodOverrideCompletions(priorWord, node.child, node.decorators);
                }
                break;
            }
        }

        return undefined;
    }

    private _isOverload(node: DecoratorNode): boolean {
        return this._checkDecorator(node, 'overload');
    }

    private _checkDecorator(node: DecoratorNode, value: string): boolean {
        return node.expression.nodeType === ParseNodeType.Name && node.expression.value === value;
    }

    private _createSingleKeywordCompletionList(keyword: string): CompletionResults {
        const completionItem = CompletionItem.create(keyword);
        completionItem.kind = CompletionItemKind.Keyword;
        completionItem.sortText = this._makeSortText(SortCategory.LikelyKeyword, keyword);
        const completionList = CompletionList.create([completionItem]);
        return { completionList };
    }

    private _getMethodOverloadsCompletions(priorWord: string, partialName: NameNode): CompletionResults | undefined {
        const symbolTable = getSymbolTable(this._evaluator, partialName);
        if (!symbolTable) {
            return undefined;
        }

        const funcParensDisabled = partialName.parent?.nodeType === ParseNodeType.Function ? true : undefined;
        const completionList = CompletionList.create();

        const enclosingFunc = ParseTreeUtils.getEnclosingFunction(partialName);
        symbolTable.forEach((symbol, name) => {
            const decl = getLastTypedDeclaredForSymbol(symbol);
            if (!decl || decl.type !== DeclarationType.Function) {
                return;
            }

            if (!decl.node.decorators.some((d) => this._isOverload(d))) {
                // Only consider ones that have overload decorator.
                return;
            }

            const decls = symbol.getDeclarations();
            if (decls.length === 1 && decls.some((d) => d.node === enclosingFunc)) {
                // Don't show itself.
                return;
            }

            if (StringUtils.isPatternInSymbol(partialName.value, name)) {
                const textEdit = this._createReplaceEdits(priorWord, partialName, decl.node.name.value);
                this._addSymbol(name, symbol, partialName.value, completionList, {
                    funcParensDisabled,
                    edits: { textEdit },
                });
            }
        });

        return { completionList };

        function getSymbolTable(evaluator: TypeEvaluator, partialName: NameNode) {
            const enclosingClass = ParseTreeUtils.getEnclosingClass(partialName, false);
            if (enclosingClass) {
                const classResults = evaluator.getTypeOfClass(enclosingClass);
                if (!classResults) {
                    return undefined;
                }

                const symbolTable = new Map<string, Symbol>();
                for (const mroClass of classResults.classType.details.mro) {
                    if (isInstantiableClass(mroClass)) {
                        getMembersForClass(mroClass, symbolTable, /* includeInstanceVars */ false);
                    }
                }

                return symbolTable;
            }

            // For function overload, we only care about top level functions
            const moduleNode = ParseTreeUtils.getEnclosingModule(partialName);
            if (moduleNode) {
                const moduleScope = AnalyzerNodeInfo.getScope(moduleNode);
                return moduleScope?.symbolTable;
            }

            return undefined;
        }
    }

    private _getMethodOverrideCompletions(
        priorWord: string,
        partialName: NameNode,
        decorators?: DecoratorNode[]
    ): CompletionResults | undefined {
        const enclosingClass = ParseTreeUtils.getEnclosingClass(partialName, true);
        if (!enclosingClass) {
            return undefined;
        }

        const classResults = this._evaluator.getTypeOfClass(enclosingClass);
        if (!classResults) {
            return undefined;
        }

        const symbolTable = new Map<string, Symbol>();
        for (let i = 1; i < classResults.classType.details.mro.length; i++) {
            const mroClass = classResults.classType.details.mro[i];
            if (isInstantiableClass(mroClass)) {
                getMembersForClass(mroClass, symbolTable, /* includeInstanceVars */ false);
            }
        }

        const staticmethod = decorators?.some((d) => this._checkDecorator(d, 'staticmethod')) ?? false;
        const classmethod = decorators?.some((d) => this._checkDecorator(d, 'classmethod')) ?? false;

        const completionList = CompletionList.create();

        symbolTable.forEach((symbol, name) => {
            let decl = getLastTypedDeclaredForSymbol(symbol);
            if (decl && decl.type === DeclarationType.Function) {
                if (StringUtils.isPatternInSymbol(partialName.value, name)) {
                    const declaredType = this._evaluator.getTypeForDeclaration(decl);
                    if (!declaredType) {
                        return;
                    }

                    let isProperty = isClassInstance(declaredType) && ClassType.isPropertyClass(declaredType);

                    if (SymbolNameUtils.isDunderName(name)) {
                        // Don't offer suggestions for built-in properties like "__class__", etc.
                        isProperty = false;
                    }

                    if (!isFunction(declaredType) && !isProperty) {
                        return;
                    }

                    if (isProperty) {
                        // For properties, we should override the "getter", which is typically
                        // the first declaration.
                        const typedDecls = symbol.getTypedDeclarations();
                        if (typedDecls.length > 0 && typedDecls[0].type === DeclarationType.Function) {
                            decl = typedDecls[0];
                        }
                    }

                    const isDeclaredStaticMethod =
                        isFunction(declaredType) && FunctionType.isStaticMethod(declaredType);

                    // Special-case the "__init__subclass__" method because it's an implicit
                    // classmethod that the type evaluator flags as a real classmethod.
                    const isDeclaredClassMethod =
                        isFunction(declaredType) &&
                        FunctionType.isClassMethod(declaredType) &&
                        name !== '__init_subclass__';

                    if (staticmethod !== isDeclaredStaticMethod || classmethod !== isDeclaredClassMethod) {
                        return;
                    }

                    const methodSignature = this._printMethodSignature(classResults.classType, decl);

                    let text: string;
                    if (isStubFile(this._filePath)) {
                        text = `${methodSignature}: ...`;
                    } else {
                        const methodBody = this._printOverriddenMethodBody(
                            classResults.classType,
                            isDeclaredStaticMethod,
                            isProperty,
                            decl
                        );
                        text = `${methodSignature}:\n${methodBody}`;
                    }

                    const textEdit = this._createReplaceEdits(priorWord, partialName, text);

                    this._addSymbol(name, symbol, partialName.value, completionList, {
                        // method signature already contains ()
                        funcParensDisabled: true,
                        edits: {
                            format: this._options.snippet ? InsertTextFormat.Snippet : undefined,
                            textEdit,
                        },
                    });
                }
            }
        });

        return { completionList };
    }

    private _createReplaceEdits(priorWord: string, node: ParseNode | undefined, text: string) {
        const replaceOrInsertEndChar =
            node?.nodeType === ParseNodeType.Name
                ? this._position.character - priorWord.length + node.value.length
                : this._position.character;

        const range: Range = {
            start: { line: this._position.line, character: this._position.character - priorWord.length },
            end: { line: this._position.line, character: replaceOrInsertEndChar },
        };

        return TextEdit.replace(range, text);
    }

    private _printMethodSignature(classType: ClassType, decl: FunctionDeclaration): string {
        const node = decl.node;

        let ellipsisForDefault: boolean | undefined;
        if (isStubFile(this._filePath)) {
            // In stubs, always use "...".
            ellipsisForDefault = true;
        } else if (classType.details.moduleName === decl.moduleName) {
            // In the same file, always print the full default.
            ellipsisForDefault = false;
        }

        const printFlags = isStubFile(this._filePath)
            ? ParseTreeUtils.PrintExpressionFlags.ForwardDeclarations
            : undefined;

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

                // Currently, we don't automatically add import if the type used in the annotation is not imported
                // in current file.
                const paramTypeAnnotation = this._evaluator.getTypeAnnotationForParameter(node, index);
                if (paramTypeAnnotation) {
                    paramString += ': ' + ParseTreeUtils.printExpression(paramTypeAnnotation, printFlags);
                }

                if (param.defaultValue) {
                    paramString += paramTypeAnnotation ? ' = ' : '=';

                    const useEllipsis = ellipsisForDefault ?? !isSimpleDefault(param.defaultValue);
                    paramString += useEllipsis ? '...' : ParseTreeUtils.printExpression(param.defaultValue, printFlags);
                }

                if (!paramString && !param.name && param.category === ParameterCategory.Simple) {
                    return '/';
                }

                return paramString;
            })
            .join(', ');

        let methodSignature = node.name.value + '(' + paramList + ')';

        if (node.returnTypeAnnotation) {
            methodSignature += ' -> ' + ParseTreeUtils.printExpression(node.returnTypeAnnotation, printFlags);
        } else if (node.functionAnnotationComment) {
            methodSignature +=
                ' -> ' +
                ParseTreeUtils.printExpression(node.functionAnnotationComment.returnTypeAnnotation, printFlags);
        }

        return methodSignature;

        function isSimpleDefault(node: ExpressionNode): boolean {
            switch (node.nodeType) {
                case ParseNodeType.Number:
                case ParseNodeType.Constant:
                    return true;

                case ParseNodeType.String:
                    return (node.token.flags & StringTokenFlags.Format) === 0;

                case ParseNodeType.StringList:
                    return node.strings.every(isSimpleDefault);

                case ParseNodeType.UnaryOperation:
                    return isSimpleDefault(node.expression);

                case ParseNodeType.BinaryOperation:
                    return isSimpleDefault(node.leftExpression) && isSimpleDefault(node.rightExpression);

                default:
                    return false;
            }
        }
    }

    private _printOverriddenMethodBody(
        classType: ClassType,
        isStaticMethod: boolean,
        isProperty: boolean,
        decl: FunctionDeclaration
    ) {
        let sb = '    ';

        if (
            classType.details.baseClasses.length === 1 &&
            isClass(classType.details.baseClasses[0]) &&
            classType.details.baseClasses[0].details.fullName === 'builtins.object'
        ) {
            sb += this._options.snippet ? '${0:pass}' : 'pass';
            return sb;
        }

        if (decl.node.parameters.length === 0) {
            sb += this._options.snippet ? '${0:pass}' : 'pass';
            return sb;
        }

        const parameters = getParameters();
        if (decl.node.name.value !== '__init__') {
            sb += 'return ';
        }

        if (decl.node.isAsync) {
            sb += 'await ';
        }

        if (isProperty) {
            return sb + `super().${decl.node.name.value}`;
        }

        return sb + `super().${decl.node.name.value}(${parameters.map(convertToString).join(', ')})`;

        function getParameters() {
            if (isStaticMethod) {
                return decl.node.parameters.filter((p) => p.name);
            }

            return decl.node.parameters.slice(1).filter((p) => p.name);
        }

        function convertToString(parameter: ParameterNode) {
            const name = parameter.name?.value;
            if (parameter.category === ParameterCategory.VarArgList) {
                return `*${name}`;
            }

            if (parameter.category === ParameterCategory.VarArgDictionary) {
                return `**${name}`;
            }

            return parameter.defaultValue ? `${name}=${name}` : name;
        }
    }

    private _getMemberAccessCompletions(
        leftExprNode: ExpressionNode,
        priorWord: string
    ): CompletionResults | undefined {
        const symbolTable = new Map<string, Symbol>();
        const completionList = CompletionList.create();
        let memberAccessInfo: MemberAccessInfo = {};

        let leftType = this._evaluator.getType(leftExprNode);

        if (leftType) {
            leftType = this._evaluator.makeTopLevelTypeVarsConcrete(leftType);

            doForEachSubtype(leftType, (subtype) => {
                subtype = this._evaluator.makeTopLevelTypeVarsConcrete(subtype);

                if (isClass(subtype)) {
                    getMembersForClass(subtype, symbolTable, /* includeInstanceVars */ TypeBase.isInstance(subtype));
                } else if (isModule(subtype)) {
                    getMembersForModule(subtype, symbolTable);
                } else if (isFunction(subtype) || isOverloadedFunction(subtype)) {
                    const functionClass = this._evaluator.getBuiltInType(leftExprNode, 'function');
                    if (functionClass && isInstantiableClass(functionClass)) {
                        getMembersForClass(functionClass, symbolTable, /* includeInstanceVars */ true);
                    }
                } else if (isNone(subtype)) {
                    const objectClass = this._evaluator.getBuiltInType(leftExprNode, 'object');
                    if (objectClass && isInstantiableClass(objectClass)) {
                        getMembersForClass(objectClass, symbolTable, TypeBase.isInstance(subtype));
                    }
                }

                this._addSymbolsForSymbolTable(
                    symbolTable,
                    (_) => true,
                    priorWord,
                    /* isInImport */ false,
                    isClass(subtype) ? subtype : undefined,
                    completionList
                );
            });
        }

        // If we don't know this type, look for a module we should stub.
        if (!leftType || isUnknown(leftType) || isUnbound(leftType)) {
            memberAccessInfo = this._getLastKnownModule(leftExprNode, leftType);
        }

        return { completionList, memberAccessInfo };
    }

    private _getLastKnownModule(leftExprNode: ExpressionNode, leftType: Type | undefined): MemberAccessInfo {
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

        const memberAccessInfo: MemberAccessInfo = {};
        if (curType && !isUnknown(curType) && !isUnbound(curType) && curNode) {
            const moduleNamesForType = getDeclaringModulesForType(curType);

            // For union types we only care about non 'typing' modules.
            memberAccessInfo.lastKnownModule = moduleNamesForType.find((n) => n !== 'typing');

            if (curNode.nodeType === ParseNodeType.MemberAccess) {
                memberAccessInfo.lastKnownMemberName = curNode.memberName.value;
            } else if (curNode.nodeType === ParseNodeType.Name && isInstantiableClass(curType)) {
                memberAccessInfo.lastKnownMemberName = curType.details.name;
            } else if (curNode.nodeType === ParseNodeType.Name && isClassInstance(curType)) {
                memberAccessInfo.lastKnownMemberName = curType.details.name;
            }

            memberAccessInfo.unknownMemberName = unknownMemberName;
        }

        return memberAccessInfo;
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
        const isIndexArgument = this._isIndexArgument(parseNode);

        // If the user typed a "." as part of a number, don't present
        // any completion options.
        if (!isIndexArgument && parseNode.nodeType === ParseNodeType.Number) {
            return undefined;
        }

        // Are we within a "with Y as []"?
        // Don't add any completion options.
        if (
            parseNode.parent?.nodeType === ParseNodeType.WithItem &&
            parseNode.parent === parseNode.parent.target?.parent
        ) {
            return undefined;
        }

        const completionList = CompletionList.create();
        const completionResults = { completionList };

        // Return empty completionList for Ellipsis
        if (priorText.slice(-2) === '..') {
            return completionResults;
        }

        // Add call argument completions.
        this._addCallArgumentCompletions(
            parseNode,
            priorWord,
            priorText,
            postText,
            /*atArgument*/ false,
            completionList
        );

        // Add symbols that are in scope.
        this._addSymbols(parseNode, priorWord, completionList);

        // Add keywords.
        this._findMatchingKeywords(Keywords.forVersion(this._execEnv.pythonVersion), priorWord).map((keyword) => {
            const completionItem = CompletionItem.create(keyword);
            completionItem.kind = CompletionItemKind.Keyword;
            completionList.items.push(completionItem);
            completionItem.sortText = this._makeSortText(SortCategory.Keyword, keyword);
        });

        // Add auto-import suggestions from other modules.
        // Ignore this check for privates, since they are not imported.
        if (this._configOptions.autoImportCompletions && !priorWord.startsWith('_') && !this._itemToResolve) {
            this._addAutoImportCompletions(priorWord, similarityLimit, this._options.lazyEdit, completionResults);
        }

        // Add literal values if appropriate.
        if (parseNode.nodeType === ParseNodeType.Error) {
            if (
                parseNode.category === ErrorExpressionCategory.MissingIndexOrSlice &&
                parseNode.parent?.nodeType === ParseNodeType.Index
            ) {
                this._tryAddTypedDictStringLiteral(
                    parseNode.parent,
                    /*priorText*/ undefined,
                    /*postText*/ undefined,
                    completionList
                );
            } else if (parseNode.category === ErrorExpressionCategory.MissingExpression) {
                if (parseNode.parent && parseNode.parent.nodeType === ParseNodeType.Assignment) {
                    const declaredTypeOfTarget = this._evaluator.getExpectedType(parseNode)?.type;
                    if (declaredTypeOfTarget) {
                        this._addLiteralValuesForTargetType(
                            declaredTypeOfTarget,
                            priorText,
                            priorWord,
                            postText,
                            completionList
                        );
                    }
                }
            }
        }

        if (isIndexArgument) {
            // Completion for dict key (ex, dict_variable[<here>])
            const indexNode = parseNode.parent!.parent! as IndexNode;
            const excludes = new Set(completionList.items.map((i) => i.label));

            this._getDictionaryKeys(indexNode, parseNode).forEach((key) => {
                if (excludes.has(key)) {
                    // Don't add key if it already exists in the completion.
                    // ex) key = "dictKey"
                    //     dict[key] = 1
                    //     print(dict[<key will come from symbol table provider>]))
                    return;
                }

                this._addNameToCompletionList(key, CompletionItemKind.Constant, priorWord, completionList, {
                    sortText: this._makeSortText(SortCategory.LiteralValue, key),
                    itemDetail: dictionaryKeyDetail,
                });
            });
        }

        return completionResults;
    }

    private _isIndexArgument(node: ParseNode) {
        const currentNode = node.parent;
        return (
            currentNode &&
            currentNode.nodeType === ParseNodeType.Argument &&
            currentNode.argumentCategory === ArgumentCategory.Simple &&
            currentNode.parent &&
            currentNode.parent.nodeType === ParseNodeType.Index &&
            currentNode.parent.baseExpression &&
            currentNode.parent.baseExpression.nodeType === ParseNodeType.Name
        );
    }

    private _addCallArgumentCompletions(
        parseNode: ParseNode,
        priorWord: string,
        priorText: string,
        postText: string,
        atArgument: boolean,
        completionList: CompletionList
    ) {
        // If we're within the argument list of a call, add parameter names.
        const offset = convertPositionToOffset(this._position, this._parseResults.tokenizerOutput.lines)!;
        const callInfo = getCallNodeAndActiveParameterIndex(
            parseNode,
            offset,
            this._parseResults.tokenizerOutput.tokens
        );

        if (!callInfo) {
            return;
        }

        const signatureInfo = this._evaluator.getCallSignatureInfo(
            callInfo.callNode,
            callInfo.activeIndex,
            callInfo.activeOrFake
        );

        if (signatureInfo) {
            // Are we past the call expression and within the argument list?
            const callNameEnd = convertOffsetToPosition(
                signatureInfo.callNode.leftExpression.start + signatureInfo.callNode.leftExpression.length,
                this._parseResults.tokenizerOutput.lines
            );

            if (comparePositions(this._position, callNameEnd) > 0) {
                if (!atArgument) {
                    this._addNamedParameters(signatureInfo, priorWord, completionList);
                }

                // Add literals that apply to this parameter.
                this._addLiteralValuesForArgument(signatureInfo, priorText, priorWord, postText, completionList);
            }
        }
    }

    private _addLiteralValuesForArgument(
        signatureInfo: CallSignatureInfo,
        priorText: string,
        priorWord: string,
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
            this._addLiteralValuesForTargetType(paramType, priorText, priorWord, postText, completionList);
            return undefined;
        });
    }

    private _addLiteralValuesForTargetType(
        type: Type,
        priorText: string,
        priorWord: string,
        postText: string,
        completionList: CompletionList
    ) {
        const quoteValue = this._getQuoteValueFromPriorText(priorText);
        this._getSubTypesWithLiteralValues(type).forEach((v) => {
            if (ClassType.isBuiltIn(v, 'str')) {
                const value = printLiteralValue(v, quoteValue.quoteCharacter);
                if (quoteValue.stringValue === undefined) {
                    this._addNameToCompletionList(value, CompletionItemKind.Constant, priorWord, completionList, {
                        sortText: this._makeSortText(SortCategory.LiteralValue, v.literalValue as string),
                    });
                } else {
                    this._addStringLiteralToCompletionList(
                        value.substr(1, value.length - 2),
                        quoteValue.stringValue,
                        postText,
                        quoteValue.quoteCharacter,
                        completionList
                    );
                }
            }
        });
    }

    private _getDictExpressionStringKeys(parseNode: ParseNode, excludeIds?: Set<number | undefined>) {
        const node = getDictionaryLikeNode(parseNode);
        if (!node) {
            return [];
        }

        return node.entries.flatMap((entry) => {
            if (entry.nodeType !== ParseNodeType.DictionaryKeyEntry || excludeIds?.has(entry.keyExpression.id)) {
                return [];
            }

            if (entry.keyExpression.nodeType === ParseNodeType.StringList) {
                return [entry.keyExpression.strings.map((s) => s.value).join('')];
            }

            return [];
        });

        function getDictionaryLikeNode(parseNode: ParseNode) {
            // this method assumes the given parseNode is either a child of a dictionary or a dictionary itself
            if (parseNode.nodeType === ParseNodeType.Dictionary) {
                return parseNode;
            }

            let curNode: ParseNode | undefined = parseNode;
            while (curNode && curNode.nodeType !== ParseNodeType.Dictionary && curNode.nodeType !== ParseNodeType.Set) {
                curNode = curNode.parent;
                if (!curNode) {
                    return;
                }
            }

            return curNode;
        }
    }

    private _getSubTypesWithLiteralValues(type: Type) {
        const values: ClassType[] = [];

        doForEachSubtype(type, (subtype) => {
            if (isClassInstance(subtype) && isLiteralType(subtype)) {
                values.push(subtype);
            }
        });

        return values;
    }

    private _getDictionaryKeys(indexNode: IndexNode, invocationNode: ParseNode) {
        if (indexNode.baseExpression.nodeType !== ParseNodeType.Name) {
            // This completion only supports simple name case
            return [];
        }

        const baseType = this._evaluator.getType(indexNode.baseExpression);
        if (!baseType || !isClassInstance(baseType)) {
            return [];
        }

        // Must be dict type
        if (!ClassType.isBuiltIn(baseType, 'dict') && !ClassType.isBuiltIn(baseType, 'Mapping')) {
            return [];
        }

        // See whether dictionary is typed using Literal types. If it is, return those literal keys.
        // For now, we are not using __getitem__ since we don't have a way to get effective parameter type of __getitem__.
        if (baseType.typeArguments?.length === 2) {
            const keys: string[] = [];

            this._getSubTypesWithLiteralValues(baseType.typeArguments[0]).forEach((v) => {
                if (
                    !ClassType.isBuiltIn(v, 'str') &&
                    !ClassType.isBuiltIn(v, 'int') &&
                    !ClassType.isBuiltIn(v, 'bool') &&
                    !ClassType.isBuiltIn(v, 'bytes') &&
                    !ClassType.isEnumClass(v)
                ) {
                    return;
                }

                keys.push(printLiteralValue(v, this._parseResults.tokenizerOutput.predominantSingleQuoteCharacter));
            });

            if (keys.length > 0) {
                return keys;
            }
        }

        // Must be local variable/parameter
        const declarations = this._evaluator.getDeclarationsForNameNode(indexNode.baseExpression) ?? [];
        const declaration = declarations.length > 0 ? declarations[0] : undefined;
        if (
            !declaration ||
            (declaration.type !== DeclarationType.Variable && declaration.type !== DeclarationType.Parameter)
        ) {
            return [];
        }

        if (declaration.path !== this._filePath) {
            return [];
        }

        let startingNode: ParseNode = indexNode.baseExpression;
        if (declaration.node) {
            const scopeRoot = ParseTreeUtils.getEvaluationScopeNode(declaration.node);

            // Find the lowest tree to search the symbol.
            if (
                ParseTreeUtils.getFileInfoFromNode(startingNode)?.filePath ===
                ParseTreeUtils.getFileInfoFromNode(scopeRoot)?.filePath
            ) {
                startingNode = scopeRoot;
            }
        }

        const results = DocumentSymbolCollector.collectFromNode(
            indexNode.baseExpression,
            this._evaluator,
            this._cancellationToken,
            startingNode
        );

        const keys: Set<string> = new Set<string>();
        for (const result of results) {
            const node =
                result.node.parent?.nodeType === ParseNodeType.TypeAnnotation ? result.node.parent : result.node;

            if (
                node.parent?.nodeType === ParseNodeType.Assignment ||
                node.parent?.nodeType === ParseNodeType.AssignmentExpression
            ) {
                if (node.parent.rightExpression.nodeType === ParseNodeType.Dictionary) {
                    const dictionary = node.parent.rightExpression;
                    for (const entry of dictionary.entries.filter(
                        (e) => e.nodeType === ParseNodeType.DictionaryKeyEntry
                    ) as DictionaryKeyEntryNode[]) {
                        const key = this._parseResults.text
                            .substr(entry.keyExpression.start, entry.keyExpression.length)
                            .trim();
                        if (key.length > 0) keys.add(key);
                    }
                }

                if (node.parent.rightExpression.nodeType === ParseNodeType.Call) {
                    const call = node.parent.rightExpression;
                    const type = this._evaluator.getType(call.leftExpression);
                    if (!type || !isInstantiableClass(type) || !ClassType.isBuiltIn(type, 'dict')) {
                        continue;
                    }

                    for (const arg of call.arguments) {
                        const key = arg.name?.value.trim() ?? '';
                        const quote = this._parseResults.tokenizerOutput.predominantSingleQuoteCharacter;
                        if (key.length > 0) {
                            keys.add(`${quote}${key}${quote}`);
                        }
                    }
                }
            }

            if (
                node.parent?.nodeType === ParseNodeType.Index &&
                node.parent.items.length === 1 &&
                node.parent.items[0].valueExpression.nodeType !== ParseNodeType.Error &&
                !TextRange.containsRange(node.parent, invocationNode)
            ) {
                const indexArgument = node.parent.items[0];
                const key = this._parseResults.text
                    .substr(indexArgument.valueExpression.start, indexArgument.valueExpression.length)
                    .trim();
                if (key.length > 0) keys.add(key);
            }
        }

        return [...keys];
    }

    private _getLiteralCompletions(
        parseNode: StringNode | ErrorNode,
        priorWord: string,
        priorText: string,
        postText: string
    ): CompletionResults | undefined {
        let parentNode: ParseNode | undefined = parseNode.parent;

        if (!parentNode) {
            return undefined;
        }

        const completionList = CompletionList.create();

        // See if the type evaluator can determine the expected type for this node.
        if (isExpressionNode(parentNode)) {
            const expectedTypeResult = this._evaluator.getExpectedType(parentNode);
            if (expectedTypeResult && isLiteralTypeOrUnion(expectedTypeResult.type)) {
                this._addLiteralValuesForTargetType(
                    expectedTypeResult.type,
                    priorText,
                    priorWord,
                    postText,
                    completionList
                );
                return { completionList };
            }

            if (parseNode.nodeType === ParseNodeType.String && parseNode.parent?.parent) {
                const stringParent = parseNode.parent.parent;

                // If the dictionary is not yet filled in, it will appear as though it's
                // a set initially.
                let dictOrSet: DictionaryNode | SetNode | undefined;

                if (
                    stringParent.nodeType === ParseNodeType.DictionaryKeyEntry &&
                    stringParent.keyExpression === parseNode.parent &&
                    stringParent.parent?.nodeType === ParseNodeType.Dictionary
                ) {
                    dictOrSet = stringParent.parent;
                } else if (stringParent?.nodeType === ParseNodeType.Set) {
                    dictOrSet = stringParent;
                }

                if (dictOrSet) {
                    if (this._addTypedDictKeys(dictOrSet, parseNode, priorText, postText, completionList)) {
                        return { completionList };
                    }
                }
            }
        }

        if (parentNode.nodeType !== ParseNodeType.Argument) {
            if (parentNode.nodeType !== ParseNodeType.StringList || parentNode.strings.length > 1) {
                return undefined;
            }

            parentNode = parentNode.parent;
            if (!parentNode) {
                return undefined;
            }
        }

        if (parentNode.nodeType === ParseNodeType.Argument && parentNode.parent?.nodeType === ParseNodeType.Index) {
            if (
                !this._tryAddTypedDictStringLiteral(
                    parentNode.parent,
                    parseNode.nodeType === ParseNodeType.String ? priorText : '',
                    postText,
                    completionList
                )
            ) {
                const keys = this._getDictionaryKeys(parentNode.parent, parseNode);
                const quoteValue = this._getQuoteValueFromPriorText(priorText);

                for (const key of keys) {
                    const stringLiteral = /^["|'].*["|']$/.test(key);
                    if (parseNode.nodeType === ParseNodeType.String && !stringLiteral) {
                        continue;
                    }

                    if (stringLiteral) {
                        const keyWithoutQuote = key.substr(1, key.length - 2);

                        this._addStringLiteralToCompletionList(
                            keyWithoutQuote,
                            quoteValue.stringValue,
                            postText,
                            quoteValue.quoteCharacter,
                            completionList,
                            dictionaryKeyDetail
                        );
                    } else {
                        this._addNameToCompletionList(key, CompletionItemKind.Constant, priorWord, completionList, {
                            sortText: this._makeSortText(SortCategory.LiteralValue, key),
                            itemDetail: dictionaryKeyDetail,
                        });
                    }
                }

                if (completionList.items.length === 0) {
                    return undefined;
                }
            }
        } else {
            debug.assert(parseNode.nodeType === ParseNodeType.String);

            const offset = convertPositionToOffset(this._position, this._parseResults.tokenizerOutput.lines)!;
            const atArgument = parentNode.start < offset && offset < TextRange.getEnd(parseNode);
            this._addCallArgumentCompletions(parseNode, priorWord, priorText, postText, atArgument, completionList);
        }

        return { completionList };
    }

    private _addTypedDictKeys(
        dictionaryNode: DictionaryNode | SetNode,
        stringNode: StringNode | undefined,
        priorText: string,
        postText: string,
        completionList: CompletionList
    ) {
        const expectedTypeResult = this._evaluator.getExpectedType(dictionaryNode);
        if (!expectedTypeResult) {
            return false;
        }

        // If the expected type result is associated with a node above the
        // dictionaryNode in the parse tree, there are no typed dict keys to add.
        if (ParseTreeUtils.getNodeDepth(expectedTypeResult.node) < ParseTreeUtils.getNodeDepth(dictionaryNode)) {
            return false;
        }

        let typedDicts: ClassType[] = [];

        doForEachSubtype(expectedTypeResult.type, (subtype) => {
            if (isClassInstance(subtype) && ClassType.isTypedDictClass(subtype)) {
                typedDicts.push(subtype);
            }
        });

        if (typedDicts.length === 0) {
            return false;
        }

        const keys = this._getDictExpressionStringKeys(
            dictionaryNode,
            stringNode ? new Set([stringNode.parent?.id]) : undefined
        );

        typedDicts = this._tryNarrowTypedDicts(typedDicts, keys);

        const quoteValue = this._getQuoteValueFromPriorText(priorText);
        const excludes = new Set(completionList.items.map((i) => i.label));

        keys.forEach((key) => {
            excludes.add(key);
        });

        typedDicts.forEach((typedDict) => {
            getTypedDictMembersForClass(this._evaluator, typedDict, /* allowNarrowed */ true).forEach((_, key) => {
                // Unions of TypedDicts may define the same key.
                if (excludes.has(key)) {
                    return;
                }

                excludes.add(key);

                this._addStringLiteralToCompletionList(
                    key,
                    quoteValue ? quoteValue.stringValue : undefined,
                    postText,
                    quoteValue
                        ? quoteValue.quoteCharacter
                        : this._parseResults.tokenizerOutput.predominantSingleQuoteCharacter,
                    completionList
                );
            });
        });

        return true;
    }

    private _tryNarrowTypedDicts(types: ClassType[], keys: string[]): ClassType[] {
        const newTypes = types.flatMap((type) => {
            const entries = getTypedDictMembersForClass(this._evaluator, type, /* allowNarrowed */ true);

            for (let index = 0; index < keys.length; index++) {
                if (!entries.has(keys[index])) {
                    return [];
                }
            }

            return [type];
        });

        if (newTypes.length === 0) {
            // Couldn't narrow to any typed dicts. Just include all.
            return types;
        }

        return newTypes;
    }

    // Given a string of text that precedes the current insertion point,
    // determines which portion of it is the first part of a string literal
    // (either starting with a single or double quote). Returns the quote
    // type and the string literal value after the starting quote.
    private _getQuoteValueFromPriorText(priorText: string) {
        if (this._insideStringLiteral) {
            const lastSingleQuote = priorText.lastIndexOf("'");
            const lastDoubleQuote = priorText.lastIndexOf('"');

            if (lastSingleQuote > lastDoubleQuote) {
                return {
                    quoteCharacter: "'",
                    stringValue: priorText.substr(lastSingleQuote + 1),
                };
            } else if (lastDoubleQuote > lastSingleQuote) {
                return { quoteCharacter: '"', stringValue: priorText.substr(lastDoubleQuote + 1) };
            }
        }

        const quoteCharacter = this._parseResults.tokenizerOutput.predominantSingleQuoteCharacter;
        const stringValue = undefined;
        return { stringValue, quoteCharacter };
    }

    private _tryAddTypedDictStringLiteral(
        indexNode: IndexNode | undefined,
        priorText: string | undefined,
        postText: string | undefined,
        completionList: CompletionList
    ) {
        if (!indexNode) {
            return false;
        }

        const baseType = this._evaluator.getType(indexNode.baseExpression);
        if (!baseType || !isClassInstance(baseType)) {
            return false;
        }

        // We currently handle only TypedDict objects.
        if (!ClassType.isTypedDictClass(baseType)) {
            return false;
        }

        const entries = getTypedDictMembersForClass(this._evaluator, baseType, /* allowNarrowed */ true);
        const quoteValue = priorText ? this._getQuoteValueFromPriorText(priorText) : undefined;

        entries.forEach((_, key) => {
            this._addStringLiteralToCompletionList(
                key,
                quoteValue ? quoteValue.stringValue : undefined,
                postText,
                quoteValue
                    ? quoteValue.quoteCharacter
                    : this._parseResults.tokenizerOutput.predominantSingleQuoteCharacter,
                completionList
            );
        });

        return true;
    }

    private _addStringLiteralToCompletionList(
        value: string,
        priorString: string | undefined,
        postText: string | undefined,
        quoteCharacter: string,
        completionList: CompletionList,
        detail?: string
    ) {
        if (StringUtils.isPatternInSymbol(priorString || '', value)) {
            const valueWithQuotes = `${quoteCharacter}${value}${quoteCharacter}`;
            const completionItem = CompletionItem.create(valueWithQuotes);

            completionItem.kind = CompletionItemKind.Constant;
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
            completionItem.detail = detail;

            completionList.items.push(completionItem);
        }
    }

    private _addAutoImportCompletions(
        priorWord: string,
        similarityLimit: number,
        lazyEdit: boolean,
        completionResults: CompletionResults
    ) {
        if (!this._autoImportMaps) {
            return;
        }

        const completionList = completionResults.completionList;
        if (!completionList) {
            return;
        }

        const moduleSymbolMap = this._autoImportMaps.getModuleSymbolsMap();
        const excludes = new Set(completionList.items.filter((i) => !i.data?.autoImport).map((i) => i.label));
        const autoImporter = new AutoImporter(
            this._execEnv,
            this._importResolver,
            this._parseResults,
            this._position,
            excludes,
            moduleSymbolMap,
            { libraryMap: this._autoImportMaps.libraryMap, lazyEdit }
        );

        const results: AutoImportResult[] = [];
        const info = this._autoImportMaps.nameMap?.get(priorWord);
        if (info && priorWord.length > 1 && !excludes.has(priorWord)) {
            results.push(...autoImporter.getAutoImportCandidatesForAbbr(priorWord, info, this._cancellationToken));
        }

        results.push(
            ...autoImporter.getAutoImportCandidates(priorWord, similarityLimit, undefined, this._cancellationToken)
        );

        const perfInfo = autoImporter.getPerfInfo();

        const additionDuration = new Duration();
        for (const result of results) {
            if (result.symbol) {
                this._addSymbol(result.name, result.symbol, priorWord, completionList, {
                    autoImportSource: result.source,
                    autoImportAlias: result.alias,
                    edits: {
                        textEdit: this._createReplaceEdits(priorWord, undefined, result.insertionText),
                        additionalTextEdits: result.edits,
                    },
                });
            } else {
                this._addNameToCompletionList(
                    result.alias ?? result.name,
                    result.kind ?? CompletionItemKind.Module,
                    priorWord,
                    completionList,
                    {
                        autoImportText: this._getAutoImportText(result.name, result.source, result.alias),
                        edits: {
                            textEdit: this._createReplaceEdits(priorWord, undefined, result.insertionText),
                            additionalTextEdits: result.edits,
                        },
                    }
                );
            }
        }

        completionResults.autoImportInfo = {
            indexUsed: perfInfo.indexUsed,
            totalTimeInMS: perfInfo.totalInMs,

            moduleTimeInMS: perfInfo.moduleTimeInMS,
            indexTimeInMS: perfInfo.indexTimeInMS,
            importAliasTimeInMS: perfInfo.importAliasTimeInMS,

            itemCount: results.length,
            symbolCount: perfInfo.symbolCount,
            indexCount: perfInfo.indexCount,
            importAliasCount: perfInfo.importAliasCount,

            additionTimeInMS: additionDuration.getDurationInMilliseconds(),
        };
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
                /* isInImport */ true,
                /* boundObject */ undefined,
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
                return StringUtils.isPatternInSymbol(partialMatch, keyword);
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
            if (StringUtils.isPatternInSymbol(priorWord, argName)) {
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
            let scope = getScopeForNode(curNode);
            if (scope) {
                while (scope) {
                    this._addSymbolsForSymbolTable(
                        scope.symbolTable,
                        () => true,
                        priorWord,
                        /* isInImport */ false,
                        /* boundObject */ undefined,
                        completionList
                    );
                    scope = scope.parent;
                }

                // If this is a class scope, add symbols from parent classes.
                if (curNode.nodeType === ParseNodeType.Class) {
                    const classType = this._evaluator.getTypeOfClass(curNode);
                    if (classType && isInstantiableClass(classType.classType)) {
                        classType.classType.details.mro.forEach((baseClass, index) => {
                            if (isInstantiableClass(baseClass)) {
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
                                    /* isInImport */ false,
                                    /* boundObject */ undefined,
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
        isInImport: boolean,
        boundObjectOrClass: ClassType | undefined,
        completionList: CompletionList
    ) {
        symbolTable.forEach((symbol, name) => {
            // If there are no declarations or the symbol is not
            // exported from this scope, don't include it in the
            // suggestion list unless we are in the same file.
            const hidden =
                symbol.isExternallyHidden() &&
                !symbol.getDeclarations().some((d) => isDefinedInFile(d, this._filePath));
            if (!hidden && includeSymbolCallback(name)) {
                // Don't add a symbol more than once. It may have already been
                // added from an inner scope's symbol table.
                if (!completionList.items.some((item) => item.label === name)) {
                    this._addSymbol(name, symbol, priorWord, completionList, {
                        boundObjectOrClass,
                        funcParensDisabled: isInImport,
                    });
                }
            }
        });
    }

    private _addSymbol(
        name: string,
        symbol: Symbol,
        priorWord: string,
        completionList: CompletionList,
        detail: SymbolDetail
    ) {
        // If the symbol is a py.typed import that is not supposed to be re-exported,
        // don't offer it as a completion suggestion.
        if (symbol.isPrivatePyTypedImport()) {
            return;
        }

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

                // Handle enum members specially. Enum members normally look like
                // variables, but the are declared using assignment expressions
                // within an enum class.
                if (
                    primaryDecl.type === DeclarationType.Variable &&
                    detail.boundObjectOrClass &&
                    isInstantiableClass(detail.boundObjectOrClass) &&
                    ClassType.isEnumClass(detail.boundObjectOrClass) &&
                    primaryDecl.node.parent?.nodeType === ParseNodeType.Assignment
                ) {
                    itemKind = CompletionItemKind.EnumMember;
                }

                // Are we resolving a completion item? If so, see if this symbol
                // is the one that we're trying to match.
                if (this._itemToResolve) {
                    const completionItemData = this._itemToResolve.data as CompletionItemData;

                    if (completionItemData.symbolLabel === name && !completionItemData.autoImportText) {
                        // This call can be expensive to perform on every completion item
                        // that we return, so we do it lazily in the "resolve" callback.
                        const type = this._evaluator.getEffectiveTypeOfSymbol(symbol);
                        if (type) {
                            let typeDetail: string | undefined;
                            let documentation: string | undefined;

                            switch (primaryDecl.type) {
                                case DeclarationType.Intrinsic:
                                case DeclarationType.Variable:
                                case DeclarationType.Parameter: {
                                    let expandTypeAlias = false;
                                    if (type && TypeBase.isInstantiable(type)) {
                                        const typeAliasInfo = getTypeAliasInfo(type);
                                        if (typeAliasInfo) {
                                            if (typeAliasInfo.name === name) {
                                                expandTypeAlias = true;
                                            }
                                        }
                                    }
                                    typeDetail = name + ': ' + this._evaluator.printType(type, expandTypeAlias);
                                    break;
                                }

                                case DeclarationType.Function: {
                                    const functionType =
                                        detail.boundObjectOrClass && (isFunction(type) || isOverloadedFunction(type))
                                            ? this._evaluator.bindFunctionToClassOrObject(
                                                  detail.boundObjectOrClass,
                                                  type
                                              )
                                            : type;
                                    if (functionType) {
                                        if (
                                            isProperty(functionType) &&
                                            detail.boundObjectOrClass &&
                                            isClassInstance(detail.boundObjectOrClass)
                                        ) {
                                            const propertyType =
                                                this._evaluator.getGetterTypeFromProperty(
                                                    functionType as ClassType,
                                                    /* inferTypeIfNeeded */ true
                                                ) || UnknownType.create();
                                            typeDetail =
                                                name +
                                                ': ' +
                                                this._evaluator.printType(propertyType, /* expandTypeAlias */ false) +
                                                ' (property)';
                                        } else if (isOverloadedFunction(functionType)) {
                                            // 35 is completion tooltip's default width size
                                            typeDetail = getOverloadedFunctionTooltip(
                                                functionType,
                                                this._evaluator,
                                                /* columnThreshold */ 35
                                            );
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

                            if (
                                primaryDecl.type === DeclarationType.Variable &&
                                primaryDecl.typeAliasName &&
                                primaryDecl.docString
                            ) {
                                documentation = primaryDecl.docString;
                            } else if (isModule(type)) {
                                documentation = getModuleDocString(type, primaryDecl, this._sourceMapper);
                            } else if (isInstantiableClass(type)) {
                                documentation = getClassDocString(type, primaryDecl, this._sourceMapper);
                            } else if (isFunction(type)) {
                                const functionType = detail.boundObjectOrClass
                                    ? this._evaluator.bindFunctionToClassOrObject(detail.boundObjectOrClass, type)
                                    : type;
                                if (functionType && isFunction(functionType)) {
                                    documentation = getFunctionDocStringFromType(
                                        functionType,
                                        this._sourceMapper,
                                        this._evaluator
                                    );
                                }
                            } else if (isOverloadedFunction(type)) {
                                const enclosingClass = isFunctionDeclaration(primaryDecl)
                                    ? ParseTreeUtils.getEnclosingClass(primaryDecl.node.name, false)
                                    : undefined;
                                const classResults = enclosingClass
                                    ? this._evaluator.getTypeOfClass(enclosingClass)
                                    : undefined;
                                const functionType = detail.boundObjectOrClass
                                    ? this._evaluator.bindFunctionToClassOrObject(detail.boundObjectOrClass, type)
                                    : type;
                                if (functionType && isOverloadedFunction(functionType)) {
                                    documentation = getOverloadedFunctionDocStringsInherited(
                                        functionType,
                                        primaryDecl,
                                        this._sourceMapper,
                                        this._evaluator,
                                        classResults?.classType
                                    ).find((doc) => doc);
                                }
                            } else if (primaryDecl?.type === DeclarationType.Function) {
                                // @property functions
                                documentation = getPropertyDocStringInherited(
                                    primaryDecl,
                                    this._sourceMapper,
                                    this._evaluator
                                );
                            } else if (primaryDecl?.type === DeclarationType.Variable) {
                                const decl = (symbol
                                    .getDeclarations()
                                    .find((d) => d.type === DeclarationType.Variable && !!d.docString) ??
                                    primaryDecl) as VariableDeclaration;
                                documentation = getVariableDocString(decl, this._sourceMapper);
                            }

                            if (this._options.format === MarkupKind.Markdown) {
                                let markdownString = '```python\n' + typeDetail + '\n```\n';

                                if (documentation) {
                                    markdownString += '---\n';
                                    markdownString += convertDocStringToMarkdown(documentation);
                                }

                                markdownString = markdownString.trimEnd();

                                this._itemToResolve.documentation = {
                                    kind: MarkupKind.Markdown,
                                    value: markdownString,
                                };
                            } else if (this._options.format === MarkupKind.PlainText) {
                                let plainTextString = typeDetail + '\n';

                                if (documentation) {
                                    plainTextString += '\n';
                                    plainTextString += convertDocStringToPlainText(documentation);
                                }

                                plainTextString = plainTextString.trimEnd();

                                this._itemToResolve.documentation = {
                                    kind: MarkupKind.PlainText,
                                    value: plainTextString,
                                };
                            } else {
                                fail(`Unsupported markup type: ${this._options.format}`);
                            }
                        }
                    }
                }
            }

            const autoImportText = detail.autoImportSource
                ? this._getAutoImportText(name, detail.autoImportSource, detail.autoImportAlias)
                : undefined;

            this._addNameToCompletionList(detail.autoImportAlias ?? name, itemKind, priorWord, completionList, {
                autoImportText,
                funcParensDisabled: detail.funcParensDisabled,
                edits: detail.edits,
            });
        } else {
            // Does the symbol have no declaration but instead has a synthesized type?
            const synthesizedType = symbol.getSynthesizedType();
            if (synthesizedType) {
                const itemKind: CompletionItemKind = CompletionItemKind.Variable;
                this._addNameToCompletionList(name, itemKind, priorWord, completionList, {
                    funcParensDisabled: detail.funcParensDisabled,
                    edits: detail.edits,
                });
            }
        }
    }

    private _getAutoImportText(importName: string, importFrom?: string, importAlias?: string) {
        const autoImportText = getAutoImportText(importName, importFrom, importAlias);

        if (this._options.format === MarkupKind.Markdown) {
            return `\`\`\`\n${autoImportText}\n\`\`\``;
        } else if (this._options.format === MarkupKind.PlainText) {
            return autoImportText;
        } else {
            fail(`Unsupported markup type: ${this._options.format}`);
        }
    }

    private _addNameToCompletionList(
        name: string,
        itemKind: CompletionItemKind,
        filter: string,
        completionList: CompletionList,
        detail?: CompletionDetail
    ) {
        // Auto importer already filtered out unnecessary ones. No need to do it again.
        const similarity = detail?.autoImportText ? true : StringUtils.isPatternInSymbol(filter, name);
        if (!similarity) {
            return;
        }

        const completionItem = CompletionItem.create(name);
        completionItem.kind = itemKind;

        const completionItemData: CompletionItemData = {
            workspacePath: this._workspacePath,
            filePath: this._filePath,
            position: this._position,
        };

        if (detail?.funcParensDisabled) {
            completionItemData.funcParensDisabled = true;
        }

        completionItem.data = completionItemData;

        if (detail?.sortText || detail?.itemDetail) {
            completionItem.sortText = detail.sortText;
            completionItem.detail = detail.itemDetail;
        } else if (detail?.autoImportText) {
            // Force auto-import entries to the end.
            completionItem.sortText = this._makeSortText(SortCategory.AutoImport, name, detail.autoImportText);
            completionItemData.autoImportText = detail.autoImportText;
            completionItem.detail = autoImportDetail;
        } else if (itemKind === CompletionItemKind.EnumMember) {
            // Handle enum members separately so they are sorted above other symbols.
            completionItem.sortText = this._makeSortText(SortCategory.EnumMember, name);
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

        if (this._options.format === MarkupKind.Markdown) {
            let markdownString = '';

            if (detail?.autoImportText) {
                markdownString += detail.autoImportText;
                if (detail.typeDetail || detail.documentation) {
                    // Micro perf optimization to not create new string from trimEnd.
                    markdownString += '\n\n';
                }
            }

            if (detail?.typeDetail) {
                markdownString += '```python\n' + detail.typeDetail + '\n```\n';
            }

            if (detail?.documentation) {
                markdownString += '---\n';
                markdownString += convertDocStringToMarkdown(detail.documentation);
            }

            markdownString = markdownString.trimEnd();

            if (markdownString) {
                completionItem.documentation = {
                    kind: MarkupKind.Markdown,
                    value: markdownString,
                };
            }
        } else if (this._options.format === MarkupKind.PlainText) {
            let plainTextString = '';

            if (detail?.autoImportText) {
                plainTextString += detail.autoImportText;
                if (detail.typeDetail || detail.documentation) {
                    // Micro perf optimization to not create new string from trimEnd.
                    plainTextString += '\n\n';
                }
            }

            if (detail?.typeDetail) {
                plainTextString += detail.typeDetail + '\n';
            }

            if (detail?.documentation) {
                plainTextString += '\n' + convertDocStringToPlainText(detail.documentation);
            }

            plainTextString = plainTextString.trimEnd();

            if (plainTextString) {
                completionItem.documentation = {
                    kind: MarkupKind.PlainText,
                    value: plainTextString,
                };
            }
        } else {
            fail(`Unsupported markup type: ${this._options.format}`);
        }

        if (detail?.edits?.format) {
            completionItem.insertTextFormat = detail.edits.format;
        }

        if (detail?.edits?.textEdit) {
            completionItem.textEdit = detail.edits.textEdit;
        }

        if (detail?.edits?.additionalTextEdits) {
            completionItem.additionalTextEdits = detail.edits.additionalTextEdits.map((te) => {
                const textEdit: TextEdit = {
                    range: {
                        start: { line: te.range.start.line, character: te.range.start.character },
                        end: { line: te.range.end.line, character: te.range.end.character },
                    },
                    newText: te.replacementText,
                };
                return textEdit;
            });

            if (this._itemToResolve) {
                const data = this._itemToResolve.data as CompletionItemData;
                if (data.autoImportText === completionItemData.autoImportText) {
                    this._itemToResolve.additionalTextEdits = completionItem.additionalTextEdits;
                }
            }
        }

        completionList.items.push(completionItem);
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
        const moduleDescriptor: ImportedModuleDescriptor = {
            leadingDots: node.leadingDots,
            hasTrailingDot: node.hasTrailingDot || false,
            nameParts: node.nameParts.map((part) => part.value),
            importedSymbols: [],
        };

        const completions = this._importResolver.getCompletionSuggestions(
            this._filePath,
            this._execEnv,
            moduleDescriptor
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
