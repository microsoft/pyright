/// <reference path="typings/fourslash.d.ts" />

// @filename: module1.py
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
//// class NoFields:
////     '''NoFields docs'''

// @filename: module1.pyi
//// class A:
////     def method1(self) -> bool:...
////     class Inner:
////         def method1(self) -> bool: ...
////
//// class NoFields:...

// @filename: testInheritedDocsInSource.py
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
////
//// inner =ChildA.[|/*child_a_inner_docs*/ChildInner|]()
//// inner.[|/*child_a_inner_method1_docs*/method1|]()

// @filename: testInheritedClassNoFieldsDocsInSource.py
//// import module1
//// class ChildB(module1.NoFields):
////     pass
////
//// childB =[|/*child_b_docs*/ChildB|]()

helper.verifyHover('markdown', {
    child_a_method1_docs: '```python\n(method) def method1() -> bool\n```\n---\nA.method1 docs',
    child_a_docs: '```python\nclass ChildA()\n```',
    child_a_inner_docs: '```python\nclass ChildInner()\n```',
    child_a_inner_method1_docs: '```python\n(method) def method1() -> bool\n```\n---\nA.Inner.method1 docs',
    child_b_docs: '```python\nclass ChildB()\n```',
});
