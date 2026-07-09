import { TypeServerProtocol } from './protocol/typeServerProtocol';

import * as PyrightDecl from '../analyzer/declaration';
import { synthesizeAliasDeclaration } from '../analyzer/declarationUtils';
import { ParseTreeWalker } from '../analyzer/parseTreeWalker';
import * as PyrightTypes from '../analyzer/types';
import { isCallableType, isLiteralType } from '../analyzer/typeUtils';
import { CaseSensitivityDetector } from '../common/caseSensitivityDetector';
import * as debug from '../common/debug';
import { FileSystem } from '../common/fileSystem';
import { convertOffsetsToRange, convertPositionToOffset } from '../common/positionUtils';
import { TextRange } from '../common/textRange';
import { Uri } from '../common/uri/uri';
import { convertUriToLspUriString } from '../common/uri/uriUtils';
import * as PyrightNodes from '../parser/parseNodes';
import { ParserOutput } from '../parser/parser';

import { map } from './typeEvalUtils';
import { convertLspUriStringToUri } from './serverUtils';
import { ISymbolLookup, ParseResults } from './programTypes';

import { INotebookUriMapper } from './notebookUriMapper';

export interface IPyrightTypeFactory {
    readonly provider: IParserOutputProvider;
    getType(protocolType: TypeServerProtocol.Type): PyrightTypes.Type;
}

export interface IParserOutputProvider extends CaseSensitivityDetector {
    getUri(node: PyrightNodes.ParseNode): Uri;
    getParserOutput(uri: Uri): ParserOutput | undefined;
    readonly fs: FileSystem;
    readonly uriMapper?: INotebookUriMapper;
    // Parse and return the results for stub code with a dummy URI
    // If directoryUri is provided, the stub URI will be created in that directory
    addStubCode(code: string, directoryUri?: Uri): { uri: Uri; parseResults: ParseResults };
}

export function isSentinelLiteral(value: any): value is TypeServerProtocol.SentinelLiteral {
    return value && value.moduleName !== undefined && value.className !== undefined;
}

export function isEnumLiteral(value: any): value is TypeServerProtocol.EnumLiteral {
    return value && value.className !== undefined && value.itemName !== undefined && value.itemType !== undefined;
}

export function isClass(handle: TypeServerProtocol.Type): handle is TypeServerProtocol.ClassType {
    return handle.kind === TypeServerProtocol.TypeKind.Class;
}

export function isFunction(handle: TypeServerProtocol.Type): handle is TypeServerProtocol.FunctionType {
    return handle.kind === TypeServerProtocol.TypeKind.Function;
}

export function fromProtocolTypesOrUndefined<TTypeFactory extends IPyrightTypeFactory>(
    types: TypeServerProtocol.Type[] | undefined,
    factory: TTypeFactory
): PyrightTypes.Type[] | undefined {
    if (!types) {
        return undefined;
    }

    return fromProtocolTypes(types, factory);
}

export function fromProtocolTypes<TTypeFactory extends IPyrightTypeFactory>(
    types: TypeServerProtocol.Type[],
    factory: TTypeFactory
): PyrightTypes.Type[] {
    return map(types, (handle) => factory.getType(handle));
}

export function fromProtocolTypeOrUndefined<TTypeFactory extends IPyrightTypeFactory>(
    type: TypeServerProtocol.Type | undefined,
    factory: TTypeFactory
): PyrightTypes.Type | undefined {
    if (!type) {
        return undefined;
    }

    return factory.getType(type);
}

export function toProtocolNodeOrUndefined(
    node: PyrightNodes.ParseNode | undefined,
    provider: IParserOutputProvider
): TypeServerProtocol.Node | undefined {
    if (!node) {
        return undefined;
    }

    return toProtocolNode(node, provider);
}

