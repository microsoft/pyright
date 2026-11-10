/*
 * overloadResult.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Passive baseline projection for overload-result witnesses.
 */

import {
    combineTypes,
    FunctionType,
    isClass,
    isFunction,
    isFunctionOrOverloaded,
    isTypeVar,
    maxTypeRecursionCount,
    OverloadedType,
    PropertyMethodInfo,
    Type,
    TypeBase,
    TypeCategory,
    UnionType,
} from './types';

export interface OverloadResultProjectionLimits {
    maxDepth?: number;
    maxNodes?: number;
}

export type OverloadResultProjection =
    | { kind: 'projected'; type: Type; visitedNodes: number }
    | { kind: 'blocked'; reason: 'depth' | 'nodes' | 'cycle' | 'category'; visitedNodes: number };

class ProjectionBlocked extends Error {
    constructor(readonly reason: 'depth' | 'nodes' | 'cycle' | 'category') {
        super(`Overload-result baseline projection blocked: ${reason}`);
    }
}

// A blocked result is not a usable fallback type. Callers must not replace it
// with Any, an unprojected input, or an arbitrary candidate.
export function projectOverloadResultBaseline(
    type: Type,
    limits: OverloadResultProjectionLimits = {}
): OverloadResultProjection {
    const maxDepth = limits.maxDepth ?? maxTypeRecursionCount;
    const maxNodes = limits.maxNodes ?? 4096;
    const active = new Set<Type>();
    const memo = new Map<Type, Type>();
    let visitedNodes = 0;

    const optional = (value: Type | undefined, depth: number) =>
        value === undefined ? undefined : project(value, depth);

    function project(value: Type, depth: number): Type {
        const cached = memo.get(value);
        if (cached) {
            return cached;
        }
        if (depth > maxDepth) {
            throw new ProjectionBlocked('depth');
        }
        if (visitedNodes >= maxNodes) {
            throw new ProjectionBlocked('nodes');
        }
        visitedNodes++;
        if (active.has(value)) {
            throw new ProjectionBlocked('cycle');
        }
        active.add(value);
        const result = projectValue(value, depth + 1);
        active.delete(value);
        memo.set(value, result);
        return result;
    }

    function projectValue(value: Type, depth: number): Type {
        let result: Type = value;
        switch (value.category) {
            case TypeCategory.OverloadResult:
                return project(value.priv.baselineType, depth);

            case TypeCategory.Class: {
                const typeArgs = value.priv.typeArgs?.map((arg) => project(arg, depth));
                const tupleTypeArgs = value.priv.tupleTypeArgs?.map((arg) => ({
                    ...arg,
                    type: project(arg.type, depth),
                }));
                const partialCallType = optional(value.priv.partialCallType, depth);
                const accessor = (info: PropertyMethodInfo | undefined) => {
                    if (!info) {
                        return undefined;
                    }
                    const methodType = project(info.methodType, depth);
                    const classType = optional(info.classType, depth);
                    if (!isFunctionOrOverloaded(methodType) || (classType && !isClass(classType))) {
                        throw new ProjectionBlocked('category');
                    }
                    return methodType === info.methodType && classType === info.classType
                        ? info
                        : { ...info, methodType, classType };
                };
                const fgetInfo = accessor(value.priv.fgetInfo);
                const fsetInfo = accessor(value.priv.fsetInfo);
                const fdelInfo = accessor(value.priv.fdelInfo);
                const narrowedEntries = value.priv.typedDictNarrowedEntries;
                const entries = narrowedEntries
                    ? new Map(
                          [...narrowedEntries].map(([name, entry]) => [
                              name,
                              { ...entry, valueType: project(entry.valueType, depth) },
                          ])
                      )
                    : undefined;
                if (
                    typeArgs?.some((arg, index) => arg !== value.priv.typeArgs![index]) ||
                    tupleTypeArgs?.some((arg, index) => arg.type !== value.priv.tupleTypeArgs![index].type) ||
                    partialCallType !== value.priv.partialCallType ||
                    fgetInfo !== value.priv.fgetInfo ||
                    fsetInfo !== value.priv.fsetInfo ||
                    fdelInfo !== value.priv.fdelInfo ||
                    (entries &&
                        [...entries].some(([name, entry]) => entry.valueType !== narrowedEntries!.get(name)!.valueType))
                ) {
                    const clone = TypeBase.cloneType(value);
                    Object.assign(clone.priv, {
                        typeArgs,
                        tupleTypeArgs,
                        partialCallType,
                        fgetInfo,
                        fsetInfo,
                        fdelInfo,
                        typedDictNarrowedEntries: entries,
                    });
                    result = clone;
                }
                break;
            }

            case TypeCategory.Function: {
                const parameterTypes = value.shared.parameters.map((_, index) =>
                    project(FunctionType.getParamType(value, index), depth)
                );
                const parameterDefaultTypes = value.shared.parameters.map((_, index) =>
                    optional(FunctionType.getParamDefaultType(value, index), depth)
                );
                const returnType = optional(FunctionType.getEffectiveReturnType(value), depth);
                const inferredReturnType = optional(value.shared.inferredReturnType?.type, depth);
                const strippedFirstParamType = optional(value.priv.strippedFirstParamType, depth);
                const boundToType = optional(value.priv.boundToType, depth);
                if (boundToType && !isClass(boundToType)) {
                    throw new ProjectionBlocked('category');
                }
                if (
                    parameterTypes.some((arg, index) => arg !== FunctionType.getParamType(value, index)) ||
                    parameterDefaultTypes.some(
                        (arg, index) => arg !== FunctionType.getParamDefaultType(value, index)
                    ) ||
                    returnType !== FunctionType.getEffectiveReturnType(value) ||
                    inferredReturnType !== value.shared.inferredReturnType?.type ||
                    strippedFirstParamType !== value.priv.strippedFirstParamType ||
                    boundToType !== value.priv.boundToType
                ) {
                    const clone = FunctionType.specialize(value, { parameterTypes, parameterDefaultTypes, returnType });
                    clone.priv.strippedFirstParamType = strippedFirstParamType;
                    clone.priv.boundToType = boundToType;
                    clone.priv.callSiteReturnTypeCache = undefined;
                    if (value.shared.inferredReturnType && inferredReturnType) {
                        clone.shared = {
                            ...clone.shared,
                            inferredReturnType: { ...value.shared.inferredReturnType, type: inferredReturnType },
                        };
                    }
                    result = clone;
                }
                break;
            }

            case TypeCategory.Overloaded: {
                const signatures = OverloadedType.getOverloads(value);
                const projected = signatures.map((signature) => {
                    const candidate = project(signature, depth);
                    if (!isFunction(candidate)) {
                        throw new ProjectionBlocked('category');
                    }
                    return candidate;
                });
                const implementation = OverloadedType.getImplementation(value);
                const projectedImplementation = optional(implementation, depth);
                if (
                    projected.some((signature, index) => signature !== signatures[index]) ||
                    implementation !== projectedImplementation
                ) {
                    const clone = OverloadedType.create(
                        projected.map((signature) => TypeBase.cloneType(signature)),
                        projectedImplementation && isFunction(projectedImplementation)
                            ? TypeBase.cloneType(projectedImplementation)
                            : projectedImplementation
                    );
                    clone.flags = value.flags;
                    clone.props = value.props;
                    result = clone;
                }
                break;
            }

            case TypeCategory.Union: {
                const subtypes = value.priv.subtypes.map((subtype) => project(subtype, depth));
                if (subtypes.some((subtype, index) => subtype !== value.priv.subtypes[index])) {
                    result = combineTypes(subtypes);
                    if (result.category === TypeCategory.Union) {
                        UnionType.addTypeAliasSource(result, value);
                    }
                }
                break;
            }

            case TypeCategory.TypeVar: {
                const boundType = optional(value.shared.boundType, depth);
                const defaultType = project(value.shared.defaultType, depth);
                const constraints = value.shared.constraints.map((constraint) => project(constraint, depth));
                const freeTypeVar = optional(value.priv.freeTypeVar, depth);
                if (freeTypeVar && !isTypeVar(freeTypeVar)) {
                    throw new ProjectionBlocked('category');
                }
                if (
                    boundType !== value.shared.boundType ||
                    defaultType !== value.shared.defaultType ||
                    constraints.some((constraint, index) => constraint !== value.shared.constraints[index]) ||
                    freeTypeVar !== value.priv.freeTypeVar
                ) {
                    const clone = TypeBase.cloneType(value);
                    clone.shared = { ...value.shared, boundType, defaultType, constraints };
                    clone.priv.freeTypeVar = freeTypeVar;
                    result = clone;
                }
                break;
            }

            case TypeCategory.Unknown: {
                const possibleType = optional(value.priv.possibleType, depth);
                if (possibleType !== value.priv.possibleType) {
                    const clone = TypeBase.cloneType(value);
                    clone.priv.possibleType = possibleType;
                    result = clone;
                }
                break;
            }

            case TypeCategory.Any:
            case TypeCategory.Unbound:
            case TypeCategory.Never:
            case TypeCategory.Module:
                break;
        }

        const props = result.props;
        if (props) {
            const typeForm = optional(props.typeForm, depth);
            const specialForm = optional(props.specialForm, depth);
            if (specialForm && !isClass(specialForm)) {
                throw new ProjectionBlocked('category');
            }
            const typeArgs = props.typeAliasInfo?.typeArgs?.map((arg) => project(arg, depth));
            if (
                typeForm !== props.typeForm ||
                specialForm !== props.specialForm ||
                typeArgs?.some((arg, index) => arg !== props.typeAliasInfo!.typeArgs![index])
            ) {
                result = TypeBase.cloneType(result);
                result.props = {
                    ...props,
                    typeForm,
                    specialForm,
                    typeAliasInfo: props.typeAliasInfo ? { ...props.typeAliasInfo, typeArgs } : undefined,
                };
            }
        }
        return result;
    }

    try {
        return { kind: 'projected', type: project(type, 0), visitedNodes };
    } catch (error) {
        if (error instanceof ProjectionBlocked) {
            return { kind: 'blocked', reason: error.reason, visitedNodes };
        }
        throw error;
    }
}
