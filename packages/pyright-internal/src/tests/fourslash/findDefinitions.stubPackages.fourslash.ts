/// <reference path="typings/fourslash.d.ts" />

// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: testLib1-stubs/py.typed
// @library: true
//// partial
////

// @filename: testLib1-stubs/__init__.pyi
// @library: true
//// from .core import C as C
//// from .base import C2 as C2

// @filename: testLib1/__init__.py
// @library: true
//// from .core import C
//// from .base import C2 as C2

// @filename: testLib1-stubs/core/__init__.pyi
// @library: true
//// class [|C|]: ...

// @filename: testLib1/core/__init__.py
// @library: true
//// class C:
////     pass

// @filename: testLib1/base/__init__.py
// @library: true
//// from ..main import C2 as C2

// @filename: testLib1/main.py
// @library: true
//// class [|C2|]:
////     pass

// @filename: test.py
//// import testLib1
////
//// a = testLib1.[|/*marker1*/C|]()
//// a = testLib1.[|/*marker2*/C2|]()

{
    const rangeMap = helper.getRangesByText();

    helper.verifyFindDefinitions(
        {
            marker1: {
                definitions: rangeMap
                    .get('C')!
                    .filter((r) => !r.marker)
                    .map((r) => {
                        return { path: helper.getMappedFilePath(r.fileName), range: helper.convertPositionRange(r) };
                    }),
            },
            marker2: {
                definitions: rangeMap
                    .get('C2')!
                    .filter((r) => !r.marker)
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
                    }),
            },
        },
        'preferStubs'
    );
}
