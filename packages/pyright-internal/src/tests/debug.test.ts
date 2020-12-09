/*
 * debug.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

import assert from 'assert';

import * as debug from '../common/debug';

test('DebugAssertTrue', () => {
    assert.doesNotThrow(() => {
        debug.assert(true, "doesn't throw");
    });
});

test('DebugAssertFalse', () => {
    assert.throws(
        () => {
            debug.assert(false, 'should throw');
        },
        (err: any) => err instanceof Error,
        'unexpected'
    );
});

test('DebugAssertDetailInfo', () => {
    // let assert to show more detail info which will get collected when
    // assert raised
    const detailInfo = 'Detail Info';
    assert.throws(
        () => {
            debug.assert(false, 'should throw', () => detailInfo);
        },
        (err: any) => err instanceof Error && err.message.includes(detailInfo),
        'unexpected'
    );
});

test('DebugAssertStackTrace', () => {
    // let assert to control what call stack to put in exception stack
    assert.throws(
        () => {
            debug.assert(false, 'should throw', undefined, assert.throws);
        },
        (err: any) => err instanceof Error && !err.message.includes('assert.throws'),
        'unexpected'
    );
});

test('DebugAssertUndefined', () => {
    const unused = undefined;
    assert.throws(
        () => debug.assertDefined(unused),
        (err: any) => err instanceof Error,
        'unexpected'
    );
});

test('DebugAssertDefined', () => {
    const unused = 1;
    assert.doesNotThrow(() => debug.assertDefined(unused));
});

test('DebugAssertEachUndefined', () => {
    type T = number | undefined;
    const unused: T[] = [1, 2, 3, undefined];
    assert.throws(
        () => debug.assertEachDefined(unused),
        (err: any) => err instanceof Error,
        'unexpected'
    );
});

test('DebugAssertEachDefined', () => {
    const unused: number[] = [1, 2, 3];
    assert.doesNotThrow(() => debug.assertEachDefined(unused));
});

test('DebugAssertNever', () => {
    const enum MyEnum {
        A,
        B,
        C,
    }
    const unused = 5 as MyEnum;

    // prevent one from adding new values and forget to add
    // handlers some places
    assert.throws(
        () => {
            switch (unused) {
                case MyEnum.A:
                case MyEnum.B:
                case MyEnum.C:
                    break;
                default:
                    debug.assertNever(unused);
            }
        },
        (err: any) => err instanceof Error,
        'unexpected'
    );
});

test('DebugGetFunctionName', () => {
    // helper method to add better message in exception
    assert(debug.getFunctionName(assert.throws) === 'throws');
});

test('DebugFormatEnum', () => {
    // helper method to add better message in exception around enum
    // const enum require --preserveConstEnums flag to work properly
    enum MyEnum {
        A,
        B,
        C,
    }
    assert(debug.formatEnum(MyEnum.A, MyEnum, false) === 'A');
});
