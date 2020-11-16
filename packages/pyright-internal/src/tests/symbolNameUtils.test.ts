/*
 * symbolNameUtils.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

import * as assert from 'assert';

import * as snu from '../analyzer/symbolNameUtils';

test('symbolNameUtils isPrivateName', () => {
    assert.strictEqual(snu.isPrivateName('__var'), true);
    assert.strictEqual(snu.isPrivateName('__Var_1-2'), true);

    assert.strictEqual(snu.isPrivateName('var'), false);
    assert.strictEqual(snu.isPrivateName('_var'), false);
    assert.strictEqual(snu.isPrivateName('__var__'), false);
});

test('symbolNameUtils isProtectedName', () => {
    assert.strictEqual(snu.isProtectedName('_var'), true);
    assert.strictEqual(snu.isProtectedName('_Var_1-2'), true);

    assert.strictEqual(snu.isProtectedName('__var'), false);
    assert.strictEqual(snu.isProtectedName('var'), false);
});

test('symbolNameUtils isPrivateOrProtectedName', () => {
    assert.strictEqual(snu.isPrivateOrProtectedName('_var'), true);
    assert.strictEqual(snu.isPrivateOrProtectedName('__VAR_1-2'), true);

    assert.strictEqual(snu.isPrivateOrProtectedName('var'), false);
    assert.strictEqual(snu.isPrivateOrProtectedName('__init__'), false);
});

test('symbolNameUtils isDunderName', () => {
    assert.strictEqual(snu.isDunderName('__init__'), true);
    assert.strictEqual(snu.isDunderName('__CONSTANT__'), true);

    assert.strictEqual(snu.isDunderName('____'), false);
    assert.strictEqual(snu.isDunderName('_init_'), false);
    assert.strictEqual(snu.isDunderName('init'), false);
});

test('symbolNameUtils isConstantName', () => {
    assert.strictEqual(snu.isConstantName('CONSTANT'), true);
    assert.strictEqual(snu.isConstantName('CONSTANT_NAME'), true);
    assert.strictEqual(snu.isConstantName('CONSTANT_42'), true);
    assert.strictEqual(snu.isConstantName('_CONSTANT_42'), true);
    assert.strictEqual(snu.isConstantName('__CONSTANT_42'), true);

    assert.strictEqual(snu.isConstantName('Constant'), false);
    assert.strictEqual(snu.isConstantName('constant'), false);
    assert.strictEqual(snu.isConstantName('____'), false);
});

test('symbolNameUtils isTypeAliasName', () => {
    assert.strictEqual(snu.isTypeAliasName('TypeAlias'), true);
    assert.strictEqual(snu.isTypeAliasName('Type_alias'), true);
    assert.strictEqual(snu.isTypeAliasName('TypeAlias1'), true);
    assert.strictEqual(snu.isTypeAliasName('_TypeAlias'), true);
    assert.strictEqual(snu.isTypeAliasName('__TypeAlias'), true);

    assert.strictEqual(snu.isTypeAliasName('invalidTypeAlias'), false);
    assert.strictEqual(snu.isTypeAliasName('1TypeAlias'), false);
    assert.strictEqual(snu.isTypeAliasName('___TypeAlias'), false);
});

test('symbolNameUtils isPublicConstantOrTypeAliasName', () => {
    assert.strictEqual(snu.isPublicConstantOrTypeAlias('CONSTANT'), true);
    assert.strictEqual(snu.isPublicConstantOrTypeAlias('TypeAlias'), true);

    assert.strictEqual(snu.isPublicConstantOrTypeAlias('var'), false);
    assert.strictEqual(snu.isPublicConstantOrTypeAlias('_CONSTANT'), false);
    assert.strictEqual(snu.isPublicConstantOrTypeAlias('_TypeAlias'), false);
    assert.strictEqual(snu.isPublicConstantOrTypeAlias('__TypeAlias'), false);
});
