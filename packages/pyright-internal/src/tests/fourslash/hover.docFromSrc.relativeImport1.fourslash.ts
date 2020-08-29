/// <reference path="fourslash.ts" />

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

helper.verifyHover({
    func1_docs: {
        value: '```python\n(function) func1: () -> bool\n```\nfunc1 docs',
        kind: 'markdown',
    },
    module1_docs: {
        value: '```python\n(module) module1\n```\nmodule1 docs',
        kind: 'markdown',
    },
});
