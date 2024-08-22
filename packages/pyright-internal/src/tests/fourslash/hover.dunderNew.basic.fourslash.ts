/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// class Foo:
////     def __new__(cls, name:str):
////         '''doc for __new__.'''
////         return super().__new__(cls)
////
//// x = [|/*marker1*/Foo|]()

helper.verifyHover('markdown', {
    marker1: '```python\nclass Foo(name: str)\n```\n---\ndoc for \\_\\_new\\_\\_.',
});
