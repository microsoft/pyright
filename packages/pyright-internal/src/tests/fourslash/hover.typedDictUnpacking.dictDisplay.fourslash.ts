/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// from typing import TypedDict
////
//// class User(TypedDict):
////     name: str
////     age: int
////
//// user: User = {"name": "Alice", "age": 30}
//// [|/*marker1*/res|] = {**user}

helper.verifyHover('markdown', {
    marker1: '```python\n(variable) res: dict[str, Unknown]\n```',
});
