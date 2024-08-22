/// <reference path="typings/fourslash.d.ts" />

// @filename: pyrightconfig.json
//// {
////   "extraPaths": ["subproj"]
//// }

// @filename: subproj/foo/bar1.py
//// [|/*def1*/x|] = 1

// @filename: foo/bar2.py
//// [|/*def2*/x|] = 1

// @filename: test.py
//// from foo import [|/*marker1*/bar1|]
//// from foo import [|/*marker2*/bar2|]

{
    helper.verifyFindDefinitions(
        {
            marker1: {
                definitions: [
                    {
                        path: helper.getMarkerByName('def1').fileName,
                        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                    },
                ],
            },
            marker2: {
                definitions: [
                    {
                        path: helper.getMarkerByName('def2').fileName,
                        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
                    },
                ],
            },
        },
        'preferSource'
    );
}
