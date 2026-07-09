import { TypeServerProtocol } from './protocol/typeServerProtocol';

import { findNodeByOffset, getClassFullName, getDocString } from '../analyzer/parseTreeUtils';
import { getScopeForNode } from '../analyzer/scopeUtils';
import { Symbol, SymbolTable } from '../analyzer/symbol';
import * as PyrightTypes from '../analyzer/types';
import { combineTupleTypeArgs, computeMroLinearization } from '../analyzer/typeUtils';
import { assert } from '../common/debug';
import { Uri } from '../common/uri/uri';
import * as PyrightNodes from '../parser/parseNodes';

import { isReprEnumClass } from './enums';
import { ITypeServerEvaluator } from './typeServerEvaluator';
import { map } from './typeEvalUtils';
import { convertLspUriStringToUri } from './serverUtils';
import { IProgram, ISymbolLookup } from './programTypes';

import {
    fromProtocolNode,
    fromProtocolTypeOrUndefined,
    fromProtocolTypes,
    fromProtocolTypesOrUndefined,
    fromProtocolVariance,
    IPyrightTypeFactory,
    isClass,
    isEnumLiteral,
    isSentinelLiteral,
} from './typeServerConversionTypes';
import * as ProtocolUtils from './typeServerProtocolUtils';

export class TypeProvider implements IPyrightTypeFactory {
    private readonly _evaluator: ITypeServerEvaluator;

    constructor(private readonly _cycleMap: Map<number, PyrightTypes.Type>, private readonly _view: IProgram) {
        // Create the evaluator once so the hot type-conversion path doesn't
        // allocate a fresh evaluator on every `createEvaluator()` call.
        this._evaluator = _view.createEvaluator();
    }

    get provider(): IProgram {
        return this._view;
    }

    get symbolLookup(): ISymbolLookup {
        return this._view.symbolLookup;
    }

    getType(type: TypeServerProtocol.Type): PyrightTypes.Type {
        if (type.kind === TypeServerProtocol.TypeKind.TypeReference) {
            return this.getTypeReference(type.typeReferenceId);
        }

        return fromProtocolType(type, this, this.symbolLookup);
    }

    getTypeShell(protocolType: TypeServerProtocol.Type): PyrightTypes.Type {
        const type = this._cycleMap.get(protocolType.id);
        if (type) {
            return type;
        }

        // This shouldn't happen.
        return PyrightTypes.UnknownType.create();
    }

    getTypeReference(typeReferenceId: number): PyrightTypes.Type {
        const type = this._cycleMap.get(typeReferenceId);
        if (!type || (PyrightTypes.isUnknown(type) && type.priv.isIncomplete)) {
            // This shouldn't happen.
            return PyrightTypes.UnknownType.create();
        }

        return type;
    }

    createEvaluator(): ITypeServerEvaluator {
        return this._evaluator;
    }
}

function applyTypeFlags(
    pyrightType: PyrightTypes.Type,
    tspType: TypeServerProtocol.Type,
    factory: TypeProvider,
    symbolLookup: ISymbolLookup
): void {
    if (ProtocolUtils.isTypeFlagSet(tspType.flags, TypeServerProtocol.TypeFlags.Literal)) {
        const tspClassType = tspType as TypeServerProtocol.ClassType;
        fromProtocolLiteralValue(pyrightType, tspClassType.literalValue, factory);
    }

    if (PyrightTypes.isClass(pyrightType) && isClass(tspType) && tspType.typeArgs) {
        if (pyrightType.priv.tupleTypeArgs) {
            for (let i = 0; i < tspType.typeArgs.length; i++) {
                const typeArg = tspType.typeArgs[i];
                pyrightType.priv.tupleTypeArgs[i].type = fromProtocolType(typeArg, factory, symbolLookup);
                pyrightType.priv.tupleTypeArgs[i].isUnbounded =
                    (typeArg.flags & TypeServerProtocol.TypeFlags.Unbound) !== 0;
                pyrightType.priv.tupleTypeArgs[i].isOptional =
                    (typeArg.flags & TypeServerProtocol.TypeFlags.Optional) !== 0;
            }
            pyrightType.priv.typeArgs = [combineTupleTypeArgs(pyrightType.priv.tupleTypeArgs)];
        } else if (pyrightType.priv.typeArgs) {
            for (let i = 0; i < tspType.typeArgs.length; i++) {
                pyrightType.priv.typeArgs[i] = fromProtocolType(tspType.typeArgs[i], factory, symbolLookup);
            }
        }
    }
}

