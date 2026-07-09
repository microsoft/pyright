import { Declaration } from '../analyzer/declaration';
import { getScopeForNode } from '../analyzer/scopeUtils';
import { TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import {
    ClassDetailsShared,
    ClassType,
    combineTypes,
    DataClassEntry,
    FunctionType,
    isFunction,
    isUnion,
    NeverType,
    OverloadedType,
    Type,
    TypeBase,
    UnionableType,
    UnionType,
} from '../analyzer/types';
import {
    addConditionToType,
    getTypeCondition,
    MapSubtypesOptions,
    sortTypes,
} from '../analyzer/typeUtils';
import { OperationCanceledException } from '../common/cancellationUtils';
import { isMap } from '../common/core';
import { ParseNode, ParseNodeType } from '../parser/parseNodes';

import { getSymbolNameFromDeclaration } from './typeServerConversionTypes';
import { IAsyncSymbolLookup } from './programTypes';

import { IAsyncTypeEvaluator } from './asyncTypeEvaluatorTypes';

export function forEach<K, V>(
    map: Map<K, V> | undefined,
    callbackfn: (value: V, key: K, map: Map<K, V>) => Promise<void>,
    thisArg?: any
): Promise<void>;
export function forEach<T>(
    map: Set<T> | undefined,
    callbackfn: (value: T, value2: T, set: Set<T>) => Promise<void>,
    thisArg?: any
): Promise<void>;
export function forEach<T>(
    array: T[] | undefined,
    callbackfn: (value: T, index: number, array: T[]) => Promise<void>,
    thisArg?: any
): Promise<void>;
export async function forEach<K, T>(
    collection: Map<K, T> | Set<T> | T[] | undefined,
    callbackfn:
        | ((value: T, key: K, map: Map<K, T>) => Promise<void>)
        | ((value: T, value2: T, set: Set<T>) => Promise<void>)
        | ((value: T, index: number, array: T[]) => Promise<void>),
    thisArg?: any
): Promise<void> {
    if (!collection) return;

    if (Array.isArray(collection)) {
        for (let i = 0; i < collection.length; i++) {
            await (callbackfn as (value: T, index: number, array: T[]) => Promise<void>).call(
                thisArg,
                collection[i],
                i,
                collection
            );
        }
    } else if (isMap(collection)) {
        for (const [key, value] of collection) {
            await (callbackfn as (value: T, key: K, map: Map<K, T>) => Promise<void>).call(
                thisArg,
                value,
                key,
                collection
            );
        }
    } else {
        for (const value of collection) {
            await (callbackfn as (value: T, value2: T, set: Set<T>) => Promise<void>).call(
                thisArg,
                value,
                value,
                collection
            );
        }
    }
}

export async function map<T, U>(
    array: T[],
    callbackfn: (value: T, index: number, array: T[]) => Promise<U>,
    thisArg?: any
): Promise<U[]> {
    const result: U[] = [];
    for (let i = 0; i < array.length; i++) {
        result.push(await callbackfn.call(thisArg, array[i], i, array));
    }
    return result;
}

export async function some<T>(
    array: T[],
    predicate: (value: T, index: number, array: T[]) => Promise<boolean>,
    thisArg?: any
): Promise<boolean> {
    for (let i = 0; i < array.length; i++) {
        if (await predicate.call(thisArg, array[i], i, array)) {
            return true;
        }
    }
    return false;
}

export async function filter<T>(
    array: T[],
    predicate: (value: T, index: number, array: T[]) => Promise<boolean>,
    thisArg?: any
): Promise<T[]> {
    const result: T[] = [];
    for (let i = 0; i < array.length; i++) {
        if (await predicate.call(thisArg, array[i], i, array)) {
            result.push(array[i]);
        }
    }
    return result;
}

export async function every<T>(
    array: T[],
    predicate: (value: T, index: number, array: T[]) => Promise<boolean>,
    thisArg?: any
): Promise<boolean> {
    for (let i = 0; i < array.length; i++) {
        if (!(await predicate.call(thisArg, array[i], i, array))) {
            return false;
        }
    }
    return true;
}

export async function findIndex<T>(
    array: T[],
    predicate: (value: T, index: number, obj: T[]) => Promise<boolean>,
    thisArg?: any
): Promise<number> {
    for (let i = 0; i < array.length; i++) {
        if (await predicate.call(thisArg, array[i], i, array)) {
            return i;
        }
    }
    return -1;
}

export async function find<T>(
    array: T[],
    predicate: (value: T, index: number, obj: T[]) => Promise<boolean>,
    thisArg?: any
): Promise<T | undefined> {
    for (let i = 0; i < array.length; i++) {
        if (await predicate.call(thisArg, array[i], i, array)) {
            return array[i];
        }
    }
    return undefined;
}

export async function doForEachSubtypeAsync(
    type: Type,
    callback: (type: Type, index: number, allSubtypes: Type[]) => Promise<void>,
    sortSubtypes = false
): Promise<void> {
    if (isUnion(type)) {
        const subtypes = sortSubtypes ? sortTypes(type.priv.subtypes) : type.priv.subtypes;
        await forEach(subtypes, async (subtype, index) => {
            await callback(subtype, index, subtypes);
        });
    } else {
        await callback(type, 0, [type]);
    }
}

export async function mapSubtypesAsync(
    type: Type,
    callback: (type: Type) => Promise<Type | undefined>,
    options?: MapSubtypesOptions
): Promise<Type> {
    if (isUnion(type)) {
        const subtypes = options?.sortSubtypes ? sortTypes(type.priv.subtypes) : type.priv.subtypes;

        for (let i = 0; i < subtypes.length; i++) {
            const subtype = subtypes[i];
            const transformedType = await callback(subtype);

            // Avoid doing any memory allocations until a change is detected.
            if (subtype !== transformedType) {
                const typesToCombine: Type[] = subtypes.slice(0, i);

                // Create a helper lambda that accumulates transformed subtypes.
                const accumulateSubtype = (newSubtype: Type | undefined) => {
                    if (newSubtype) {
                        typesToCombine.push(addConditionToType(newSubtype, getTypeCondition(type)));
                    }
                };

                accumulateSubtype(transformedType);

                for (i++; i < subtypes.length; i++) {
                    accumulateSubtype(await callback(subtypes[i]));
                }

                let newType = combineTypes(typesToCombine, {
                    skipElideRedundantLiterals: options?.skipElideRedundantLiterals,
                });

                if (options?.retainTypeAlias) {
                    if (type.props?.typeAliasInfo) {
                        newType = TypeBase.cloneForTypeAlias(newType, type.props.typeAliasInfo);
                    }
                } else {
                    // Do our best to retain type aliases.
                    if (isUnion(newType)) {
                        UnionType.addTypeAliasSource(newType, type);
                    }
                }

                return newType;
            }
        }

        return type;
    }

    const transformedSubtype = await callback(type);
    if (!transformedSubtype) {
        return NeverType.createNever();
    }
    return transformedSubtype;
}

export async function invalidateTypeCacheIfCanceled<T>(cb: () => Promise<T>): Promise<T> {
    try {
        return await cb();
    } catch (e: any) {
        if (OperationCanceledException.is(e)) {
            // If the work was canceled before the function type was updated, the
            // function type in the type cache is in an invalid, partially-constructed state.
            e.isTypeCacheInvalid = true;
        }

        throw e;
    }
}

export async function findSubtypeAsync(type: Type, filter: (type: UnionableType | NeverType) => Promise<boolean>) {
    if (isUnion(type)) {
        for (const subtype of type.priv.subtypes) {
            if (await filter(subtype)) {
                return subtype;
            }
        }

        return undefined;
    }

    return (await filter(type)) ? type : undefined;
}

export async function mapSignaturesAsync(
    type: FunctionType | OverloadedType,
    callback: (type: FunctionType) => Promise<FunctionType | undefined>
): Promise<OverloadedType | FunctionType | undefined> {
    if (isFunction(type)) {
        return await callback(type);
    }

    const newSignatures: FunctionType[] = [];
    let changeMade = false;

    await forEach(OverloadedType.getOverloads(type), async (overload, index) => {
        const newOverload = await callback(overload);
        if (newOverload !== overload) {
            changeMade = true;
        }

        if (newOverload) {
            newSignatures.push(newOverload);
        }
    });

    if (newSignatures.length === 0) {
        return undefined;
    }

    // Add the unmodified implementation if it's present.
    const implementation = OverloadedType.getImplementation(type);
    let newImplementation: Type | undefined = implementation;

    if (implementation && isFunction(implementation)) {
        newImplementation = await callback(implementation);

        if (newImplementation) {
            changeMade = true;
        }
    }

    if (!changeMade) {
        return type;
    }

    if (newSignatures.length === 1) {
        return newSignatures[0];
    }

    return OverloadedType.create(newSignatures, newImplementation);
}

export async function doForEachSignatureAsync(
    type: FunctionType | OverloadedType,
    callback: (type: FunctionType, index: number) => Promise<void>
) {
    if (isFunction(type)) {
        await callback(type, 0);
    } else {
        await forEach(OverloadedType.getOverloads(type), async (overload, index) => {
            await callback(overload, index);
        });
    }
}

export function isDeclaration(decl: any): decl is Declaration {
    return decl && decl.type !== undefined && decl.uri !== undefined;
}

export function isParseNode(node: any): node is ParseNode {
    return node && node.nodeType !== undefined && node.id !== undefined;
}

function getSymbolFromScope(node: ParseNode, name: string) {
    // use name node for parameter to get the correct scope
    const nodeForScope = node.nodeType === ParseNodeType.Parameter ? node.d.name ?? node : node;
    const scope = getScopeForNode(nodeForScope);
    if (!scope) {
        return undefined;
    }

    return scope.lookUpSymbol(name);
}

export function getEffectiveTypeOfDeclaration(
    evaluator: TypeEvaluator | undefined,
    decl: Declaration
): Type | undefined {
    const type = evaluator?.getTypeForDeclaration(decl)?.type;
    if (type) {
        return type;
    }

    if (!decl.node) {
        return undefined;
    }

    const symbolName = getSymbolNameFromDeclaration(decl);
    if (symbolName === undefined) {
        return undefined;
    }

    const symbol = getSymbolFromScope(decl.node, symbolName);
    if (!symbol) {
        return undefined;
    }

    return evaluator?.getInferredTypeOfDeclaration(symbol, decl);
}

export async function getEffectiveTypeOfDeclarationAsync(
    symbolLookup: IAsyncSymbolLookup,
    evaluator: IAsyncTypeEvaluator | undefined,
    decl: Declaration
): Promise<Type | undefined> {
    const type = (await evaluator?.getTypeForDeclaration(decl))?.type;
    if (type) {
        return type;
    }

    if (!decl.node) {
        return undefined;
    }

    const symbolName = getSymbolNameFromDeclaration(decl);
    if (symbolName === undefined) {
        return undefined;
    }

    const symbol = await symbolLookup.lookupSymbol(decl.node, symbolName);
    if (!symbol) {
        return undefined;
    }

    return await evaluator?.getInferredTypeOfDeclaration(symbol, decl);
}

export function toMap<K, V>(array: [K, V][]): Map<K, V> {
    return new Map(array);
}

export interface PylanceClassDetailsShared extends ClassDetailsShared {
    // Async callback for deferred synthesis of methods in symbol table.
    synthesizeMethodsDeferredAsync?: () => Promise<void>;

    // Async callback for calculating inherited slots names.
    calculateInheritedSlotsNamesDeferredAsync?: () => Promise<void>;
}

export async function getDataClassEntries(classType: ClassType): Promise<DataClassEntry[]> {
    const shared = classType.shared as PylanceClassDetailsShared;
    await shared.synthesizeMethodsDeferredAsync?.();

    return shared.dataClassEntries || [];
}

export async function getSymbolTable(classType: ClassType) {
    const shared = classType.shared as PylanceClassDetailsShared;
    await shared.synthesizeMethodsDeferredAsync?.();

    return shared.fields;
}

export async function getInheritedSlotsNames(classType: ClassType) {
    const shared = classType.shared as PylanceClassDetailsShared;

    // First synthesize methods if needed. The slots entries
    // can depend on synthesized methods.
    await shared.synthesizeMethodsDeferredAsync?.();

    await shared.calculateInheritedSlotsNamesDeferredAsync?.();

    return shared.inheritedSlotsNamesCached;
}
