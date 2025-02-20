/// <reference path="typings/fourslash.d.ts" />

// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: lib1/definition.py
// @library: true
//// def func():
////     '''func docs'''
////     pass
////
//// class MyType:
////     '''MyType docs'''
////     pass
////
//// class MyType2:
////     def func2(self):
////         '''func2 docs'''
////         pass

// @filename: lib1/alias.py
// @library: true
//// def func3():
////     '''func3 docs'''
////     pass

// @filename: lib1/withall.py
// @library: true
//// def func4():
////     '''func4 docs'''
////     pass
////
//// def func5():
////     '''func5 docs'''
////     pass
////
//// __all__ = ['func5']

// @filename: lib1/redirect.py
// @library: true
//// from . import withall
//// from .withall import *
////
//// __all__ += withall.__all__

// @filename: lib1/wildcard.py
// @library: true
//// from .definition import *
//// from .redirect import *
//// from .alias import func3

// @filename: lib1/__init__.py
// @library: true
//// from .wildcard import *

// @filename: lib1/__init__.pyi
// @library: true
//// from typing import Any
//// func: Any
//// MyType: Any
//// class MyType2:
////     def func2(self) -> None : ...
//// func3: Any
//// func4: Any
//// func5: Any

// @filename: test.py
//// import lib1
//// lib1.[|/*marker1*/func|]()
//// c = lib1.[|/*marker2*/MyType|]()
//// lib1.MyType2().[|/*marker3*/func2|]()
//// lib1.[|/*marker4*/func3|]()
//// lib1.[|/*marker5*/func4|]()
//// lib1.[|/*marker6*/func5|]()

helper.verifyHover('markdown', {
    marker1: '```python\n(variable) func: Any\n```\n---\nfunc docs',
    marker2: '```python\n(variable) MyType: Any\n```\n---\nMyType docs',
    marker3: '```python\n(method) def func2() -> None\n```\n---\nfunc2 docs',
    marker4: '```python\n(variable) func3: Any\n```\n---\nfunc3 docs',
    marker5: '```python\n(variable) func4: Any\n```\n---\nfunc4 docs',
    marker6: '```python\n(variable) func5: Any\n```\n---\nfunc5 docs',
});
