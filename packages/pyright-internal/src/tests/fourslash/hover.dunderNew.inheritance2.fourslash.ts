/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// class Parent:
////     def __init__(self, *args: Any, **kwargs: Any):
////         pass
////
////     def __new__(cls, *args: Any, **kwargs: Any):
////         return super().__new__(cls)
////
//// class Child(Parent):
////     def __new__(cls, name:str):
////         return super().__new__(cls, name)
////
//// class GrandChild(Child):
////     pass

//// x = [|/*marker1*/GrandChild|]()

helper.verifyHover('markdown', {
    marker1: '```python\nclass GrandChild(name: str)\n```',
});
