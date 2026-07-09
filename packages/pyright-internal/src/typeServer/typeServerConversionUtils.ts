/**
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * abstractConversionUtils.ts
 *
 * Conversion utilities for converting between concrete and abstract representations of nodes and declarations.
 */
import { TypeServerProtocol } from './protocol/typeServerProtocol';
import { CancellationToken } from 'vscode-languageserver-protocol';

import { Declaration, DeclarationType } from '../analyzer/declaration';
import { getChildNodes, ParseTreeWalker } from '../analyzer/parseTreeWalker';
import * as PyrightTypes from '../analyzer/types';
import { assert } from '../common/debug';
import { convertTextRangeToRange } from '../common/positionUtils';
import { PythonVersion } from '../common/pythonVersion';
import { Uri } from '../common/uri/uri';
import { convertUriToLspUriString } from '../common/uri/uriUtils';
import * as PyrightNodes from '../parser/parseNodes';

import { ITypeServerEvaluator } from './typeServerEvaluator';
import { isDeclaration, map } from './typeEvalUtils';
import { IProgram } from './programTypes';

import {
    generateStubFromClassType,
    generateStubFromFunctionType,
    generateStubFromTypeVar,
    StubGenerationOptions,
    StubGenerationResult,
} from './stubGenerator';
import { TypeProvider } from './typeProvider';
import {
    IPyrightTypeFactory,
    toProtocolDecl,
    toProtocolNode,
    toProtocolTypeFlags,
    toProtocolVariance,
} from './typeServerConversionTypes';
import { TypeShellFactory } from './typeShellFactory';

export function toProtocolModuleName(moduleName: string): TypeServerProtocol.ModuleName {
    if (moduleName.length === 0) {
        return { leadingDots: 0, nameParts: [] };
    }

    let startIndex = 0;
    let leadingDots = 0;
    for (; startIndex < moduleName.length; startIndex++) {
        if (moduleName[startIndex] !== '.') {
            break;
        }

        leadingDots++;
    }

    return {
        leadingDots,
        nameParts: moduleName.slice(startIndex).split('.'),
    };
}

export class ProtocolTypeFactory {
    private _id = 0;
    private readonly _cycleMap = new Map<PyrightTypes.Type, number>();
    private readonly _sourceUri: Uri;
    private readonly _evaluator: ITypeServerEvaluator;

    constructor(
        readonly view: IProgram,
        readonly pythonVersion: PythonVersion,
        declarationOrNode: Declaration | PyrightNodes.ParseNode
    ) {
        this._evaluator = view.createEvaluator();
        // Extract source URI from declaration or node
        this._sourceUri = this._extractSourceUri(declarationOrNode);
    }

    get sourceUri() {
        return this._sourceUri;
    }

    get evaluator() {
        return this._evaluator;
    }

    getNextId() {
        return this._id++;
    }

    getModule(type: PyrightTypes.FunctionType | PyrightTypes.ClassType): PyrightTypes.ModuleType {
        const moduleName = type.shared.moduleName;
        const moduleDescriptor = toProtocolModuleName(moduleName);
        const moduleUri =
            this.view.resolveImport(this.sourceUri, moduleDescriptor, CancellationToken.None) || this.sourceUri;
        const moduleNode = this.view.getParserOutput(moduleUri)?.parseTree;
        assert(moduleNode !== undefined, `Module node not found for URI: ${moduleUri.toString()}`);
        const scope = this.view.symbolLookup.getScope(moduleNode);
        const symbolTable = scope?.symbolTable;
        return PyrightTypes.ModuleType.create(moduleName, moduleUri, symbolTable);
    }

    getType(type: PyrightTypes.Type): TypeServerProtocol.Type {
        const newId = this.getNextId();

        const existingTypeId = this._cycleMap.get(type);
        if (existingTypeId !== undefined) {
            return {
                id: newId,
                kind: TypeServerProtocol.TypeKind.TypeReference,
                flags: TypeServerProtocol.TypeFlags.None,
                typeReferenceId: existingTypeId,
            };
        }

        this._set(type, newId);
        return toProtocolType(newId, type, this);
    }