export function toProtocolNode(node: PyrightNodes.ParseNode, provider: IParserOutputProvider): TypeServerProtocol.Node {
    const uri = provider.getUri(node);
    const results = provider.getParserOutput(uri);
    if (!results) {
        throw new Error(`Unable to find parse results for ${uri}`);
    }
    const range = convertOffsetsToRange(node.start, node.start + node.length, results.lines);

    // Before becoming a protocol node, we need to convert the uri to an LSP URI string.
    const uriString = convertUriToLspUriString(provider.fs, uri);
    return {
        uri: uriString,
        range,
    };
}

export function fromProtocolNodeOrUndefined<T extends PyrightNodes.ParseNodeBase<PyrightNodes.ParseNodeType>>(
    node: TypeServerProtocol.Node | undefined,
    resultsProvider: IParserOutputProvider,
    typeHints?: PyrightNodes.ParseNodeType[]
): T | undefined {
    if (!node) {
        return undefined;
    }

    return fromProtocolNode<T>(node, resultsProvider, typeHints);
}

export function fromProtocolNode<T extends PyrightNodes.ParseNodeBase<PyrightNodes.ParseNodeType>>(
    node: TypeServerProtocol.Node,
    resultsProvider: IParserOutputProvider,
    typeHints?: PyrightNodes.ParseNodeType[]
): T {
    const uri = convertLspUriStringToUri(node.uri, resultsProvider, resultsProvider.uriMapper);
    const mappedUri = resultsProvider.fs.getMappedUri(uri);
    const parserOutput = resultsProvider.getParserOutput(mappedUri);
    const rootNode = parserOutput?.parseTree;
    if (!rootNode) {
        throw new Error(`Unable to find parse results for ${node.uri}`);
    }
    const start = convertPositionToOffset(node.range.start, parserOutput.lines);
    const end = convertPositionToOffset(node.range.end, parserOutput.lines);
    if (start === undefined || end === undefined) {
        throw new Error(`Invalid range for node: ${JSON.stringify(node)}`);
    }

    function keepNewType(oldType: PyrightNodes.ParseNodeType, newType: PyrightNodes.ParseNodeType) {
        if (typeHints) {
            return typeHints.some((t) => t === newType);
        }
        switch (oldType) {
            case PyrightNodes.ParseNodeType.Name:
                return newType !== PyrightNodes.ParseNodeType.Name;
            case PyrightNodes.ParseNodeType.StringList:
                return newType !== PyrightNodes.ParseNodeType.String;
            case PyrightNodes.ParseNodeType.String:
                return newType === PyrightNodes.ParseNodeType.StringList;
            case PyrightNodes.ParseNodeType.Number:
                return newType === PyrightNodes.ParseNodeType.Slice;
            case PyrightNodes.ParseNodeType.Slice:
                return newType !== PyrightNodes.ParseNodeType.Number;
            case PyrightNodes.ParseNodeType.ModuleName:
                return (
                    newType === PyrightNodes.ParseNodeType.Import ||
                    newType === PyrightNodes.ParseNodeType.ImportFrom ||
                    newType === PyrightNodes.ParseNodeType.ImportAs ||
                    newType === PyrightNodes.ParseNodeType.ImportFromAs
                );
            case PyrightNodes.ParseNodeType.Import:
            case PyrightNodes.ParseNodeType.ImportFrom:
            case PyrightNodes.ParseNodeType.ImportAs:
            case PyrightNodes.ParseNodeType.ImportFromAs:
                return newType !== PyrightNodes.ParseNodeType.ModuleName;
            case PyrightNodes.ParseNodeType.Error:
                return newType !== PyrightNodes.ParseNodeType.Error;
            default:
                return true;
        }
    }

    // Now that we have the root node, we can search for the node that contains the range.
    class ParseTreeWalkerImpl extends ParseTreeWalker {
        private _range: TextRange;
        private _bestMatch: PyrightNodes.ParseNode = rootNode!;
        private _bestMatchType: PyrightNodes.ParseNodeType = PyrightNodes.ParseNodeType.Error;

        constructor(private _start: number, private _length: number) {
            super();
            this._range = TextRange.create(_start, _length);
        }

        getBestMatch(): PyrightNodes.ParseNode {
            return this._bestMatch;
        }

        override visitNode(node: PyrightNodes.ParseNode): PyrightNodes.ParseNodeArray {
            if (
                node.start === this._start &&
                node.length >= this._length &&
                this._bestMatch.length >= node.length &&
                keepNewType(this._bestMatchType, node.nodeType)
            ) {
                this._bestMatchType = node.nodeType;
                this._bestMatch = node;
            }

            // Perform the same special case that findNodeByOffset does for augmented assignments. leftExpr is
            // not searched, but rather the destExpr is.
            if (node.nodeType === PyrightNodes.ParseNodeType.AugmentedAssignment) {
                return [node.d.destExpr, node.d.rightExpr];
            }

            return super.visitNode(node);
        }

        override walk(node: PyrightNodes.ParseNode): void {
            if (!TextRange.overlapsRange(this._range, node)) {
                // If the node doesn't overlap with the range, we can skip it.
                return;
            }

            super.walk(node);
        }
    }

    const walker = new ParseTreeWalkerImpl(start, end - start);
    walker.walk(rootNode);
    const bestMatch = walker.getBestMatch();
    if (typeHints && !typeHints.some((t) => t === bestMatch.nodeType)) {
        // The range may not line up exactly with the hinted node type (e.g. due to edits or
        // subtle parse differences). Prefer resiliency over crashing; retry without hints.
        return fromProtocolNode<T>(node, resultsProvider, /* typeHints */ undefined);
    }
    return bestMatch as T;
}