function fromProtocolLiteralValue(
    type: PyrightTypes.Type,
    value: TypeServerProtocol.LiteralValue | undefined,
    factory: TypeProvider
): void {
    if (value === undefined) {
        return;
    }

    if (!PyrightTypes.isClass(type) || !type.priv.literalValue) {
        return;
    }

    if (isSentinelLiteral(value)) {
        const classNode = fromProtocolNode<PyrightNodes.ParseNode>(value.classNode, factory.provider);
        const literal = new PyrightTypes.SentinelLiteral(
            getClassFullName(classNode, value.moduleName, value.className),
            value.className
        );

        type.priv.literalValue = literal;
        return;
    }

    if (isEnumLiteral(value)) {
        const literal = new PyrightTypes.EnumLiteral(
            'Not Used',
            value.className,
            value.itemName,
            factory.getType(value.itemType) ?? PyrightTypes.UnknownType.create(),
            isReprEnumClass(type)
        );
        type.priv.literalValue = literal;
        return;
    }

    type.priv.literalValue = value;
}

function applyTypeProps(
    type: PyrightTypes.Type,
    props: { instantiableDepth?: number; typeAliasInfo?: PyrightTypes.TypeAliasInfo }
) {
    const typeProps = PyrightTypes.TypeBase.addProps(type);

    if (props.instantiableDepth !== undefined) {
        typeProps.instantiableDepth = props.instantiableDepth;
    }

    if (props.typeAliasInfo !== undefined) {
        typeProps.typeAliasInfo = props.typeAliasInfo;
    }
}

function fromProtocolTypeAliasInfo(
    type: PyrightTypes.Type,
    info: TypeServerProtocol.TypeAliasInfo | undefined,
    factory: TypeProvider
): void {
    if (!info) {
        return;
    }

    const aliasInfo = {
        shared: {
            name: info.name,
            fullName: info.fullName,
            moduleName: info.moduleName,
            fileUri: convertLspUriStringToUri(info.fileUri, factory.provider, factory.provider.uriMapper),
            typeVarScopeId: info.scopeId,
            isTypeAliasType: info.isTypeAliasType,
            typeParams: fromProtocolTypesOrUndefined(info.typeParams, factory) as
                | PyrightTypes.TypeVarType[]
                | undefined,
            computedVariance: info.computedVariance?.map(
                (v) => fromProtocolVariance(v) ?? PyrightTypes.Variance.Unknown
            ),
        },
        typeArgs: fromProtocolTypesOrUndefined(info.typeArgs, factory),
    } satisfies PyrightTypes.TypeAliasInfo;

    if (aliasInfo.shared.typeVarScopeId && aliasInfo.shared.typeParams) {
        // When aliases come back from the protocol, their type parameters may have
        // fallen back to a generic module-level scope. Re-scope them so they behave
        // like the original alias parameters; otherwise comparisons that rely on
        // scope ids (e.g., TypeVar.nameWithScope) will treat them as fresh TypeVars.
        const scopeId = aliasInfo.shared.typeVarScopeId;
        const scopeName = aliasInfo.shared.name;
        const scopeType = PyrightTypes.TypeVarScopeType.TypeAlias;

        aliasInfo.shared.typeParams = aliasInfo.shared.typeParams.map((param) => {
            if (!PyrightTypes.isTypeVar(param)) {
                return param;
            }

            if (param.priv.scopeId === scopeId) {
                return param;
            }

            const instantiable = PyrightTypes.TypeBase.isInstance(param)
                ? PyrightTypes.TypeVarType.cloneAsInstantiable(param)
                : param;
            const scopedParam = PyrightTypes.TypeVarType.cloneForScopeId(instantiable, scopeId, scopeName, scopeType);
            return PyrightTypes.TypeVarType.cloneAsInstance(scopedParam);
        }) as PyrightTypes.TypeVarType[];
    }

    applyTypeProps(type, { typeAliasInfo: aliasInfo });
}

