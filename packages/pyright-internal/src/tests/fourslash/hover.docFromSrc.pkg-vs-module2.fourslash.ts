/// <reference path="typings/fourslash.d.ts" />

// @filename: package1/__init__.py
// @library: true
//// '''package1 docs'''
//// from .subpackage import func1

// @filename: package1/subpackage/__init__.py
// @library: true
//// '''subpackage docs'''
//// def func1():
////     '''func1 docs'''
////     return True

// @filename: typings/package1/__init__.pyi
//// from .subpackage import func1 as func1

// @filename: typings/package1/subpackage.pyi
//// def func1() -> bool: ...

// @filename: test.py
//// from [|/*package_docs*/package1|] import func1
////
//// print([|/*func1_docs*/func1|]())

helper.verifyHover('markdown', {
    func1_docs: '```python\n(function) def func1() -> bool\n```\n---\nfunc1 docs',
    package_docs: '```python\n(module) package1\n```\n---\npackage1 docs',
});
