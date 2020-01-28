/*
* collectionUtils.test.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
*/

import * as assert from 'assert';
import * as utils from '../common/collectionUtils';
import { compareValues, isArray } from '../common/core';

test('UtilsContainsDefault', () => {
    const data = [1, 2, 3, 4, 5];
    assert(utils.contains(data, 2));
});

test('UtilsContainsComparer', () => {
    const data = [new D(1, "A"), new D(2, "B"), new D(3, "C"), new D(4, "D")]
    assert(utils.contains(data, new D(1, "D"), (a, b) => a.Value == b.Value));
});

test('UtilsAppend', () => {
    const data: number[] = [];
    assert.deepEqual(utils.append(data, 1), [1]);
});

test('UtilsAppendUndefined', () => {
    const data = undefined;
    assert.deepEqual(utils.append(data, 1), [1]);
});

test('UtilsAppendUndefinedValue', () => {
    const data = [1];
    assert.equal(utils.append(data, undefined), data);
});

test('UtilsFindEmpty', () => {
    const data: number[] = [];
    assert.equal(utils.find(data, e => true), undefined);
});

test('UtilsFindNoMatch', () => {
    const data = [1];
    assert.equal(utils.find(data, e => false), undefined);
});

test('UtilsFindMatchSimple', () => {
    const data = [1];
    assert.equal(utils.find(data, e => e == 1), 1);
});

test('UtilsFindMatch', () => {
    const data = [new D(1, "Hello")];
    assert.equal(utils.find(data, e => e.Value == 1), data[0]);
});

test('UtilsFindMatchCovariant', () => {
    const item1 = new D(1, "Hello");
    const item2 = new D(2, "Hello2");
    const data: B[] = [new B(0), item1, item2, new B(3)];
    assert.equal(utils.find(data, (e: D) => e.Value == 2), item2);
});

test('UtilsStableSort', () => {
    const data = [new D(2, "Hello3"), new D(1, "Hello1"), new D(2, "Hello4"), new D(1, "Hello2")];
    const sorted = utils.stableSort(data, (a, b) => compareValues(a.Value, b.Value));

    let result: string[] = [];
    sorted.forEach(e => result.push(e.Name));

    assert.deepEqual(result, ["Hello1", "Hello2", "Hello3", "Hello4"])
});

test('UtilsBinarySearch', () => {
    const data = [new D(1, "Hello3"), new D(2, "Hello1"), new D(3, "Hello4"), new D(4, "Hello2")];
    const index = utils.binarySearch(data, new D(3, "Unused"), v => v.Value, compareValues, 0);

    assert.equal(index, 2);
});

test('UtilsBinarySearchMiss', () => {
    const data = [new D(1, "Hello3"), new D(2, "Hello1"), new D(4, "Hello4"), new D(5, "Hello2")];
    const index = utils.binarySearch(data, new D(3, "Unused"), v => v.Value, compareValues, 0);

    assert.equal(~index, 2);
});

test('isArray1', () => {
    const data = [new D(1, "Hello3")];
    assert(isArray(data));
});

test('isArray2', () => {
    const data = {};
    assert(!isArray(data));
});

test('addRange1', () => {
    const data: number[] = [];
    assert.deepEqual(utils.addRange(data, [1, 2, 3]), [1, 2, 3]);
});

test('addRange2', () => {
    const data: number[] = [1, 2, 3];
    assert.deepEqual(utils.addRange(data, [1, 2, 3, 4], 3, 4), [1, 2, 3, 4]);
});

test('insertAt1', () => {
    const data: number[] = [2, 3, 4];
    assert.deepEqual(utils.insertAt(data, 0, 1), [1, 2, 3, 4]);
});

test('insertAt2', () => {
    const data: number[] = [1, 2, 4];
    assert.deepEqual(utils.insertAt(data, 2, 3), [1, 2, 3, 4]);
});

test('insertAt3', () => {
    const data: number[] = [1, 2, 3];
    assert.deepEqual(utils.insertAt(data, 3, 4), [1, 2, 3, 4]);
});

test('cloneAndSort', () => {
    const data: number[] = [3, 2, 1];
    assert.deepEqual(utils.cloneAndSort(data), [1, 2, 3]);
});

test('flatten', () => {
    const data: number[][] = [[1, 2], [3, 4], [5, 6]];
    assert.deepEqual(utils.flatten(data), [1, 2, 3, 4, 5, 6]);
});

class B {
    Value: number;

    constructor(value: number) {
        this.Value = value;
    }
};

class D extends B {
    Name: string;

    constructor(value: number, name: string) {
        super(value);
        this.Name = name;
    }
}