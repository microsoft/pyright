/// <reference path="fourslash.ts" />

// @filename: test.py
//// class A:
////     def __init__(self):
////         self.x = 1
////         """ test x """
////
//// a = A()
//// a.[|/*marker1*/x|]

// @filename: test2.py
//// y = 2
//// """ test y """
////
//// [|/*marker2*/y|]

// @filename: test3.py
//// from stubs import z
////
//// [|/*marker3*/z|]

// @filename: stubs.py
//// z = 3
//// """ test z """

// @filename: stubs.pyi
//// z: int = ...

// @filename: test4.py
//// from typing import List, Union
//// [|/*marker4*/SomeType|] = List[Union[int, str]]
//// """Here's some documentation about SomeType"""

helper.verifyHover('markdown', {
    marker1: '```python\n(variable) x: int\n```\n---\ntest x',
    marker2: '```python\n(variable) y: Literal[2]\n```\n---\ntest y',
    marker3: '```python\n(variable) z: int\n```\n---\ntest z',
    marker4:
        "```python\n(type alias) SomeType: Type[List[int | str]]\n```\n---\nHere's some documentation about SomeType",
});
