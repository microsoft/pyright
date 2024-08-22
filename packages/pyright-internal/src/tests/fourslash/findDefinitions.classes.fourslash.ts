/// <reference path="typings/fourslash.d.ts" />

// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: testLib1/__init__.pyi
// @library: true
//// class C: ...
////
//// class C2: ...
////
//// class C3: ...
////
//// class C4: ...
////
//// def C5(a, b): ...

// @filename: testLib1/__init__.py
// @library: true
//// from .M import C2
//// from . import D
////
//// class [|C|]:
////     pass
////
//// [|C3|] = D.C3
//// [|C4|] = D.N.C4
////
//// class [|C5|]:
////     def __init__(self, a, b):
////         pass

// @filename: testLib1/M.py
// @library: true
//// class [|C2|]:
////     pass

// @filename: testLib1/D.py
// @library: true
//// class [|C3|]:
////     pass
////
//// class N:
////     class [|C4|]:
////         pass

// @filename: test.py
//// import testLib1
////
//// a = testLib1.[|/*marker1*/C|]()
//// a = testLib1.[|/*marker2*/C2|]()
//// a = testLib1.[|/*marker3*/C3|]()
//// a = testLib1.[|/*marker4*/C4|]()
//// a = testLib1.[|/*marker5*/C5|](1, 2)

{
    const rangeMap = helper.getRangesByText();

    helper.verifyFindDefinitions(
        {
            marker1: {
                definitions: rangeMap
                    .get('C')!
                    .filter((r) => !r.marker)
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
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
            marker3: {
                definitions: rangeMap
                    .get('C3')!
                    .filter((r) => !r.marker)
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
                    }),
            },
            marker4: {
                definitions: rangeMap
                    .get('C4')!
                    .filter((r) => !r.marker)
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
                    }),
            },
            marker5: {
                definitions: rangeMap
                    .get('C5')!
                    .filter((r) => !r.marker)
                    .map((r) => {
                        return { path: r.fileName, range: helper.convertPositionRange(r) };
                    }),
            },
        },
        'preferSource'
    );
}