function applySpecializedTypes(
    pyrightType: PyrightTypes.Type,
    tspType: TypeServerProtocol.FunctionType,
    factory: TypeProvider
): PyrightTypes.Type {
    if (!PyrightTypes.isFunction(pyrightType)) {
        return pyrightType;
    }

    pyrightType.priv.specializedTypes = fromProtocolSpecializedFunctionTypesOrUndefined(
        tspType.specializedTypes,
        factory
    );

    if (
        PyrightTypes.isFunction(pyrightType) &&
        pyrightType.shared.typeVarScopeId &&
        pyrightType.priv.specializedTypes
    ) {
        // Specialized parameter / return types coming from the type server are no longer
        // associated with the function's scope id. Restore that link so synthesized
        // TypeVars continue to bind correctly (e.g., for auto-generated stubs or bound methods).
        const scopeId = pyrightType.shared.typeVarScopeId;
        const scopeName = pyrightType.shared.name ?? undefined;
        const scopeType = PyrightTypes.TypeVarScopeType.Function;

        pyrightType.priv.specializedTypes.parameterTypes = pyrightType.priv.specializedTypes.parameterTypes.map(
            (param) => {
                if (!PyrightTypes.isTypeVar(param)) {
                    return param;
                }

                if (PyrightTypes.TypeBase.isInstance(param)) {
                    const instantiable = PyrightTypes.TypeVarType.cloneAsInstantiable(param);
                    const scoped = PyrightTypes.TypeVarType.cloneForScopeId(
                        instantiable,
                        scopeId,
                        scopeName,
                        scopeType
                    );
                    return PyrightTypes.TypeVarType.cloneAsInstance(scoped);
                }

                return PyrightTypes.TypeVarType.cloneForScopeId(param, scopeId, scopeName, scopeType);
            }
        );

        if (
            pyrightType.priv.specializedTypes.returnType &&
            PyrightTypes.isTypeVar(pyrightType.priv.specializedTypes.returnType)
        ) {
            const returnType = pyrightType.priv.specializedTypes.returnType;

            // The protocol only carries raw TypeVar handles; bring them back into the function scope
            // so we preserve the same TypeVar identity that existed before serialization.
            if (PyrightTypes.TypeBase.isInstance(returnType)) {
                const instantiable = PyrightTypes.TypeVarType.cloneAsInstantiable(returnType);
                const scoped = PyrightTypes.TypeVarType.cloneForScopeId(instantiable, scopeId, scopeName, scopeType);
                pyrightType.priv.specializedTypes.returnType = PyrightTypes.TypeVarType.cloneAsInstance(scoped);
            } else {
                pyrightType.priv.specializedTypes.returnType = PyrightTypes.TypeVarType.cloneForScopeId(
                    returnType,
                    scopeId,
                    scopeName,
                    scopeType
                );
            }
        }
    }

    // If boundToType is set, the function was bound. We need to recreate the binding by cloning
    // the function with stripFirstParam=true. We don't use bindFunctionToClassOrObject because
    // that would recompute specializedTypes, but we want to preserve the exact specializedTypes
    // that were sent across the protocol (which were computed when the function was originally bound).
    const boundToType = fromProtocolTypeOrUndefined(tspType.boundToType, factory) as PyrightTypes.ClassType | undefined;

    if (boundToType) {
        // Clone the function with stripFirstParam=true to recreate the bound state
        const boundFunction = PyrightTypes.FunctionType.clone(pyrightType, /* stripFirstParam */ true, boundToType);
        return boundFunction;
    }

    return pyrightType;
}

