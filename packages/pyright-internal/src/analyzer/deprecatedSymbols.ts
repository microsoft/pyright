/*
 * deprecatedSymbols.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * A list of implicitly-deprecated symbols as defined in PEP 585, etc.
 */

import { PythonVersion } from '../common/pythonVersion';

export interface DeprecatedForm {
    // The version of Python where this symbol becomes deprecated
    version: PythonVersion;

    // The full name of the deprecated type
    fullName: string;

    // The replacement form
    replacementText: string;

    // Indicates that the symbol is deprecated only if imported from `typing`
    typingImportOnly?: boolean;
}

export const deprecatedAliases = new Map<string, DeprecatedForm>([
    ['Tuple', { version: PythonVersion.V3_9, fullName: 'builtins.tuple', replacementText: 'tuple' }],
    ['List', { version: PythonVersion.V3_9, fullName: 'builtins.list', replacementText: 'list' }],
    ['Dict', { version: PythonVersion.V3_9, fullName: 'builtins.dict', replacementText: 'dict' }],
    ['Set', { version: PythonVersion.V3_9, fullName: 'builtins.set', replacementText: 'set' }],
    ['FrozenSet', { version: PythonVersion.V3_9, fullName: 'builtins.frozenset', replacementText: 'frozenset' }],
    ['Type', { version: PythonVersion.V3_9, fullName: 'builtins.type', replacementText: 'type' }],
    ['Deque', { version: PythonVersion.V3_9, fullName: 'collections.deque', replacementText: 'collections.deque' }],
    [
        'DefaultDict',
        {
            version: PythonVersion.V3_9,
            fullName: 'collections.defaultdict',
            replacementText: 'collections.defaultdict',
        },
    ],
    [
        'OrderedDict',
        {
            version: PythonVersion.V3_9,
            fullName: 'collections.OrderedDict',
            replacementText: 'collections.OrderedDict',
            typingImportOnly: true,
        },
    ],
    [
        'Counter',
        {
            version: PythonVersion.V3_9,
            fullName: 'collections.Counter',
            replacementText: 'collections.Counter',
            typingImportOnly: true,
        },
    ],
    [
        'ChainMap',
        {
            version: PythonVersion.V3_9,
            fullName: 'collections.ChainMap',
            replacementText: 'collections.ChainMap',
            typingImportOnly: true,
        },
    ],
    [
        'Awaitable',
        {
            version: PythonVersion.V3_9,
            fullName: 'typing.Awaitable',
            replacementText: 'collections.abc.Awaitable',
            typingImportOnly: true,
        },
    ],
    [
        'Coroutine',
        {
            version: PythonVersion.V3_9,
            fullName: 'typing.Coroutine',
            replacementText: 'collections.abc.Coroutine',
            typingImportOnly: true,
        },
    ],
    [
        'AsyncIterable',
        {
            version: PythonVersion.V3_9,
            fullName: 'typing.AsyncIterable',
            replacementText: 'collections.abc.AsyncIterable',
            typingImportOnly: true,
        },
    ],
    [
        'AsyncIterator',
        {
            version: PythonVersion.V3_9,
            fullName: 'typing.AsyncIterator',
            replacementText: 'collections.abc.AsyncIterator',
            typingImportOnly: true,
        },
    ],
    [
        'AsyncGenerator',
        {
            version: PythonVersion.V3_9,
            fullName: 'typing.AsyncGenerator',
            replacementText: 'collections.abc.AsyncGenerator',
            typingImportOnly: true,
        },
    ],
    [
        'Iterable',
        {
            version: PythonVersion.V3_9,
            fullName: 'typing.Iterable',
            replacementText: 'collections.abc.Iterable',
            typingImportOnly: true,
        },
    ],
    [
        'Iterator',
        {
            version: PythonVersion.V3_9,
            fullName: 'typing.Iterator',
            replacementText: 'collections.abc.Iterator',
            typingImportOnly: true,
        },
    ],
    [
        'Generator',
        {
            version: PythonVersion.V3_9,
            fullName: 'typing.Generator',
            replacementText: 'collections.abc.Generator',
            typingImportOnly: true,
        },
    ],
    [
        'Reversible',
        {
            version: PythonVersion.V3_9,
            fullName: 'typing.Reversible',
            replacementText: 'collections.abc.Reversible',
            typingImportOnly: true,
        },
    ],
    [
        'Container',
        {
            version: PythonVersion.V3_9,
            fullName: 'typing.Container',
            replacementText: 'collections.abc.Container',
            typingImportOnly: true,
        },
    ],
    [
        'Collection',
        {
            version: PythonVersion.V3_9,
            fullName: 'typing.Collection',
            replacementText: 'collections.abc.Collection',
            typingImportOnly: true,
        },
    ],
    [
        'AbstractSet',
        {
            version: PythonVersion.V3_9,
            fullName: 'typing.AbstractSet',
            replacementText: 'collections.abc.Set',
        },
    ],
    [
        'MutableSet',
        {
            version: PythonVersion.V3_9,
            fullName: 'typing.MutableSet',
            replacementText: 'collections.abc.MutableSet',
            typingImportOnly: true,
        },
    ],
    [
        'Mapping',
        {
            version: PythonVersion.V3_9,
            fullName: 'typing.Mapping',
            replacementText: 'collections.abc.Mapping',
            typingImportOnly: true,
        },
    ],
    [
        'MutableMapping',
        {
            version: PythonVersion.V3_9,
            fullName: 'typing.MutableMapping',
            replacementText: 'collections.abc.MutableMapping',
            typingImportOnly: true,
        },
    ],
    [
        'Sequence',
        {
            version: PythonVersion.V3_9,
            fullName: 'typing.Sequence',
            replacementText: 'collections.abc.Sequence',
            typingImportOnly: true,
        },
    ],
    [
        'MutableSequence',
        {
            version: PythonVersion.V3_9,
            fullName: 'typing.MutableSequence',
            replacementText: 'collections.abc.MutableSequence',
            typingImportOnly: true,
        },
    ],
    [
        'ByteString',
        {
            version: PythonVersion.V3_9,
            fullName: 'typing.ByteString',
            replacementText: 'collections.abc.ByteString',
            typingImportOnly: true,
        },
    ],
    [
        'MappingView',
        {
            version: PythonVersion.V3_9,
            fullName: 'typing.MappingView',
            replacementText: 'collections.abc.MappingView',
            typingImportOnly: true,
        },
    ],
    [
        'KeysView',
        {
            version: PythonVersion.V3_9,
            fullName: 'typing.KeysView',
            replacementText: 'collections.abc.KeysView',
            typingImportOnly: true,
        },
    ],
    [
        'ItemsView',
        {
            version: PythonVersion.V3_9,
            fullName: 'typing.ItemsView',
            replacementText: 'collections.abc.ItemsView',
            typingImportOnly: true,
        },
    ],
    [
        'ValuesView',
        {
            version: PythonVersion.V3_9,
            fullName: 'typing.ValuesView',
            replacementText: 'collections.abc.ValuesView',
            typingImportOnly: true,
        },
    ],
    [
        'ContextManager',
        {
            version: PythonVersion.V3_9,
            fullName: 'contextlib.AbstractContextManager',
            replacementText: 'contextlib.AbstractContextManager',
            typingImportOnly: true,
        },
    ],
    [
        'AsyncContextManager',
        {
            version: PythonVersion.V3_9,
            fullName: 'contextlib.AbstractAsyncContextManager',
            replacementText: 'contextlib.AbstractAsyncContextManager',
            typingImportOnly: true,
        },
    ],
    [
        'Pattern',
        {
            version: PythonVersion.V3_9,
            fullName: 're.Pattern',
            replacementText: 're.Pattern',
            typingImportOnly: true,
        },
    ],
    [
        'Match',
        {
            version: PythonVersion.V3_9,
            fullName: 're.Match',
            replacementText: 're.Match',
            typingImportOnly: true,
        },
    ],
]);

export const deprecatedSpecialForms = new Map<string, DeprecatedForm>([
    ['Optional', { version: PythonVersion.V3_10, fullName: 'typing.Optional', replacementText: '| None' }],
    ['Union', { version: PythonVersion.V3_10, fullName: 'typing.Union', replacementText: '|' }],
]);
