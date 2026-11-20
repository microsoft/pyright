/*
 * types.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for analyzer type helpers.
 */

import * as assert from 'assert';

import { applyTypeNarrowingCallback } from '../analyzer/typeGuards';
import {
    AnyType,
    ClassType,
    ClassTypeFlags,
    combineTypes,
    exceedsInferredTupleLiteralProduct,
    getInferredTupleLiteralBase,
    isTypeSame,
    isUnion,
    retainInferredTupleLiterals,
    TypeBase,
    TypeVarType,
    UnknownType,
} from '../analyzer/types';
import { Uri } from '../common/uri/uri';

test('CombineSpecializedTypedDictPresenceVariants', () => {
    const cls = ClassType.createInstantiable(
        'Options',
        'test.Options',
        'test',
        Uri.empty(),
        ClassTypeFlags.TypedDictClass,
        0,
        undefined,
        undefined
    );
    const valueType = AnyType.create();
    const specialized = ClassType.cloneAsInstance(ClassType.specialize(cls, [valueType]));
    const otherSpecialization = ClassType.cloneAsInstance(ClassType.specialize(cls, [UnknownType.create()]));
    const provided = { valueType, isRequired: false, isReadOnly: false, isProvided: true };
    const absent = { ...provided, isProvided: false };
    const variants = Array.from({ length: 32 }, (_, i) =>
        ClassType.cloneForNarrowedTypedDictEntries(specialized, new Map([[`key${i}`, provided]]))
    );
    const ordered = ClassType.cloneForNarrowedTypedDictEntries(
        specialized,
        new Map([
            ['a,b', provided],
            ['"c"', provided],
        ])
    );
    const reversed = ClassType.cloneForNarrowedTypedDictEntries(
        specialized,
        new Map([
            ['"c"', provided],
            ['a,b', provided],
        ])
    );
    const notProvided = ClassType.cloneForNarrowedTypedDictEntries(specialized, new Map([['key0', absent]]));
    const differentArgs = ClassType.cloneForNarrowedTypedDictEntries(
        otherSpecialization,
        new Map([['key0', provided]])
    );
    const expected = [...variants, ordered, notProvided, differentArgs, specialized];
    const combined = combineTypes([...expected, reversed, variants[0]]);
    assert.ok(isUnion(combined));
    assert.deepStrictEqual(combined.priv.subtypes, expected);

    // Both forms have identical key presence, but only one has type-form metadata.
    const tagged = TypeBase.cloneWithTypeForm(ordered, specialized);
    for (const [first, second] of [
        [ordered, tagged],
        [tagged, ordered],
    ]) {
        const capped = combineTypes([...variants, first, second, notProvided], { maxSubtypeCount: 34 });
        assert.ok(isUnion(capped));
        assert.deepStrictEqual(capped.priv.subtypes, [...variants, first, notProvided]);

        const preserveForms = combineTypes([...variants, first, second], { skipElideRedundantLiterals: true });
        assert.ok(isUnion(preserveForms));
        assert.deepStrictEqual(preserveForms.priv.subtypes, [...variants, first, second]);
    }
});

test('DisjointBaseDoesNotSynthesizeDataClassMethods', () => {
    const classType = ClassType.createInstantiable(
        'SlottedDataClass',
        '',
        '',
        Uri.empty(),
        ClassTypeFlags.None,
        0,
        /* declaredMetaclass */ undefined,
        /* effectiveMetaclass */ undefined
    );

    let synthesizedSlots = false;
    let synthesizedMethods = false;
    classType.shared.synthesizeDataClassSlotsDeferred = () => {
        synthesizedSlots = true;
        classType.shared.hasNonEmptySlots = true;
    };
    classType.shared.synthesizeMethodsDeferred = () => {
        synthesizedMethods = true;
    };

    assert.strictEqual(ClassType.getDisjointBase(classType), classType);
    assert.strictEqual(synthesizedSlots, true);
    assert.strictEqual(synthesizedMethods, false);
});

test('InferredTupleLiteralGuardViews', () => {
    const base = ClassType.cloneAsInstance(
        ClassType.createInstantiable(
            'int',
            'builtins.int',
            'builtins',
            Uri.empty(),
            ClassTypeFlags.BuiltIn,
            0,
            /* declaredMetaclass */ undefined,
            /* effectiveMetaclass */ undefined
        )
    );
    const literal = ClassType.cloneWithLiteral(base, 1);
    const retained = retainInferredTupleLiterals(literal, base);
    let calls = 0;

    const independent = applyTypeNarrowingCallback((type) => {
        calls++;
        return { type: type === base ? literal : type, isIncomplete: type === base };
    }, retained);
    assert.ok(independent);
    assert.strictEqual(calls, 2);
    assert.strictEqual(independent.type, literal);
    assert.strictEqual(independent.type.props?.inferredTupleLiteral, undefined);
    assert.strictEqual(independent.isIncomplete, true);

    const guardedBase = combineTypes([literal, ClassType.cloneWithLiteral(base, 2)]);
    calls = 0;
    const membership = applyTypeNarrowingCallback((type) => {
        calls++;
        return { type: type === base ? guardedBase : type, isIncomplete: false };
    }, retained);
    assert.ok(membership);
    assert.strictEqual(calls, 2);
    assert.ok(isTypeSame(membership.type, literal));
    assert.strictEqual(getInferredTupleLiteralBase(membership.type), guardedBase);

    const inferred = applyTypeNarrowingCallback(() => ({ type: retained, isIncomplete: false }), retained);
    assert.ok(inferred);
    assert.strictEqual(getInferredTupleLiteralBase(inferred.type), base);
    assert.strictEqual(getInferredTupleLiteralBase(retained), base);

    calls = 0;
    applyTypeNarrowingCallback((type) => {
        calls++;
        return { type, isIncomplete: false };
    }, base);
    assert.strictEqual(calls, 1);
});

test('InferredTupleLiteralProductBudget', () => {
    const base = ClassType.cloneAsInstance(
        ClassType.createInstantiable(
            'int',
            'builtins.int',
            'builtins',
            Uri.empty(),
            ClassTypeFlags.BuiltIn,
            0,
            /* declaredMetaclass */ undefined,
            /* effectiveMetaclass */ undefined
        )
    );
    const choices = Array.from({ length: 9 }, (_, index) => ClassType.cloneWithLiteral(base, index));
    const eight = combineTypes(choices.slice(0, 8));
    const retained = retainInferredTupleLiterals(eight, base);
    assert.strictEqual(retained.props?.inferredTupleLiteral?.alternatives, 8);
    assert.strictEqual(exceedsInferredTupleLiteralProduct(retained, eight), false);
    assert.strictEqual(exceedsInferredTupleLiteralProduct(retained, combineTypes(choices)), true);

    const opaque = TypeVarType.createInstance('T');
    opaque.shared.boundType = combineTypes(choices);
    assert.strictEqual(exceedsInferredTupleLiteralProduct(retained, opaque), true);
    assert.strictEqual(exceedsInferredTupleLiteralProduct(opaque, retained), true);
    assert.strictEqual(exceedsInferredTupleLiteralProduct(retained, combineTypes([base, opaque])), true);
    assert.strictEqual(exceedsInferredTupleLiteralProduct(base, opaque), false);
});
