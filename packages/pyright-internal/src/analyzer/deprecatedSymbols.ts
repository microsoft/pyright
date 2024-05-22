/*
 * deprecatedSymbols.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * A list of implicitly-deprecated symbols as defined in PEP 585, etc.
 */

import { PythonVersion, pythonVersion3_10, pythonVersion3_9 } from '../common/pythonVersion';

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
    ['Tuple', { version: pythonVersion3_9, fullName: 'builtins.tuple', replacementText: 'tuple' }],
    ['List', { version: pythonVersion3_9, fullName: 'builtins.list', replacementText: 'list' }],
    ['Dict', { version: pythonVersion3_9, fullName: 'builtins.dict', replacementText: 'dict' }],
    ['Set', { version: pythonVersion3_9, fullName: 'builtins.set', replacementText: 'set' }],
    ['FrozenSet', { version: pythonVersion3_9, fullName: 'builtins.frozenset', replacementText: 'frozenset' }],
    ['Type', { version: pythonVersion3_9, fullName: 'builtins.type', replacementText: 'type' }],
    ['Deque', { version: pythonVersion3_9, fullName: 'collections.deque', replacementText: 'collections.deque' }],
    [
        'DefaultDict',
        {
            version: pythonVersion3_9,
            fullName: 'collections.defaultdict',
            replacementText: 'collections.defaultdict',
        },
    ],
    [
        'OrderedDict',
        {
            version: pythonVersion3_9,
            fullName: 'collections.OrderedDict',
            replacementText: 'collections.OrderedDict',
            typingImportOnly: true,
        },
    ],
    [
        'Counter',
        {
            version: pythonVersion3_9,
            fullName: 'collections.Counter',
            replacementText: 'collections.Counter',
            typingImportOnly: true,
        },
    ],
    [
        'ChainMap',
        {
            version: pythonVersion3_9,
            fullName: 'collections.ChainMap',
            replacementText: 'collections.ChainMap',
            typingImportOnly: true,
        },
    ],
    [
        'Awaitable',
        {
            version: pythonVersion3_9,
            fullName: 'typing.Awaitable',
            replacementText: 'collections.abc.Awaitable',
            typingImportOnly: true,
        },
    ],
    [
        'Coroutine',
        {
            version: pythonVersion3_9,
            fullName: 'typing.Coroutine',
            replacementText: 'collections.abc.Coroutine',
            typingImportOnly: true,
        },
    ],
    [
        'AsyncIterable',
        {
            version: pythonVersion3_9,
            fullName: 'typing.AsyncIterable',
            replacementText: 'collections.abc.AsyncIterable',
            typingImportOnly: true,
        },
    ],
    [
        'AsyncIterator',
        {
            version: pythonVersion3_9,
            fullName: 'typing.AsyncIterator',
            replacementText: 'collections.abc.AsyncIterator',
            typingImportOnly: true,
        },
    ],
    [
        'AsyncGenerator',
        {
            version: pythonVersion3_9,
            fullName: 'typing.AsyncGenerator',
            replacementText: 'collections.abc.AsyncGenerator',
            typingImportOnly: true,
        },
    ],
    [
        'Iterable',
        {
            version: pythonVersion3_9,
            fullName: 'typing.Iterable',
            replacementText: 'collections.abc.Iterable',
            typingImportOnly: true,
        },
    ],
    [
        'Iterator',
        {
            version: pythonVersion3_9,
            fullName: 'typing.Iterator',
            replacementText: 'collections.abc.Iterator',
            typingImportOnly: true,
        },
    ],
    [
        'Generator',
        {
            version: pythonVersion3_9,
            fullName: 'typing.Generator',
            replacementText: 'collections.abc.Generator',
            typingImportOnly: true,
        },
    ],
    [
        'Reversible',
        {
            version: pythonVersion3_9,
            fullName: 'typing.Reversible',
            replacementText: 'collections.abc.Reversible',
            typingImportOnly: true,
        },
    ],
    [
        'Container',
        {
            version: pythonVersion3_9,
            fullName: 'typing.Container',
            replacementText: 'collections.abc.Container',
            typingImportOnly: true,
        },
    ],
    [
        'Collection',
        {
            version: pythonVersion3_9,
            fullName: 'typing.Collection',
            replacementText: 'collections.abc.Collection',
            typingImportOnly: true,
        },
    ],
    [
        'AbstractSet',
        {
            version: pythonVersion3_9,
            fullName: 'typing.AbstractSet',
            replacementText: 'collections.abc.Set',
            typingImportOnly: true,
        },
    ],
    [
        'MutableSet',
        {
            version: pythonVersion3_9,
            fullName: 'typing.MutableSet',
            replacementText: 'collections.abc.MutableSet',
            typingImportOnly: true,
        },
    ],
    [
        'Mapping',
        {
            version: pythonVersion3_9,
            fullName: 'typing.Mapping',
            replacementText: 'collections.abc.Mapping',
            typingImportOnly: true,
        },
    ],
    [
        'MutableMapping',
        {
            version: pythonVersion3_9,
            fullName: 'typing.MutableMapping',
            replacementText: 'collections.abc.MutableMapping',
            typingImportOnly: true,
        },
    ],
    [
        'Sequence',
        {
            version: pythonVersion3_9,
            fullName: 'typing.Sequence',
            replacementText: 'collections.abc.Sequence',
            typingImportOnly: true,
        },
    ],
    [
        'MutableSequence',
        {
            version: pythonVersion3_9,
            fullName: 'typing.MutableSequence',
            replacementText: 'collections.abc.MutableSequence',
            typingImportOnly: true,
        },
    ],
    [
        'ByteString',
        {
            version: pythonVersion3_9,
            fullName: 'typing.ByteString',
            replacementText: 'collections.abc.ByteString',
            typingImportOnly: true,
        },
    ],
    [
        'MappingView',
        {
            version: pythonVersion3_9,
            fullName: 'typing.MappingView',
            replacementText: 'collections.abc.MappingView',
            typingImportOnly: true,
        },
    ],
    [
        'KeysView',
        {
            version: pythonVersion3_9,
            fullName: 'typing.KeysView',
            replacementText: 'collections.abc.KeysView',
            typingImportOnly: true,
        },
    ],
    [
        'ItemsView',
        {
            version: pythonVersion3_9,
            fullName: 'typing.ItemsView',
            replacementText: 'collections.abc.ItemsView',
            typingImportOnly: true,
        },
    ],
    [
        'ValuesView',
        {
            version: pythonVersion3_9,
            fullName: 'typing.ValuesView',
            replacementText: 'collections.abc.ValuesView',
            typingImportOnly: true,
        },
    ],
    [
        'ContextManager',
        {
            version: pythonVersion3_9,
            fullName: 'typing.ContextManager',
            replacementText: 'contextlib.AbstractContextManager',
        },
    ],
    [
        'AsyncContextManager',
        {
            version: pythonVersion3_9,
            fullName: 'typing.AsyncContextManager',
            replacementText: 'contextlib.AbstractAsyncContextManager',
        },
    ],
    [
        'Pattern',
        {
            version: pythonVersion3_9,
            fullName: 're.Pattern',
            replacementText: 're.Pattern',
            typingImportOnly: true,
        },
    ],
    [
        'Match',
        {
            version: pythonVersion3_9,
            fullName: 're.Match',
            replacementText: 're.Match',
            typingImportOnly: true,
        },
    ],
]);

export const deprecatedSpecialForms = new Map<string, DeprecatedForm>([
    ['Optional', { version: pythonVersion3_10, fullName: 'typing.Optional', replacementText: '| None' }],
    ['Union', { version: pythonVersion3_10, fullName: 'typing.Union', replacementText: '|' }],
    [
        'Callable',
        {
            version: pythonVersion3_9,
            fullName: 'typing.Callable',
            replacementText: 'collections.abc.Callable',
            typingImportOnly: true,
        },
    ],
]);