    private _set(type: PyrightTypes.Type, id: number) {
        this._cycleMap.set(type, id);
    }

    private _extractSourceUri(declarationOrNode: Declaration | PyrightNodes.ParseNode): Uri {
        if (isDeclaration(declarationOrNode)) {
            return declarationOrNode.uri;
        } else {
            return this.view.getUri(declarationOrNode);
        }
    }
}

function toProtocolTypesOrUndefined(
    types: PyrightTypes.Type[] | undefined,
    factory: ProtocolTypeFactory
): TypeServerProtocol.Type[] | undefined {
    if (!types) {
        return undefined;
    }

    return toProtocolTypes(types, factory);
}

function toProtocolTypes(types: PyrightTypes.Type[], factory: ProtocolTypeFactory): TypeServerProtocol.Type[] {
    return map(types, (type) => factory.getType(type));
}

function toProtocolTypeOrUndefined(
    type: PyrightTypes.Type | undefined,
    factory: ProtocolTypeFactory
): TypeServerProtocol.Type | undefined {
    if (!type) {
        return undefined;
    }

    return factory.getType(type);
}

function toProtocolTypeArgs(type: PyrightTypes.ClassType, factory: ProtocolTypeFactory) {
    // See if we have any type arguments. Set those on the handle too.
    let typeArgs: TypeServerProtocol.Type[] | undefined = undefined;
    if (type.priv.tupleTypeArgs) {
        typeArgs = toProtocolTypesOrUndefined(
            type.priv.tupleTypeArgs.map((t) => t.type),
            factory
        );

        // Set the flags on each based on tuple information
        for (let i = 0; i < type.priv.tupleTypeArgs.length; i++) {
            if (typeArgs && typeArgs[i] && type.priv.tupleTypeArgs[i].isUnbounded) {
                (typeArgs[i].flags as any) |= TypeServerProtocol.TypeFlags.Unbound;
            }
            if (typeArgs && typeArgs[i] && type.priv.tupleTypeArgs[i].isOptional) {
                (typeArgs[i].flags as any) |= TypeServerProtocol.TypeFlags.Optional;
            }
        }
    } else if (type.priv.typeArgs) {
        typeArgs = toProtocolTypesOrUndefined(type.priv.typeArgs, factory);
    }

    return typeArgs;
}

function toProtocolTypeAliasInfo(info: PyrightTypes.TypeAliasInfo | undefined, factory: ProtocolTypeFactory) {
    if (!info) {
        return undefined;
    }

    return {
        name: info.shared.name,
        fullName: info.shared.fullName,
        moduleName: info.shared.moduleName,
        fileUri: convertUriToLspUriString(factory.view.fs, info.shared.fileUri),
        scopeId: info.shared.typeVarScopeId,
        isTypeAliasType: info.shared.isTypeAliasType,
        typeParams: toProtocolTypesOrUndefined(info.shared.typeParams, factory),
        typeArgs: toProtocolTypesOrUndefined(info.typeArgs, factory),
        computedVariance: info.shared.computedVariance?.map(
            (v) => toProtocolVariance(v) ?? TypeServerProtocol.Variance.Unknown
        ),
    } satisfies TypeServerProtocol.TypeAliasInfo;
}

