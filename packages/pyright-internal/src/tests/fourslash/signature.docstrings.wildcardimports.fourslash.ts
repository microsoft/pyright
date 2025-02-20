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
////     def __call__(self) -> None : ...
////
//// func: ufunc
//// class MyType:
////     def func2(self) -> None : ...
//// func3: ufunc
//// func4: ufunc
//// func5: ufunc

// @filename: test.py
//// import lib1
//// lib1.func([|/*marker1*/|])
//// lib1.MyType().func2([|/*marker2*/|])
//// lib1.func3([|/*marker3*/|])
//// lib1.func4([|/*marker4*/|])
//// lib1.func5([|/*marker5*/|])

{
    helper.verifySignature('markdown', {
        marker1: {
            signatures: [
                {
                    label: '() -> None',
                    parameters: [],
                    documentation: 'func docs',
                },
            ],
            activeParameters: [undefined],
        },
        marker2: {
            signatures: [
                {
                    label: '() -> None',
                    parameters: [],
                    documentation: 'func2 docs',
                },
            ],
            activeParameters: [undefined],
        },
        marker3: {
            signatures: [
                {
                    label: '() -> None',
                    parameters: [],
                    documentation: 'func3 docs',
                },
            ],
            activeParameters: [undefined],
        },
        marker4: {
            signatures: [
                {
                    label: '() -> None',
                    parameters: [],
                    documentation: 'func4 docs',
                },
            ],
            activeParameters: [undefined],
        },
        marker5: {
            signatures: [
                {
                    label: '() -> None',
                    parameters: [],
                    documentation: 'func5 docs',
                },
            ],
            activeParameters: [undefined],
        },
    });
}
