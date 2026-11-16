/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// from typing import Literal, NotRequired
//// from typing_extensions import TypedDict
////
//// class Cls(TypedDict):
////     a: int
////     b: str
////     x: NotRequired[bytes]
////     y: NotRequired[float]
////
//// dct: Cls = {"a": 1, "b": "2"}
//// dct.[|/*marker1*/get|]("a")
////
//// def check(dct: Cls, key: Literal["a", "b"], optional: Literal["x", "y"]):
////     dct.[|/*unionGet*/get|](key)
////     Cls.[|/*unboundGet*/get|](dct, key)
////     dct.[|/*unionPop*/pop|](optional)

helper.verifyHover('markdown', {
    marker1: "```python\n(variable) def get(k: Literal['a']) -> int\n```",
    unionGet: "```python\n(variable)\ndef get(k: Literal['a']) -> int: ...\ndef get(k: Literal['b']) -> str: ...\n```",
    unboundGet:
        "```python\n(variable)\ndef get(self: Cls, k: Literal['a']) -> int: ...\ndef get(self: Cls, k: Literal['b']) -> str: ...\n```",
    unionPop:
        "```python\n(variable)\ndef pop(k: Literal['x']) -> bytes: ...\ndef pop(k: Literal['y']) -> float: ...\n```",
});
