/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// from typing import Generic, TypeVar, Union
////
//// class C1:
////     def __init__(self, name="hello"):
////         '''__init__ docs'''
////         pass
////
//// class C2:
////     def __init__(self, name="hello"):
////         pass
////
//// c1 = [|/*marker1*/C1|]()
////
//// unionType = Union[C1, C2]
//// c2 = [|/*marker2*/unionType|]
////
//// T = TypeVar("T")
//// class G(Generic[T]):
////     def __init__(self, value: T):
////         pass
////
//// g1 = [|/*marker3*/G|](10)
//// g2 = [|/*marker4*/G|][int](10)

// @filename: test1.py
//// import test
////
//// c = test.[|/*marker5*/C1|]()

helper.verifyHover('markdown', {
    marker1: '```python\nclass C1(name: str = "hello")\n```\n---\n\\_\\_init\\_\\_ docs',
    marker2: '```python\n(type) unionType = C1 | C2\n```',
    marker3: '```python\nclass G(value: int)\n```',
    marker4: '```python\nclass G(value: int)\n```',
    marker5: '```python\nclass C1(name: str = "hello")\n```\n---\n\\_\\_init\\_\\_ docs',
});