function applyReturnType(
    pyrightType: PyrightTypes.Type,
    tspReturnType: TypeServerProtocol.Type | undefined,
    factory: TypeProvider
): void {
    if (
        !tspReturnType ||
        !PyrightTypes.isFunction(pyrightType) ||
        pyrightType.shared.declaredReturnType ||
        pyrightType.shared.inferredReturnType ||
        pyrightType.priv.specializedTypes?.returnType
    ) {
        return;
    }

    const existingReturnInfo = pyrightType.shared.inferredReturnType as { type: PyrightTypes.Type } | undefined;
    const existingReturn = existingReturnInfo?.type;

    if (existingReturn && PyrightTypes.isTypeVar(existingReturn) && existingReturn.priv.scopeId) {
        return;
    }

    const returnType = factory.getType(tspReturnType);

    if (PyrightTypes.isTypeVar(returnType)) {
        const specializedReturn = pyrightType.priv.specializedTypes?.returnType;

        if (specializedReturn && PyrightTypes.isTypeVar(specializedReturn) && specializedReturn.priv.scopeId) {
            pyrightType.shared.inferredReturnType = { type: specializedReturn };
            return;
        }

        const specializedParams = pyrightType.priv.specializedTypes?.parameterTypes;

        if (specializedParams && returnType.shared && specializedParams.length > 0) {
            // If the return TypeVar matches one of the parameter specializations, reuse the
            // already-scoped version. This keeps callback wrappers and decorators stable even
            // when the protocol rehydrates types from stubs.
            const matchingParam = specializedParams.find(
                (param: PyrightTypes.Type): param is PyrightTypes.TypeVarType =>
                    PyrightTypes.isTypeVar(param) &&
                    !!param.shared &&
                    param.shared.name === returnType.shared!.name &&
                    !!param.priv.scopeId
            );

            if (matchingParam) {
                let specialized = matchingParam;

                const returnIsInstance = PyrightTypes.TypeBase.isInstance(returnType);
                const paramIsInstance = PyrightTypes.TypeBase.isInstance(matchingParam);

                if (returnIsInstance && !paramIsInstance) {
                    specialized = PyrightTypes.TypeVarType.cloneAsInstance(matchingParam);
                } else if (!returnIsInstance && paramIsInstance) {
                    specialized = PyrightTypes.TypeVarType.cloneAsInstantiable(matchingParam);
                }

                pyrightType.shared.inferredReturnType = { type: specialized };
                return;
            }
        }

        if (!returnType.priv.scopeId && pyrightType.shared.typeVarScopeId) {
            // Otherwise ensure the return TypeVar is tied back to the function's scope
            // so downstream inference treats it as the same symbol as before serialization.
            const scopeId = pyrightType.shared.typeVarScopeId;
            const scopeName = pyrightType.shared.name ?? undefined;
            const scopeType = PyrightTypes.TypeVarScopeType.Function;

            if (PyrightTypes.TypeBase.isInstance(returnType)) {
                const instantiable = PyrightTypes.TypeVarType.cloneAsInstantiable(returnType);
                const scoped = PyrightTypes.TypeVarType.cloneForScopeId(instantiable, scopeId, scopeName, scopeType);
                pyrightType.shared.inferredReturnType = { type: PyrightTypes.TypeVarType.cloneAsInstance(scoped) };
            } else {
                const scoped = PyrightTypes.TypeVarType.cloneForScopeId(returnType, scopeId, scopeName, scopeType);
                pyrightType.shared.inferredReturnType = { type: scoped };
            }

            return;
        }
    }

    pyrightType.shared.inferredReturnType = { type: returnType };
}

function fromProtocolSpecializedFunctionTypesOrUndefined(
    specializedTypes: TypeServerProtocol.SpecializedFunctionTypes | undefined,
    factory: TypeProvider
): PyrightTypes.SpecializedFunctionTypes | undefined {
    if (!specializedTypes) {
        return undefined;
    }

    return {
        parameterTypes: fromProtocolTypes(specializedTypes.parameterTypes, factory),
        parameterDefaultTypes: specializedTypes.parameterDefaultTypes
            ? map(specializedTypes.parameterDefaultTypes, (t) => fromProtocolTypeOrUndefined(t, factory))
            : undefined,
        returnType: fromProtocolTypeOrUndefined(specializedTypes.returnType, factory),
    };
}

function searchSymbolTableForClassSymbol(symbolTable: SymbolTable | undefined, className: string): Symbol | undefined {
    if (!symbolTable) {
        return undefined;
    }

    // Split the className to handle nested classes
    const nameParts = className.split('.');
    let currentSymbolTable: SymbolTable | undefined = symbolTable;
    let symbol: Symbol | undefined;
    for (const part of nameParts) {
        if (!currentSymbolTable) {
            return undefined;
        }
        symbol = currentSymbolTable.get(part);
        if (!symbol) {
            return undefined;
        }
        currentSymbolTable = getScopeForNode(symbol.getDeclarations()[0].node)?.symbolTable;
    }
    return symbol;
}

