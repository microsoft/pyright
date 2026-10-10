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
    combineTypes,
    FunctionParam,
    FunctionType,
    isClassInstance,
    isTypeSame,
    isUnion,
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

test('CombineTypesDistinctClasses', () => {
    const firstClass = createClassType('Value', ClassTypeFlags.None, 'first.Value');
    const secondClass = createClassType('Value', ClassTypeFlags.None, 'second.Value');
    const classUnion = combineTypes([firstClass, secondClass]);
    assert.ok(isUnion(classUnion));
    assert.deepStrictEqual(classUnion.priv.subtypes, [firstClass, secondClass]);

    const first = ClassType.cloneAsInstance(firstClass);
    const second = ClassType.cloneAsInstance(secondClass);
    const duplicate = ClassType.cloneForDeprecatedInstance(first, 'deprecated');
    const instanceUnion = combineTypes([first, second, duplicate]);
    assert.ok(isUnion(instanceUnion));
    assert.deepStrictEqual(instanceUnion.priv.subtypes, [first, second]);
});

test('CombineTypesSameNameDifferentSources', () => {
    const first = ClassType.cloneAsInstance(createClassType('Value'));
    const second = ClassType.cloneAsInstance(createClassType('Value'));
    second.shared.typeSourceId = 1;

    const union = combineTypes([first, second]);
    assert.ok(isUnion(union));
    assert.deepStrictEqual(union.priv.subtypes, [first, second]);
});

test('CombineTypesSpecializations', () => {
    const firstArg = ClassType.cloneAsInstance(createClassType('First'));
    const secondArg = ClassType.cloneAsInstance(createClassType('Second'));
    const genericClass = createClassType('Generic');
    const first = ClassType.cloneAsInstance(ClassType.specialize(genericClass, [firstArg]));
    const second = ClassType.cloneAsInstance(ClassType.specialize(genericClass, [secondArg]));
    const unrelated = ClassType.cloneAsInstance(createClassType('Unrelated'));

    const union = combineTypes([first, unrelated, second, ClassType.cloneForDeprecatedInstance(first, 'deprecated')]);
    assert.ok(isUnion(union));
    assert.deepStrictEqual(union.priv.subtypes, [first, unrelated, second]);
});

test('CombineTypesLiteralElisionWithDistinctClasses', () => {
    const intType = ClassType.cloneAsInstance(createClassType('int', ClassTypeFlags.BuiltIn));
    const literal = ClassType.cloneWithLiteral(intType, 1);
    const unrelated = ClassType.cloneAsInstance(createClassType('Unrelated'));

    const union = combineTypes([unrelated, literal, intType]);
    assert.ok(isUnion(union));
    assert.deepStrictEqual(union.priv.subtypes, [unrelated, intType]);
});

test('CombineTypesPseudoGenericSpecializations', () => {
    const genericClass = createClassType('PseudoGeneric', ClassTypeFlags.PseudoGenericClass);
    genericClass.shared.typeParams.push(TypeVarType.createInstance('_T'));
    const firstArg = ClassType.cloneAsInstance(createClassType('First'));
    const secondArg = ClassType.cloneAsInstance(createClassType('Second'));
    const first = ClassType.cloneAsInstance(ClassType.specialize(genericClass, [firstArg]));
    const second = ClassType.cloneAsInstance(ClassType.specialize(genericClass, [secondArg]));
    const unrelated = ClassType.cloneAsInstance(createClassType('Unrelated'));

    const union = combineTypes([first, unrelated, second]);
    assert.ok(isUnion(union));
    assert.strictEqual(union.priv.subtypes.length, 2);
    assert.ok(
        isTypeSame(
            union.priv.subtypes[0],
            ClassType.cloneAsInstance(ClassType.specialize(genericClass, [UnknownType.create()]))
        )
    );
    assert.strictEqual(union.priv.subtypes[1], unrelated);
});

test('CombineTypesTypeForms', () => {
    const classType = createClassType('Value');
    const firstForm = ClassType.cloneAsInstance(createClassType('First'));
    const secondForm = ClassType.cloneAsInstance(createClassType('Second'));
    const first = TypeBase.cloneWithTypeForm(classType, firstForm);
    const second = TypeBase.cloneWithTypeForm(classType, secondForm);
    const unrelated = createClassType('Unrelated');

    const union = combineTypes([first, unrelated, second]);
    assert.ok(isUnion(union));
    assert.deepStrictEqual(union.priv.subtypes, [first, unrelated, second]);
});

test('CombineTypesBuiltInBoolAliases', () => {
    const firstBool = ClassType.cloneAsInstance(createClassType('bool', ClassTypeFlags.BuiltIn, 'builtins.bool'));
    const secondBool = ClassType.cloneAsInstance(createClassType('bool', ClassTypeFlags.BuiltIn, 'alias.bool'));
    const combined = combineTypes([
        ClassType.cloneWithLiteral(firstBool, true),
        ClassType.cloneWithLiteral(secondBool, false),
    ]);

    assert.ok(isClassInstance(combined));
    assert.ok(ClassType.isBuiltIn(combined, 'bool'));
    assert.strictEqual(combined.priv.literalValue, undefined);
});

test('CombineTypesWideDistinctClasses', () => {
    const types = Array.from({ length: 256 }, (_, index) =>
        ClassType.cloneAsInstance(createClassType('Value', ClassTypeFlags.None, `module${index}.Value`))
    );
    const duplicates = types.map((type) => ClassType.cloneForDeprecatedInstance(type, 'deprecated'));

    const union = combineTypes([...types, ...duplicates]);
    assert.ok(isUnion(union));
    assert.deepStrictEqual(union.priv.subtypes, types);
});

function createClassType(name: string, flags = ClassTypeFlags.None, fullName = name) {
    const classType = ClassType.createInstantiable(
        name,
        fullName,
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