export function toProtocolDeclCategory(decl: PyrightDecl.Declaration) {
    switch (decl.type) {
        case PyrightDecl.DeclarationType.Intrinsic:
            return TypeServerProtocol.DeclarationCategory.Intrinsic;
        case PyrightDecl.DeclarationType.Function:
            return TypeServerProtocol.DeclarationCategory.Function;
        case PyrightDecl.DeclarationType.Class:
        case PyrightDecl.DeclarationType.SpecialBuiltInClass:
            return TypeServerProtocol.DeclarationCategory.Class;
        case PyrightDecl.DeclarationType.Param:
            return TypeServerProtocol.DeclarationCategory.Param;
        case PyrightDecl.DeclarationType.TypeParam:
            return TypeServerProtocol.DeclarationCategory.TypeParam;
        case PyrightDecl.DeclarationType.TypeAlias:
            return TypeServerProtocol.DeclarationCategory.TypeAlias;
        case PyrightDecl.DeclarationType.Variable:
            return TypeServerProtocol.DeclarationCategory.Variable;
        case PyrightDecl.DeclarationType.Alias:
            return TypeServerProtocol.DeclarationCategory.Import;
        default:
            throw new Error(`Unknown declaration type: ${(decl as any).type}`);
    }
}

export function toProtocolDecl(
    decl: PyrightDecl.Declaration,
    provider: IParserOutputProvider
): TypeServerProtocol.Declaration {
    const wrap: IParserOutputProvider = {
        fs: provider.fs,
        uriMapper: provider.uriMapper,
        isCaseSensitive: (uri) => provider.isCaseSensitive(uri),
        getUri: (node) => (decl.node ? provider.getUri(decl.node) : decl.uri),
        getParserOutput: (uri) => provider.getParserOutput(uri),
        addStubCode: (code) => provider.addStubCode(code),
    };

    if (!decl.node) {
        return {
            kind: TypeServerProtocol.DeclarationKind.Synthesized,
            uri: convertUriToLspUriString(provider.fs, decl.uri),
        };
    }

    return {
        kind: TypeServerProtocol.DeclarationKind.Regular,
        category: toProtocolDeclCategory(decl),
        node: toProtocolNode(decl.node, wrap),
        name: getSymbolNameFromDeclaration(decl),
    };
}

/**
 * Build a stable string key for a TSP `Declaration`. Used to cache
 * `fromProtocolDecl` results on a snapshot.
 *
 * The key intentionally captures only the protocol-visible identity of the
 * declaration (uri + range + kind/category + name) so that distinct TSP
 * `Declaration` object instances that refer to the same source-level
 * declaration share a cache entry.
 */
