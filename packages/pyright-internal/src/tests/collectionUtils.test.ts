/*
 * collectionUtils.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

import assert from 'assert';

import * as utils from '../common/collectionUtils';
import { compareValues, isArray } from '../common/core';

test('UtilsContainsDefault', () => {
    const data = [1, 2, 3, 4, 5];
    assert(utils.contains(data, 2));
});

test('UtilsContainsComparer', () => {
    const data = [new D(1, 'A'), new D(2, 'B'), new D(3, 'C'), new D(4, 'D')];
    assert(utils.contains(data, new D(1, 'D'), (a, b) => a.value === b.value));
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
    assert.equal(
        utils.find(data, (e) => true),
        undefined
    );
});

test('UtilsFindNoMatch', () => {
    const data = [1];
    assert.equal(
        utils.find(data, (e) => false),
        undefined
    );
});

test('UtilsFindMatchSimple', () => {
    const data = [1];
    assert.equal(
        utils.find(data, (e) => e === 1),
        1
    );
});

test('UtilsFindMatch', () => {
    const data = [new D(1, 'Hello')];
    assert.equal(
        utils.find(data, (e) => e.value === 1),
        data[0]
    );
});

test('UtilsFindMatchCovariant', () => {
    const item1 = new D(1, 'Hello');
    const item2 = new D(2, 'Hello2');
    const data: B[] = [new B(0), item1, item2, new B(3)];
    assert.equal(
        utils.find(data, (e: B) => e.value === 2),
        item2
    );
});

test('UtilsStableSort', () => {
    const data = [new D(2, 'Hello3'), new D(1, 'Hello1'), new D(2, 'Hello4'), new D(1, 'Hello2')];
    const sorted = utils.stableSort(data, (a, b) => compareValues(a.value, b.value));

    const result: string[] = [];
    sorted.forEach((e) => result.push(e.name));

    assert.deepEqual(result, ['Hello1', 'Hello2', 'Hello3', 'Hello4']);
});

test('UtilsBinarySearch', () => {
    const data = [new D(1, 'Hello3'), new D(2, 'Hello1'), new D(3, 'Hello4'), new D(4, 'Hello2')];
    const index = utils.binarySearch(data, new D(3, 'Unused'), (v) => v.value, compareValues, 0);

    assert.equal(index, 2);
});

test('UtilsBinarySearchMiss', () => {
    const data = [new D(1, 'Hello3'), new D(2, 'Hello1'), new D(4, 'Hello4'), new D(5, 'Hello2')];
    const index = utils.binarySearch(data, new D(3, 'Unused'), (v) => v.value, compareValues, 0);

    assert.equal(~index, 2);
});

test('isArray1', () => {
    const data = [new D(1, 'Hello3')];
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
    const data: number[][] = [
        [1, 2],
        [3, 4],
        [5, 6],
    ];
    assert.deepEqual(utils.flatten(data), [1, 2, 3, 4, 5, 6]);
});

test('getNestedProperty', () => {
    const data = { a: { b: { c: 3 } } };
    assert.deepEqual(utils.getNestedProperty(data, 'a'), { b: { c: 3 } });
    assert.deepEqual(utils.getNestedProperty(data, 'a.b'), { c: 3 });
    assert.deepEqual(utils.getNestedProperty(data, 'a.b.c'), 3);
    assert.deepEqual(utils.getNestedProperty(data, 'x'), undefined);
    assert.deepEqual(utils.getNestedProperty(data, 'a.x'), undefined);
    assert.deepEqual(utils.getNestedProperty(data, ''), undefined);
    assert.deepEqual(utils.getNestedProperty(undefined, ''), undefined);
});

test('createMapFromItems groups by key preserving order and identity', () => {
    const a = { id: 1, k: 'x' };
    const b = { id: 2, k: 'y' };
    const c = { id: 3, k: 'x' };
    const map = utils.createMapFromItems([a, b, c], (t) => t.k);

    // Keys appear in first-occurrence order.
    assert.deepEqual([...map.keys()], ['x', 'y']);
    // Items keep their original order within a key, and the exact references are stored.
    assert.equal(map.get('x')!.length, 2);
    assert.strictEqual(map.get('x')![0], a);
    assert.strictEqual(map.get('x')![1], c);
    assert.strictEqual(map.get('y')![0], b);
});

test('createMapFromItems handles empty input', () => {
    const map = utils.createMapFromItems<number>([], (t) => String(t));
    assert.equal(map.size, 0);
});

test('createMapFromItems keeps duplicate identical references', () => {
    const dup = { id: 'dup' };
    const map = utils.createMapFromItems([dup, dup, dup], () => 'k');
    assert.equal(map.get('k')!.length, 3);
    assert.strictEqual(map.get('k')![0], dup);
    assert.strictEqual(map.get('k')![2], dup);
});

test('createMapFromItems matches legacy concat-based semantics', () => {
    assertCreateMapParity<number>([], (t) => String(t));
    assertCreateMapParity([{ v: 'a' }, { v: 'b' }, { v: 'a' }], (t) => t.v);
    assertCreateMapParity(['aa', 'bb', 'aa', 'cc'], (t) => t[0]);
    assertCreateMapParity([1, 2, 12, 22, 3], (t) => String(t % 10));
    assertCreateMapParity([{ v: '' }, { v: '0' }, { v: 'undefined' }, { v: 'ключ' }, { v: '' }], (t) => t.v);
});

// Oracle that reproduces the pre-rewrite concat-based implementation, so any
// behavioral drift for the non-array items every caller passes is caught.
function assertCreateMapParity<T>(items: T[], keyGetter: (t: T) => string) {
    const legacy = items
        .map((t) => keyGetter(t))
        .reduce((m, key, i) => {
            m.set(key, (m.get(key) || []).concat(items[i]));
            return m;
        }, new Map<string, T[]>());
    const actual = utils.createMapFromItems(items, keyGetter);

    assert.deepEqual([...actual.keys()], [...legacy.keys()]);
    for (const key of legacy.keys()) {
        assert.deepEqual(actual.get(key), legacy.get(key));
    }
}

class B {
    value: number;

    constructor(value: number) {
        this.value = value;
    }
}

class D extends B {
    name: string;

    constructor(value: number, name: string) {
        super(value);
        this.name = name;
    }
}
