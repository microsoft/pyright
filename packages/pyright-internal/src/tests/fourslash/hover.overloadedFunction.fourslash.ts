/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// from typing import overload
////
//// @overload
//// def func(a: int) -> int:
////     ...
////
//// @overload
//// def func(a: str) -> str:
////     ...
////
//// def func(a: int | str) -> int | str:
////     return a
////
//// [|/*marker1*/func|](1)
//// [|/*marker2*/func|]("hi")

helper.verifyHover('markdown', {
    marker1: '```python\n(function) def func(a: int) -> int\n```',
    marker2: '```python\n(function) def func(a: str) -> str\n```',
});
