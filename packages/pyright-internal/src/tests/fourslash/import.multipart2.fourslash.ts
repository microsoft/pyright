/// <reference path="typings/fourslash.d.ts" />

// @filename: pkg/__init__.py
//// from . import sub1
//// from .sub2 import *

// @filename: pkg/sub1.py
//// a = 1
//// b = 2

// @filename: pkg/sub2.py
//// from . import sub1
//// from .sub1 import a

// @filename: test.py
//// import pkg.sub1
//// pkg.sub1.[|/*marker*/b|]()

// @ts-ignore
helper.verifyHover('markdown', {
    marker: '```python\n(variable) b: int\n```',
});
