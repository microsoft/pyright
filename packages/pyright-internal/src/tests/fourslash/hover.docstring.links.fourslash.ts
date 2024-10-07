/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// def func():
////     '''something [link](http://microsoft.com) something'''
////     pass
////
//// [|/*marker1*/func|]()

helper.verifyHover('markdown', {
    marker1: '```python\n(function) def func() -> None\n```\n---\nsomething [link](http://microsoft.com) something',
});