// This should be only called from TypeFactory
// Otherwise, cycle detection won't work.
function fromProtocolType(
    protocolType: TypeServerProtocol.Type,
    factory: TypeProvider,
    symbolLookup: ISymbolLookup
): PyrightTypes.Type {
    switch (protocolType.kind) {
        case TypeServerProtocol.TypeKind.BuiltIn: {
            switch (protocolType.name) {
                case 'unknown': {
                    const type = factory.getTypeShell(protocolType);
                    applyTypeFlags(type, protocolType, factory, symbolLookup);

                    if (!PyrightTypes.isUnknown(type)) {
                        return type;
                    }

                    type.priv.possibleType = fromProtocolTypeOrUndefined(protocolType.possibleType, factory);
                    return type;
                }
            }

            return factory.getTypeShell(protocolType);
        }
        case TypeServerProtocol.TypeKind.Class: {
            const type = factory.getTypeShell(protocolType);
            applyTypeFlags(type, protocolType, factory, symbolLookup);

            if (PyrightTypes.isClass(type)) {
                fromProtocolTypeAliasInfo(type, protocolType.typeAliasInfo, factory);
                // Synthesized fields may not be computed yet. Force them to compute now.
                type.shared.synthesizeMethodsDeferred?.();
            }

            return type;
        }
        case TypeServerProtocol.TypeKind.Function: {
            let type = factory.getTypeShell(protocolType);
            applyTypeFlags(type, protocolType, factory, symbolLookup);

            if (PyrightTypes.isFunction(type)) {
                fromProtocolTypeAliasInfo(type, protocolType.typeAliasInfo, factory);
                // applySpecializedTypes may return a bound function, so use its result
                type = applySpecializedTypes(type, protocolType, factory);
                applyReturnType(type, protocolType.returnType, factory);
            }

            return type;
        }
        case TypeServerProtocol.TypeKind.Declared: {
            // Fallback for other declared types (rare)
            const type = factory.getTypeShell(protocolType);
            applyTypeFlags(type, protocolType, factory, symbolLookup);
            return type;
        }
        case TypeServerProtocol.TypeKind.Union: {
            const type = factory.getTypeShell(protocolType);
            applyTypeFlags(type, protocolType, factory, symbolLookup);

            if (!PyrightTypes.isUnion(type)) {
                return type;
            }

            fromProtocolTypeAliasInfo(type, protocolType.typeAliasInfo, factory);
            type.priv.subtypes = fromProtocolTypes(protocolType.subTypes, factory) as PyrightTypes.UnionableType[];
            return type;
        }
        case TypeServerProtocol.TypeKind.Module: {
            const moduleType = factory.getTypeShell(protocolType);
            applyTypeFlags(moduleType, protocolType, factory, symbolLookup);

            if (!PyrightTypes.isModule(moduleType)) {
                return moduleType;
            }

            if (!moduleType.priv.fileUri) {
                return moduleType;
            }

            const symbolTable = factory.symbolLookup.getSymbolsForFile(moduleType.priv.fileUri);
            const parseResults = factory.provider.getParserOutput(moduleType.priv.fileUri);
            if (symbolTable && parseResults) {
                moduleType.priv.fields = symbolTable;
                moduleType.priv.docString = getDocString(parseResults.parseTree.d.statements);
                moduleType.priv.notPresentFieldType = PyrightTypes.UnknownType.create();
            }

            // Loader fields will be filled in when symbols are requested.

            return moduleType;
        }
        case TypeServerProtocol.TypeKind.Overloaded: {
            const overloadedType = factory.getTypeShell(protocolType);
            applyTypeFlags(overloadedType, protocolType, factory, symbolLookup);
            if (!PyrightTypes.isOverloaded(overloadedType)) {
                return overloadedType;
            }

            overloadedType.priv._overloads = fromProtocolTypes(
                protocolType.overloads,
                factory
            ) as PyrightTypes.FunctionType[];
            overloadedType.priv._implementation = fromProtocolTypeOrUndefined(protocolType.implementation, factory);

            return overloadedType;
        }
        case TypeServerProtocol.TypeKind.Synthesized: {
            const originalType = factory.getTypeShell(protocolType);
            // Get the owning module and directory for this module if available
            let owningModule: PyrightTypes.ModuleType | undefined;
            let directoryUri: Uri | undefined;
            if (protocolType.metadata?.module) {
                owningModule = fromProtocolType(
                    protocolType.metadata.module,
                    factory,
                    symbolLookup
                ) as PyrightTypes.ModuleType;
                if (owningModule) {
                    assert(
                        owningModule.category === PyrightTypes.TypeCategory.Module,
                        'Expected owning module to be a module type'
                    );
                    assert(owningModule.priv.fileUri, 'Expected owning module to have a file URI');
                    directoryUri = owningModule.priv.fileUri;
                }
            }

            // Parse the stub content and evaluate it to reconstruct the type
            const { parseResults } = factory.provider.addStubCode(protocolType.stubContent, directoryUri);
            const evaluator = factory.createEvaluator();

            // Find the generated type definition using metadata offset
            const primaryOffset = protocolType.metadata.primaryDefinitionOffset;
            // Use the offset to find the exact node
            let node = findNodeByOffset(parseResults.parserOutput.parseTree, primaryOffset);

            // Walk up the tree to find a function, class, assignment, or type annotation node
            let targetNode:
                | PyrightNodes.FunctionNode
                | PyrightNodes.ClassNode
                | PyrightNodes.AssignmentNode
                | PyrightNodes.TypeAnnotationNode
                | undefined;
            while (node) {
                if (
                    node.nodeType === PyrightNodes.ParseNodeType.Function ||
                    node.nodeType === PyrightNodes.ParseNodeType.Class ||
                    node.nodeType === PyrightNodes.ParseNodeType.Assignment ||
                    node.nodeType === PyrightNodes.ParseNodeType.TypeAnnotation
                ) {
                    targetNode = node as
                        | PyrightNodes.FunctionNode
                        | PyrightNodes.ClassNode
                        | PyrightNodes.AssignmentNode
                        | PyrightNodes.TypeAnnotationNode;
                    break;
                }
                node = node.parent;
            }

            if (!targetNode) {
                // This should never happen since the stub generator guarantees a valid offset
                return originalType;
            }

            // Use the fresh evaluator to get the type from the node
            let type: PyrightTypes.Type | undefined;

            if (targetNode.nodeType === PyrightNodes.ParseNodeType.Assignment) {
                const assignNode = targetNode as PyrightNodes.AssignmentNode;

                if (assignNode.d.leftExpr.nodeType === PyrightNodes.ParseNodeType.Name) {
                    const nameNode = assignNode.d.leftExpr as PyrightNodes.NameNode;

                    const assignedType = evaluator.getType(nameNode);
                    type = assignedType;
                }
            } else if (targetNode.nodeType === PyrightNodes.ParseNodeType.Function) {
                const result = evaluator.getTypeOfFunction(targetNode as PyrightNodes.FunctionNode);
                type = result?.functionType;

                // Special case. If this is a classmethod, rewrite the type to be the original class type.
                // This makes sure we don't have two representations of the class type.
                if (type && PyrightTypes.isFunction(type) && type.shared.methodClass && owningModule) {
                    // We should have a module and that module should have the class symbol.
                    const symbolTable = symbolLookup.getSymbolsForFile(owningModule.priv.fileUri);
                    const classSymbol = searchSymbolTableForClassSymbol(
                        symbolTable,
                        type.shared.methodClass.shared.name
                    );
                    if (classSymbol) {
                        const classType = evaluator.getEffectiveTypeOfSymbol(classSymbol);
                        if (classType && PyrightTypes.isClass(classType)) {
                            type.shared.methodClass = classType;
                        }
                    }
                } else if (
                    type &&
                    PyrightTypes.isFunction(type) &&
                    type.shared.parameters.length > 0 &&
                    type.shared.methodClass === undefined
                ) {
                    // Compute the type of 'self' parameter if available
                    const firstParam = type.shared.parameters[0];
                    if (
                        firstParam &&
                        firstParam._type &&
                        firstParam.name === 'self' &&
                        firstParam._type.category === PyrightTypes.TypeCategory.TypeVar
                    ) {
                        // Mark the self type as synthesized.
                        firstParam._type = {
                            ...firstParam._type,
                            shared: { ...firstParam._type.shared },
                            priv: { ...firstParam._type.priv },
                            props: { ...firstParam._type.props },
                        } as PyrightTypes.TypeVarType;
                        firstParam._type.shared.isSynthesized = true;
                        firstParam._type.shared.isSynthesizedSelf = true;
                    }
                }
            } else if (targetNode.nodeType === PyrightNodes.ParseNodeType.TypeAnnotation) {
                // Extract the display string from the stub annotation (e.g. "list[int]" from "x: list[int]").
                const annotationLine = protocolType.stubContent.slice(protocolType.metadata.primaryDefinitionOffset);
                const displayMatch = annotationLine.match(/^x:\s*(.+)/);
                const displayStr = displayMatch?.[1]?.trim();

                // Try the evaluator first — this works now that the extracted typeshed is
                // on disk and reachable through resolveImport.
                type = evaluator.getType(targetNode.d.annotation);

                // Fall back to display-string parsing if the evaluator returns Unknown
                // (e.g. special forms like Literal, type[X]) or returns a class without
                // type arguments when the annotation has them (e.g. list[int] → list).
                const evaluatorLostInfo =
                    !type ||
                    PyrightTypes.isUnknown(type) ||
                    (PyrightTypes.isClass(type) && !type.priv.typeArgs?.length && displayStr?.includes('['));
                if (evaluatorLostInfo && displayStr) {
                    type = buildTypeFromDisplay(targetNode, displayStr, evaluator);
                }
            } else {
                const result = evaluator.getTypeOfClass(targetNode as PyrightNodes.ClassNode);
                type = result?.classType;
            }

            if (!type) {
                return originalType;
            }

            // If the protocol type indicates this is an instance (not the class itself),
            // clone the evaluated class type as an instance. The stub generates a class
            // definition, but the original ty type may be an instance of that class.
            if (PyrightTypes.isClass(type) && (protocolType.flags & TypeServerProtocol.TypeFlags.Instance) !== 0) {
                type = PyrightTypes.ClassType.cloneAsInstance(type);
            }

            // Update the cycle map with the real type
            originalType.category = type.category;
            originalType.shared = type.shared;
            originalType.priv = type.priv;
            originalType.props = type.props;
            originalType.flags = type.flags;

            return originalType;
        }
        case TypeServerProtocol.TypeKind.TypeVar: {
            const typeVarType = factory.getTypeShell(protocolType);
            applyTypeFlags(typeVarType, protocolType, factory, symbolLookup);
            return typeVarType;
        }
        case TypeServerProtocol.TypeKind.TypeReference: {
            // Return if we have cycle for the given type reference id.
            return factory.getTypeReference(protocolType.typeReferenceId);
        }
    }

    return PyrightTypes.UnknownType.create();
}

