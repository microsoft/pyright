/// <reference path="fourslash.ts" />

// @filename: pyrightconfig.json
//// {
////   "compactSignatureDisplay": false
//// }

// @filename: test.py
//// from typing import overload
//// class A:
////     def __init__(self, x:int, y:int):
////         pass
////
//// class B:
////     @overload
////     def __init__(self):
////         pass
////     @overload
////     def __init__(self, x:int, y:int):
////         pass
////
//// a = [|/*a_constructor*/A|](1,2)
//// b = [|/*b_constructorOverloads*/B|](1,2)
////
//// def [|/*paramFunc0*/foo|]():
////     pass
//// def [|/*paramFunc1*/foo1|](x:int):
////     pass
//// def [|/*paramFunc2*/foo2|](x:int, y:int):
////     pass
////
//// @overload
//// def bar() -> int: ...
//// @overload
//// def bar(x:str, y:int) -> int: ...
////
//// [|/*overload*/bar|]()

helper.verifyHover('markdown', {
    a_constructor: '```python\n(class)\nA(x: int, \n y: int\n )\n```',
    b_constructorOverloads: '```python\n(class)\nB()\n\nB(x: int, \n y: int\n )\n\n\n```',
    paramFunc0: '```python\n(function)\nfoo() -> None\n```',
    paramFunc1: '```python\n(function)\nfoo1(x: int) -> None\n```',
    paramFunc2: '```python\n(function)\nfoo2(x: int, \n    y: int\n    ) -> None\n```',
    overload: '```python\n(function)\nbar() -> int\nbar(x: str, \n   y: int\n   ) -> int\n```',
});
