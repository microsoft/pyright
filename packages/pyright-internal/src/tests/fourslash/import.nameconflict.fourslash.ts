/// <reference path="typings/fourslash.d.ts" />

// @filename: project/__init__.py
//// from .a import *

// @filename: project/a/__init__.py
//// from .b import b

// @filename: project/a/b.py
//// def b() -> None:
////     pass

// @filename: project/a/test.py
//// from project import a
//// x: a.[|/*marker*/b|]

// @ts-ignore
helper.verifyHover('markdown', {
    marker: '```python\n(function) def b() -> None\n```',
});
