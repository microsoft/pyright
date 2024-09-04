/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// class Something:
////     '''This is a test.'''
////
////     def __init__(self, text: str) -> None:
////         self.text = text
////
//// [|/*marker1*/Something|]()

helper.verifyHover('markdown', {
    marker1: '```python\nclass Something(text: str)\n```\n---\nThis is a test.',
});