// This should be only called from TspTypeFactory
// Otherwise, cycle detection won't work.
function toProtocolType(id: number, type: PyrightTypes.Type, factory: ProtocolTypeFactory): TypeServerProtocol.Type {
    switch (type.category) {
        case PyrightTypes.TypeCategory.Class: {
            const decl = type.shared.declaration;
            if (decl) {
                return {
                    id,
                    kind: TypeServerProtocol.TypeKind.Class,
                    flags: toProtocolTypeFlags(type),
                    typeAliasInfo: toProtocolTypeAliasInfo(type.props?.typeAliasInfo, factory),

                    declaration: toProtocolDecl(decl, factory.view),
                    literalValue: toProtocolLiteralValue(type, factory),
                    typeArgs: toProtocolTypeArgs(type, factory),
                } satisfies TypeServerProtocol.ClassType;
            }

            return createSynthesizedType(id, type, factory);
        }
        case PyrightTypes.TypeCategory.Function: {
            const decl = type.shared.declaration;
            if (decl) {
                // Compute boundToType: if not set but strippedFirstParamType exists, use it as boundToType
                let boundToType = type.priv.boundToType;
                if (
                    !boundToType &&
                    type.priv.strippedFirstParamType &&
                    PyrightTypes.isClass(type.priv.strippedFirstParamType)
                ) {
                    boundToType = type.priv.strippedFirstParamType;
                }

                const returnType = PyrightTypes.FunctionType.getEffectiveReturnType(type, true);
                return {
                    id,
                    kind: TypeServerProtocol.TypeKind.Function,
                    flags: toProtocolTypeFlags(type),
                    typeAliasInfo: toProtocolTypeAliasInfo(type.props?.typeAliasInfo, factory),

                    declaration: toProtocolDecl(decl, factory.view),

                    specializedTypes: toProtocolSpecializedFunctionTypesOrUndefined(
                        type.priv.specializedTypes,
                        factory
                    ),
                    boundToType: toProtocolTypeOrUndefined(boundToType, factory),

                    returnType: toProtocolTypeOrUndefined(returnType, factory),
                } satisfies TypeServerProtocol.FunctionType;
            }

            return createSynthesizedType(id, type, factory);
        }
        case PyrightTypes.TypeCategory.Overloaded: {
            const implementation = PyrightTypes.OverloadedType.getImplementation(type);
            const overloaded = PyrightTypes.OverloadedType.getOverloads(type);

            return {
                id,
                kind: TypeServerProtocol.TypeKind.Overloaded,
                flags: toProtocolTypeFlags(type),
                overloads: toProtocolTypes(overloaded, factory),
                implementation: toProtocolTypeOrUndefined(implementation, factory),
            } satisfies TypeServerProtocol.OverloadedType;
        }
        case PyrightTypes.TypeCategory.TypeVar: {
            const declaration = getDeclarationForTypeVar(type, factory);
            if (declaration) {
                return {
                    id,
                    kind: TypeServerProtocol.TypeKind.TypeVar,
                    flags: toProtocolTypeFlags(type),
                    declaration: toProtocolDecl(declaration, factory.view),
                } satisfies TypeServerProtocol.TypeVarType;
            }

            return createSynthesizedType(id, type, factory);
        }
        case PyrightTypes.TypeCategory.Unbound: {
            const handle: TypeServerProtocol.BuiltInType = {
                id,
                kind: TypeServerProtocol.TypeKind.BuiltIn,
                flags: toProtocolTypeFlags(type),
                name: 'unbound',
            };

            return handle;
        }
        case PyrightTypes.TypeCategory.Unknown: {
            const possibleType = type.priv.possibleType;
            const handle: TypeServerProtocol.BuiltInType = {
                id,
                kind: TypeServerProtocol.TypeKind.BuiltIn,
                flags: toProtocolTypeFlags(type),
                name: 'unknown',
                possibleType: toProtocolTypeOrUndefined(possibleType, factory),
            };
            return handle;
        }
        case PyrightTypes.TypeCategory.Any: {
            const handle: TypeServerProtocol.BuiltInType = {
                id,
                kind: TypeServerProtocol.TypeKind.BuiltIn,
                flags: toProtocolTypeFlags(type),
                name: type.priv.isEllipsis ? 'ellipsis' : 'any',
            };
            return handle;
        }
        case PyrightTypes.TypeCategory.Never: {
            const handle: TypeServerProtocol.BuiltInType = {
                id,
                kind: TypeServerProtocol.TypeKind.BuiltIn,
                flags: toProtocolTypeFlags(type),
                name: type.priv.isNoReturn ? 'noreturn' : 'never',
            };
            return handle;
        }
        case PyrightTypes.TypeCategory.Union:
            return {
                id,
                kind: TypeServerProtocol.TypeKind.Union,
                flags: toProtocolTypeFlags(type),
                typeAliasInfo: toProtocolTypeAliasInfo(type.props?.typeAliasInfo, factory),

                subTypes: map(type.priv.subtypes, (t) => factory.getType(t)),
            } satisfies TypeServerProtocol.UnionType;

        case PyrightTypes.TypeCategory.Module: {
            return {
                id,
                kind: TypeServerProtocol.TypeKind.Module,
                flags: toProtocolTypeFlags(type),
                moduleName: type.priv.moduleName,
                uri: convertUriToLspUriString(factory.view.fs, type.priv.fileUri),
            } satisfies TypeServerProtocol.ModuleType;
        }
    }
}

