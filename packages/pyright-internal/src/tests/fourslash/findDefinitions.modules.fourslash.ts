/// <reference path="typings/fourslash.d.ts" />

// @filename: testLib1/__init__.pyi
// @library: true
//// from . import M as M
//// from . import D as D

// @filename: testLib1/D.pyi
// @library: true
//// # empty

// @filename: testLib1/__init__.py
// @library: true
//// [|/*def1*/|]# empty

// @filename: testLib1/M.py
// @library: true
//// [|/*def2*/|]# empty

// @filename: testLib1/D.py
// @library: true
//// [|/*def3*/|]# empty

// @filename: test.py
//// import [|/*marker1*/testLib1|]
//// import testLib1.[|/*marker2*/M|]
//// import testLib1.[|/*marker3*/D|]

{
    helper.verifyFindDefinitions(
        {
            marker1: {
                definitions: [
                    { path: helper.getMarkerByName('def1').fileName, range: helper.getPositionRange('def1') },
                ],
            },
            marker2: {
                definitions: [
                    { path: helper.getMarkerByName('def2').fileName, range: helper.getPositionRange('def2') },
                ],
            },
            marker3: {
                definitions: [
                    { path: helper.getMarkerByName('def3').fileName, range: helper.getPositionRange('def3') },
                ],
            },
        },
        'preferSource'
    );
}
