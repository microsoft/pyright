/// <reference path="fourslash.ts" />

// @filename: test.py
//// from typing import overload
//// class Foo:
////     @overload
////     def __new__(cls, name:str, last:str) -> "Foo":
////         return super().__new__(cls)
////     @overload
////     def __new__(cls, age:int, height:float) -> "Foo":
////         return super().__new__(cls)
////
//// x = [|/*marker1*/Foo|]()

helper.verifyHover('markdown', {
    marker1: '```python\n(class)\nFoo(name: str,\n   last: str)\n\nFoo(age: int,\n   height: float)\n\n\n```',
});
