/*
 * typeUtils.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for typeUtils module.
 */

import * as assert from 'assert';

import {
    allSubtypes,
    combineSameSizedTuples,
    derivesFromAnyOrUnknown,
    getLiteralTypeClassName,
    someSubtypes,
} from '../analyzer/typeUtils';
import {
    AnyType,
    ClassType,
    ClassTypeFlags,
    isClassInstance,
    Type,
    UnionableType,
    UnionType,
    UnknownType,
} from '../analyzer/types';
import { Uri } from '../common/uri/uri';

test('AllSubtypes', () => {
    const unionType = createUnion(createClassType('A'), createClassType('B'), createClassType('C'));
    const visitedSubtypes: Type[] = [];

    const result = allSubtypes(unionType, (subtype) => {
        visitedSubtypes.push(subtype);
        return visitedSubtypes.length < 2;
    });

    assert.strictEqual(result, false);
    assert.strictEqual(visitedSubtypes.length, 2);

    assert.strictEqual(
        allSubtypes(unionType, () => {
            return true;
        }),
        true
    );

    const singleType = createClassType('D');
    assert.strictEqual(
        allSubtypes(singleType, (subtype) => {
            assert.strictEqual(subtype, singleType);
            return true;
        }),
        true
    );
});

test('SomeSubtypes', () => {
    const unionType = createUnion(createClassType('A'), createClassType('B'), createClassType('C'));
    const visitedSubtypes: Type[] = [];

    const result = someSubtypes(unionType, (subtype) => {
        visitedSubtypes.push(subtype);
        return visitedSubtypes.length === 2;
    });

    assert.strictEqual(result, true);
    assert.strictEqual(visitedSubtypes.length, 2);

    assert.strictEqual(
        someSubtypes(unionType, () => {
            return false;
        }),
        false
    );

    const singleType = createClassType('D');
    assert.strictEqual(
        someSubtypes(singleType, (subtype) => {
            assert.strictEqual(subtype, singleType);
            return false;
        }),
        false
    );
});

test('DerivesFromAnyOrUnknownUnion', () => {
    const classType = createClassType('A');

    assert.strictEqual(derivesFromAnyOrUnknown(createUnion(classType, UnknownType.create())), true);
    assert.strictEqual(derivesFromAnyOrUnknown(createUnion(classType, AnyType.create())), true);
    assert.strictEqual(derivesFromAnyOrUnknown(createUnion(classType, createClassType('B'))), false);
});

test('GetLiteralTypeClassName', () => {
    const intLiteral1 = createLiteralInstance('int', 1);
    const intLiteral2 = createLiteralInstance('int', 2);
    const strLiteral = createLiteralInstance('str', '');
    const nonLiteralInt = ClassType.cloneAsInstance(createClassType('int', ClassTypeFlags.BuiltIn));

    assert.strictEqual(getLiteralTypeClassName(intLiteral1), 'int');
    assert.strictEqual(getLiteralTypeClassName(createUnion(intLiteral1, intLiteral2)), 'int');
    assert.strictEqual(getLiteralTypeClassName(createUnion(intLiteral1, strLiteral)), undefined);
    assert.strictEqual(getLiteralTypeClassName(createUnion(intLiteral1, nonLiteralInt)), undefined);
});

test('CombineSameSizedTuples', () => {
    const tupleClass = createClassType('tuple', ClassTypeFlags.BuiltIn);
    const intType = ClassType.cloneAsInstance(createClassType('int', ClassTypeFlags.BuiltIn));
    const strType = ClassType.cloneAsInstance(createClassType('str', ClassTypeFlags.BuiltIn));
    const boolType = ClassType.cloneAsInstance(createClassType('bool', ClassTypeFlags.BuiltIn));

    const tuple1 = createTupleInstance(tupleClass, [intType, strType]);
    const tuple2 = createTupleInstance(tupleClass, [strType, boolType]);
    const tupleUnion = createUnion(tuple1, tuple2);

    const combinedTuple = combineSameSizedTuples(tupleUnion, tupleClass);
    assert.notStrictEqual(combinedTuple, tupleUnion);
    assert.strictEqual(isClassInstance(combinedTuple), true);
    assert.strictEqual((combinedTuple as ClassType).priv.tupleTypeArgs?.length, 2);

    const mismatchedTuple = createTupleInstance(tupleClass, [intType]);
    const mismatchedTupleUnion = createUnion(tuple1, mismatchedTuple);
    assert.strictEqual(combineSameSizedTuples(mismatchedTupleUnion, tupleClass), mismatchedTupleUnion);

    const nonTupleUnion = createUnion(tuple1, intType);
    assert.strictEqual(combineSameSizedTuples(nonTupleUnion, tupleClass), nonTupleUnion);
});

function createLiteralInstance(name: string, literalValue: string | number | boolean) {
    return ClassType.cloneAsInstance(
        ClassType.cloneWithLiteral(createClassType(name, ClassTypeFlags.BuiltIn), literalValue)
    );
}

function createTupleInstance(tupleClass: ClassType, entries: UnionableType[]) {
    return ClassType.cloneAsInstance(
        ClassType.specialize(
            tupleClass,
            [createUnion(...entries)],
            /* isTypeArgExplicit */ true,
            /* includeSubclasses */ false,
            entries.map((type) => {
                return { type, isUnbounded: false };
            })
        )
    );
}

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

function createUnion(...subtypes: UnionableType[]) {
    const unionType = UnionType.create();
    subtypes.forEach((subtype) => {
        UnionType.addType(unionType, subtype);
    });
    return unionType;
}
