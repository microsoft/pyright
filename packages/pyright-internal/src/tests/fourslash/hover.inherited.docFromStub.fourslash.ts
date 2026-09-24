/// <reference path="typings/fourslash.d.ts" />

// @filename: module1.py
//// class A:
////     def method1(self) -> bool:
////         return True
////     class Inner:
////         def method1(self):
////             return True

// @filename: module1.pyi
//// class A:
////     '''A docs'''
////     def method1(self) -> bool:
////         '''A.method1 docs'''
////         ...
////     class Inner:
////         '''A.Inner docs'''
////         def method1(self) -> bool:
////             '''A.Inner.method1 docs'''
////             ...

// @filename: testInheritedDocsInStubs.py
//// import module1
//// class ChildA(module1.A):
////     def method1(self) -> bool:
////         return True
////     class ChildInner(module1.A.Inner):
////         def method1(self) -> bool:
////            return True
////
//// childA =[|/*child_a_docs*/ChildA|]()
//// childA.[|/*child_a_method1_docs*/method1|]()
//// inner =ChildA.[|/*child_a_inner_docs*/ChildInner|]()
//// inner.[|/*child_a_inner_method1_docs*/method1|]()

helper.verifyHover('markdown', {
    child_a_method1_docs: '```python\n(method) def method1() -> bool\n```\n---\nA.method1 docs',
    // A subclass with no docstring of its own inherits the nearest base class
    // docstring from the stub (approximating Python's `inspect.getdoc`,
    // excluding builtins).
    child_a_docs: '```python\nclass ChildA()\n```\n---\nA docs',
    child_a_inner_docs: '```python\nclass ChildInner()\n```\n---\nA.Inner docs',
    child_a_inner_method1_docs: '```python\n(method) def method1() -> bool\n```\n---\nA.Inner.method1 docs',
});
