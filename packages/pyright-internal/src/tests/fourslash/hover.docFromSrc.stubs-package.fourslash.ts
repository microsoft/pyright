/// <reference path="fourslash.ts" />

// @filename: package1-stubs/__init__.pyi
// @library: true
//// from .api import func1

// @filename: package1-stubs/api.pyi
// @library: true
//// def func1() -> bool: ...

// @filename: package1/__init__.py
// @library: true
//// from .api import func1

// @filename: package1/api.py
// @library: true
//// def func1():
////     '''func1 docs'''
////     return True

// @filename: test.py
//// import package1
////
//// print(package1.[|/*marker*/func1|]())

helper.verifyHover('markdown', {
    marker: '```python\n(function) func1: () -> bool\n```\nfunc1 docs',
    marker2: '```python\n(function) func2: () -> bool\n```\nfunc2 docs',
});
