/// <reference path="fourslash.ts" />

// @filename: overloads_client.py
//// from typing import overload
//// import moduleA
////
//// class ChildA(moduleA.A):
////     @overload
////     def func(self, x: str) -> str:
////         pass
////
////     @overload
////     def func(self, x: int) -> int:
////         pass
////
////
//// ChildA.[|/*child_a_func_doc*/func|]
//// a = ChildA()
//// a.[|/*child_a_instance_func_doc*/func|]

// @filename: typings/moduleA.pyi
//// from typing import overload
//// class A:
////     @overload
////     def func(self, x: str) -> str: ...
////
////     @overload
////     def func(self, x: int) -> int: ...

// @filename: typings/moduleA.py
//// from typing import overload
//// class A:
////     @overload
////     def func(self, x: str) -> str:
////         pass
////
////     @overload
////     def func(self, x: int) -> int:
////         '''func docs'''
////         pass

helper.verifyHover('markdown', {
    child_a_func_doc:
        '```python\n(method) func: Overload[(self: ChildA, x: str) -> str, (self: ChildA, x: int) -> int]\n```\nfunc docs',
    child_a_instance_func_doc: '```python\n(method) func: Overload[(x: str) -> str, (x: int) -> int]\n```\nfunc docs',
});
