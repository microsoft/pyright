/// <reference path="fourslash.ts" />

// @filename: module1.py
//// '''module1 docs'''
////
//// def func1():
////     '''func1 docs'''
////     return True
////
//// class A:
////     '''A docs'''
////     def method1(self):
////         '''A.method1 docs'''
////         return True
////     class Inner:
////         '''A.Inner docs'''
////         def method1(self):
////             '''A.Inner.method1 docs'''
////             return True
////
//// class B:
////     '''B docs'''
////     def __init__(self):
////         '''B init docs'''
////         pass

// @filename: module1.pyi
//// def func1() -> bool: ...
////
//// class A:
////     def method1(self) -> bool: ...
////     class Inner:
////         def method1(self) -> bool: ...
////
//// class B:
////     def __init__(self): ...

// @filename: module2/__init__.py
// @library: true
//// '''module2 docs'''
////
//// from ._internal import func2

// @filename: module2/_internal.py
// @library: true
//// from ._more_internal import func2

// @filename: module2/_more_internal.py
// @library: true
//// def func2():
////     '''func2 docs'''
////     return True

// @filename: typings/module2.pyi
//// def func2() -> bool: ...

// @filename: test.py
//// import module1
//// import module2
////
//// print([|/*module1_docs*/module1|].[|/*func1_docs*/func1|]())
////
//// a = module1.[|/*a_docs*/A|]()
//// print(a.[|/*method1_docs*/method1|]())
////
//// b = module1.[|/*b_docs*/B|]()
////
//// print([|/*module2_docs*/module2|].[|/*func2_docs*/func2|]())
////
//// inner = module1.A.[|/*a_inner_docs*/Inner|]()
//// print(inner.[|/*inner_method1_docs*/method1|]())

helper.verifyHover({
    a_docs: {
        value: '```python\n(class) A\n```\nA docs',
        kind: 'markdown',
    },
    b_docs: {
        value: '```python\n(class) B()\n```\nB init docs',
        kind: 'markdown',
    },
    a_inner_docs: {
        value: '```python\n(class) Inner\n```\nA.Inner docs',
        kind: 'markdown',
    },
    func1_docs: {
        value: '```python\n(function) func1: () -> bool\n```\nfunc1 docs',
        kind: 'markdown',
    },
    func2_docs: {
        value: '```python\n(function) func2: () -> bool\n```\nfunc2 docs',
        kind: 'markdown',
    },
    inner_method1_docs: {
        value: '```python\n(method) method1: () -> bool\n```\nA.Inner.method1 docs',
        kind: 'markdown',
    },
    method1_docs: {
        value: '```python\n(method) method1: () -> bool\n```\nA.method1 docs',
        kind: 'markdown',
    },
    module1_docs: {
        value: '```python\n(module) module1\n```\nmodule1 docs',
        kind: 'markdown',
    },
    module2_docs: {
        value: '```python\n(module) module2\n```\nmodule2 docs',
        kind: 'markdown',
    },
});
