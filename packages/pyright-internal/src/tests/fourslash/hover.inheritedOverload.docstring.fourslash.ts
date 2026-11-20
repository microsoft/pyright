/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// from typing import overload
////
//// class Base:
////     @overload
////     def method(self, x: int) -> int:
////         """integer docs"""
////     @overload
////     def method(self, x: str) -> str: ...
////     def method(self, x: int | str) -> int | str:
////         return x
////
//// class Derived(Base):
////     @overload
////     def method(self, x: int) -> int: ...
////     @overload
////     def method(self, x: str) -> str: ...
////     def method(self, x: int | str) -> int | str:
////         return x
////
//// Derived().[|/*marker1*/method|]("")

helper.verifyHover('markdown', {
    marker1: '```python\n(method) def method(x: str) -> str\n```',
});
