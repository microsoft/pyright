/// <reference path="typings/fourslash.d.ts" />

// @filename: typeshed-fallback/stdlib/builtins.pyi
//// class baseClass:
////     def method(self) -> None: ...

// @filename: typeshed-fallback/stdlib/builtins.py
//// class baseClass:
////     def method(self) -> None:
////         """baseClass doc string"""
////         pass

// @filename: test.py
//// class derivedClass(baseClass):
////     pass
////
//// x = derivedClass()
//// x.[|/*marker*/method|]()

helper.verifyHover('markdown', {
    marker: '```python\n(method) def method() -> None\n```',
});