export function getProtocolDeclKey(decl: TypeServerProtocol.Declaration): string {
    if (decl.kind === TypeServerProtocol.DeclarationKind.Synthesized) {
        return `s:${decl.uri}`;
    }
    const r = decl.node.range;
    return `r:${decl.node.uri}:${r.start.line},${r.start.character}-${r.end.line},${r.end.character}:${decl.category}:${
        decl.name ?? ''
    }`;
}

export function fromProtocolDecl(
    decl: TypeServerProtocol.Declaration,
    resultsProvider: IParserOutputProvider,
    symbolLookup: ISymbolLookup
): PyrightDecl.Declaration | undefined {
    if (decl.kind === TypeServerProtocol.DeclarationKind.Synthesized) {
        return synthesizeAliasDeclaration(
            convertLspUriStringToUri(decl.uri, resultsProvider, resultsProvider.uriMapper)
        );
    }

    if (!decl.name) {
        return undefined;
    }

    const hints = getParseNodeTypesForDecl(decl);

    // Try to get the node from the protocol - if this fails (e.g., file not available in this context
    // or the range is invalid because the external server uses a different version of the file),
    // fall back to the module root node so we can still look up the symbol by name.
    let node: PyrightNodes.ParseNode | undefined;
    try {
        node = fromProtocolNode<PyrightNodes.ParseNode>(decl.node, resultsProvider, hints);
    } catch (error) {
        // Try to get the module root node as a fallback for symbol lookup.
        if (decl.node?.uri) {
            try {
                const uri = convertLspUriStringToUri(decl.node.uri, resultsProvider, resultsProvider.uriMapper);
                const mappedUri = resultsProvider.fs.getMappedUri(uri);
                const parserOutput = resultsProvider.getParserOutput(mappedUri);
                if (parserOutput?.parseTree) {
                    node = parserOutput.parseTree;
                }
            } catch {
                // Ignore - will fall through to return undefined below.
            }
        }
        if (!node) {
            return undefined;
        }
    }

    if (decl.category !== TypeServerProtocol.DeclarationCategory.Import && !node) {
        return undefined;
    }

    if (!node) {
        return undefined;
    }

    const symbol = symbolLookup.lookupSymbol(node, decl.name);
    if (!symbol) {
        return undefined;
    }

    // Helper to check if a declaration matches the expected category type.
    const matchesDeclCategory = (d: PyrightDecl.Declaration): boolean => {
        switch (decl.category) {
            case TypeServerProtocol.DeclarationCategory.Import:
                return PyrightDecl.isAliasDeclaration(d);
            case TypeServerProtocol.DeclarationCategory.Intrinsic:
                return PyrightDecl.isIntrinsicDeclaration(d);
            case TypeServerProtocol.DeclarationCategory.Variable:
                return PyrightDecl.isVariableDeclaration(d);
            case TypeServerProtocol.DeclarationCategory.Param:
                return PyrightDecl.isParamDeclaration(d);
            case TypeServerProtocol.DeclarationCategory.TypeParam:
                return PyrightDecl.isTypeParamDeclaration(d);
            case TypeServerProtocol.DeclarationCategory.TypeAlias:
                return PyrightDecl.isTypeAliasDeclaration(d);
            case TypeServerProtocol.DeclarationCategory.Function:
                return PyrightDecl.isFunctionDeclaration(d);
            case TypeServerProtocol.DeclarationCategory.Class:
                return PyrightDecl.isClassDeclaration(d) || PyrightDecl.isSpecialBuiltInClassDeclaration(d);
            default:
                return false;
        }
    };

    // Helper to check if a declaration's node matches the protocol node identity.
    const matchesNodeIdentity = (d: PyrightDecl.Declaration): boolean => {
        if (d.node === node) {
            return true;
        }
        // For Function/Class declarations, also check if the name node matches.
        if (PyrightDecl.isFunctionDeclaration(d) && d.node.d.name === node) {
            return true;
        }
        if (PyrightDecl.isClassDeclaration(d) && d.node.d.name === node) {
            return true;
        }
        return false;
    };

    const allDecls = symbol.getDeclarations();

    // First try: exact node identity match (preferred).
    const exactMatch = allDecls.find((d) => matchesDeclCategory(d) && matchesNodeIdentity(d));
    if (exactMatch) {
        return exactMatch;
    }

    // Fallback: when the external type server provides imprecise node ranges (e.g., file-level
    // ranges that resolve to the Module node instead of the actual declaration node), the node
    // identity check fails. In that case, fall back to matching by category alone. Since
    // lookupSymbol already constrained to the correct symbol, this is safe.
    return allDecls.find((d) => matchesDeclCategory(d));
}