// ---------------------------------------------------------------------------
// Display-string type construction helpers
//
// Annotation-based stubs can't be evaluated because the ExternalProgram's
// BindingService doesn't have access to builtins (they live on the type
// server's filesystem). These helpers construct Pyright types directly from
// the protocol display string without needing the evaluator.
// ---------------------------------------------------------------------------

/**
 * Build a Pyright type from a display string (e.g. "list[int]", "type[int]").
 * Returns an instantiable ClassType; the caller is responsible for cloning
 * to instance if the protocol type has the Instance flag.
 */
export function buildTypeFromDisplay(
    node: PyrightNodes.ParseNode,
    display: string,
    evaluator: ITypeServerEvaluator
): PyrightTypes.Type {
    // ty uses <class 'X'> format for class objects (instantiable types)
    if (display.startsWith("<class '") && display.endsWith("'>")) {
        const className = display.slice(8, -2);
        return buildSyntheticClass(node, className, evaluator);
    }

    // type[X] → instantiable ClassType for X
    if (display.startsWith('type[') && display.endsWith(']')) {
        const inner = display.slice(5, -1);
        const innerType = buildTypeFromDisplay(node, inner, evaluator);
        // Instantiable ClassType prints as "type[X]"
        if (PyrightTypes.isClass(innerType) && !PyrightTypes.TypeBase.isInstantiable(innerType)) {
            return PyrightTypes.ClassType.cloneAsInstantiable(innerType);
        }
        return innerType;
    }

    // Literal[value] → class instance with literal value
    if (display.startsWith('Literal[') && display.endsWith(']')) {
        const value = display.slice(8, -1).trim();
        return buildLiteralType(node, evaluator, value);
    }

    // None → NoneType instance
    if (display === 'None') {
        const noneClass = buildSyntheticClass(node, 'NoneType', evaluator);
        return PyrightTypes.ClassType.cloneAsInstance(noneClass);
    }

    // Generic[args] like list[int], dict[str, int]
    const bracketIdx = display.indexOf('[');
    if (bracketIdx !== -1 && display.endsWith(']')) {
        const baseName = display.slice(0, bracketIdx);
        const argsStr = display.slice(bracketIdx + 1, -1);
        const args = splitDisplayTypeArgs(argsStr);

        const baseClass = buildSyntheticClass(node, baseName, evaluator);
        const typeArgs = args.map((arg) => {
            const argType = buildTypeFromDisplay(node, arg.trim(), evaluator);
            // Type args should be instances (e.g., int not type[int])
            if (PyrightTypes.isClass(argType) && PyrightTypes.TypeBase.isInstantiable(argType)) {
                return PyrightTypes.ClassType.cloneAsInstance(argType);
            }
            return argType;
        });
        return PyrightTypes.ClassType.specialize(baseClass, typeArgs);
    }

    // Simple name → instantiable ClassType
    return buildSyntheticClass(node, display, evaluator);
}

