/// <reference path="typings/fourslash.d.ts" />

// @filename: typeshed-fallback/stdlib/builtins.pyi
//// class baseClass:
////     def method(self) -> None: ...
////
//// class derivedClass(baseClass): ...

// @filename: typeshed-fallback/stdlib/builtins.py
//// class baseClass:
////     def method(self) -> None:
////         """baseClass doc string"""
////         pass
////
//// class derivedClass(baseClass):
////     pass

// @filename: test.py
//// x = derivedClass()
//// x.[|/*marker*/method|]()

helper.verifyHover('markdown', {
    marker: '```python\n(method) def method() -> None\n```\n---\nbaseClass doc string',
});
