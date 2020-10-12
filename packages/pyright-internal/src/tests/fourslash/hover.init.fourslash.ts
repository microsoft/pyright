/// <reference path="fourslash.ts" />

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
//// c2 = [|/*marker2*/unionType|]()
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
    marker1: '```python\n(class) C1(name: Unknown = "hello")\n```\n\\_\\_init\\_\\_ docs',
    marker2: '```python\n(type alias) unionType: Type[C1] | Type[C2]\n```\n',
    marker3: '```python\n(class) G(value: Literal[10])\n```\n',
    marker4: '```python\n(class) G\n```\n',
    marker5: '```python\n(class) C1(name: Unknown = "hello")\n```\n\\_\\_init\\_\\_ docs',
});
