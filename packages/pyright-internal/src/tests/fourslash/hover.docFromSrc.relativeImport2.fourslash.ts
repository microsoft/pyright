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
//// from .module1 import func1
////
//// print([|/*func1_docs*/func1|]())

helper.verifyHover('markdown', {
    func1_docs: '```python\n(function) func1: () -> bool\n```\nfunc1 docs',
});
