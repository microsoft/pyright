/// <reference path="fourslash.ts" />

// @filename: overloads_client.py
//// from typing import overload
//// import moduleA
////
//// class ChildA(moduleA.A):
////     @overload
////     def func(self, x: str) -> str:
////         pass
////
////     @overload
////     def func(self, x: int) -> int:
////         pass
////
////
//// ChildA.f[|/*marker1*/|]

// @filename: typings/moduleA.pyi
//// from typing import overload
//// class A:
////     @overload
////     def func(self, x: str) -> str: ...
////
////     @overload
////     def func(self, x: int) -> int: ...

// @filename: typings/moduleA.py
//// from typing import overload
//// class A:
////     @overload
////     def func(self, x: str) -> str:
////         pass
////
////     @overload
////     def func(self, x: int) -> int:
////         '''func docs'''
////         pass

// @ts-ignore
await helper.verifyCompletion('included', 'markdown', {
    marker1: {
        completions: [
            {
                label: 'func',
                kind: Consts.CompletionItemKind.Method,
                documentation:
                    '```python\nfunc(self: ChildA,\n    x: str\n    ) -> str\n\nfunc(self: ChildA,\n    x: int\n    ) -> int\n```\n---\nfunc docs',
            },
        ],
    },
});
