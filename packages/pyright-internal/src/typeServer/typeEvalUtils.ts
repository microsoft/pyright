import { Declaration } from '../analyzer/declaration';
import { getScopeForNode } from '../analyzer/scopeUtils';
import { TypeEvaluator } from '../analyzer/typeEvaluatorTypes';
import { ClassType, Type } from '../analyzer/types';
import { isMap } from '../common/core';
import { ParseNode, ParseNodeType } from '../parser/parseNodes';

import { getSymbolNameFromDeclaration } from './typeServerConversionTypes';

export function forEach<K, V>(
    map: Map<K, V> | undefined,
    callbackfn: (value: V, key: K, map: Map<K, V>) => void,
    thisArg?: any
): void;
export function forEach<T>(
    set: Set<T> | undefined,
    callbackfn: (value: T, value2: T, set: Set<T>) => void,
    thisArg?: any
): void;
export function forEach<T>(
    array: T[] | undefined,
    callbackfn: (value: T, index: number, array: T[]) => void,
    thisArg?: any
): void;
export function forEach<K, T>(
    collection: Map<K, T> | Set<T> | T[] | undefined,
    callbackfn:
        | ((value: T, key: K, map: Map<K, T>) => void)
        | ((value: T, value2: T, set: Set<T>) => void)
        | ((value: T, index: number, array: T[]) => void),
    thisArg?: any
): void {
    if (!collection) return;

    if (Array.isArray(collection)) {
        for (let i = 0; i < collection.length; i++) {
            (callbackfn as (value: T, index: number, array: T[]) => void).call(thisArg, collection[i], i, collection);
        }
    } else if (isMap(collection)) {
        for (const [key, value] of collection) {
            (callbackfn as (value: T, key: K, map: Map<K, T>) => void).call(thisArg, value, key, collection);
        }
    } else {
        for (const value of collection) {
            (callbackfn as (value: T, value2: T, set: Set<T>) => void).call(thisArg, value, value, collection);
        }
    }
}

export function map<T, U>(array: T[], callbackfn: (value: T, index: number, array: T[]) => U, thisArg?: any): U[] {
    const result: U[] = [];
    for (let i = 0; i < array.length; i++) {
        result.push(callbackfn.call(thisArg, array[i], i, array));
    }
    return result;
}

export function filter<T>(array: T[], predicate: (value: T, index: number, array: T[]) => boolean, thisArg?: any): T[] {
    const result: T[] = [];
    for (let i = 0; i < array.length; i++) {
        if (predicate.call(thisArg, array[i], i, array)) {
            result.push(array[i]);
        }
    }
    return result;
}

export function isDeclaration(decl: any): decl is Declaration {
    return decl && decl.type !== undefined && decl.uri !== undefined;
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

export function getSymbolTable(classType: ClassType) {
    // Ensure any deferred method synthesis has run so callers observe a complete symbol table.
    classType.shared.synthesizeMethodsDeferred?.();

    return classType.shared.fields;
}
