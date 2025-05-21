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

import * as AnalyzerNodeInfo from '../analyzer/analyzerNodeInfo';
import {
    Declaration,
    DeclarationType,
    FunctionDeclaration,
    isIntrinsicDeclaration,
    isVariableDeclaration,
    VariableDeclaration,
} from '../analyzer/declaration';
import { isDefinedInFile } from '../analyzer/declarationUtils';
import { transformTypeForEnumMember } from '../analyzer/enums';
import { ImportedModuleDescriptor, ImportResolver } from '../analyzer/importResolver';
import { ImportResult } from '../analyzer/importResult';
import { getParamListDetails, ParamKind } from '../analyzer/parameterUtils';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import { getCallNodeAndActiveParamIndex } from '../analyzer/parseTreeUtils';
import { getScopeForNode } from '../analyzer/scopeUtils';
import { isStubFile, SourceMapper } from '../analyzer/sourceMapper';
import { Symbol, SymbolTable } from '../analyzer/symbol';
import * as SymbolNameUtils from '../analyzer/symbolNameUtils';
import { getLastTypedDeclarationForSymbol, isVisibleExternally } from '../analyzer/symbolUtils';
import { getTypedDictMembersForClass } from '../analyzer/typedDicts';
import { getModuleDocStringFromUris, isBuiltInModule } from '../analyzer/typeDocStringUtils';
import { CallSignatureInfo, TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import { printLiteralValue } from '../analyzer/typePrinter';
import {
    ClassType,
    combineTypes,
    EnumLiteral,
    FunctionType,
    isClass,
    isClassInstance,
    isFunction,
    isFunctionOrOverloaded,
    isInstantiableClass,
    isModule,
    isUnknown,
    Type,
    TypeBase,
    TypeCategory,
} from '../analyzer/types';
import {
    containsLiteralType,
    doForEachSignature,
    doForEachSubtype,
    getMembersForClass,
    getMembersForModule,
    isLiteralType,
    isMaybeDescriptorInstance,
    isNoneInstance,
    lookUpClassMember,
    MemberAccessFlags,
} from '../analyzer/typeUtils';
import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { appendArray } from '../common/collectionUtils';
import { ExecutionEnvironment } from '../common/configOptions';
import * as debug from '../common/debug';
import { fail } from '../common/debug';
import { ProgramView } from '../common/extensibility';
import { fromLSPAny, toLSPAny } from '../common/lspUtils';
import { convertOffsetToPosition, convertPositionToOffset } from '../common/positionUtils';
import { PythonVersion, pythonVersion3_10, pythonVersion3_5 } from '../common/pythonVersion';
import '../common/serviceProviderExtensions';
import * as StringUtils from '../common/stringUtils';
import { comparePositions, Position, TextRange } from '../common/textRange';
import { TextRangeCollection } from '../common/textRangeCollection';
import { Uri } from '../common/uri/uri';
import { convertToTextEdits } from '../common/workspaceEditUtils';
import { Localizer } from '../localization/localize';
import {
    ArgCategory,
    DecoratorNode,
    DictionaryKeyEntryNode,
    DictionaryNode,
    ErrorExpressionCategory,
    ErrorNode,
    ExpressionNode,
    FormatStringNode,
    ImportFromNode,
    IndexNode,
    isExpressionNode,
    ModuleNameNode,
    NameNode,
    ParamCategory,
    ParameterNode,
    ParseNode,
    ParseNodeType,
    SetNode,
    StringNode,
    TypeAnnotationNode,
} from '../parser/parseNodes';
import { ParseFileResults } from '../parser/parser';
import { Tokenizer } from '../parser/tokenizer';
import {
    FStringStartToken,
    OperatorToken,
    OperatorType,
    StringToken,
    StringTokenFlags,
    Token,
    TokenType,
} from '../parser/tokenizerTypes';
import { AutoImporter, AutoImportResult, buildModuleSymbolsMap } from './autoImporter';
import {
    CompletionDetail,
    getCompletionItemDocumentation,
    getTypeDetail,
    SymbolDetail,
} from './completionProviderUtils';
import { DocumentSymbolCollector } from './documentSymbolCollector';
import { getAutoImportText, getDocumentationPartsForTypeAndDecl } from './tooltipUtils';

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
        'type',
        'while',
        'with',
    ];

    const python3_5: string[] = [...base, 'async', 'await'];

    const python3_10: string[] = [...python3_5, 'case', 'match'];

    export function forVersion(version: PythonVersion): string[] {
        if (PythonVersion.isGreaterOrEqualTo(version, pythonVersion3_10)) {
            return python3_10;
        }
        if (PythonVersion.isGreaterOrEqualTo(version, pythonVersion3_5)) {
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
    uri: string; // Have to be strings because this data is passed across the LSP boundary.
    position: Position;
    autoImportText?: string;
    symbolLabel?: string;
    funcParensDisabled?: boolean;
    moduleUri?: string;
}

export interface CompletionOptions {
    readonly format: MarkupKind;
    readonly snippet: boolean;
    readonly lazyEdit: boolean;
    readonly triggerCharacter?: string;
}

interface RecentCompletionInfo {
    label: string;
    autoImportText: string;
}

interface QuoteInfo {
    priorWord: string;
    priorText: string;
    filterText: string | undefined;
    stringValue: string | undefined;
    quoteCharacter: string;
}

export const autoImportDetail = Localizer.Completion.autoImportDetail();
export const indexValueDetail = Localizer.Completion.indexValueDetail();

// We'll use a somewhat-arbitrary cutoff value here to determine
// whether it's sufficiently similar.
const similarityLimit = 0.25;

// We'll remember this many completions in the MRU list.
const maxRecentCompletions = 128;

export class CompletionProvider {
    private static _mostRecentCompletions: RecentCompletionInfo[] = [];

    // Indicates whether invocation position is inside of string literal
    // token or an f-string expression.
    private _stringLiteralContainer: StringToken | FStringStartToken | undefined = undefined;

    protected readonly execEnv: ExecutionEnvironment;
    protected readonly parseResults: ParseFileResults;
    protected readonly sourceMapper: SourceMapper;

    // If we're being asked to resolve a completion item, we run the
    // original completion algorithm and look for this symbol.
    protected itemToResolve: CompletionItem | undefined;

    constructor(
        protected readonly program: ProgramView,
        protected readonly fileUri: Uri,
        protected readonly position: Position,
        protected readonly options: CompletionOptions,
        protected readonly cancellationToken: CancellationToken
    ) {
        this.execEnv = this.configOptions.findExecEnvironment(this.fileUri);

        this.parseResults = this.program.getParseResults(this.fileUri)!;
        this.sourceMapper = this.program.getSourceMapper(this.fileUri, this.cancellationToken, /* mapCompiled */ true);
    }

    getCompletions(): CompletionList | null {
        if (!this.program.getSourceFileInfo(this.fileUri)) {
            return null;
        }

        const completionMap = this._getCompletions();
        return CompletionList.create(completionMap?.toArray());
    }

    // When the user selects a completion, this callback is invoked,
    // allowing us to record what was selected. This allows us to
    // build our MRU cache so we can better predict entries.
    resolveCompletionItem(completionItem: CompletionItem) {
        throwIfCancellationRequested(this.cancellationToken);

        const completionItemData = this.getCompletionItemData(completionItem);

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

        if (!completionItemData.symbolLabel) {
            return;
        }

        if (
            completionItemData.moduleUri &&
            ImportResolver.isSupportedImportSourceFile(
                Uri.parse(completionItemData.moduleUri, this.program.serviceProvider)
            )
        ) {
            const moduleUri = Uri.parse(completionItemData.moduleUri, this.program.serviceProvider);
            const documentation = getModuleDocStringFromUris([moduleUri], this.sourceMapper);
            if (!documentation) {
                return;
            }

            if (this.options.format === MarkupKind.Markdown) {
                const markdownString = this.program.serviceProvider
                    .docStringService()
                    .convertDocStringToMarkdown(documentation, isBuiltInModule(moduleUri));
                completionItem.documentation = {
                    kind: MarkupKind.Markdown,
                    value: markdownString,
                };
            } else if (this.options.format === MarkupKind.PlainText) {
                const plainTextString = this.program.serviceProvider
                    .docStringService()
                    .convertDocStringToPlainText(documentation);
                completionItem.documentation = {
                    kind: MarkupKind.PlainText,
                    value: plainTextString,
                };
            }
            return;
        }

        this.itemToResolve = completionItem;
        if (!completionItemData.autoImportText) {
            // Rerun the completion lookup. It will fill in additional information
            // about the item to be resolved. We'll ignore the rest of the returned
            // list. This is a bit wasteful, but all of that information should be
            // cached, so it's not as bad as it might seem.
            this.getCompletions();
        } else if (!completionItem.additionalTextEdits) {
            const completionMap = new CompletionMap();
            this.addAutoImportCompletions(
                completionItemData.symbolLabel,
                /* similarityLimit */ 1,
                /* lazyEdit */ false,
                completionMap
            );
        }
    }

    protected get evaluator() {
        return this.program.evaluator!;
    }

    protected get importResolver() {
        return this.program.importResolver;
    }

    protected get configOptions() {
        return this.program.configOptions;
    }

    protected getCompletionItemData(item: CompletionItem): CompletionItemData {
        return fromLSPAny<CompletionItemData>(item.data);
    }

    protected getMethodOverrideCompletions(
        priorWord: string,
        partialName: NameNode,
        decorators?: DecoratorNode[]
    ): CompletionMap | undefined {
        const enclosingClass = ParseTreeUtils.getEnclosingClass(partialName, /* stopAtFunction */ true);
        if (!enclosingClass) {
            return undefined;
        }

        const classResults = this.evaluator.getTypeOfClass(enclosingClass);
        if (!classResults) {
            return undefined;
        }

        const symbolTable = new Map<string, Symbol>();
        for (let i = 1; i < classResults.classType.shared.mro.length; i++) {
            const mroClass = classResults.classType.shared.mro[i];
            if (isInstantiableClass(mroClass)) {
                getMembersForClass(mroClass, symbolTable, /* includeInstanceVars */ false);
            }
        }

        const staticmethod = decorators?.some((d) => ParseTreeUtils.checkDecorator(d, 'staticmethod')) ?? false;
        const classmethod = decorators?.some((d) => ParseTreeUtils.checkDecorator(d, 'classmethod')) ?? false;

        const completionMap = new CompletionMap();

        symbolTable.forEach((symbol, name) => {
            let decl = getLastTypedDeclarationForSymbol(symbol);
            if (decl && decl.type === DeclarationType.Function) {
                if (StringUtils.isPatternInSymbol(partialName.d.value, name)) {
                    const declaredType = this.evaluator.getTypeForDeclaration(decl)?.type;
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

                    // Special-case the "__init_subclass__" method because it's an implicit
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
                    if (isStubFile(this.fileUri)) {
                        text = `${methodSignature}: ...`;
                    } else {
                        const methodBody = this.printOverriddenMethodBody(
                            classResults.classType,
                            isDeclaredStaticMethod,
                            isProperty,
                            decl,
                            decl.node.d.isAsync
                        );
                        text = `${methodSignature}:\n${methodBody}`;
                    }

                    const textEdit = this.createReplaceEdits(priorWord, partialName, text);

                    this.addSymbol(name, symbol, partialName.d.value, completionMap, {
                        // method signature already contains ()
                        funcParensDisabled: true,
                        edits: {
                            format: this.options.snippet ? InsertTextFormat.Snippet : undefined,
                            textEdit,
                        },
                    });
                }
            }
        });

        return completionMap;
    }

    protected printOverriddenMethodBody(
        classType: ClassType,
        isStaticMethod: boolean,
        isProperty: boolean,
        decl: FunctionDeclaration,
        insertAwait?: boolean
    ) {
        let sb = this.parseResults.tokenizerOutput.predominantTabSequence;

        if (
            classType.shared.baseClasses.length === 1 &&
            isClass(classType.shared.baseClasses[0]) &&
            classType.shared.baseClasses[0].shared.fullName === 'builtins.object'
        ) {
            sb += this.options.snippet ? '${0:pass}' : 'pass';
            return sb;
        }

        if (decl.node.d.params.length === 0) {
            sb += this.options.snippet ? '${0:pass}' : 'pass';
            return sb;
        }

        const parameters = getParameters(isStaticMethod ? decl.node.d.params : decl.node.d.params.slice(1));
        if (decl.node.d.name.d.value !== '__init__') {
            sb += 'return ';
        }

        if (insertAwait) {
            sb += 'await ';
        }

        if (isProperty) {
            return sb + `super().${decl.node.d.name.d.value}`;
        }

        return sb + `super().${decl.node.d.name.d.value}(${parameters.map(convertToString).join(', ')})`;

        function getParameters(parameters: ParameterNode[]) {
            const results: [node: ParameterNode, keywordOnly: boolean][] = [];

            let sawKeywordOnlySeparator = false;
            for (const parameter of parameters) {
                if (parameter.d.name) {
                    results.push([
                        parameter,
                        parameter.d.category === ParamCategory.Simple && !!parameter.d.name && sawKeywordOnlySeparator,
                    ]);
                }

                // All simple parameters after a `*` or `*args` parameter
                // are considered keyword only.
                if (parameter.d.category === ParamCategory.ArgsList) {
                    sawKeywordOnlySeparator = true;
                }
            }

            return results;
        }

        function convertToString(parameter: [node: ParameterNode, keywordOnly: boolean]) {
            const name = parameter[0].d.name?.d.value;
            if (parameter[0].d.category === ParamCategory.ArgsList) {
                return `*${name}`;
            }

            if (parameter[0].d.category === ParamCategory.KwargsDict) {
                return `**${name}`;
            }

            return parameter[1] ? `${name}=${name}` : name;
        }
    }

    protected createReplaceEdits(priorWord: string, node: ParseNode | undefined, text: string) {
        const replaceOrInsertEndChar =
            node?.nodeType === ParseNodeType.Name
                ? this.position.character - priorWord.length + node.d.value.length
                : this.position.character;

        const range: Range = {
            start: { line: this.position.line, character: this.position.character - priorWord.length },
            end: { line: this.position.line, character: replaceOrInsertEndChar },
        };

        return TextEdit.replace(range, text);
    }

    protected shouldProcessDeclaration(declaration: Declaration | undefined) {
        // By default, we allow all symbol/decl to be included in the completion.
        return true;
    }

    protected addSymbol(
        name: string,
        symbol: Symbol,
        priorWord: string,
        completionMap: CompletionMap,
        detail: SymbolDetail
    ) {
        // Make sure we don't crash due to OOM.
        this.program.handleMemoryHighUsage();

        let primaryDecl = getLastTypedDeclarationForSymbol(symbol);
        if (!primaryDecl) {
            const declarations = symbol.getDeclarations();
            if (declarations.length > 0) {
                primaryDecl = declarations[declarations.length - 1];
            }
        }

        if (!this.shouldProcessDeclaration(primaryDecl)) {
            return;
        }

        primaryDecl = primaryDecl
            ? this.evaluator.resolveAliasDeclaration(primaryDecl, /* resolveLocalNames */ true) ?? primaryDecl
            : undefined;

        const autoImportText = detail.autoImportSource
            ? this.getAutoImportText(name, detail.autoImportSource, detail.autoImportAlias)
            : undefined;

        // Are we resolving a completion item? If so, see if this symbol
        // is the one that we're trying to match.
        if (this.itemToResolve) {
            const completionItemData = this.getCompletionItemData(this.itemToResolve);

            if (completionItemData.symbolLabel !== name) {
                // It's not what we are looking for.
                return;
            }

            if (
                this.itemToResolve.additionalTextEdits === undefined &&
                detail.edits?.additionalTextEdits !== undefined
            ) {
                this.itemToResolve.additionalTextEdits = convertToTextEdits(detail.edits.additionalTextEdits);
            }

            if (completionItemData.autoImportText) {
                return;
            }

            // This call can be expensive to perform on every completion item
            // that we return, so we do it lazily in the "resolve" callback.
            const type = this.evaluator.getEffectiveTypeOfSymbol(symbol);
            if (!type) {
                // Can't resolve. so bail out.
                return;
            }

            const typeDetail = getTypeDetail(
                this.evaluator,
                type,
                primaryDecl,
                name,
                detail,
                this.configOptions.functionSignatureDisplay
            );
            const documentation = getDocumentationPartsForTypeAndDecl(
                this.sourceMapper,
                type,
                primaryDecl,
                this.evaluator,
                {
                    name,
                    symbol,
                    boundObjectOrClass: detail.boundObjectOrClass,
                }
            );

            if (this.options.format === MarkupKind.Markdown || this.options.format === MarkupKind.PlainText) {
                this.itemToResolve.documentation = getCompletionItemDocumentation(
                    this.program.serviceProvider,
                    typeDetail,
                    documentation,
                    this.options.format,
                    primaryDecl
                );
            } else {
                fail(`Unsupported markup type: ${this.options.format}`);
            }

            // Bail out. We don't need to add items to completion.
            return;
        }

        if (primaryDecl) {
            let itemKind = this._convertDeclarationTypeToItemKind(primaryDecl);

            // Handle enum members specially. Enum members normally look like
            // variables, but the are declared using assignment expressions
            // within an enum class.
            if (this._isEnumMember(detail.boundObjectOrClass, name)) {
                itemKind = CompletionItemKind.EnumMember;
            }

            this.addNameToCompletions(detail.autoImportAlias ?? name, itemKind, priorWord, completionMap, {
                autoImportText,
                extraCommitChars: detail.extraCommitChars,
                funcParensDisabled: detail.funcParensDisabled,
                edits: detail.edits,
            });
        } else {
            // Does the symbol have no declaration but instead has a synthesized type?
            const synthesizedType = symbol.getSynthesizedType()?.type;
            if (synthesizedType) {
                const itemKind: CompletionItemKind = this._convertTypeToItemKind(synthesizedType);
                this.addNameToCompletions(name, itemKind, priorWord, completionMap, {
                    extraCommitChars: detail.extraCommitChars,
                    funcParensDisabled: detail.funcParensDisabled,
                    edits: detail.edits,
                });
            }
        }
    }

    protected getMemberAccessCompletions(leftExprNode: ExpressionNode, priorWord: string): CompletionMap | undefined {
        const symbolTable = new Map<string, Symbol>();
        const completionMap = new CompletionMap();

        let leftType = this.evaluator.getType(leftExprNode);
        if (!leftType) {
            return completionMap;
        }

        leftType = this.evaluator.makeTopLevelTypeVarsConcrete(leftType);

        // If this is an unknown type with a "possible type" associated with
        // it, use the possible type.
        if (isUnknown(leftType) && leftType.priv.possibleType) {
            leftType = this.evaluator.makeTopLevelTypeVarsConcrete(leftType.priv.possibleType);
        }

        doForEachSubtype(leftType, (subtype) => {
            subtype = this.evaluator.makeTopLevelTypeVarsConcrete(subtype);

            if (isClass(subtype)) {
                const instance = TypeBase.isInstance(subtype);
                getMembersForClass(subtype, symbolTable, instance);

                if (ClassType.isEnumClass(subtype) && instance) {
                    // Don't show enum member out of another enum member
                    // ex) Enum.Member. <= shouldn't show `Member` again.
                    for (const name of symbolTable.keys()) {
                        if (this._isEnumMember(subtype, name)) {
                            symbolTable.delete(name);
                        }
                    }
                }
            } else if (isModule(subtype)) {
                getMembersForModule(subtype, symbolTable);
            } else if (isFunctionOrOverloaded(subtype)) {
                const functionClass = this.evaluator.getBuiltInType(leftExprNode, 'function');
                if (functionClass && isInstantiableClass(functionClass)) {
                    getMembersForClass(functionClass, symbolTable, /* includeInstanceVars */ true);
                }
            } else if (isNoneInstance(subtype)) {
                const objectClass = this.evaluator.getBuiltInType(leftExprNode, 'object');
                if (objectClass && isInstantiableClass(objectClass)) {
                    getMembersForClass(objectClass, symbolTable, TypeBase.isInstance(subtype));
                }
            }

            this._addSymbolsForSymbolTable(
                symbolTable,
                () => true,
                priorWord,
                leftExprNode,
                /* isInImport */ false,
                isClass(subtype) ? subtype : undefined,
                completionMap
            );
        });

        return completionMap;
    }

    protected createAutoImporter(completionMap: CompletionMap, lazyEdit: boolean) {
        const currentFile = this.program.getSourceFileInfo(this.fileUri);
        const moduleSymbolMap = buildModuleSymbolsMap(
            this.program,
            this.program.getSourceFileInfoList().filter((s) => s !== currentFile)
        );

        return new AutoImporter(
            this.program,
            this.execEnv,
            this.parseResults,
            this.position,
            completionMap,
            moduleSymbolMap,
            {
                lazyEdit,
            }
        );
    }

    protected addAutoImportCompletions(
        priorWord: string,
        similarityLimit: number,
        lazyEdit: boolean,
        completionMap: CompletionMap,
        parensDisabled?: boolean
    ) {
        if (!this.configOptions.autoImportCompletions) {
            // If auto import on the server is turned off or this particular invocation
            // is turned off (ex, notebook), don't do any thing.
            return;
        }

        const autoImporter = this.createAutoImporter(completionMap, lazyEdit);

        const results: AutoImportResult[] = [];
        appendArray(
            results,
            autoImporter.getAutoImportCandidates(
                priorWord,
                similarityLimit,
                /* abbrFromUsers */ undefined,
                this.cancellationToken
            )
        );

        this.addImportResults(results, priorWord, completionMap, parensDisabled);
    }

    protected addImportResults(
        results: AutoImportResult[],
        priorWord: string,
        completionMap: CompletionMap,
        parensDisabled?: boolean
    ) {
        for (const result of results) {
            if (result.symbol) {
                this.addSymbol(result.name, result.symbol, priorWord, completionMap, {
                    extraCommitChars: true,
                    autoImportSource: result.source,
                    autoImportAlias: result.alias,
                    edits: {
                        textEdit: this.createReplaceEdits(priorWord, /* node */ undefined, result.insertionText),
                        additionalTextEdits: result.edits,
                    },
                    funcParensDisabled: parensDisabled,
                });
            } else {
                this.addNameToCompletions(
                    result.alias ?? result.name,
                    result.kind ?? CompletionItemKind.Module,
                    priorWord,
                    completionMap,
                    {
                        extraCommitChars: true,
                        autoImportText: this.getAutoImportText(result.name, result.source, result.alias),
                        edits: {
                            textEdit: this.createReplaceEdits(priorWord, /* node */ undefined, result.insertionText),
                            additionalTextEdits: result.edits,
                        },
                        funcParensDisabled: parensDisabled,
                    }
                );
            }
        }
    }

    protected addExtraCommitChar(item: CompletionItem) {
        // extra commit char is not supported.
    }

    protected addNameToCompletions(
        name: string,
        itemKind: CompletionItemKind,
        filter: string,
        completionMap: CompletionMap,
        detail?: CompletionDetail
    ) {
        // Auto importer already filtered out unnecessary ones. No need to do it again.
        const similarity = detail?.autoImportText ? true : StringUtils.isPatternInSymbol(filter, name);
        if (!similarity) {
            return;
        }

        if (
            completionMap.has(
                name,
                (i) => CompletionMap.matchKindAndImportText(i, this.getCompletionItemData.bind(this), itemKind),
                itemKind,
                detail?.autoImportText?.importText
            )
        ) {
            return;
        }

        const completionItem = CompletionItem.create(name);
        completionItem.kind = itemKind;

        if (detail?.extraCommitChars) {
            this.addExtraCommitChar(completionItem);
        }

        const completionItemData: CompletionItemData = {
            uri: this.fileUri.toString(),
            position: this.position,
        };

        if (detail?.funcParensDisabled || !this.options.snippet) {
            completionItemData.funcParensDisabled = true;
        }

        if (detail?.moduleUri) {
            completionItemData.moduleUri = detail.moduleUri.toString();
        }

        completionItem.data = toLSPAny(completionItemData);

        if (detail?.sortText || detail?.itemDetail) {
            completionItem.sortText = detail.sortText;
            completionItem.detail = detail.itemDetail;
        } else if (detail?.autoImportText) {
            // Force auto-import entries to the end.
            completionItem.sortText = this._makeSortText(
                SortCategory.AutoImport,
                `${name}.${this._formatInteger(detail.autoImportText.source.length, 2)}.${
                    detail.autoImportText.source
                }`,
                detail.autoImportText.importText
            );
            completionItemData.autoImportText = detail.autoImportText.importText;
            completionItem.detail = autoImportDetail;

            if (detail.autoImportText.source) {
                completionItem.labelDetails = { description: detail.autoImportText.source };
            }
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

        if (this.options.format === MarkupKind.Markdown) {
            let markdownString = '';

            if (detail?.autoImportText) {
                markdownString += detail.autoImportText.importText;
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
                markdownString += this.program.serviceProvider
                    .docStringService()
                    .convertDocStringToMarkdown(detail.documentation, isBuiltInModule(detail.moduleUri));
            }

            markdownString = markdownString.trimEnd();

            if (markdownString) {
                completionItem.documentation = {
                    kind: MarkupKind.Markdown,
                    value: markdownString,
                };
            }
        } else if (this.options.format === MarkupKind.PlainText) {
            let plainTextString = '';

            if (detail?.autoImportText) {
                plainTextString += detail.autoImportText.importText;
                if (detail.typeDetail || detail.documentation) {
                    // Micro perf optimization to not create new string from trimEnd.
                    plainTextString += '\n\n';
                }
            }

            if (detail?.typeDetail) {
                plainTextString += detail.typeDetail + '\n';
            }

            if (detail?.documentation) {
                plainTextString +=
                    '\n' +
                    this.program.serviceProvider.docStringService().convertDocStringToPlainText(detail.documentation);
            }

            plainTextString = plainTextString.trimEnd();

            if (plainTextString) {
                completionItem.documentation = {
                    kind: MarkupKind.PlainText,
                    value: plainTextString,
                };
            }
        } else {
            fail(`Unsupported markup type: ${this.options.format}`);
        }

        if (detail?.edits?.format) {
            completionItem.insertTextFormat = detail.edits.format;
        }

        if (detail?.edits?.textEdit) {
            completionItem.textEdit = detail.edits.textEdit;
        }

        if (detail?.edits?.additionalTextEdits) {
            completionItem.additionalTextEdits = convertToTextEdits(detail.edits.additionalTextEdits);

            // This is for auto import entries from indices which skip symbols.
            if (this.itemToResolve) {
                const data = this.getCompletionItemData(this.itemToResolve);
                if (data.autoImportText === completionItemData.autoImportText) {
                    this.itemToResolve.additionalTextEdits = completionItem.additionalTextEdits;
                }
            }
        }

        completionMap.set(completionItem);
    }

    protected getAutoImportText(importName: string, importFrom?: string, importAlias?: string) {
        const autoImportText = getAutoImportText(importName, importFrom, importAlias);

        let importText = '';
        if (this.options.format === MarkupKind.Markdown) {
            importText = `\`\`\`\n${autoImportText}\n\`\`\``;
        } else if (this.options.format === MarkupKind.PlainText) {
            importText = autoImportText;
        } else {
            fail(`Unsupported markup type: ${this.options.format}`);
        }

        return {
            source: importFrom ?? '',
            importText,
        };
    }

    private get _fileContents() {
        return this.parseResults?.text ?? '';
    }

    private _getCompletions(): CompletionMap | undefined {
        const offset = convertPositionToOffset(this.position, this.parseResults.tokenizerOutput.lines);
        if (offset === undefined) {
            return undefined;
        }

        let node = ParseTreeUtils.findNodeByOffset(this.parseResults.parserOutput.parseTree, offset);

        // See if we're inside a string literal or an f-string statement.
        const token = ParseTreeUtils.getTokenOverlapping(this.parseResults.tokenizerOutput.tokens, offset);
        if (token?.type === TokenType.String) {
            const stringToken = token as StringToken;
            this._stringLiteralContainer = TextRange.contains(stringToken, offset)
                ? stringToken
                : stringToken.flags & StringTokenFlags.Unterminated
                ? stringToken
                : undefined;
        } else if (node) {
            const fStringContainer = ParseTreeUtils.getParentNodeOfType<FormatStringNode>(
                node,
                ParseNodeType.FormatString
            );
            if (fStringContainer) {
                this._stringLiteralContainer = fStringContainer.d.token;
            }
        }

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

                const curNode = ParseTreeUtils.findNodeByOffset(this.parseResults.parserOutput.parseTree, curOffset);
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
        const lineTextRange = this.parseResults.tokenizerOutput.lines.getItemAt(this.position.line);
        const textOnLine = this._fileContents.substr(lineTextRange.start, lineTextRange.length);
        const priorText = textOnLine.substr(0, this.position.character);
        const postText = textOnLine.substr(this.position.character);
        const priorWordIndex = priorText.search(/[\p{L}\p{N}\p{Pc}\p{Mn}\p{Mc}]+$/u);
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
            throwIfCancellationRequested(this.cancellationToken);

            if (curNode.nodeType === ParseNodeType.String) {
                return this._getLiteralCompletions(curNode, offset, priorWord, priorText, postText);
            }

            if (curNode.nodeType === ParseNodeType.StringList || curNode.nodeType === ParseNodeType.FormatString) {
                return undefined;
            }

            if (curNode.nodeType === ParseNodeType.ModuleName) {
                return this._getImportModuleCompletions(curNode);
            }

            if (curNode.nodeType === ParseNodeType.Error) {
                return this._getExpressionErrorCompletions(curNode, offset, priorWord, priorText, postText);
            }

            if (curNode.nodeType === ParseNodeType.MemberAccess) {
                return this.getMemberAccessCompletions(curNode.d.leftExpr, priorWord);
            }

            if (curNode.nodeType === ParseNodeType.Dictionary) {
                const completionMap = new CompletionMap();
                if (
                    this._tryAddTypedDictKeysFromDictionary(
                        curNode,
                        /* stringNode */ undefined,
                        priorWord,
                        priorText,
                        postText,
                        completionMap
                    )
                ) {
                    return completionMap;
                }
            }

            const dictionaryEntry = ParseTreeUtils.getFirstAncestorOrSelfOfKind(
                curNode,
                ParseNodeType.DictionaryKeyEntry
            );
            if (dictionaryEntry) {
                if (dictionaryEntry.parent?.nodeType === ParseNodeType.Dictionary) {
                    const dictionaryNode = dictionaryEntry.parent;
                    if (dictionaryNode.d.trailingCommaToken && dictionaryNode.d.trailingCommaToken.start < offset) {
                        const completionMap = new CompletionMap();
                        if (
                            this._tryAddTypedDictKeysFromDictionary(
                                dictionaryNode,
                                /* stringNode */ undefined,
                                priorWord,
                                priorText,
                                postText,
                                completionMap
                            )
                        ) {
                            return completionMap;
                        }
                    }
                }
            }

            if (curNode.nodeType === ParseNodeType.Name) {
                // This condition is little different than others since it does its own
                // tree walk up to find context and let outer tree walk up to proceed if it can't find
                // one to show completion.
                const result = this._tryGetNameCompletions(curNode, offset, priorWord, priorText, postText);
                if (result || result === undefined) {
                    return result;
                }
            }

            if (curNode.nodeType === ParseNodeType.List && this.options.triggerCharacter === '[') {
                // If this is an empty list, don't start putting completions up yet.
                return undefined;
            }

            if (curNode.nodeType === ParseNodeType.ImportFrom) {
                return this._getImportFromCompletions(curNode, offset, priorWord);
            }

            if (isExpressionNode(curNode)) {
                return this._getExpressionCompletions(curNode, priorWord, priorText, postText);
            }

            if (curNode.nodeType === ParseNodeType.Suite) {
                if (
                    curNode.parent &&
                    curNode.parent.nodeType === ParseNodeType.Except &&
                    !curNode.parent.d.name &&
                    curNode.parent.d.typeExpr &&
                    TextRange.getEnd(curNode.parent.d.typeExpr) < offset &&
                    offset <= curNode.parent.d.exceptSuite.start
                ) {
                    // except Exception as [<empty>]
                    return undefined;
                }

                if (
                    curNode.parent &&
                    curNode.parent.nodeType === ParseNodeType.Class &&
                    (!curNode.parent.d.name || !curNode.parent.d.name.d.value) &&
                    curNode.parent.d.arguments.length === 0 &&
                    offset <= curNode.parent.d.suite.start
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

    // This method returns false if it wants the caller to walk up the
    // tree. It returns CompletionResults or undefined if it wants the
    // caller to return.
    private _tryGetNameCompletions(
        curNode: NameNode,
        offset: number,
        priorWord: string,
        priorText: string,
        postText: string
    ): false | CompletionMap | undefined {
        if (!curNode.parent) {
            return false;
        }

        if (curNode.parent.nodeType === ParseNodeType.ImportAs && curNode.parent.d.alias === curNode) {
            // Are we within a "import Y as [Z]"?
            return undefined;
        }

        if (curNode.parent.nodeType === ParseNodeType.ModuleName) {
            // Are we within a "import Y as [<empty>]"?
            if (
                curNode.parent.parent &&
                curNode.parent.parent.nodeType === ParseNodeType.ImportAs &&
                !curNode.parent.parent.d.alias &&
                TextRange.getEnd(curNode.parent.parent) < offset
            ) {
                return undefined;
            }

            // Are we within a "from X import Y as Z" statement and
            // more specifically within the "Y"?
            return this._getImportModuleCompletions(curNode.parent);
        }

        if (curNode.parent.nodeType === ParseNodeType.ImportFromAs) {
            if (curNode.parent.d.alias === curNode) {
                // Are we within a "from X import Y as [Z]"?
                return undefined;
            }

            const parentNode = curNode.parent.parent;
            if (parentNode && parentNode.nodeType === ParseNodeType.ImportFrom) {
                // Are we within a "from X import Y as [<empty>]"?
                if (!curNode.parent.d.alias && TextRange.getEnd(curNode.parent) < offset) {
                    return undefined;
                }

                if (curNode.parent.d.name === curNode) {
                    return this._getImportFromCompletions(parentNode, offset, priorWord);
                }

                return this._getImportFromCompletions(parentNode, offset, '');
            }

            return false;
        }

        if (curNode.parent.nodeType === ParseNodeType.MemberAccess && curNode === curNode.parent.d.member) {
            return this.getMemberAccessCompletions(curNode.parent.d.leftExpr, priorWord);
        }

        if (curNode.parent.nodeType === ParseNodeType.Except && curNode === curNode.parent.d.name) {
            return undefined;
        }

        if (curNode.parent.nodeType === ParseNodeType.Function && curNode === curNode.parent.d.name) {
            if (curNode.parent.d.decorators?.some((d) => this._isOverload(d))) {
                return this._getMethodOverloadsCompletions(priorWord, curNode);
            }

            return undefined;
        }

        if (curNode.parent.nodeType === ParseNodeType.Parameter && curNode === curNode.parent.d.name) {
            return undefined;
        }

        if (curNode.parent.nodeType === ParseNodeType.Class && curNode === curNode.parent.d.name) {
            return undefined;
        }

        if (
            curNode.parent.nodeType === ParseNodeType.For &&
            TextRange.contains(curNode.parent.d.targetExpr, curNode.start)
        ) {
            return undefined;
        }

        if (
            curNode.parent.nodeType === ParseNodeType.ComprehensionFor &&
            TextRange.contains(curNode.parent.d.targetExpr, curNode.start)
        ) {
            return undefined;
        }

        // For assignments that implicitly declare variables, remove itself (var decl) from completion.
        if (
            curNode.parent.nodeType === ParseNodeType.Assignment ||
            curNode.parent.nodeType === ParseNodeType.AssignmentExpression
        ) {
            const leftNode =
                curNode.parent.nodeType === ParseNodeType.AssignmentExpression
                    ? curNode.parent.d.name
                    : curNode.parent.d.leftExpr;

            if (leftNode !== curNode || priorWord.length === 0) {
                return false;
            }

            const decls = this.evaluator.getDeclInfoForNameNode(curNode)?.decls;
            if (decls?.length !== 1 || !isVariableDeclaration(decls[0]) || decls[0].node !== curNode) {
                return false;
            }

            const completionMap = this._getExpressionCompletions(curNode, priorWord, priorText, postText);
            if (completionMap) {
                completionMap.delete(curNode.d.value);
            }

            return completionMap;
        }

        // Defining class variables.
        // ex) class A:
        //         variable = 1
        if (
            curNode.parent.nodeType === ParseNodeType.StatementList &&
            curNode.parent.parent?.nodeType === ParseNodeType.Suite &&
            curNode.parent.parent.parent?.nodeType === ParseNodeType.Class
        ) {
            const completionList = this._getClassVariableCompletions(curNode);
            if (completionList) {
                return completionList;
            }
        }

        return false;
    }

    private _isWithinComment(offset: number): boolean {
        const token = getTokenAfter(offset, this.parseResults.tokenizerOutput.tokens);
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
        offset: number,
        priorWord: string,
        priorText: string,
        postText: string
    ): CompletionMap | undefined {
        // Is the error due to a missing member access name? If so,
        // we can evaluate the left side of the member access expression
        // to determine its type and offer suggestions based on it.
        switch (node.d.category) {
            case ErrorExpressionCategory.MissingIn: {
                return this._createSingleKeywordCompletion('in');
            }

            case ErrorExpressionCategory.MissingElse: {
                return this._createSingleKeywordCompletion('else');
            }

            case ErrorExpressionCategory.MissingMemberAccessName:
            case ErrorExpressionCategory.MissingExpression: {
                // Don't show completion after random dots.
                const tokenizerOutput = this.parseResults.tokenizerOutput;
                const offset = convertPositionToOffset(this.position, tokenizerOutput.lines);
                const index = ParseTreeUtils.getTokenIndexAtLeft(tokenizerOutput.tokens, offset!);
                const token = ParseTreeUtils.getTokenAtIndex(tokenizerOutput.tokens, index);
                const prevToken = ParseTreeUtils.getTokenAtIndex(tokenizerOutput.tokens, index - 1);

                if (node.d.category === ErrorExpressionCategory.MissingExpression) {
                    // Skip dots on expressions.
                    if (token?.type === TokenType.Dot || token?.type === TokenType.Ellipsis) {
                        break;
                    }

                    // ex) class MyType:
                    //         def is_str(self): ...
                    //     myType = MyType()
                    //
                    // In incomplete code such as "myType.is" <= "is" will be tokenized as keyword not identifier,
                    // so even if user's intention is writing "is_str", completion after "is" won't include "is_str"
                    // since parser won't see "is" as partially written member name instead it will see it as
                    // expression statement with missing expression after "is" keyword.
                    // In such case, use "MyType." to get completion.
                    if (token?.type !== TokenType.Keyword || TextRange.getEnd(token) !== offset) {
                        return this._getExpressionCompletions(node, priorWord, priorText, postText);
                    }

                    if (prevToken?.type !== TokenType.Dot) {
                        return this._getExpressionCompletions(node, priorWord, priorText, postText);
                    }

                    const previousOffset = TextRange.getEnd(prevToken);
                    const previousNode = ParseTreeUtils.findNodeByOffset(
                        this.parseResults.parserOutput.parseTree,
                        previousOffset
                    );
                    if (
                        previousNode?.nodeType !== ParseNodeType.Error ||
                        previousNode.d.category !== ErrorExpressionCategory.MissingMemberAccessName
                    ) {
                        return this._getExpressionCompletions(node, priorWord, priorText, postText);
                    } else {
                        // Update node to previous node so we get the member access completions.
                        node = previousNode;
                    }
                } else if (node.d.category === ErrorExpressionCategory.MissingMemberAccessName) {
                    // Skip double dots on member access.
                    if (
                        (token?.type === TokenType.Dot || token?.type === TokenType.Ellipsis) &&
                        (prevToken?.type === TokenType.Dot || prevToken?.type === TokenType.Ellipsis)
                    ) {
                        return undefined;
                    }
                }

                return this._getMissingMemberAccessNameCompletions(node, priorWord);
            }

            case ErrorExpressionCategory.MissingDecoratorCallName: {
                return this._getExpressionCompletions(node, priorWord, priorText, postText);
            }

            case ErrorExpressionCategory.MissingPattern:
            case ErrorExpressionCategory.MissingIndexOrSlice: {
                let completionResults = this._getLiteralCompletions(node, offset, priorWord, priorText, postText);

                if (!completionResults) {
                    completionResults = this._getExpressionCompletions(node, priorWord, priorText, postText);
                }

                return completionResults;
            }

            case ErrorExpressionCategory.MissingFunctionParameterList: {
                if (node.d.child && node.d.child.nodeType === ParseNodeType.Name) {
                    if (node.d.decorators?.some((d) => this._isOverload(d))) {
                        return this._getMethodOverloadsCompletions(priorWord, node.d.child);
                    }

                    // Determine if the partial name is a method that's overriding
                    // a method in a base class.
                    return this.getMethodOverrideCompletions(priorWord, node.d.child, node.d.decorators);
                }
                break;
            }

            case ErrorExpressionCategory.MissingTupleCloseParen: {
                return this._getExpressionCompletions(node, priorWord, priorText, postText);
            }
        }

        return undefined;
    }

    private _getMissingMemberAccessNameCompletions(node: ErrorNode, priorWord: string) {
        if (!node.d.child || !isExpressionNode(node.d.child)) {
            return undefined;
        }

        return this.getMemberAccessCompletions(node.d.child, priorWord);
    }

    private _isOverload(node: DecoratorNode): boolean {
        return ParseTreeUtils.checkDecorator(node, 'overload');
    }

    private _createSingleKeywordCompletion(keyword: string): CompletionMap {
        const completionItem = CompletionItem.create(keyword);
        completionItem.kind = CompletionItemKind.Keyword;
        completionItem.sortText = this._makeSortText(SortCategory.LikelyKeyword, keyword);
        const completionMap = new CompletionMap();
        completionMap.set(completionItem);
        return completionMap;
    }

    private _addClassVariableTypeAnnotationCompletions(
        priorWord: string,
        parseNode: ParseNode,
        completionMap: CompletionMap
    ): void {
        // class T:
        //    f: |<= here
        const isTypeAnnotationOfClassVariable =
            parseNode.parent?.nodeType === ParseNodeType.TypeAnnotation &&
            parseNode.parent.d.valueExpr.nodeType === ParseNodeType.Name &&
            parseNode.parent.d.annotation === parseNode &&
            parseNode.parent.parent?.nodeType === ParseNodeType.StatementList &&
            parseNode.parent.parent.parent?.nodeType === ParseNodeType.Suite &&
            parseNode.parent.parent.parent.parent?.nodeType === ParseNodeType.Class;

        if (!isTypeAnnotationOfClassVariable) {
            return;
        }

        const enclosingClass = ParseTreeUtils.getEnclosingClass(parseNode, false);
        if (!enclosingClass) {
            return;
        }

        const classResults = this.evaluator.getTypeOfClass(enclosingClass);
        if (!classResults) {
            return undefined;
        }

        const classVariableName = ((parseNode.parent as TypeAnnotationNode).d.valueExpr as NameNode).d.value;
        const classMember = lookUpClassMember(
            classResults.classType,
            classVariableName,
            MemberAccessFlags.SkipInstanceMembers | MemberAccessFlags.SkipOriginalClass
        );

        // First, see whether we can use semantic info to get variable type.
        if (classMember) {
            const memberType = this.evaluator.getTypeOfMember(classMember);

            const text = this.evaluator.printType(memberType, {
                enforcePythonSyntax: true,
                expandTypeAlias: false,
            });

            this.addNameToCompletions(text, CompletionItemKind.Reference, priorWord, completionMap, {
                sortText: this._makeSortText(SortCategory.LikelyKeyword, text),
            });
            return;
        }

        // If we can't do that using semantic info, then try syntactic info.
        const symbolTable = new Map<string, Symbol>();
        for (const mroClass of classResults.classType.shared.mro) {
            if (mroClass === classResults.classType) {
                // Ignore current type.
                continue;
            }

            if (isInstantiableClass(mroClass)) {
                getMembersForClass(mroClass, symbolTable, /* includeInstanceVars */ false);
            }
        }

        const symbol = symbolTable.get(classVariableName);
        if (!symbol) {
            return;
        }

        const decls = symbol
            .getDeclarations()
            .filter((d) => isVariableDeclaration(d) && d.moduleName !== 'builtins') as VariableDeclaration[];

        // Skip any symbols invalid such as defined in the same class.
        if (
            decls.length === 0 ||
            decls.some((d) => d.node && ParseTreeUtils.getEnclosingClass(d.node, false) === enclosingClass)
        ) {
            return;
        }

        const declWithTypeAnnotations = decls.filter((d) => d.typeAnnotationNode);
        if (declWithTypeAnnotations.length === 0) {
            return;
        }

        const printFlags = isStubFile(this.fileUri)
            ? ParseTreeUtils.PrintExpressionFlags.ForwardDeclarations |
              ParseTreeUtils.PrintExpressionFlags.DoNotLimitStringLength
            : ParseTreeUtils.PrintExpressionFlags.DoNotLimitStringLength;

        const text = `${ParseTreeUtils.printExpression(
            declWithTypeAnnotations[declWithTypeAnnotations.length - 1].typeAnnotationNode!,
            printFlags
        )}`;

        this.addNameToCompletions(text, CompletionItemKind.Reference, priorWord, completionMap, {
            sortText: this._makeSortText(SortCategory.LikelyKeyword, text),
        });
    }

    private _getClassVariableCompletions(partialName: NameNode): CompletionMap | undefined {
        const enclosingClass = ParseTreeUtils.getEnclosingClass(partialName, false);
        if (!enclosingClass) {
            return undefined;
        }

        const classResults = this.evaluator.getTypeOfClass(enclosingClass);
        if (!classResults) {
            return undefined;
        }

        const symbolTable = new Map<string, Symbol>();
        for (const mroClass of classResults.classType.shared.mro) {
            if (isInstantiableClass(mroClass)) {
                getMembersForClass(mroClass, symbolTable, /* includeInstanceVars */ false);
            }
        }

        const completionMap = new CompletionMap();
        symbolTable.forEach((symbol, name) => {
            if (
                SymbolNameUtils.isPrivateName(name) ||
                symbol.isPrivateMember() ||
                symbol.isExternallyHidden() ||
                !StringUtils.isPatternInSymbol(partialName.d.value, name)
            ) {
                return;
            }

            const decls = symbol
                .getDeclarations()
                .filter((d) => isVariableDeclaration(d) && d.moduleName !== 'builtins') as VariableDeclaration[];

            // Skip any symbols invalid such as defined in the same class.
            if (
                decls.length === 0 ||
                decls.some((d) => d.node && ParseTreeUtils.getEnclosingClass(d.node, false) === enclosingClass)
            ) {
                return;
            }

            this.addSymbol(name, symbol, partialName.d.value, completionMap, {});
        });

        return completionMap.size > 0 ? completionMap : undefined;
    }

    private _getMethodOverloadsCompletions(priorWord: string, partialName: NameNode): CompletionMap | undefined {
        const symbolTable = getSymbolTable(this.evaluator, partialName);
        if (!symbolTable) {
            return undefined;
        }

        const funcParensDisabled = partialName.parent?.nodeType === ParseNodeType.Function ? true : undefined;
        const completionMap = new CompletionMap();

        const enclosingFunc = ParseTreeUtils.getEnclosingFunction(partialName);
        symbolTable.forEach((symbol, name) => {
            const decl = getLastTypedDeclarationForSymbol(symbol);
            if (!decl || decl.type !== DeclarationType.Function) {
                return;
            }

            if (!decl.node.d.decorators.some((d) => this._isOverload(d))) {
                // Only consider ones that have overload decorator.
                return;
            }

            const decls = symbol.getDeclarations();
            if (decls.length === 1 && decls.some((d) => d.node === enclosingFunc)) {
                // Don't show itself.
                return;
            }

            if (StringUtils.isPatternInSymbol(partialName.d.value, name)) {
                const textEdit = this.createReplaceEdits(priorWord, partialName, decl.node.d.name.d.value);
                this.addSymbol(name, symbol, partialName.d.value, completionMap, {
                    funcParensDisabled,
                    edits: { textEdit },
                });
            }
        });

        return completionMap;

        function getSymbolTable(evaluator: TypeEvaluator, partialName: NameNode) {
            const enclosingClass = ParseTreeUtils.getEnclosingClass(partialName, false);
            if (enclosingClass) {
                const classResults = evaluator.getTypeOfClass(enclosingClass);
                if (!classResults) {
                    return undefined;
                }

                const symbolTable = new Map<string, Symbol>();
                for (const mroClass of classResults.classType.shared.mro) {
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

    private _printMethodSignature(classType: ClassType, decl: FunctionDeclaration): string {
        const node = decl.node;

        let ellipsisForDefault: boolean | undefined;
        if (isStubFile(this.fileUri)) {
            // In stubs, always use "...".
            ellipsisForDefault = true;
        } else if (classType.shared.moduleName === decl.moduleName) {
            // In the same file, always print the full default.
            ellipsisForDefault = false;
        }

        const printFlags = isStubFile(this.fileUri)
            ? ParseTreeUtils.PrintExpressionFlags.ForwardDeclarations |
              ParseTreeUtils.PrintExpressionFlags.DoNotLimitStringLength
            : ParseTreeUtils.PrintExpressionFlags.DoNotLimitStringLength;

        const paramList = node.d.params
            .map((param, index) => {
                let paramString = '';
                if (param.d.category === ParamCategory.ArgsList) {
                    paramString += '*';
                } else if (param.d.category === ParamCategory.KwargsDict) {
                    paramString += '**';
                }

                if (param.d.name) {
                    paramString += param.d.name.d.value;
                }

                // Currently, we don't automatically add import if the type used in the annotation is not imported
                // in current file.
                const paramTypeAnnotation = ParseTreeUtils.getTypeAnnotationForParam(node, index);
                if (paramTypeAnnotation) {
                    paramString += ': ' + ParseTreeUtils.printExpression(paramTypeAnnotation, printFlags);
                }

                if (param.d.defaultValue) {
                    paramString += paramTypeAnnotation ? ' = ' : '=';

                    const useEllipsis = ellipsisForDefault ?? !ParseTreeUtils.isSimpleDefault(param.d.defaultValue);
                    paramString += useEllipsis
                        ? '...'
                        : ParseTreeUtils.printExpression(param.d.defaultValue, printFlags);
                }

                if (!paramString && !param.d.name && param.d.category === ParamCategory.Simple) {
                    return '/';
                }

                return paramString;
            })
            .join(', ');

        let methodSignature = node.d.name.d.value + '(' + paramList + ')';

        if (node.d.returnAnnotation) {
            methodSignature += ' -> ' + ParseTreeUtils.printExpression(node.d.returnAnnotation, printFlags);
        } else if (node.d.funcAnnotationComment) {
            methodSignature +=
                ' -> ' + ParseTreeUtils.printExpression(node.d.funcAnnotationComment.d.returnAnnotation, printFlags);
        }

        return methodSignature;
    }

    private _getStatementCompletions(
        parseNode: ParseNode,
        priorWord: string,
        priorText: string,
        postText: string
    ): CompletionMap | undefined {
        // For now, use the same logic for expressions and statements.
        return this._getExpressionCompletions(parseNode, priorWord, priorText, postText);
    }

    private _getExpressionCompletions(
        parseNode: ParseNode,
        priorWord: string,
        priorText: string,
        postText: string
    ): CompletionMap | undefined {
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
            parseNode.parent === parseNode.parent.d.target?.parent
        ) {
            return undefined;
        }

        const completionMap = new CompletionMap();

        // Return empty completionList for Ellipsis
        if (priorText.slice(-2) === '..') {
            return completionMap;
        }

        // Defining type annotation for class variables.
        // ex) class A:
        //         variable: | <= here
        this._addClassVariableTypeAnnotationCompletions(priorWord, parseNode, completionMap);

        // Add call argument completions.
        this._addCallArgumentCompletions(
            parseNode,
            priorWord,
            priorText,
            postText,
            /* atArgument */ false,
            completionMap
        );

        // Add symbols that are in scope.
        this._addSymbols(parseNode, priorWord, completionMap);

        // Add keywords.
        this._findMatchingKeywords(Keywords.forVersion(this.execEnv.pythonVersion), priorWord).map((keyword) => {
            if (completionMap.has(keyword)) {
                return;
            }
            const completionItem = CompletionItem.create(keyword);
            completionItem.kind = CompletionItemKind.Keyword;
            completionItem.sortText = this._makeSortText(SortCategory.Keyword, keyword);
            completionMap.set(completionItem);
        });

        // Add auto-import suggestions from other modules.
        // Ignore this check for privates, since they are not imported.
        if (!priorWord.startsWith('_') && !this.itemToResolve) {
            const parensDisabled = parseNode.parent?.nodeType === ParseNodeType.Decorator;
            this.addAutoImportCompletions(
                priorWord,
                similarityLimit,
                this.options.lazyEdit,
                completionMap,
                parensDisabled
            );
        }

        // Add literal values if appropriate.
        this._tryAddLiterals(parseNode, priorWord, priorText, postText, completionMap);

        return completionMap;
    }

    private _isIndexArgument(node: ParseNode) {
        const currentNode = node.parent;
        return (
            currentNode &&
            currentNode.nodeType === ParseNodeType.Argument &&
            currentNode.d.argCategory === ArgCategory.Simple &&
            currentNode.parent &&
            currentNode.parent.nodeType === ParseNodeType.Index &&
            currentNode.parent.d.leftExpr &&
            currentNode.parent.d.leftExpr.nodeType === ParseNodeType.Name
        );
    }

    private _addCallArgumentCompletions(
        parseNode: ParseNode,
        priorWord: string,
        priorText: string,
        postText: string,
        atArgument: boolean,
        completionMap: CompletionMap
    ) {
        // If we're within the argument list of a call, add parameter names.
        const offset = convertPositionToOffset(this.position, this.parseResults.tokenizerOutput.lines)!;
        const callInfo = getCallNodeAndActiveParamIndex(parseNode, offset, this.parseResults.tokenizerOutput.tokens);

        if (!callInfo) {
            return;
        }

        const signatureInfo = this.evaluator.getCallSignatureInfo(
            callInfo.callNode,
            callInfo.activeIndex,
            callInfo.activeOrFake
        );

        if (signatureInfo) {
            // Are we past the call expression and within the argument list?
            const callNameEnd = convertOffsetToPosition(
                signatureInfo.callNode.d.leftExpr.start + signatureInfo.callNode.d.leftExpr.length,
                this.parseResults.tokenizerOutput.lines
            );

            if (comparePositions(this.position, callNameEnd) > 0) {
                if (!atArgument) {
                    this._addNamedParameters(signatureInfo, priorWord, completionMap);
                }

                // Add literals that apply to this parameter.
                this._addLiteralValuesForArgument(signatureInfo, priorWord, priorText, postText, completionMap);
            }
        }
    }

    private _addLiteralValuesForArgument(
        signatureInfo: CallSignatureInfo,
        priorWord: string,
        priorText: string,
        postText: string,
        completionMap: CompletionMap
    ) {
        signatureInfo.signatures.forEach((signature) => {
            if (!signature.activeParam) {
                return undefined;
            }

            const type = signature.type;
            const paramIndex = type.shared.parameters.indexOf(signature.activeParam);

            if (paramIndex < 0) {
                return undefined;
            }

            const paramType = FunctionType.getParamType(type, paramIndex);
            this._addLiteralValuesForTargetType(paramType, priorWord, priorText, postText, completionMap);
            return undefined;
        });
    }

    private _addLiteralValuesForTargetType(
        type: Type,
        priorWord: string,
        priorText: string,
        postText: string,
        completionMap: CompletionMap
    ) {
        const quoteValue = this._getQuoteInfo(priorWord, priorText);
        this._getSubTypesWithLiteralValues(type).forEach((v) => {
            if (ClassType.isBuiltIn(v, 'str')) {
                const value = printLiteralValue(v, quoteValue.quoteCharacter);
                if (quoteValue.stringValue === undefined) {
                    this.addNameToCompletions(value, CompletionItemKind.Constant, priorWord, completionMap, {
                        sortText: this._makeSortText(SortCategory.LiteralValue, v.priv.literalValue as string),
                    });
                } else {
                    this._addStringLiteralToCompletions(
                        value.substr(1, value.length - 2),
                        quoteValue,
                        postText,
                        completionMap
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

        return node.d.items.flatMap((entry) => {
            if (entry.nodeType !== ParseNodeType.DictionaryKeyEntry || excludeIds?.has(entry.d.keyExpr.id)) {
                return [];
            }

            if (entry.d.keyExpr.nodeType === ParseNodeType.StringList) {
                return [entry.d.keyExpr.d.strings.map((s) => s.d.value).join('')];
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

    private _getIndexKeyType(baseType: ClassType) {
        // Handle __getitem__.
        const getItemType = this.evaluator.getBoundMagicMethod(baseType, '__getitem__');
        if (getItemType) {
            const typesToCombine: Type[] = [];

            // Handle both overloaded and non-overloaded functions.
            doForEachSignature(getItemType, (signature) => {
                if (
                    signature.shared.parameters.length >= 1 &&
                    signature.shared.parameters[0].category === ParamCategory.Simple
                ) {
                    typesToCombine.push(FunctionType.getParamType(signature, 0));
                }
            });

            if (typesToCombine.length > 0) {
                return combineTypes(typesToCombine);
            }
        }

        return undefined;
    }

    private _getIndexKeys(indexNode: IndexNode, invocationNode: ParseNode) {
        const baseType = this.evaluator.getType(indexNode.d.leftExpr);
        if (!baseType || !isClassInstance(baseType)) {
            return [];
        }

        // See whether subscript is typed using Literal types. If it is, return those literal keys.
        const subscriptType = this._getIndexKeyType(baseType);
        if (subscriptType) {
            const keys: string[] = [];

            this._getSubTypesWithLiteralValues(subscriptType).forEach((v) => {
                if (
                    !ClassType.isBuiltIn(v, 'str') &&
                    !ClassType.isBuiltIn(v, 'int') &&
                    !ClassType.isBuiltIn(v, 'bool') &&
                    !ClassType.isBuiltIn(v, 'bytes') &&
                    !ClassType.isEnumClass(v)
                ) {
                    return;
                }

                keys.push(printLiteralValue(v, this.parseResults.tokenizerOutput.predominantSingleQuoteCharacter));
            });

            if (keys.length > 0) {
                return keys;
            }
        }

        if (indexNode.d.leftExpr.nodeType !== ParseNodeType.Name) {
            // This completion only supports simple name case
            return [];
        }

        // Must be local variable/parameter
        const declarations = this.evaluator.getDeclInfoForNameNode(indexNode.d.leftExpr)?.decls ?? [];
        const declaration = declarations.length > 0 ? declarations[0] : undefined;
        if (
            !declaration ||
            (declaration.type !== DeclarationType.Variable && declaration.type !== DeclarationType.Param)
        ) {
            return [];
        }

        if (!declaration.uri.equals(this.fileUri)) {
            return [];
        }

        let startingNode: ParseNode = indexNode.d.leftExpr;
        if (declaration.node) {
            const scopeRoot = ParseTreeUtils.getEvaluationScopeNode(declaration.node).node;

            // Find the lowest tree to search the symbol.
            if (
                ParseTreeUtils.getFileInfoFromNode(startingNode)?.fileUri.equals(
                    ParseTreeUtils.getFileInfoFromNode(scopeRoot)?.fileUri
                )
            ) {
                startingNode = scopeRoot;
            }
        }

        const results = DocumentSymbolCollector.collectFromNode(
            this.program,
            indexNode.d.leftExpr,
            this.cancellationToken,
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
                if (node.parent.d.rightExpr.nodeType === ParseNodeType.Dictionary) {
                    const dictionary = node.parent.d.rightExpr;
                    for (const entry of dictionary.d.items.filter(
                        (e) => e.nodeType === ParseNodeType.DictionaryKeyEntry
                    ) as DictionaryKeyEntryNode[]) {
                        const key = this.parseResults.text.substr(entry.d.keyExpr.start, entry.d.keyExpr.length).trim();
                        if (key.length > 0) keys.add(key);
                    }
                }

                if (node.parent.d.rightExpr.nodeType === ParseNodeType.Call) {
                    const call = node.parent.d.rightExpr;
                    const type = this.evaluator.getType(call.d.leftExpr);
                    if (!type || !isInstantiableClass(type) || !ClassType.isBuiltIn(type, 'dict')) {
                        continue;
                    }

                    for (const arg of call.d.args) {
                        const key = arg.d.name?.d.value.trim() ?? '';
                        const quote = this.parseResults.tokenizerOutput.predominantSingleQuoteCharacter;
                        if (key.length > 0) {
                            keys.add(`${quote}${key}${quote}`);
                        }
                    }
                }
            }

            if (
                node.parent?.nodeType === ParseNodeType.Index &&
                node.parent.d.items.length === 1 &&
                node.parent.d.items[0].d.valueExpr.nodeType !== ParseNodeType.Error &&
                !TextRange.containsRange(node.parent, invocationNode)
            ) {
                const indexArgument = node.parent.d.items[0];
                const key = this.parseResults.text
                    .substr(indexArgument.d.valueExpr.start, indexArgument.d.valueExpr.length)
                    .trim();
                if (key.length > 0) keys.add(key);
            }
        }

        return Array.from(keys);
    }

    private _getLiteralCompletions(
        parseNode: StringNode | ErrorNode,
        offset: number,
        priorWord: string,
        priorText: string,
        postText: string
    ): CompletionMap | undefined {
        if (this.options.triggerCharacter === '"' || this.options.triggerCharacter === "'") {
            if (parseNode.start !== offset - 1) {
                // If completion is triggered by typing " or ', it must be the one that starts a string
                // literal. In another word, it can't be something inside of another string or comment
                return undefined;
            }
        }

        const completionMap = new CompletionMap();
        if (!this._tryAddLiterals(parseNode, priorWord, priorText, postText, completionMap)) {
            return undefined;
        }

        return completionMap;
    }

    private _tryAddLiterals(
        parseNode: ParseNode,
        priorWord: string,
        priorText: string,
        postText: string,
        completionMap: CompletionMap
    ): boolean {
        const parentAndChild = getParentSkippingStringList(parseNode);
        if (!parentAndChild) {
            return false;
        }

        // See if the type evaluator can determine the expected type for this node.
        // ex) a: Literal["str"] = /* here */
        const nodeForExpectedType =
            parentAndChild.parent.nodeType === ParseNodeType.Assignment
                ? parentAndChild.parent.d.rightExpr === parentAndChild.child
                    ? parentAndChild.child
                    : undefined
                : isExpressionNode(parentAndChild.child)
                ? parentAndChild.child
                : undefined;

        if (nodeForExpectedType) {
            const expectedTypeResult = this.evaluator.getExpectedType(nodeForExpectedType);
            if (expectedTypeResult && containsLiteralType(expectedTypeResult.type)) {
                this._addLiteralValuesForTargetType(
                    expectedTypeResult.type,
                    priorWord,
                    priorText,
                    postText,
                    completionMap
                );
                return true;
            }
        }

        // ex) a: TypedDictType = { "/* here */" } or a: TypedDictType = { A/* here */ }
        const nodeForKey = parentAndChild.parent;
        if (nodeForKey) {
            // If the dictionary is not yet filled in, it will appear as though it's
            // a set initially.
            let dictOrSet: DictionaryNode | SetNode | undefined;

            if (
                nodeForKey.nodeType === ParseNodeType.DictionaryKeyEntry &&
                nodeForKey.d.keyExpr === parentAndChild.child &&
                nodeForKey.parent?.nodeType === ParseNodeType.Dictionary
            ) {
                dictOrSet = nodeForKey.parent;
            } else if (nodeForKey?.nodeType === ParseNodeType.Set) {
                dictOrSet = nodeForKey;
            }

            if (dictOrSet) {
                if (
                    this._tryAddTypedDictKeysFromDictionary(
                        dictOrSet,
                        parseNode.nodeType === ParseNodeType.String ? parseNode : undefined,
                        priorWord,
                        priorText,
                        postText,
                        completionMap
                    )
                ) {
                    return true;
                }
            }
        }

        // a: DictType = { .... }
        // a[/* here */] or a['/* here */'] or a[variable/*here*/]
        const argument = parentAndChild.parent;
        if (argument.nodeType === ParseNodeType.Argument && argument.parent?.nodeType === ParseNodeType.Index) {
            const priorTextInString = parseNode.nodeType === ParseNodeType.String ? priorText : '';
            if (
                this._tryAddTypedDictKeysFromIndexer(
                    argument.parent,
                    priorWord,
                    priorTextInString,
                    postText,
                    completionMap
                )
            ) {
                return true;
            }

            const quoteInfo = this._getQuoteInfo(priorWord, priorTextInString);
            const keys = this._getIndexKeys(argument.parent, parseNode);

            let keyFound = false;
            for (const key of keys) {
                if (completionMap.has(key)) {
                    // Don't add key if it already exists in the completion.
                    // ex) key = "dictKey"
                    //     dict[key] = 1
                    //     print(dict[<key will come from symbol table provider>]))
                    continue;
                }

                const stringLiteral = /^["|'].*["|']$/.test(key);
                if (parseNode.nodeType === ParseNodeType.String && !stringLiteral) {
                    continue;
                }

                keyFound = true;
                if (stringLiteral) {
                    const keyWithoutQuote = key.substr(1, key.length - 2);

                    this._addStringLiteralToCompletions(
                        keyWithoutQuote,
                        quoteInfo,
                        postText,
                        completionMap,
                        indexValueDetail
                    );
                } else {
                    this.addNameToCompletions(key, CompletionItemKind.Constant, priorWord, completionMap, {
                        sortText: this._makeSortText(SortCategory.LiteralValue, key),
                        itemDetail: indexValueDetail,
                    });
                }
            }

            if (keyFound) {
                return true;
            }
        }

        // if c == "/* here */"
        const comparison = parentAndChild.parent;
        const supportedOperators = [OperatorType.Assign, OperatorType.Equals, OperatorType.NotEquals];
        if (
            comparison.nodeType === ParseNodeType.BinaryOperation &&
            supportedOperators.includes(comparison.d.operator)
        ) {
            const type = this.evaluator.getType(comparison.d.leftExpr);
            if (type && containsLiteralType(type)) {
                this._addLiteralValuesForTargetType(type, priorWord, priorText, postText, completionMap);
                return true;
            }
        }

        // if c := "/* here */"
        const assignmentExpression = parentAndChild.parent;
        if (
            assignmentExpression.nodeType === ParseNodeType.AssignmentExpression &&
            assignmentExpression.d.rightExpr === parentAndChild.child
        ) {
            const type = this.evaluator.getType(assignmentExpression.d.name);
            if (type && containsLiteralType(type)) {
                this._addLiteralValuesForTargetType(type, priorWord, priorText, postText, completionMap);
                return true;
            }
        }

        // For now, we only support simple cases. no complex pattern matching.
        // match c:
        //     case /* here */
        const caseNode = parentAndChild.parent;
        if (
            caseNode.nodeType === ParseNodeType.Case &&
            caseNode.d.pattern.nodeType === ParseNodeType.Error &&
            caseNode.d.pattern.d.category === ErrorExpressionCategory.MissingPattern &&
            caseNode.d.suite === parentAndChild.child &&
            caseNode.parent?.nodeType === ParseNodeType.Match
        ) {
            const type = this.evaluator.getType(caseNode.parent.d.expr);
            if (type && containsLiteralType(type)) {
                this._addLiteralValuesForTargetType(type, priorWord, priorText, postText, completionMap);
                return true;
            }
        }

        // match c:
        //     case "/* here */"
        //     case Sym/*here*/
        const patternLiteral = parentAndChild.parent;
        if (
            (patternLiteral.nodeType === ParseNodeType.PatternLiteral ||
                patternLiteral.nodeType === ParseNodeType.PatternCapture) &&
            patternLiteral.parent?.nodeType === ParseNodeType.PatternAs &&
            patternLiteral.parent.parent?.nodeType === ParseNodeType.Case &&
            patternLiteral.parent.parent.parent?.nodeType === ParseNodeType.Match
        ) {
            const type = this.evaluator.getType(patternLiteral.parent.parent.parent.d.expr);
            if (type && containsLiteralType(type)) {
                this._addLiteralValuesForTargetType(type, priorWord, priorText, postText, completionMap);
                return true;
            }
        }

        if (parseNode.nodeType === ParseNodeType.String) {
            const offset = convertPositionToOffset(this.position, this.parseResults.tokenizerOutput.lines)!;
            const atArgument = parseNode.parent!.start < offset && offset < TextRange.getEnd(parseNode);
            this._addCallArgumentCompletions(parseNode, priorWord, priorText, postText, atArgument, completionMap);
            return true;
        }

        return false;

        function getParentSkippingStringList(node: ParseNode): { parent: ParseNode; child: ParseNode } | undefined {
            if (!node.parent) {
                return undefined;
            }

            if (node.nodeType !== ParseNodeType.String) {
                return { parent: node.parent, child: node };
            }

            if (!node.parent.parent) {
                return undefined;
            }

            if (node.parent?.nodeType !== ParseNodeType.StringList || node.parent.d.strings.length > 1) {
                return undefined;
            }

            return { parent: node.parent.parent, child: node.parent };
        }
    }

    private _tryAddTypedDictKeys(
        type: Type,
        existingKeys: string[],
        priorWord: string,
        priorText: string,
        postText: string,
        completionMap: CompletionMap
    ) {
        let typedDicts: ClassType[] = [];

        doForEachSubtype(type, (subtype) => {
            if (isClassInstance(subtype) && ClassType.isTypedDictClass(subtype)) {
                typedDicts.push(subtype);
            }
        });

        if (typedDicts.length === 0) {
            return false;
        }

        typedDicts = this._tryNarrowTypedDicts(typedDicts, existingKeys);

        const quoteInfo = this._getQuoteInfo(priorWord, priorText);
        const excludes = new Set(existingKeys);

        typedDicts.forEach((typedDict) => {
            getTypedDictMembersForClass(this.evaluator, typedDict, /* allowNarrowed */ true).knownItems.forEach(
                (_, key) => {
                    // Unions of TypedDicts may define the same key.
                    if (excludes.has(key) || completionMap.has(key)) {
                        return;
                    }

                    excludes.add(key);

                    this._addStringLiteralToCompletions(key, quoteInfo, postText, completionMap);
                }
            );
        });

        return true;
    }

    private _tryAddTypedDictKeysFromDictionary(
        dictionaryNode: DictionaryNode | SetNode,
        stringNode: StringNode | undefined,
        priorWord: string,
        priorText: string,
        postText: string,
        completionMap: CompletionMap
    ) {
        const expectedTypeResult = this.evaluator.getExpectedType(dictionaryNode);
        if (!expectedTypeResult) {
            return false;
        }

        // If the expected type result is associated with a node above the
        // dictionaryNode in the parse tree, there are no typed dict keys to add.
        if (ParseTreeUtils.getNodeDepth(expectedTypeResult.node) < ParseTreeUtils.getNodeDepth(dictionaryNode)) {
            return false;
        }

        const keys = this._getDictExpressionStringKeys(
            dictionaryNode,
            stringNode ? new Set([stringNode.parent?.id]) : undefined
        );

        return this._tryAddTypedDictKeys(expectedTypeResult.type, keys, priorWord, priorText, postText, completionMap);
    }

    private _tryNarrowTypedDicts(types: ClassType[], keys: string[]): ClassType[] {
        const newTypes = types.flatMap((type) => {
            const entries = getTypedDictMembersForClass(this.evaluator, type, /* allowNarrowed */ true);

            for (let index = 0; index < keys.length; index++) {
                if (!entries.knownItems.has(keys[index])) {
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

    // Find quotation and string prefix to use for string literals
    // completion under current context.
    private _getQuoteInfo(priorWord: string, priorText: string): QuoteInfo {
        let filterText = priorWord;
        let stringValue = undefined;
        let quoteCharacter = this.parseResults.tokenizerOutput.predominantSingleQuoteCharacter;

        // If completion is not inside of the existing string literal
        // ex) typedDict[ |<= here
        // use default quotation char without any string prefix.
        if (!this._stringLiteralContainer) {
            return { priorWord, priorText, filterText, stringValue, quoteCharacter };
        }

        const singleQuote = "'";
        const doubleQuote = '"';

        // If completion is inside of string literal and has prior text
        // ex) typedDict["key |<= here
        // find quotation user has used (ex, ") and string prefix (ex, key)
        if (priorText !== undefined) {
            const lastSingleQuote = priorText.lastIndexOf(singleQuote);
            const lastDoubleQuote = priorText.lastIndexOf(doubleQuote);

            if (lastSingleQuote > lastDoubleQuote) {
                stringValue = priorText.substr(lastSingleQuote + 1);
                quoteCharacter = singleQuote;
            } else if (lastDoubleQuote > lastSingleQuote) {
                stringValue = priorText.substr(lastDoubleQuote + 1);
                quoteCharacter = doubleQuote;
            }
        }

        // If the invocation position is within an f-string, use a double or
        // single quote that doesn't match the f-string. Prior to Python 3.12,
        // using the same quotation mark nested within an f-string was not
        // permitted. For example, f"..{typedDict[|<= here ]}", we need to use
        // single quotes. Note that this doesn't account for deeper nested
        // f-strings.
        if (this._stringLiteralContainer.flags & StringTokenFlags.Format) {
            quoteCharacter =
                this._stringLiteralContainer.flags & StringTokenFlags.SingleQuote ? doubleQuote : singleQuote;
        }

        if (stringValue) {
            filterText = stringValue;
        }

        return { priorWord, priorText, filterText, stringValue, quoteCharacter };
    }

    private _tryAddTypedDictKeysFromIndexer(
        indexNode: IndexNode,
        priorWord: string,
        priorText: string,
        postText: string,
        completionMap: CompletionMap
    ) {
        if (!indexNode) {
            return false;
        }

        const baseType = this.evaluator.getType(indexNode.d.leftExpr);
        if (!baseType) {
            return false;
        }

        return this._tryAddTypedDictKeys(baseType, [], priorWord, priorText, postText, completionMap);
    }

    private _addStringLiteralToCompletions(
        value: string,
        quoteInfo: QuoteInfo,
        postText: string | undefined,
        completionMap: CompletionMap,
        detail?: string
    ) {
        if (!StringUtils.isPatternInSymbol(quoteInfo.filterText || '', value)) {
            return;
        }

        const valueWithQuotes = `${quoteInfo.quoteCharacter}${value}${quoteInfo.quoteCharacter}`;
        if (completionMap.has(valueWithQuotes)) {
            return;
        }

        const completionItem = CompletionItem.create(valueWithQuotes);

        completionItem.kind = CompletionItemKind.Constant;
        completionItem.sortText = this._makeSortText(SortCategory.LiteralValue, valueWithQuotes);
        let rangeStartCol = this.position.character;
        if (quoteInfo.stringValue !== undefined) {
            rangeStartCol -= quoteInfo.stringValue.length + 1;
        } else if (quoteInfo.priorWord) {
            rangeStartCol -= quoteInfo.priorWord.length;
        }

        // If the text after the insertion point is the closing quote,
        // replace it.
        let rangeEndCol = this.position.character;
        if (postText !== undefined) {
            if (postText.startsWith(quoteInfo.quoteCharacter)) {
                rangeEndCol++;
            }
        }

        const range: Range = {
            start: { line: this.position.line, character: rangeStartCol },
            end: { line: this.position.line, character: rangeEndCol },
        };
        completionItem.textEdit = TextEdit.replace(range, valueWithQuotes);
        completionItem.detail = detail;

        completionMap.set(completionItem);
    }

    private _getImportFromCompletions(
        importFromNode: ImportFromNode,
        offset: number,
        priorWord: string
    ): CompletionMap | undefined {
        // Don't attempt to provide completions for "from X import *".
        if (importFromNode.d.isWildcardImport) {
            return undefined;
        }

        // Access the imported module information, which is hanging
        // off the ImportFromNode.
        const importInfo = AnalyzerNodeInfo.getImportInfo(importFromNode.d.module);
        if (!importInfo) {
            return undefined;
        }

        const completionMap = new CompletionMap();
        const resolvedPath =
            importInfo.resolvedUris.length > 0
                ? importInfo.resolvedUris[importInfo.resolvedUris.length - 1]
                : Uri.empty();

        const parseResults = this.program.getParseResults(resolvedPath);
        if (!parseResults) {
            // Add the implicit imports.
            this._addImplicitImportsToCompletion(importInfo, importFromNode, priorWord, completionMap);
            return completionMap;
        }

        const symbolTable = AnalyzerNodeInfo.getScope(parseResults.parserOutput.parseTree)?.symbolTable;
        if (!symbolTable) {
            return completionMap;
        }

        this._addSymbolsForSymbolTable(
            symbolTable,
            (symbol, name) => {
                return (
                    // Don't suggest built in symbols.
                    symbol.getDeclarations().some((d) => !isIntrinsicDeclaration(d)) &&
                    // Don't suggest symbols that have already been imported elsewhere
                    // in this import statement.
                    !importFromNode.d.imports.find(
                        (imp) =>
                            imp.d.name.d.value === name &&
                            !(TextRange.contains(imp, offset) || TextRange.getEnd(imp) === offset)
                    )
                );
            },
            priorWord,
            importFromNode,
            /* isInImport */ true,
            /* boundObject */ undefined,
            completionMap
        );

        // Add the implicit imports.
        this._addImplicitImportsToCompletion(importInfo, importFromNode, priorWord, completionMap);
        return completionMap;
    }

    private _addImplicitImportsToCompletion(
        importInfo: ImportResult,
        importFromNode: ImportFromNode,
        priorWord: string,
        completionMap: CompletionMap
    ) {
        importInfo.implicitImports.forEach((implImport) => {
            if (!importFromNode.d.imports.find((imp) => imp.d.name.d.value === implImport.name)) {
                this.addNameToCompletions(implImport.name, CompletionItemKind.Module, priorWord, completionMap, {
                    moduleUri: implImport.uri,
                });
            }
        });
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

    private _addNamedParameters(signatureInfo: CallSignatureInfo, priorWord: string, completionMap: CompletionMap) {
        const argNameSet = new Set<string>();

        signatureInfo.signatures.forEach((signature) => {
            this._addNamedParametersToMap(signature.type, argNameSet);
        });

        // Add keys from typed dict outside signatures.
        signatureInfo.signatures.forEach((signature) => {
            if (signature.type.priv.boundToType) {
                const keys = Array.from(
                    signature.type.priv.boundToType.shared.typedDictEntries?.knownItems.keys() || []
                );
                keys.forEach((key: string) => argNameSet.add(key));
            }
        });

        // Remove any named parameters that are already provided.
        signatureInfo.callNode.d.args!.forEach((arg) => {
            if (arg.d.name) {
                argNameSet.delete(arg.d.name.d.value);
            }
        });

        // Add the remaining unique parameter names to the completion list.
        argNameSet.forEach((argName) => {
            if (StringUtils.isPatternInSymbol(priorWord, argName)) {
                const label = argName + '=';
                if (completionMap.has(label)) {
                    return;
                }

                const completionItem = CompletionItem.create(label);
                completionItem.kind = CompletionItemKind.Variable;

                const completionItemData: CompletionItemData = {
                    uri: this.fileUri.toString(),
                    position: this.position,
                };
                completionItem.data = toLSPAny(completionItemData);
                completionItem.sortText = this._makeSortText(SortCategory.NamedParameter, argName);
                completionItem.filterText = argName;

                completionMap.set(completionItem);
            }
        });
    }

    private _addNamedParametersToMap(type: FunctionType, names: Set<string>) {
        const paramDetails = getParamListDetails(type);

        paramDetails.params.forEach((paramInfo) => {
            if (
                paramInfo.param.name &&
                paramInfo.kind !== ParamKind.Positional &&
                paramInfo.kind !== ParamKind.ExpandedArgs
            ) {
                if (
                    !SymbolNameUtils.isPrivateOrProtectedName(paramInfo.param.name) &&
                    Tokenizer.isPythonIdentifier(paramInfo.param.name)
                ) {
                    names.add(paramInfo.param.name);
                }
            }
        });
    }

    private _addSymbols(node: ParseNode, priorWord: string, completionMap: CompletionMap) {
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
                        node,
                        /* isInImport */ false,
                        /* boundObject */ undefined,
                        completionMap
                    );
                    scope = scope.parent;
                }

                // If this is a class scope, add symbols from parent classes.
                if (curNode.nodeType === ParseNodeType.Class) {
                    const classType = this.evaluator.getTypeOfClass(curNode);
                    if (classType && isInstantiableClass(classType.classType)) {
                        classType.classType.shared.mro.forEach((baseClass, index) => {
                            if (isInstantiableClass(baseClass)) {
                                this._addSymbolsForSymbolTable(
                                    ClassType.getSymbolTable(baseClass),
                                    (symbol) => {
                                        if (!symbol.isClassMember()) {
                                            return false;
                                        }

                                        // Return only variables, not methods or classes.
                                        return symbol
                                            .getDeclarations()
                                            .some((decl) => decl.type === DeclarationType.Variable);
                                    },
                                    priorWord,
                                    node,
                                    /* isInImport */ false,
                                    /* boundObject */ undefined,
                                    completionMap
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
        includeSymbolCallback: (symbol: Symbol, name: string) => boolean,
        priorWord: string,
        node: ParseNode,
        isInImport: boolean,
        boundObjectOrClass: ClassType | undefined,
        completionMap: CompletionMap
    ) {
        const insideTypeAnnotation =
            ParseTreeUtils.isWithinAnnotationComment(node) ||
            ParseTreeUtils.isWithinTypeAnnotation(node, /* requireQuotedAnnotation */ false);
        symbolTable.forEach((symbol, name) => {
            // If there are no declarations or the symbol is not
            // exported from this scope, don't include it in the
            // suggestion list unless we are in the same file.
            const hidden =
                !isVisibleExternally(symbol) && !symbol.getDeclarations().some((d) => isDefinedInFile(d, this.fileUri));
            if (!hidden && includeSymbolCallback(symbol, name)) {
                // Don't add a symbol more than once. It may have already been
                // added from an inner scope's symbol table.
                if (!completionMap.has(name)) {
                    // Skip func parens for classes when not a direct assignment or an argument (passed as a value)
                    const skipForClass = !this._shouldShowAutoParensForClass(symbol, node);
                    const skipForDecorator = node.parent?.nodeType === ParseNodeType.Decorator;
                    this.addSymbol(name, symbol, priorWord, completionMap, {
                        boundObjectOrClass,
                        funcParensDisabled: isInImport || insideTypeAnnotation || skipForClass || skipForDecorator,
                        extraCommitChars: !isInImport && !!priorWord,
                    });
                }
            }
        });
    }

    private _shouldShowAutoParensForClass(symbol: Symbol, node: ParseNode) {
        if (symbol.getDeclarations().every((d) => d.type !== DeclarationType.Class)) {
            // Not actually a class, so yes show parens.
            return true;
        }

        // If an argument then show parens for classes if not a class argument.
        if (node.parent?.nodeType === ParseNodeType.Argument && node.parent.parent?.nodeType !== ParseNodeType.Class) {
            return true;
        }

        // Otherwise only show when the class is being assigned to a variable.
        const nodeIndex = ParseTreeUtils.getTokenIndexAtLeft(this.parseResults.tokenizerOutput.tokens, node.start);
        const prevToken = ParseTreeUtils.getTokenAtIndex(this.parseResults.tokenizerOutput.tokens, nodeIndex);
        return (
            prevToken &&
            prevToken.type === TokenType.Operator &&
            (prevToken as OperatorToken).operatorType === OperatorType.Assign
        );
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
        const resolvedDeclaration = this.evaluator.resolveAliasDeclaration(declaration, /* resolveLocalNames */ true);
        if (!resolvedDeclaration) {
            return CompletionItemKind.Variable;
        }

        switch (resolvedDeclaration.type) {
            case DeclarationType.Intrinsic:
                return resolvedDeclaration.intrinsicType === 'type[self]'
                    ? CompletionItemKind.Class
                    : CompletionItemKind.Variable;

            case DeclarationType.Param:
                return CompletionItemKind.Variable;

            case DeclarationType.TypeParam:
                return CompletionItemKind.TypeParameter;

            case DeclarationType.Variable:
                return resolvedDeclaration.isConstant || resolvedDeclaration.isFinal
                    ? CompletionItemKind.Constant
                    : CompletionItemKind.Variable;

            case DeclarationType.TypeAlias:
                return CompletionItemKind.Variable;

            case DeclarationType.Function: {
                if (this._isPossiblePropertyDeclaration(resolvedDeclaration)) {
                    const functionType = this.evaluator.getTypeOfFunction(resolvedDeclaration.node);
                    if (
                        functionType &&
                        isMaybeDescriptorInstance(functionType.decoratedType, /* requireSetter */ false)
                    ) {
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

    private _convertTypeToItemKind(type: Type): CompletionItemKind {
        switch (type.category) {
            case TypeCategory.Module:
                return CompletionItemKind.Module;
            case TypeCategory.Class:
                return CompletionItemKind.Class;
            case TypeCategory.Function:
            case TypeCategory.Overloaded:
                if (isMaybeDescriptorInstance(type, /* requireSetter */ false)) {
                    return CompletionItemKind.Property;
                }

                return CompletionItemKind.Function;
            case TypeCategory.TypeVar:
                return CompletionItemKind.TypeParameter;

            default:
                return CompletionItemKind.Variable;
        }
    }

    private _getImportModuleCompletions(node: ModuleNameNode): CompletionMap {
        const moduleDescriptor: ImportedModuleDescriptor = {
            leadingDots: node.d.leadingDots,
            hasTrailingDot: node.d.hasTrailingDot || false,
            nameParts: node.d.nameParts.map((part) => part.d.value),
            importedSymbols: new Set<string>(),
        };

        const completions = this.importResolver.getCompletionSuggestions(this.fileUri, this.execEnv, moduleDescriptor);

        const completionMap = new CompletionMap();

        // If we're in the middle of a "from X import Y" statement, offer
        // the "import" keyword as a completion.
        if (
            !node.d.hasTrailingDot &&
            node.parent &&
            node.parent.nodeType === ParseNodeType.ImportFrom &&
            node.parent.d.missingImport
        ) {
            const keyword = 'import';
            const completionItem = CompletionItem.create(keyword);
            completionItem.kind = CompletionItemKind.Keyword;
            completionItem.sortText = this._makeSortText(SortCategory.Keyword, keyword);
            completionMap.set(completionItem);
        }

        completions.forEach((modulePath, completionName) => {
            this.addNameToCompletions(completionName, CompletionItemKind.Module, '', completionMap, {
                sortText: this._makeSortText(SortCategory.ImportModuleName, completionName),
                moduleUri: modulePath,
            });
        });

        return completionMap;
    }

    private _isPossiblePropertyDeclaration(decl: FunctionDeclaration) {
        // Do cheap check using only nodes that will cover 99.9% cases
        // before doing more expensive type evaluation.
        return decl.isMethod && decl.node.d.decorators.length > 0;
    }

    private _isEnumMember(containingType: ClassType | undefined, name: string) {
        if (!containingType || !ClassType.isEnumClass(containingType)) {
            return false;
        }

        const symbolType = transformTypeForEnumMember(this.evaluator, containingType, name);

        return (
            symbolType &&
            isClassInstance(symbolType) &&
            ClassType.isSameGenericClass(
                symbolType,
                TypeBase.isInstance(containingType) ? containingType : ClassType.cloneAsInstance(containingType)
            ) &&
            symbolType.priv.literalValue instanceof EnumLiteral
        );
    }
}

export class CompletionMap {
    private _completions: Map<string, CompletionItem | CompletionItem[]> = new Map();

    get size() {
        return this._completions.size;
    }

    set(value: CompletionItem): void {
        const existing = this._completions.get(value.label);
        if (!existing) {
            this._completions.set(value.label, value);
        } else if (Array.isArray(existing)) {
            existing.push(value);
        } else {
            this._completions.set(value.label, [existing, value]);
        }
    }

    get(key: string): CompletionItem | CompletionItem[] | undefined {
        return this._completions.get(key);
    }

    has(
        label: string,
        predicate?: (
            other: CompletionItem | CompletionItem[],
            kind?: CompletionItemKind,
            autoImportText?: string
        ) => boolean,
        kind?: CompletionItemKind,
        autImportText?: string
    ): boolean {
        const existing = this._completions.get(label);
        if (!existing) {
            return false;
        }

        if (predicate) {
            return predicate(existing, kind, autImportText);
        }
        return true;
    }

    clear(): void {
        this._completions.clear();
    }

    delete(key: string): boolean {
        return this._completions.delete(key);
    }

    toArray(): CompletionItem[] {
        const items: CompletionItem[] = [];
        this._completions?.forEach((value) => {
            if (Array.isArray(value)) {
                value.forEach((item) => {
                    items.push(item);
                });
            } else {
                items.push(value);
            }
        });
        return items;
    }

    static matchKindAndImportText(
        completionItemOrItems: CompletionItem | CompletionItem[],
        getCompletionData: (d: CompletionItem) => CompletionItemData | undefined,
        kind?: CompletionItemKind,
        autoImportText?: string
    ): boolean {
        if (!Array.isArray(completionItemOrItems)) {
            return (
                completionItemOrItems.kind === kind &&
                getCompletionData(completionItemOrItems)?.autoImportText === autoImportText
            );
        } else {
            return !!completionItemOrItems.find(
                (c) => c.kind === kind && getCompletionData(c)?.autoImportText === autoImportText
            );
        }
    }

    static labelOnlyIgnoringAutoImports(
        completionItemOrItems: CompletionItem | CompletionItem[],
        getCompletionData: (d: CompletionItem) => CompletionItemData | undefined
    ): boolean {
        if (!Array.isArray(completionItemOrItems)) {
            if (!getCompletionData(completionItemOrItems)?.autoImportText) {
                return true;
            }
        } else {
            if (completionItemOrItems.find((c) => !getCompletionData(c)?.autoImportText)) {
                return true;
            }
        }

        return false;
    }
}
