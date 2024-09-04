/// <reference path="typings/fourslash.d.ts" />

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
////     def func(self, x: int) -> int:
////         '''func docs'''
////         ...

// @filename: typings/moduleA.py
//// from typing import overload
//// class A:
////     @overload
////     def func(self, x: str) -> str:
////         pass
////
////     @overload
////     def func(self, x: int) -> int:
////         pass

helper.verifyHover('markdown', {
    child_a_func_doc:
        '```python\n(method)\ndef func(self: ChildA, x: str) -> str: ...\ndef func(self: ChildA, x: int) -> int: ...\n```\n---\nfunc docs',
    child_a_instance_func_doc:
        '```python\n(method)\ndef func(x: str) -> str: ...\ndef func(x: int) -> int: ...\n```\n---\nfunc docs',
});
