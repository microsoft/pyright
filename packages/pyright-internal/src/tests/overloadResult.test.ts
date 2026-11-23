/*
 * overloadResult.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

import { strict as assert } from 'assert';

import { projectOverloadResultBaseline } from '../analyzer/overloadResult';
import { printType, PrintTypeFlags } from '../analyzer/typePrinter';
import {
    AnyType,
    ClassType,
    ClassTypeFlags,
    combineTypes,
    FunctionParam,
    FunctionParamFlags,
    FunctionType,
    isClass,
    isFunction,
    isOverloaded,
    isOverloadResult,
    isTypeSame,
    isUnion,
    NeverType,
    OverloadedType,
    OverloadResultType,
    Type,
    TypeBase,
    TypeCategory,
    UnknownType,
} from '../analyzer/types';
import { Uri } from '../common/uri/uri';
import { ParamCategory } from '../parser/parseNodes';

function instance(name: string) {
    return ClassType.cloneAsInstance(
        ClassType.createInstantiable(name, name, '', Uri.empty(), ClassTypeFlags.None, 0, undefined, undefined)
    );
}

const intType = instance('int');
const strType = instance('str');
const listType = instance('list');
const intList = ClassType.specialize(listType, [intType]);
const strList = ClassType.specialize(listType, [strType]);

function alternatives(reverse = false) {
    return OverloadResultType.create(reverse ? [strList, intList] : [intList, strList], intList, TypeCategory.Any);
}

function signature(defaultType: Type) {
    const fn = FunctionType.createSynthesizedInstance('f');
    FunctionType.addParam(
        fn,
        FunctionParam.create(ParamCategory.Simple, AnyType.create(), FunctionParamFlags.TypeDeclared, 'x', defaultType)
    );
    fn.shared.declaredReturnType = intType;
    return fn;
}

function projected(type: Type): Type {
    const result = projectOverloadResultBaseline(type);
    assert.strictEqual(result.kind, 'projected');
    assert(result.kind === 'projected');
    return result.type;
}

test('OverloadResult retains complete payload without pretending to be an ordinary type', () => {
    const candidates = [intList, strList];
    const result = OverloadResultType.create(candidates, intList, TypeCategory.Any);
    candidates.reverse();
    assert.deepStrictEqual(result.priv.candidates, [intList, strList]);
    assert(Object.isFrozen(result.priv.candidates));
    assert.strictEqual(result.priv.baselineType, intList);
    assert(isOverloadResult(result));
    assert(!isUnion(result));
    assert(!isClass(result));
    assert(!isTypeSame(result, ClassType.specialize(listType, [AnyType.create()])));
    assert(!isTypeSame(result, combineTypes([intList, strList])));
});

test('OverloadResult comparison retains uncertainty and baseline but ignores candidate order', () => {
    assert(isTypeSame(alternatives(), alternatives(true)));
    assert(!isTypeSame(alternatives(), OverloadResultType.create([intList, strList], strList, TypeCategory.Any)));
    assert(!isTypeSame(alternatives(), OverloadResultType.create([intList, strList], intList, TypeCategory.Unknown)));
});

test('OverloadResult uses an honest display and ordinary baseline for Python-only syntax', () => {
    const callback = (type: FunctionType) => type.shared.declaredReturnType ?? UnknownType.create();
    assert.strictEqual(
        printType(alternatives(), PrintTypeFlags.None, callback),
        'OverloadResult[list[int], list[str]]'
    );
    assert.strictEqual(printType(alternatives(), PrintTypeFlags.PythonSyntax, callback), 'list[int]');
});

test('OverloadResult survives ordinary union normalization in both orders', () => {
    const ordinary = ClassType.specialize(listType, [AnyType.create()]);
    for (const items of [
        [alternatives(), ordinary],
        [ordinary, alternatives()],
    ]) {
        const union = combineTypes(items);
        assert(isUnion(union));
        assert.strictEqual(union.priv.subtypes.length, 2);
        assert(union.priv.subtypes.some(isOverloadResult));
        assert(isTypeSame(projected(union), combineTypes([intList, ordinary])));
    }
});

test('OverloadResult equality does not erase callable defaults, receiver or stripped state', () => {
    const first = signature(intType);
    const second = signature(strType);
    assert(isTypeSame(first, second));
    assert(!isTypeSame(first, second, { honorCallBehavior: true }));
    for (const field of ['boundToType', 'strippedFirstParamType'] as const) {
        const left = signature(intType);
        const right = signature(intType);
        left.priv[field] = intList;
        right.priv[field] = strList;
        assert(isTypeSame(left, right));
        assert(!isTypeSame(left, right, { honorCallBehavior: true }));
    }
});

test('OverloadResult equality retains ordered overloads, implementations and signature ownership', () => {
    const first = signature(intType);
    const second = signature(strType);
    const implementation1 = signature(intType);
    const implementation2 = signature(strType);
    const owner1 = OverloadedType.create([first], implementation1);
    const owner2 = OverloadedType.create([second], implementation2);
    assert(!isTypeSame(owner1, owner2, { honorCallBehavior: true }));
    const sameSignature = signature(intType);
    OverloadedType.create([sameSignature], signature(strType));
    assert(!isTypeSame(first, sameSignature, { honorCallBehavior: true }));
    assert(
        !isTypeSame(
            OverloadedType.create([signature(intType), signature(strType)]),
            OverloadedType.create([signature(strType), signature(intType)]),
            { honorCallBehavior: true }
        )
    );
});

test('OverloadResult baseline projection preserves ordinary alias and tuple metadata', () => {
    const tuple = ClassType.specialize(
        ClassType.cloneForTypingAlias(instance('tuple'), 'Tuple'),
        [alternatives()],
        false,
        true,
        [{ type: alternatives(), isUnbounded: false, isOptional: true }]
    );
    const result = projected(tuple);
    assert(isClass(result));
    assert.strictEqual(result.priv.aliasName, 'Tuple');
    assert.strictEqual(result.priv.isTypeArgExplicit, false);
    assert.strictEqual(result.priv.includeSubclasses, true);
    assert.strictEqual(result.priv.typeArgs![0], intList);
    assert.deepStrictEqual(result.priv.tupleTypeArgs, [{ type: intList, isUnbounded: false, isOptional: true }]);
    assert(isOverloadResult(tuple.priv.typeArgs![0]));
});

test('OverloadResult projects callable parameters, defaults, return and bound payload without reparenting', () => {
    const fn = signature(alternatives());
    fn.shared.parameters[0] = FunctionParam.create(
        ParamCategory.Simple,
        alternatives(),
        FunctionParamFlags.TypeDeclared,
        'x',
        alternatives()
    );
    fn.shared.declaredReturnType = alternatives();
    fn.priv.strippedFirstParamType = alternatives();
    fn.priv.boundToType = ClassType.specialize(listType, [alternatives()]);
    const unchanged = signature(intType);
    const implementation = signature(intType);
    const owner = OverloadedType.create([fn, unchanged], implementation);
    const result = projected(owner);
    assert(isOverloaded(result));
    const [projectedFn, projectedUnchanged] = OverloadedType.getOverloads(result);
    assert.strictEqual(FunctionType.getParamType(projectedFn, 0), intList);
    assert.strictEqual(FunctionType.getParamDefaultType(projectedFn, 0), intList);
    assert.strictEqual(FunctionType.getEffectiveReturnType(projectedFn), intList);
    assert.strictEqual(projectedFn.priv.strippedFirstParamType, intList);
    assert.strictEqual(projectedFn.priv.boundToType!.priv.typeArgs![0], intList);
    assert.strictEqual(projectedFn.priv.overloaded, result);
    assert.strictEqual(projectedUnchanged.priv.overloaded, result);
    assert.strictEqual(fn.priv.overloaded, owner);
    assert.strictEqual(unchanged.priv.overloaded, owner);
    assert.strictEqual(implementation.priv.overloaded, owner);
    assert(isFunction(OverloadedType.getImplementation(result)!));
    assert.notStrictEqual(OverloadedType.getImplementation(result), implementation);
});

test('OverloadResult does not treat a mixed Never payload as ordinary Never', () => {
    const never = NeverType.createNever();
    const result = OverloadResultType.create([never, intList], never, TypeCategory.Any);
    assert.notStrictEqual(result.category, TypeCategory.Never);
    assert.strictEqual(projected(result), never);
});

test('OverloadResult baseline projection retains unchanged inputs by identity', () => {
    assert.strictEqual(projected(intList), intList);
    assert.strictEqual(projected(signature(intType)).category, TypeCategory.Function);
});

test('OverloadResult projection reports depth cutoff without pretending to have a baseline', () => {
    let nested: Type = alternatives();
    for (let depth = 0; depth < 21; depth++) {
        nested = ClassType.specialize(listType, [nested]);
    }
    const result = projectOverloadResultBaseline(nested);
    assert.strictEqual(result.kind, 'blocked');
    assert(result.kind === 'blocked');
    assert.strictEqual(result.reason, 'depth');
    assert(!('type' in result));
    const largerBudget = projectOverloadResultBaseline(nested, { maxDepth: 24 });
    assert.strictEqual(largerBudget.kind, 'projected');
});

test('OverloadResult projection reports node cutoff even for a shallow ordinary enclosing value', () => {
    const args = Array.from({ length: 4096 }, (_, index) => ({
        type: ClassType.cloneWithLiteral(intType, index),
        isUnbounded: false,
    }));
    args.push({ type: ClassType.specialize(listType, [alternatives()]), isUnbounded: false });
    const tuple = ClassType.specialize(instance('tuple'), [AnyType.create()], true, false, args);
    const result = projectOverloadResultBaseline(tuple);
    assert.strictEqual(result.kind, 'blocked');
    assert(result.kind === 'blocked');
    assert.strictEqual(result.reason, 'nodes');
    assert.strictEqual(result.visitedNodes, 4096);
    assert(!('type' in result));
    assert.strictEqual(projectOverloadResultBaseline(tuple, { maxNodes: 4110 }).kind, 'projected');
});

test('OverloadResult projection rejects recursive value edges rather than leaking a wrapper', () => {
    const cyclic = TypeBase.cloneType(listType);
    cyclic.priv.typeArgs = [cyclic, alternatives()];
    const result = projectOverloadResultBaseline(cyclic);
    assert.strictEqual(result.kind, 'blocked');
    assert(result.kind === 'blocked');
    assert.strictEqual(result.reason, 'cycle');
    assert(!('type' in result));
});
