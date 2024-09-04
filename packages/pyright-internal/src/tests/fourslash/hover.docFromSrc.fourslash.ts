/// <reference path="typings/fourslash.d.ts" />

// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

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
//// import [|/*module1_docs*/module1|] as m1
//// import [|/*module2_docs*/module2|] as m2
////
//// print([|/*m1_docs*/m1|].[|/*func1_docs*/func1|]())
////
//// a = m1.[|/*a_docs*/A|]()
//// print(a.[|/*method1_docs*/method1|]())
////
//// b = m1.[|/*b_docs*/B|]()
////
//// print([|/*m2_docs*/m2|].[|/*func2_docs*/func2|]())
////
//// inner = m1.A.[|/*a_inner_docs*/Inner|]()
//// print(inner.[|/*inner_method1_docs*/method1|]())

helper.verifyHover('markdown', {
    a_docs: '```python\nclass A()\n```\n---\nA docs',
    b_docs: '```python\nclass B()\n```\n---\nB init docs',
    a_inner_docs: '```python\nclass Inner()\n```\n---\nA.Inner docs',
    func1_docs: '```python\n(function) def func1() -> bool\n```\n---\nfunc1 docs',
    func2_docs: '```python\n(function) def func2() -> bool\n```\n---\nfunc2 docs',
    inner_method1_docs: '```python\n(method) def method1() -> bool\n```\n---\nA.Inner.method1 docs',
    method1_docs: '```python\n(method) def method1() -> bool\n```\n---\nA.method1 docs',
    module1_docs: '```python\n(module) module1\n```\n---\nmodule1 docs',
    module2_docs: '```python\n(module) module2\n```\n---\nmodule2 docs',
    m1_docs: '```python\n(module) m1\n```\n---\nmodule1 docs',
    m2_docs: '```python\n(module) m2\n```\n---\nmodule2 docs',
});