/** Create a synthetic instantiable ClassType with the given name.
 *
 * For known built-in primitive names we first try to resolve the real class
 * from `builtins` via `getBuiltInType`. This matters when an external type
 * server (e.g. pyrefly) emits a declaration whose URI we can't open locally:
 * in that case the caller falls back to this helper, and a fully synthetic
 * class would lack the `BuiltIn` flag / `builtins.<name>` fullName, which
 * breaks gates like `ClassType.isBuiltIn(t, 'str')` (used by literal-value
 * completions, etc.). Resolving the real built-in keeps round-tripped
 * built-ins (`str`, `int`, `bool`, `float`, `bytes`, `complex`, and
 * `object` — the last isn't really a primitive but is included because it
 * benefits from the same real-class resolution) behaviorally faithful.
 */
function buildSyntheticClass(
    node: PyrightNodes.ParseNode,
    name: string,
    evaluator: ITypeServerEvaluator
): PyrightTypes.ClassType {
    if (BUILTIN_PRIMITIVE_NAMES.has(name)) {
        const builtIn = evaluator.getBuiltInType(node, name);
        if (PyrightTypes.isInstantiableClass(builtIn)) {
            return builtIn;
        }
    }

    const fileInfo = evaluator.getSymbolLookup().getFileInfo(node);
    const classType = PyrightTypes.ClassType.createInstantiable(
        name,
        '',
        '',
        fileInfo.fileUri,
        PyrightTypes.ClassTypeFlags.None,
        0,
        undefined,
        undefined
    );
    const objectType = evaluator.getBuiltInType(node, 'object') as PyrightTypes.ClassType;
    classType.shared.baseClasses.push(objectType);
    computeMroLinearization(classType);
    return classType;
}