export function getSymbolNameFromDeclaration(declaration: PyrightDecl.Declaration): string | undefined {
    switch (declaration.type) {
        case PyrightDecl.DeclarationType.Alias: {
            if (declaration.node.nodeType === PyrightNodes.ParseNodeType.ImportFrom) {
                if (declaration.node.d.isWildcardImport) {
                    return declaration.symbolName;
                }

                return declaration.node.d.module.d.nameParts[0].d.value;
            }

            if (declaration.node.nodeType === PyrightNodes.ParseNodeType.ImportFromAs) {
                const nameNode = declaration.node.d.alias || declaration.node.d.name;
                return nameNode.d.value;
            }

            if (declaration.node.nodeType === PyrightNodes.ParseNodeType.ImportAs) {
                return declaration.node.d.alias
                    ? declaration.node.d.alias.d.value
                    : declaration.node.d.module.d.nameParts[0].d.value;
            }

            return undefined;
        }
        case PyrightDecl.DeclarationType.Class:
        case PyrightDecl.DeclarationType.Function:
        case PyrightDecl.DeclarationType.TypeParam:
        case PyrightDecl.DeclarationType.TypeAlias:
            return declaration.node.d.name.d.value;

        case PyrightDecl.DeclarationType.Param:
            return declaration.node.d.name?.d.value;

        case PyrightDecl.DeclarationType.Variable: {
            const node = declaration.node;
            return node.nodeType === PyrightNodes.ParseNodeType.Name
                ? node.d.value
                : node.nodeType === PyrightNodes.ParseNodeType.StringList
                ? node.d.strings[0].d.value
                : undefined;
        }
        case PyrightDecl.DeclarationType.Intrinsic:
            return declaration.name;
        case PyrightDecl.DeclarationType.SpecialBuiltInClass:
            return declaration.node.d.valueExpr.nodeType === PyrightNodes.ParseNodeType.Name
                ? declaration.node.d.valueExpr.d.value
                : undefined;
        default: {
            debug.assertNever(declaration);
        }
    }
}

export function getParseNodeTypesForDecl(decl: TypeServerProtocol.Declaration): PyrightNodes.ParseNodeType[] {
    if (decl.kind === TypeServerProtocol.DeclarationKind.Synthesized) {
        // Synthesized declarations don't have an associated node.
        return [];
    }

    switch (decl.category) {
        case TypeServerProtocol.DeclarationCategory.Import: {
            return [
                PyrightNodes.ParseNodeType.ImportAs,
                PyrightNodes.ParseNodeType.ImportFromAs,
                PyrightNodes.ParseNodeType.ImportFrom,
            ];
        }
        case TypeServerProtocol.DeclarationCategory.Intrinsic: {
            return [
                PyrightNodes.ParseNodeType.Module |
                    PyrightNodes.ParseNodeType.Function |
                    PyrightNodes.ParseNodeType.Class,
            ];
        }
        case TypeServerProtocol.DeclarationCategory.Variable: {
            return [PyrightNodes.ParseNodeType.Name, PyrightNodes.ParseNodeType.StringList];
        }
        case TypeServerProtocol.DeclarationCategory.Param: {
            return [PyrightNodes.ParseNodeType.Parameter];
        }
        case TypeServerProtocol.DeclarationCategory.TypeParam: {
            return [PyrightNodes.ParseNodeType.TypeParameter];
        }
        case TypeServerProtocol.DeclarationCategory.TypeAlias: {
            return [PyrightNodes.ParseNodeType.TypeAlias];
        }
        case TypeServerProtocol.DeclarationCategory.Function: {
            return [PyrightNodes.ParseNodeType.Function];
        }
        case TypeServerProtocol.DeclarationCategory.Class: {
            return [PyrightNodes.ParseNodeType.Class, PyrightNodes.ParseNodeType.TypeAnnotation];
        }
    }
}

