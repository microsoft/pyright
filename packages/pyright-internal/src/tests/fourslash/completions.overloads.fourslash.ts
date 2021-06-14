/// <reference path="fourslash.ts" />

// @filename: overloads_client.py
//// import overloads
//// overloads.f[|/*marker1*/|]

// @filename: typings/overloads.pyi
//// from typing import overload
////
//// @overload
//// def func(x: str) -> str: ...[|/*marker2*/|]
////
//// @overload
//// def func(x: bytes) -> bytes:
////     ...[|/*marker3*/|]
////
//// @overload
//// def func(x: int) -> int:
////     '''func docs'''
////     pass

// @ts-ignore
await helper.verifyCompletion('included', 'markdown', {
    marker1: {
        completions: [
            {
                label: 'func',
                kind: Consts.CompletionItemKind.Function,
                documentation:
                    '```python\nfunc(x: str) -> str\nfunc(x: bytes) -> bytes\nfunc(x: int) -> int\n```\n---\nfunc docs',
            },
        ],
    },
});

// @ts-ignore
await helper.verifyCompletion('exact', 'markdown', {
    marker2: { completions: [] },
    marker3: { completions: [] },
});
