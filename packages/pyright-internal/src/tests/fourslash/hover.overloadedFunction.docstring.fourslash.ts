/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// from typing import overload
////
//// @overload
//// def fun(a: int) -> int:
////     """int overload"""
//// @overload
//// def fun(a: str) -> str:
////     """str overload"""
//// @overload
//// def fun(a: bytes) -> bytes:
////     ...
//// def fun(a: int | bytes | str) -> int | bytes | str:
////     return a
////
//// [|/*marker1*/fun|](1)
//// [|/*marker2*/fun|]("")
//// [|/*marker3*/fun|](b"")
//// [|/*marker4*/fun|]

helper.verifyHover('markdown', {
    marker1: '```python\n(function) def fun(a: int) -> int\n```\n---\nint overload',
    marker2: '```python\n(function) def fun(a: str) -> str\n```\n---\nstr overload',
    marker3: '```python\n(function) def fun(a: bytes) -> bytes\n```',
    marker4:
        '```python\n(function)\ndef fun(a: int) -> int: ...\ndef fun(a: str) -> str: ...\ndef fun(a: bytes) -> bytes: ...\n```\n---\nint overload',
});
