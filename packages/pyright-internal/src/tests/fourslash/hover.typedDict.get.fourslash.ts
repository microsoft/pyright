/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// from typing_extensions import TypedDict
////
//// class Cls(TypedDict):
////     a: int
////     b: str
////
//// dct: Cls = {"a": 1, "b": "2"}
//// dct.[|/*marker1*/get|]("a")

helper.verifyHover('markdown', {
    marker1: "```python\n(variable) def get(k: Literal['a']) -> int\n```",
});
