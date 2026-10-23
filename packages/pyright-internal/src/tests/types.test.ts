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
    ClassType,
    ClassTypeFlags,
    combineTypes,
    getInferredTupleLiteralBase,
    isTypeSame,
    retainInferredTupleLiterals,
} from '../analyzer/types';
import { Uri } from '../common/uri/uri';

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
