/*
 * typeUtils.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for typeUtils module.
 */

import * as assert from 'assert';

import { transformTypePair } from '../analyzer/typeUtils';
import {
    AnyType,
    ClassType,
    ClassTypeFlags,
    FunctionParam,
    FunctionType,
    FunctionTypeFlags,
    isClass,
    isFunction,
    isTypeVar,
    Type,
    TypeVarScopeType,
    TypeVarType,
    UnionType,
    UnknownType,
    Variance,
} from '../analyzer/types';
import { Uri } from '../common/uri/uri';
import { ParamCategory } from '../parser/parseNodes';

test('Transform aligned function types', () => {
    const sourceLeaf = UnknownType.create();
    const targetLeaf = AnyType.create();
    const sourceFunction = createFunction(sourceLeaf, sourceLeaf, sourceLeaf);
    const targetFunction = createFunction(targetLeaf, targetLeaf, targetLeaf);

    const result = transformTypePair(sourceFunction, targetFunction, replacePair(sourceLeaf, targetLeaf));

    assert.ok(isFunction(result));
    assert.notStrictEqual(result, sourceFunction);
    assert.strictEqual(FunctionType.getParamType(result, 0), targetLeaf);
    assert.strictEqual(FunctionType.getParamDefaultType(result, 0), targetLeaf);
    assert.strictEqual(FunctionType.getEffectiveReturnType(result), targetLeaf);
    assert.strictEqual(FunctionType.getParamType(sourceFunction, 0), sourceLeaf);
    assert.strictEqual(FunctionType.getParamDefaultType(sourceFunction, 0), sourceLeaf);
    assert.strictEqual(FunctionType.getEffectiveReturnType(sourceFunction), sourceLeaf);
});

test('Transform type variable metadata without changing its identity', () => {
    const sourceLeaf = UnknownType.create();
    const targetLeaf = AnyType.create();
    const sourceTypeVar = TypeVarType.cloneForScopeId(
        TypeVarType.createInstance('T'),
        'source-scope',
        'source',
        TypeVarScopeType.Class
    );
    sourceTypeVar.shared.constraints = [sourceLeaf];
    sourceTypeVar.shared.boundType = sourceLeaf;
    sourceTypeVar.shared.defaultType = sourceLeaf;
    sourceTypeVar.shared.declaredVariance = Variance.Covariant;

    const targetTypeVar = TypeVarType.createInstance('U');
    targetTypeVar.shared.constraints = [targetLeaf];
    targetTypeVar.shared.boundType = targetLeaf;
    targetTypeVar.shared.defaultType = targetLeaf;

    const result = transformTypePair(sourceTypeVar, targetTypeVar, replacePair(sourceLeaf, targetLeaf));

    assert.ok(isTypeVar(result));
    assert.notStrictEqual(result, sourceTypeVar);
    assert.strictEqual(result.shared.name, 'T');
    assert.strictEqual(result.shared.declaredVariance, Variance.Covariant);
    assert.strictEqual(result.priv.scopeId, sourceTypeVar.priv.scopeId);
    assert.deepStrictEqual(result.shared.constraints, [targetLeaf]);
    assert.strictEqual(result.shared.boundType, targetLeaf);
    assert.strictEqual(result.shared.defaultType, targetLeaf);

    const recursiveSource = TypeVarType.createInstance('RecursiveSource');
    const recursiveTarget = TypeVarType.createInstance('RecursiveTarget');
    recursiveSource.shared.boundType = recursiveSource;
    recursiveTarget.shared.boundType = recursiveTarget;
    assert.strictEqual(
        transformTypePair(recursiveSource, recursiveTarget, () => undefined),
        recursiveSource
    );
});

test('Transform aligned class arguments but preserve mismatched wrappers', () => {
    const sourceLeaf = UnknownType.create();
    const targetLeaf = AnyType.create();
    const sourceOther = TypeVarType.createInstance('T');
    const targetOther = TypeVarType.createInstance('T');
    const sourceUnion = UnionType.create();
    sourceUnion.priv.subtypes = [sourceLeaf, sourceOther];
    const targetUnion = UnionType.create();
    targetUnion.priv.subtypes = [targetLeaf, targetOther];

    const wrapper = ClassType.cloneAsInstance(createClass('Wrapper'));
    const sourceClass = ClassType.specialize(
        wrapper,
        [sourceUnion],
        /* isTypeArgExplicit */ true,
        /* includeSubclasses */ false,
        [{ type: sourceLeaf, isUnbounded: true, isOptional: true }]
    );
    const targetClass = ClassType.specialize(
        wrapper,
        [targetUnion],
        /* isTypeArgExplicit */ true,
        /* includeSubclasses */ false,
        [{ type: targetLeaf, isUnbounded: false, isOptional: false }]
    );

    const result = transformTypePair(sourceClass, targetClass, replacePair(sourceLeaf, targetLeaf));

    assert.ok(isClass(result));
    assert.notStrictEqual(result, sourceClass);
    assert.strictEqual(result.priv.typeArgs?.[0].category, sourceUnion.category);
    assert.strictEqual((result.priv.typeArgs?.[0] as typeof sourceUnion).priv.subtypes[0], targetLeaf);
    assert.strictEqual(result.priv.tupleTypeArgs?.[0].type, targetLeaf);
    assert.strictEqual(result.priv.tupleTypeArgs?.[0].isUnbounded, true);
    assert.strictEqual(result.priv.tupleTypeArgs?.[0].isOptional, true);

    const mismatchedTarget = ClassType.specialize(ClassType.cloneAsInstance(createClass('Other')), [targetLeaf]);
    assert.strictEqual(
        transformTypePair(sourceClass, mismatchedTarget, replacePair(sourceLeaf, targetLeaf)),
        sourceClass
    );

    const shortTargetUnion = UnionType.create();
    shortTargetUnion.priv.subtypes = [targetLeaf];
    assert.strictEqual(
        transformTypePair(sourceUnion, shortTargetUnion, replacePair(sourceLeaf, targetLeaf)),
        sourceUnion
    );
});

function createFunction(parameterType: Type, defaultType: Type, returnType: Type) {
    const functionType = FunctionType.createInstance('', '', '', FunctionTypeFlags.None);
    FunctionType.addParam(
        functionType,
        FunctionParam.create(ParamCategory.Simple, parameterType, undefined, 'value', defaultType)
    );
    functionType.shared.declaredReturnType = returnType;
    return functionType;
}

function createClass(name: string) {
    return ClassType.createInstantiable(
        name,
        'test',
        `test.${name}`,
        Uri.empty(),
        ClassTypeFlags.None,
        0,
        /* declaredMetaclass */ undefined,
        /* effectiveMetaclass */ undefined
    );
}

function replacePair(source: Type, target: Type) {
    return (sourceNode: Type, targetNode: Type) =>
        sourceNode === source && targetNode === target ? targetNode : undefined;
}
