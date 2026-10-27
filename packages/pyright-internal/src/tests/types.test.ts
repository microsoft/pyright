/*
 * types.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for analyzer type helpers.
 */

import * as assert from 'assert';

import { ClassType, ClassTypeFlags, FunctionType, FunctionTypeFlags } from '../analyzer/types';
import { Uri } from '../common/uri/uri';

test('ClassBuiltInNameMatching', () => {
    const classType = ClassType.createInstantiable(
        'list',
        'builtins.list',
        'builtins',
        Uri.empty(),
        ClassTypeFlags.None,
        0,
        /* declaredMetaclass */ undefined,
        /* effectiveMetaclass */ undefined
    );
    classType.priv.aliasName = 'List';

    assert.strictEqual(ClassType.isBuiltIn(classType, 'list'), false);
    classType.shared.flags |= ClassTypeFlags.BuiltIn;

    for (const name of ['list', 'builtins.list', 'List']) {
        assert.strictEqual(ClassType.isBuiltIn(classType, name), true);
        assert.strictEqual(ClassType.isBuiltIn(classType, ['other', name]), true);
    }

    assert.strictEqual(ClassType.isBuiltIn(classType, 'other'), false);
    assert.strictEqual(ClassType.isBuiltIn(classType, ''), false);
    assert.strictEqual(ClassType.isBuiltIn(classType, []), false);
    assert.strictEqual(ClassType.isBuiltIn(classType), true);
});

test('FunctionBuiltInNameMatching', () => {
    const functionType = FunctionType.createInstance('len', 'builtins.len', 'builtins', FunctionTypeFlags.None);

    assert.strictEqual(FunctionType.isBuiltIn(functionType, 'len'), false);
    functionType.shared.flags |= FunctionTypeFlags.BuiltIn;

    for (const name of ['len', 'builtins.len']) {
        assert.strictEqual(FunctionType.isBuiltIn(functionType, name), true);
        assert.strictEqual(FunctionType.isBuiltIn(functionType, ['other', name]), true);
    }

    assert.strictEqual(FunctionType.isBuiltIn(functionType, 'other'), false);
    assert.strictEqual(FunctionType.isBuiltIn(functionType, ''), false);
    assert.strictEqual(FunctionType.isBuiltIn(functionType, []), false);
    assert.strictEqual(FunctionType.isBuiltIn(functionType), true);
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
