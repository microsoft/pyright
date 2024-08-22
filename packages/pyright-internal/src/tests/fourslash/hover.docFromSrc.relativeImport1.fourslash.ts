/// <reference path="typings/fourslash.d.ts" />

// @filename: module1.py
//// '''module1 docs'''
////
//// def func1():
////     '''func1 docs'''
////     return True
////

// @filename: module1.pyi
//// def func1() -> bool: ...
////

// @filename: test.py
//// from . import module1
////
//// print([|/*module1_docs*/module1|].[|/*func1_docs*/func1|]())

helper.verifyHover('markdown', {
    func1_docs: '```python\n(function) def func1() -> bool\n```\n---\nfunc1 docs',
    module1_docs: '```python\n(module) module1\n```\n---\nmodule1 docs',
});
