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
//// class ufunc:
////     def __call__(self): ...
////
//// func: ufunc
//// class MyType:
////     def func2(self) -> None : ...
//// func3: ufunc
//// func4: ufunc
//// func5: ufunc

// @filename: test.py
//// import lib1
//// lib1.[|/*marker1*/func|]()
//// lib1.MyType().[|/*marker2*/func2|]()
//// lib1.[|/*marker3*/func3|]()
//// lib1.[|/*marker4*/func4|]()
//// lib1.[|/*marker5*/func5|]()

// @ts-ignore
await helper.verifyCompletion('includes', 'markdown', {
    marker1: {
        completions: [
            {
                label: 'func',
                kind: Consts.CompletionItemKind.Variable,
                documentation: '```python\nfunc: ufunc\n```\n---\nfunc docs',
            },
        ],
    },
    marker2: {
        completions: [
            {
                label: 'func2',
                kind: Consts.CompletionItemKind.Method,
                documentation: '```python\ndef func2() -> None\n```\n---\nfunc2 docs',
            },
        ],
    },
    marker3: {
        completions: [
            {
                label: 'func3',
                kind: Consts.CompletionItemKind.Variable,
                documentation: '```python\nfunc3: ufunc\n```\n---\nfunc3 docs',
            },
        ],
    },
    marker4: {
        completions: [
            {
                label: 'func4',
                kind: Consts.CompletionItemKind.Variable,
                documentation: '```python\nfunc4: ufunc\n```\n---\nfunc4 docs',
            },
        ],
    },
    marker5: {
        completions: [
            {
                label: 'func5',
                kind: Consts.CompletionItemKind.Variable,
                documentation: '```python\nfunc5: ufunc\n```\n---\nfunc5 docs',
            },
        ],
    },
});
