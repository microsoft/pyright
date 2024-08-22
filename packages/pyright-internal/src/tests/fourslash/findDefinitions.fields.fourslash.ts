/// <reference path="typings/fourslash.d.ts" />

// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: testLib1/__init__.pyi
// @library: true
//// from typing import ClassVar
////
//// class C:
////     V = ...
////
//// class C2:
////     V2 = ...
////
//// class C3:
////     V3 = ...
////
//// class C4:
////     V4: ClassVar[int] = ...
////
//// class C5:
////     V5: ClassVar[int] = ...
////
//// class C6:
////     V6 = ...

// @filename: testLib1/__init__.py
// @library: true
//// from .M import C2
//// from . import D
////
//// class C:
////     def __init__(self):
////         self.[|V|] = 1
////
//// C3 = D.C3
//// C4 = D.N.C4
////
//// class B:
////     [|V5|] = 1
////
////     def __init__(self):
////         self.[|V6|] = 1
////
//// class C5(B):
////     pass
////
//// class C6(B):
////     pass

// @filename: testLib1/M.py
// @library: true
//// class C2:
////     def __init__(self):
////         self.[|V2|] = 1

// @filename: testLib1/D.py
// @library: true
//// class C3:
////     def [|__init__|](self):
////         self.[|V3|] = 1
////
//// class N:
////     class C4:
////         [|V4|] = 1

// @filename: test.py
//// import testLib1
////
//// a = testLib1.C().[|/*marker1*/V|]()
//// a = testLib1.C2().[|/*marker2*/V2|]()
//// a = testLib1.C3().[|/*marker3*/V3|]()
//// a = testLib1.C4().[|/*marker4*/V4|]()
//// a = testLib1.C5().[|/*marker5*/V5|]()
//// a = testLib1.C6().[|/*marker6*/V6|]()

{
    const rangeMap = helper.getRangesByText();

    helper.verifyFindDefinitions(
        {
            marker1: {
                definitions: rangeMap
                    .get('V')!
                    .filter((r) => !r.marker)
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
                    }),
            },
            marker2: {
                definitions: rangeMap
                    .get('V2')!
                    .filter((r) => !r.marker)
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
                    }),
            },
            marker3: {
                definitions: rangeMap
                    .get('V3')!
                    .filter((r) => !r.marker)
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
                    }),
            },
            marker4: {
                definitions: rangeMap
                    .get('V4')!
                    .filter((r) => !r.marker)
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
                    }),
            },
            marker5: {
                definitions: rangeMap
                    .get('V5')!
                    .filter((r) => !r.marker)
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
                    }),
            },
            marker6: {
                definitions: rangeMap
                    .get('V6')!
                    .filter((r) => !r.marker)
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
                    }),
            },
        },
        'preferSource'
    );
}
