/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// from typing import Literal, Union
////
//// A = Union[int, str, None]
////
//// def func([|/*marker1*/param|]: A = None) -> None:
////     print([|/*marker2*/param|])

helper.verifyHover('markdown', {
    marker1: '```python\n(parameter) param: A\n```',
    marker2: '```python\n(parameter) param: A\n```',
});
