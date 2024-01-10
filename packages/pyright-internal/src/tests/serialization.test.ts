/*
 * serialization.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for serializing/deserializing data for background threads.
 */

import assert from 'assert';

import { deserialize, serialize } from '../backgroundThreadBase';
import { Uri } from '../common/uri/uri';

test('Simple string', () => {
    const serialized = serialize('hello');
    const deserialized = deserialize(serialized);
    assert.strictEqual(deserialized, 'hello');
});

test('Simple number', () => {
    const serialized = serialize(123);
    const deserialized = deserialize(serialized);
    assert.strictEqual(deserialized, 123);
});

test('Simple boolean', () => {
    const serialized = serialize(true);
    const deserialized = deserialize(serialized);
    assert.strictEqual(deserialized, true);
});

test('Simple object', () => {
    const serialized = serialize({ a: 1, b: 'hello' });
    const deserialized = deserialize(serialized);
    assert.deepStrictEqual(deserialized, { a: 1, b: 'hello' });
});

test('Simple array', () => {
    const serialized = serialize([1, 'hello']);
    const deserialized = deserialize(serialized);
    assert.deepStrictEqual(deserialized, [1, 'hello']);
});

test('Object with maps', () => {
    const serialized = serialize({
        a: new Map<string, number>([
            ['hello', 1],
            ['world', 2],
        ]),
    });
    const deserialized = deserialize(serialized);
    assert.deepStrictEqual(deserialized, {
        a: new Map<string, number>([
            ['hello', 1],
            ['world', 2],
        ]),
    });
});

test('Object with sets', () => {
    const serialized = serialize({ a: new Set<string>(['hello', 'world']) });
    const deserialized = deserialize(serialized);
    assert.deepStrictEqual(deserialized, { a: new Set<string>(['hello', 'world']) });
});

test('Object with undefined', () => {
    const serialized = serialize({ a: undefined });
    const deserialized = deserialize(serialized);
    assert.deepStrictEqual(deserialized, {});
});

test('Object with null', () => {
    const serialized = serialize({ a: null });
    const deserialized = deserialize(serialized);
    assert.deepStrictEqual(deserialized, { a: null });
});

test('Object with URI', () => {
    const serialized = serialize({ a: Uri.file('hello') });
    const deserialized = deserialize(serialized);
    assert.deepStrictEqual(deserialized, { a: Uri.file('hello') });
});

test('Object with URI array', () => {
    const serialized = serialize({ a: [Uri.file('hello'), Uri.file('world')] });
    const deserialized = deserialize(serialized);
    assert.deepStrictEqual(deserialized, { a: [Uri.file('hello'), Uri.file('world')] });
});