export class PyrightTypeFactory {
    private readonly _cycleMap = new Map<number, PyrightTypes.Type>();
    private readonly _typeShellFactory: IPyrightTypeFactory;
    private readonly _typeProvider: IPyrightTypeFactory;

    constructor(view: IProgram) {
        this._typeShellFactory = new TypeShellFactory(this._cycleMap, view);
        this._typeProvider = new TypeProvider(this._cycleMap, view);
    }

    getType(protocolType: TypeServerProtocol.Type): PyrightTypes.Type {
        // this is 2 pass of type handle to toProtocolHandle cycles.
        // first pass, create type shells for all types.
        this._typeShellFactory.getType(protocolType);

        // second pass, fill in type details.
        return this._typeProvider.getType(protocolType);
    }
}

function createSynthesizedType(
    id: number,
    type: PyrightTypes.FunctionType | PyrightTypes.ClassType | PyrightTypes.TypeVarType,
    factory: ProtocolTypeFactory
): TypeServerProtocol.SynthesizedType {
    const options = { pythonVersion: factory.pythonVersion } satisfies StubGenerationOptions;
    let moduleHandle: TypeServerProtocol.ModuleType;
    let stubResult: StubGenerationResult;

    if (PyrightTypes.isTypeVar(type)) {
        const moduleName = factory.view.getModuleName(factory.sourceUri) ?? '';
        const moduleType = PyrightTypes.ModuleType.create(moduleName, factory.sourceUri, new Map());
        moduleHandle = factory.getType(moduleType) as TypeServerProtocol.ModuleType;

        stubResult = generateStubFromTypeVar(type, options);
    } else {
        const module = factory.getModule(type);
        moduleHandle = factory.getType(module) as TypeServerProtocol.ModuleType;

        stubResult = PyrightTypes.isFunction(type)
            ? generateStubFromFunctionType(factory.evaluator, type, options)
            : generateStubFromClassType(factory.evaluator, type, options);
    }

    const metadata: TypeServerProtocol.SynthesizedTypeMetadata = {
        module: moduleHandle,
        primaryDefinitionOffset: stubResult.primaryDefinitionOffset,
    };

    return {
        id,
        kind: TypeServerProtocol.TypeKind.Synthesized,
        flags: toProtocolTypeFlags(type),
        typeAliasInfo: toProtocolTypeAliasInfo(type.props?.typeAliasInfo, factory),
        stubContent: stubResult.stubContent,
        metadata,
    } satisfies TypeServerProtocol.SynthesizedType;
}

function toProtocolSpecializedFunctionTypesOrUndefined(
    specializedTypes: PyrightTypes.SpecializedFunctionTypes | undefined,
    factory: ProtocolTypeFactory
): TypeServerProtocol.SpecializedFunctionTypes | undefined {
    if (!specializedTypes) {
        return undefined;
    }

    return {
        parameterTypes: map(specializedTypes.parameterTypes, (t) => factory.getType(t)),
        parameterDefaultTypes: specializedTypes.parameterDefaultTypes
            ? map(specializedTypes.parameterDefaultTypes, (t) => toProtocolTypeOrUndefined(t, factory))
            : undefined,
        returnType: toProtocolTypeOrUndefined(specializedTypes.returnType, factory),
    };
}

