/// <reference path="typings/fourslash.d.ts" />

// @filename: module1.py
//// '''module1 docs'''
////
//// def func1():
////     '''func1 docs'''
////     return True
////
//// class A:
////     '''A docs'''
////     def method1(self) -> bool:
////         '''A.method1 docs'''
////         return True
////
//// class B:
////     '''B docs'''
////     def __init__(self):
////         '''B init docs'''
////         pass

// @filename: testBasicInheritance.py
//// import module1
////
//// class ChildA(module1.A):
////     def method1(self) -> bool:
////         return True
////
//// class ChildB(module1.B):
////     def __init__(self):
////         pass
////
//// childA =[|/*child_a_docs*/ChildA|]()
//// childA.[|/*child_a_method1_docs*/method1|]()
////
//// childB =[|/*child_b_docs*/ChildB|]()
//// childB.[|/*child_b_init_docs*/__init__|]()

// @filename: testMultiLevelInheritance.py
//// class Base:
////     """Base docs"""
////     def method(self):
////         """Base.method docs"""
////
//// class Derived1(Base):
////     def method(self):
////         pass
////
//// class Derived2(Derived1):
////     def method(self):
////         pass
////
//// d2 = [|/*secondDerived_docs*/Derived2|]()
//// d2.[|/*secondDerived_method_docs*/method|]()

helper.verifyHover('markdown', {
    child_a_method1_docs: '```python\n(method) def method1() -> bool\n```\n---\nA.method1 docs',
    child_a_docs: '```python\nclass ChildA()\n```',
    child_b_docs: '```python\nclass ChildB()\n```\n---\nB init docs',
    child_b_init_docs: '```python\n(method) def __init__() -> None\n```\n---\nB init docs',
    secondDerived_docs: '```python\nclass Derived2()\n```',
    secondDerived_method_docs: '```python\n(method) def method() -> None\n```\n---\nBase.method docs',
});
