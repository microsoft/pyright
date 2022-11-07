/// <reference path="fourslash.ts" />

// @filename: test.py
//// class Foo:
////     def __init__(self, *args: Any, **kwargs: Any):
////         pass
////     def __new__(cls, name:str):
////         '''doc for __new__.'''
////         return super().__new__(cls)
////
//// x = [|/*marker1*/Foo|]()

helper.verifyHover('markdown', {
    marker1: '```python\n(class)\nFoo(name: str)\n```\n---\ndoc for \\_\\_new\\_\\_.',
});
