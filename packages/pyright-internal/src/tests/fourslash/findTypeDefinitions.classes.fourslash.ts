/// <reference path="typings/fourslash.d.ts" />

// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: testLib1/__init__.pyi
// @library: true
//// class [|C|]: ...
////
//// class [|C2|]: ...
////
//// class [|C3|]: ...
////
//// class [|C4|]: ...
////
//// class [|C5|]: ...

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
//// [|/*marker1*/a|] = testLib1.C()
//// [|/*marker2*/a|] = testLib1.C2()
//// [|/*marker3*/a|] = testLib1.C3()
//// [|/*marker4*/a|] = testLib1.C4()
//// [|/*marker5*/a|] = testLib1.C5(1, 2)

{
    const rangeMap = helper.getRangesByText();

    var _getRanges = function (rangeName: string): _.DocumentRange[] {
        return rangeMap
            .get(rangeName)!
            .filter((r) => !r.marker)
            .map((r) => {
                return { path: r.fileName, range: helper.convertPositionRange(r) };
            });
    };

    helper.verifyFindTypeDefinitions({
        marker1: { definitions: _getRanges('C') },
        marker2: { definitions: _getRanges('C2') },
        marker3: { definitions: _getRanges('C3') },
        marker4: { definitions: _getRanges('C4') },
        marker5: { definitions: _getRanges('C5') },
    });
}
