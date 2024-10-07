/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// from typing import Callable
//// class A:
////     def __init__(self, func : Callable[[float], float]) -> None:
////         self.x = 1
////         """ test x """
////         self.func = func
////         """A given function"""
////
//// a = A()
//// a.[|/*marker1*/x|]
//// a.[|/*marker2*/func|]

// @filename: test2.py
//// y = 2
//// """ test y """
////
//// [|/*marker3*/y|]

// @filename: test3.py
//// from stubs import z
////
//// [|/*marker4*/z|]

// @filename: stubs.py
//// z = 3
//// """ test z """

// @filename: stubs.pyi
//// z: int = ...

// @filename: test4.py
//// from typing import List, Union
//// [|/*marker5*/SomeType|] = List[Union[int, str]]
//// """Here's some documentation about SomeType"""

// @filename: testBigInt.py
//// [|/*marker6*/x|] = 123670029844611072

helper.verifyHover('markdown', {
    marker1: '```python\n(variable) x: int\n```\n---\ntest x',
    marker2: '```python\n(variable) def func(float) -> float\n```\n---\nA given function',
    marker3: '```python\n(variable) y: Literal[2]\n```\n---\ntest y',
    marker4: '```python\n(variable) z: int\n```\n---\ntest z',
    marker5: "```python\n(type) SomeType = List[int | str]\n```\n---\nHere's some documentation about SomeType",
    marker6: '```python\n(variable) x: Literal[123670029844611072]\n```',
});
