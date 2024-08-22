/// <reference path="typings/fourslash.d.ts" />

// @filename: pyrightconfig.json
//// {
////   "functionSignatureDisplay": "formatted"
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
////
//// b = [|/*b_constructorOverloads*/B|](1,2)
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
//// [|/*overload*/bar|]

helper.verifyHover('markdown', {
    a_constructor: '```python\nclass A(\n    x: int,\n    y: int\n)\n```',
    b_constructorOverloads: '```python\nclass B(\n    x: int,\n    y: int\n)\n```',
    paramFunc0: '```python\n(function) def foo() -> None\n```',
    paramFunc1: '```python\n(function) def foo1(x: int) -> None\n```',
    paramFunc2: '```python\n(function) def foo2(\n    x: int,\n    y: int\n) -> None\n```',
    overload: '```python\n(function)\ndef bar() -> int: ...\ndef bar(\n    x: str,\n    y: int\n) -> int: ...\n```',
});
