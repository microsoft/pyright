/*
 * serialization.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for serializing/deserializing data for background threads.
 */

import assert from 'assert';

import { deserialize, serialize } from '../backgroundThreadBase';
import { UriEx } from '../common/uri/uriUtils';
import { CancellationToken } from 'vscode-languageserver';

export function serializationTests(serializer = serialize, deserializer = deserialize) {
    test('Simple string', () => {
        const serialized = serializer('hello');
        const deserialized = deserializer(serialized);
        assert.strictEqual(deserialized, 'hello');
    });

    test('Simple number', () => {
        const serialized = serializer(123);
        const deserialized = deserializer(serialized);
        assert.strictEqual(deserialized, 123);
    });

    test('Simple boolean', () => {
        const serialized = serializer(true);
        const deserialized = deserializer(serialized);
        assert.strictEqual(deserialized, true);
    });

    test('Simple object', () => {
        const serialized = serializer({ a: 1, b: 'hello' });
        const deserialized = deserializer(serialized);
        assert.deepStrictEqual(deserialized, { a: 1, b: 'hello' });
    });

    test('Simple array', () => {
        const serialized = serializer([1, 'hello']);
        const deserialized = deserializer(serialized);
        assert.deepStrictEqual(deserialized, [1, 'hello']);
    });

    test('Object with maps', () => {
        const serialized = serializer({
            a: new Map<string, number>([
                ['hello', 1],
                ['world', 2],
            ]),
        });
        const deserialized = deserializer(serialized);
        assert.deepStrictEqual(deserialized, {
            a: new Map<string, number>([
                ['hello', 1],
                ['world', 2],
            ]),
        });
    });

    test('Object with sets', () => {
        const serialized = serializer({ a: new Set<string>(['hello', 'world']) });
        const deserialized = deserializer(serialized);
        assert.deepStrictEqual(deserialized, { a: new Set<string>(['hello', 'world']) });
    });

    test('Object with undefined', () => {
        const serialized = serializer({ a: undefined });
        const deserialized = deserializer(serialized);
        assert.deepStrictEqual(deserialized, {});
    });

    test('Object with null', () => {
        const serialized = serializer({ a: null });
        const deserialized = deserializer(serialized);
        assert.deepStrictEqual(deserialized, { a: null });
    });

    test('Object with URI', () => {
        const serialized = serializer({ a: UriEx.file('hello') });
        const deserialized = deserializer(serialized);
        assert.deepStrictEqual(deserialized, { a: UriEx.file('hello') });
    });

    test('Object with URI array', () => {
        const serialized = serializer({ a: [UriEx.file('hello'), UriEx.file('world')] });
        const deserialized = deserializer(serialized);
        assert.deepStrictEqual(deserialized, { a: [UriEx.file('hello'), UriEx.file('world')] });
    });

    test('cancellatoin', () => {
        const cancelled = serializer(CancellationToken.Cancelled);
        const none = serializer(CancellationToken.None);

        assert(CancellationToken.Cancelled === deserializer(cancelled));
        assert(CancellationToken.None === deserializer(none));
    });
}

describe('Serialization', () => {
    serializationTests();
});
