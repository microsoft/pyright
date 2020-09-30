/// <reference path="fourslash.ts" />

// @filename: test.py
//// class Something:
////     '''This is a test.'''
////
////     def __init__(self, text: str) -> None:
////         self.text = text
////
//// [|/*marker1*/Something|]()

helper.verifyHover({
    marker1: { value: '```python\n(class) Something(text: str)\n```\nThis is a test.', kind: 'markdown' },
});
