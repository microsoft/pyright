/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// from typing import List, Union, Callable
////
//// class Foo:
////     """ This is a docstring """
////
////     aaa = 4
////     """ aaa is an int """
////
////     def __init__(self, func : Callable[[float], float]) -> None:
////         self.bbb = "hi"
////         " bbb is a str "
////         self.func = func
////         """A given function"""
////
//// ccc = Foo()
//// """ ccc is a Foo """
////
//// SomeType = List[Union[int, str]]
//// """Here's some documentation about SomeType"""
////
//// foo1.b[|/*marker1*/|]
////
//// foo1.a[|/*marker2*/|]
////
//// cc[|/*marker3*/|]
////
//// SomeType[|/*marker4*/|]
////
//// ccc.fun[|/*marker5*/|]

// @ts-ignore
await helper.verifyCompletion('includes', 'markdown', {
    marker1: {
        completions: [
            {
                label: 'bbb',
                kind: Consts.CompletionItemKind.Variable,
                documentation: '```python\nbbb: str\n```\n---\nbbb is a str',
            },
        ],
    },
    marker2: {
        completions: [
            {
                label: 'aaa',
                kind: Consts.CompletionItemKind.Variable,
                documentation: '```python\naaa: int\n```\n---\naaa is an int',
            },
        ],
    },
    marker3: {
        completions: [
            {
                label: 'ccc',
                kind: Consts.CompletionItemKind.Variable,
                documentation: '```python\nccc: Foo\n```\n---\nccc is a Foo',
            },
        ],
    },
    marker4: {
        completions: [
            {
                label: 'SomeType',
                kind: Consts.CompletionItemKind.Variable,
                documentation:
                    "```python\nSomeType: type[List[int | str]]\n```\n---\nHere's some documentation about SomeType",
            },
        ],
    },
    marker5: {
        completions: [
            {
                label: 'func',
                kind: Consts.CompletionItemKind.Variable,
                documentation: '```python\ndef func(float) -> float\n```\n---\nA given function',
            },
        ],
    },
});