const BUILTIN_PRIMITIVE_NAMES: ReadonlySet<string> = new Set([
    'str',
    'int',
    'bool',
    'float',
    'bytes',
    'complex',
    'object',
]);

/** Build a literal type (int, str, or bool) from a Literal[] value string. */
function buildLiteralType(
    node: PyrightNodes.ParseNode,
    evaluator: ITypeServerEvaluator,
    value: string
): PyrightTypes.Type {
    // Integer literal
    if (/^-?\d+$/.test(value)) {
        const intInstance = PyrightTypes.ClassType.cloneAsInstance(
            evaluator.getBuiltInType(node, 'int') as PyrightTypes.ClassType
        );
        return PyrightTypes.ClassType.cloneWithLiteral(intInstance, BigInt(value));
    }
    // String literal
    if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
        const strInstance = PyrightTypes.ClassType.cloneAsInstance(
            evaluator.getBuiltInType(node, 'str') as PyrightTypes.ClassType
        );
        return PyrightTypes.ClassType.cloneWithLiteral(strInstance, value.slice(1, -1));
    }
    // Boolean literal
    if (value === 'True' || value === 'False') {
        const boolInstance = PyrightTypes.ClassType.cloneAsInstance(
            evaluator.getBuiltInType(node, 'bool') as PyrightTypes.ClassType
        );
        return PyrightTypes.ClassType.cloneWithLiteral(boolInstance, value === 'True');
    }
    return PyrightTypes.UnknownType.create();
}

/** Split type args at top-level commas, respecting bracket nesting. */
function splitDisplayTypeArgs(s: string): string[] {
    const args: string[] = [];
    let depth = 0;
    let current = '';
    for (const ch of s) {
        if (ch === '[') {
            depth++;
            current += ch;
        } else if (ch === ']') {
            depth--;
            current += ch;
        } else if (ch === ',' && depth === 0) {
            args.push(current.trim());
            current = '';
        } else {
            current += ch;
        }
    }
    if (current.trim()) {
        args.push(current.trim());
    }
    return args;
}