export function toProtocolTypeFlags(type: PyrightTypes.Type): TypeServerProtocol.TypeFlags {
    let flags = TypeServerProtocol.TypeFlags.None;
    if (PyrightTypes.isClass(type) && isLiteralType(type)) {
        flags |= TypeServerProtocol.TypeFlags.Literal;
    }
    if (PyrightTypes.isClass(type) && type.shared.typeParams.length > 0) {
        flags |= TypeServerProtocol.TypeFlags.Generic;
    }
    if (PyrightTypes.TypeBase.isInstance(type)) {
        flags |= TypeServerProtocol.TypeFlags.Instance;
    }
    if (PyrightTypes.TypeBase.isInstantiable(type)) {
        flags |= TypeServerProtocol.TypeFlags.Instantiable;
    }
    if (isCallableType(type)) {
        flags |= TypeServerProtocol.TypeFlags.Callable;
    }
    if (PyrightTypes.isClass(type) && PyrightTypes.ClassType.isProtocolClass(type)) {
        flags |= TypeServerProtocol.TypeFlags.Interface;
    }
    if (type.props?.typeAliasInfo) {
        flags |= TypeServerProtocol.TypeFlags.FromAlias;
    }
    if (PyrightTypes.isUnpacked(type)) {
        flags |= TypeServerProtocol.TypeFlags.Unpacked;
    }
    return flags;
}

export function fromProtocolTypeFlags(protocolFlags: TypeServerProtocol.TypeFlags): PyrightTypes.TypeFlags {
    let flags = PyrightTypes.TypeFlags.None;
    if (protocolFlags & TypeServerProtocol.TypeFlags.Instance) {
        flags |= PyrightTypes.TypeFlags.Instance;
    }
    if (protocolFlags & TypeServerProtocol.TypeFlags.Instantiable) {
        flags |= PyrightTypes.TypeFlags.Instantiable;
    }
    return flags;
}

export function toProtocolVariance(
    variance: PyrightTypes.Variance | undefined
): TypeServerProtocol.Variance | undefined {
    if (variance === undefined) {
        return undefined;
    }

    switch (variance) {
        case PyrightTypes.Variance.Auto:
            return TypeServerProtocol.Variance.Auto;
        case PyrightTypes.Variance.Unknown:
            return TypeServerProtocol.Variance.Unknown;
        case PyrightTypes.Variance.Invariant:
            return TypeServerProtocol.Variance.Invariant;
        case PyrightTypes.Variance.Covariant:
            return TypeServerProtocol.Variance.Covariant;
        case PyrightTypes.Variance.Contravariant:
            return TypeServerProtocol.Variance.Contravariant;
        default:
            debug.assertNever(variance);
    }

    return TypeServerProtocol.Variance.Unknown;
}

export function fromProtocolVariance(
    variance: TypeServerProtocol.Variance | undefined
): PyrightTypes.Variance | undefined {
    if (variance === undefined) {
        return undefined;
    }

    switch (variance) {
        case TypeServerProtocol.Variance.Auto:
            return PyrightTypes.Variance.Auto;
        case TypeServerProtocol.Variance.Unknown:
            return PyrightTypes.Variance.Unknown;
        case TypeServerProtocol.Variance.Invariant:
            return PyrightTypes.Variance.Invariant;
        case TypeServerProtocol.Variance.Covariant:
            return PyrightTypes.Variance.Covariant;
        case TypeServerProtocol.Variance.Contravariant:
            return PyrightTypes.Variance.Contravariant;
        default:
            debug.assertNever(variance);
    }

    return PyrightTypes.Variance.Unknown;
}
