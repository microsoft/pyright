/*
 * typeEquality.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for type equality helpers.
 */

import * as assert from 'assert';

import { Uri } from '../common/uri/uri';
import { ParamCategory } from '../parser/parseNodes';
import {
    AnyType,
    ClassType,
    ClassTypeFlags,
    FunctionParam,
    FunctionType,
    isTypeSame,
    TypeBase,
    TypeVarType,
    UnionType,
    UnknownType,
} from '../analyzer/types';

test('IsTypeSameClassClonesShareTypeArgs', () => {
    const intType = ClassType.cloneAsInstance(createClassType('int', ClassTypeFlags.BuiltIn));
    const listClass = createClassType('list', ClassTypeFlags.BuiltIn);
    const specializedList = ClassType.cloneAsInstance(ClassType.specialize(listClass, [intType]));
    const deprecatedList = ClassType.cloneForDeprecatedInstance(specializedList, 'deprecated');

    assert.strictEqual(specializedList.priv.typeArgs, deprecatedList.priv.typeArgs);
    assert.strictEqual(isTypeSame(specializedList, deprecatedList), true);
});

test('IsTypeSameFunctionClonesShareParameters', () => {
    const functionType = FunctionType.createInstance('f', 'module.f', 'module', 0);
    FunctionType.addParam(functionType, FunctionParam.create(ParamCategory.Simple, AnyType.create(), 0, 'value'));
    functionType.shared.declaredReturnType = UnknownType.create();

    const clonedFunctionType = FunctionType.cloneWithDocString(functionType, 'doc');

    assert.strictEqual(functionType.shared.parameters, clonedFunctionType.shared.parameters);
    assert.strictEqual(isTypeSame(functionType, clonedFunctionType), true);
});

test('IsTypeSameUnionClonesShareSubtypes', () => {
    const unionType = UnionType.create();
    UnionType.addType(unionType, AnyType.create());
    UnionType.addType(unionType, UnknownType.create());

    const unionTypeClone = TypeBase.cloneType(unionType);

    assert.strictEqual(unionType.priv.subtypes, unionTypeClone.priv.subtypes);
    assert.strictEqual(isTypeSame(unionType, unionTypeClone), true);
});

test('IsTypeSameTypeVarClonesShareBoundAndConstraints', () => {
    const baseTypeVar = TypeVarType.createInstance('_T');
    const boundType = ClassType.cloneAsInstance(createClassType('int', ClassTypeFlags.BuiltIn));

    baseTypeVar.shared.boundType = boundType;
    TypeVarType.addConstraint(baseTypeVar, ClassType.cloneAsInstance(createClassType('str', ClassTypeFlags.BuiltIn)));

    const clone1 = TypeVarType.cloneForScopeId(baseTypeVar, 'scope', 'scope', undefined);
    const clone2 = TypeVarType.cloneForScopeId(baseTypeVar, 'scope', 'scope', undefined);

    assert.strictEqual(clone1.shared.boundType, clone2.shared.boundType);
    assert.strictEqual(clone1.shared.constraints, clone2.shared.constraints);
    assert.strictEqual(isTypeSame(clone1, clone2), true);

    const distinctConstraints = TypeVarType.cloneForScopeId(
        TypeVarType.createInstance('_T'),
        'scope',
        'scope',
        undefined
    );
    distinctConstraints.shared = {
        ...distinctConstraints.shared,
        boundType,
        constraints: [ClassType.cloneAsInstance(createClassType('bytes', ClassTypeFlags.BuiltIn))],
    };

    assert.strictEqual(isTypeSame(clone1, distinctConstraints), false);
});

function createClassType(name: string, flags = ClassTypeFlags.None) {
    const classType = ClassType.createInstantiable(
        name,
        name,
        '',
        Uri.empty(),
        flags,
        0,
        /* declaredMetaclass*/ undefined,
        /* effectiveMetaclass */ undefined
    );
    classType.shared.mro.push(classType);
    return classType;
}