function toProtocolLiteralValue(
    type: PyrightTypes.ClassType,
    factory: ProtocolTypeFactory
): TypeServerProtocol.LiteralValue | undefined {
    const value = type.priv.literalValue;
    if (value === undefined) {
        return undefined;
    }

    if (value instanceof PyrightTypes.SentinelLiteral) {
        return {
            classNode: toProtocolNode(type.shared.declaration!.node, factory.view),
            moduleName: type.shared.moduleName,
            className: value.className,
        } satisfies TypeServerProtocol.SentinelLiteral;
    }

    if (value instanceof PyrightTypes.EnumLiteral) {
        return {
            className: value.className,
            itemName: value.itemName,
            itemType: factory.getType(value.itemType),
        } satisfies TypeServerProtocol.EnumLiteral;
    }

    return value;
}

// Attempts to recover the original declaration node for a TypeVar so we can serialize
// the same metadata the evaluator used when the symbol was first defined. Stub-based
// reconstruction frequently loses this link, so we search for it on demand using the
// scope id that is preserved on the TypeVar instance.
export function getDeclarationForTypeVar(
    typeVar: PyrightTypes.TypeVarType,
    factory: ProtocolTypeFactory
): Declaration | undefined {
    // freeTypeVar stores the "canonical" definition for synthesized instances that were
    // cloned for specialization. Always operate on that canonical TypeVar when available.
    const canonicalTypeVar = typeVar.priv.freeTypeVar ?? typeVar;

    if (canonicalTypeVar.shared.isSynthesized) {
        return undefined;
    }

    // Without a scope id we have no way to map the TypeVar back to the parse tree.
    const scopeId = canonicalTypeVar.priv.scopeId;
    if (!scopeId) {
        return undefined;
    }

    const scopeNode = findScopeNodeForId(scopeId, factory.view);
    if (!scopeNode) {
        return undefined;
    }

    // Start by inspecting the symbol table attached to the original scope; this covers
    // most cases for function, class, and alias TypeVars.
    let symbolTable = factory.view.symbolLookup.getSymbolsForNode(scopeNode);
    if (!symbolTable && scopeNode.nodeType === PyrightNodes.ParseNodeType.Module) {
        const fileInfo = factory.view.symbolLookup.getFileInfo(scopeNode);
        symbolTable = factory.view.symbolLookup.getSymbolsForFile(fileInfo.fileUri);
    }

    const typeVarName = canonicalTypeVar.shared.name;
    let symbol = symbolTable?.get(typeVarName) ?? factory.view.symbolLookup.lookupSymbol(scopeNode, typeVarName);

    if (
        (!symbol || symbol.getDeclarations().length === 0) &&
        scopeNode.nodeType !== PyrightNodes.ParseNodeType.Module
    ) {
        // For nested scopes we can fall back to the file-level module scope. This is
        // common when using PEP 695 syntax where a type parameter is hoisted into the
        // containing module table for reuse.
        const moduleNode = findModuleAncestor(scopeNode);
        if (moduleNode) {
            const moduleInfo = factory.view.symbolLookup.getFileInfo(moduleNode);
            const moduleSymbols = factory.view.symbolLookup.getSymbolsForFile(moduleInfo.fileUri);
            const moduleSymbol = moduleSymbols?.get(typeVarName);
            if (moduleSymbol) {
                symbol = moduleSymbol;
            } else {
                symbol = factory.view.symbolLookup.lookupSymbol(moduleNode, typeVarName);
            }
        }
    }

    const declarations = symbol?.getDeclarations();
    if (!declarations || declarations.length === 0) {
        // As a final attempt, locate the syntactic TypeParameter node and synthesize a
        // declaration object pointing to it. This ensures we at least return file/offset
        // information even when binding never populated a symbol.
        const typeParamNode = findTypeParameterNode(scopeNode, typeVarName);
        if (typeParamNode) {
            const fileInfo = factory.view.symbolLookup.getFileInfo(typeParamNode);
            return {
                type: DeclarationType.TypeParam,
                node: typeParamNode,
                uri: fileInfo.fileUri,
                range: convertTextRangeToRange(typeParamNode, fileInfo.lines),
                moduleName: fileInfo.moduleName,
                isInExceptSuite: false,
            } satisfies Declaration;
        }
        return undefined;
    }

    const typeParamDecl = declarations.find((decl) => decl.type === DeclarationType.TypeParam);
    return typeParamDecl ?? declarations[0];
}

