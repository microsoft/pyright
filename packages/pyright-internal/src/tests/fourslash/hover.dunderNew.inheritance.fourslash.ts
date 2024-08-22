/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// class Parent:
////     def __init__(self, *args: Any, **kwargs: Any):
////         pass
////
//// class Child(Parent):
////     def __new__(cls, name: str):
////         return super().__new__(cls)

//// x = [|/*marker1*/Child|]()

helper.verifyHover('markdown', {
    marker1: '```python\nclass Child(name: str)\n```',
});
