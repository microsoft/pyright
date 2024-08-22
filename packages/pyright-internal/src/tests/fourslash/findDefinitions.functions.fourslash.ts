/// <reference path="typings/fourslash.d.ts" />

// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: testLib1/__init__.pyi
// @library: true
//// def C(): ...
////
//// def C2(): ...
////
//// def C3(): ...
////
//// def C4(): ...

// @filename: testLib1/__init__.py
// @library: true
//// from .M import C2
//// from . import D
////
//// def [|C|]():
////     pass
////
//// [|C3|] = D.C3
//// [|C4|] = D.Generate()

// @filename: testLib1/M.py
// @library: true
//// def [|C2|]():
////     pass

// @filename: testLib1/D.py
// @library: true
//// def [|C3|]():
////     pass
////
//// def Generate():
////     def [|C4|]():
////         pass
////     return C4;

// @filename: test.py
//// import testLib1
////
//// a = testLib1.[|/*marker1*/C|]()
//// a = testLib1.[|/*marker2*/C2|]()
//// a = testLib1.[|/*marker3*/C3|]()
//// a = testLib1.[|/*marker4*/C4|]()

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
        },
        'preferSource'
    );
}
