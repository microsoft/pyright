/// <reference path="typings/fourslash.d.ts" />

// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: lib1/definition.py
// @library: true
//// def [|func|]():
////     '''func docs'''
////     pass
////
//// class MyType:
////     def [|func2|]():
////         '''func2 docs'''
////         pass

// @filename: lib1/alias.py
// @library: true
//// def [|func3|]():
////     '''func3 docs'''
////     pass

// @filename: lib1/withall.py
// @library: true
//// def [|func4|]():
////     '''func4 docs'''
////     pass
////
//// def [|func5|]():
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
////     def func2() -> None : ...
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

{
    const rangeMap = helper.getRangesByText();

    helper.verifyFindDefinitions(
        {
            marker1: {
                definitions: rangeMap
                    .get('func')!
                    .filter((r) => !r.marker)
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
                    }),
            },
            marker2: {
                definitions: rangeMap
                    .get('func2')!
                    .filter((r) => !r.marker)
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
                    }),
            },
            marker3: {
                definitions: rangeMap
                    .get('func3')!
                    .filter((r) => !r.marker)
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
                    }),
            },
            marker4: {
                definitions: rangeMap
                    .get('func4')!
                    .filter((r) => !r.marker)
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
                    }),
            },
            marker5: {
                definitions: rangeMap
                    .get('func5')!
                    .filter((r) => !r.marker)
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
                    }),
            },
        },
        'preferSource'
    );
}