// Search all known parse trees to locate the node that owns the provided scope id.
// Scope ids are assigned to functions, classes, modules, and type aliases; once we
// find the matching node we can dig into its symbol table for declarations.
function findScopeNodeForId(scopeId: string, view: IProgram): PyrightNodes.ParseNode | undefined {
    const targetPrefix = scopeId.split('.', 1)[0];
    const matchingFiles = view.symbolLookup.getMatchingFileInfos(targetPrefix);

    for (const fileInfo of matchingFiles) {
        const parseResults = view.getParserOutput(fileInfo.fileUri);
        if (!parseResults) {
            continue;
        }

        const stack: PyrightNodes.ParseNode[] = [parseResults.parseTree];
        while (stack.length > 0) {
            const node = stack.pop()!;
            const nodeScopeId = view.symbolLookup.getScopeIdForNode(node);
            if (isTypeVarScopeCandidate(node) && nodeScopeId === scopeId) {
                return node;
            }

            // Expression nodes cannot contain declarations, so skip their children.
            if (!PyrightNodes.isExpressionNode(node)) {
                for (const child of getChildNodes(node)) {
                    if (child) {
                        stack.push(child);
                    }
                }
            }
        }
    }

    return undefined;
}

// Returns the TypeParameter node with the requested name if the enclosing scope declares
// type parameters (function/class/type alias). This gives us a concrete parse node even
// when the TypeVar was not bound to a symbol table entry.
function findTypeParameterNode(
    scopeNode: PyrightNodes.ParseNode,
    typeVarName: string
): PyrightNodes.TypeParameterNode | undefined {
    let typeParams: PyrightNodes.TypeParameterListNode | undefined;

    switch (scopeNode.nodeType) {
        case PyrightNodes.ParseNodeType.Function:
        case PyrightNodes.ParseNodeType.Class:
        case PyrightNodes.ParseNodeType.TypeAlias:
            typeParams = scopeNode.d.typeParams;
            break;
        case PyrightNodes.ParseNodeType.Module:
            typeParams = undefined;
            break;
    }

    if (!typeParams) {
        return undefined;
    }

    return typeParams.d.params.find((param) => param.d.name.d.value === typeVarName);
}

// Walks parent pointers up to the root module node. Used when we fall back to the
// file-level scope to locate a TypeVar that was re-exported at module scope.
function findModuleAncestor(node: PyrightNodes.ParseNode): PyrightNodes.ModuleNode | undefined {
    let current: PyrightNodes.ParseNode | undefined = node;
    while (current) {
        if (current.nodeType === PyrightNodes.ParseNodeType.Module) {
            return current as PyrightNodes.ModuleNode;
        }
        current = current.parent;
    }
    return undefined;
}

// Only certain node kinds introduce scope ids; this helper keeps the search logic focused
// on those nodes to avoid unnecessary traversal work during scope discovery.
function isTypeVarScopeCandidate(node: PyrightNodes.ParseNode): boolean {
    switch (node.nodeType) {
        case PyrightNodes.ParseNodeType.Module:
        case PyrightNodes.ParseNodeType.Class:
        case PyrightNodes.ParseNodeType.Function:
        case PyrightNodes.ParseNodeType.TypeAlias:
            return true;
        default:
            return false;
    }
}

export function findFirstExpression(node: PyrightNodes.ParseNode): PyrightNodes.ExpressionNode | undefined {
    if (PyrightNodes.isExpressionNode(node)) {
        return node as PyrightNodes.ExpressionNode;
    }

    class ExpressionNodeWalker extends ParseTreeWalker {
        private _result: PyrightNodes.ExpressionNode | undefined;

        getResult(): PyrightNodes.ExpressionNode | undefined {
            return this._result;
        }

        override visitNode(node: PyrightNodes.ParseNode): PyrightNodes.ParseNodeArray {
            if (PyrightNodes.isExpressionNode(node)) {
                this._result = node as PyrightNodes.ExpressionNode;
                return [];
            }
            return super.visitNode(node);
        }
    }
    const walker = new ExpressionNodeWalker();
    walker.walk(node);

    return walker.getResult();
}
