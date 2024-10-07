/// <reference path="typings/fourslash.d.ts" />

// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true,
////   "executionEnvironments": [{ "root": "."}],
////   "venv": ".venv",
////   "venvPath": ".",
//// }

// @filename: .venv/lib/site-packages/lib1.pth
//// lib1

// @filename: .venv/lib/site-packages/lib2.pth
//// lib2

// @filename: .venv/lib/site-packages/lib1/a/b/main.py
////

// @filename: .venv/lib/site-packages/lib2/a/b/__init__.py
//// [|/*def1*/x|] = 1

// @filename: test.py
//// from a.b import [|/*marker1*/x|]

{
    helper.verifyFindDefinitions(
        {
            marker1: {
                definitions: [
                    {
                        path: helper.getMarkerByName('def1').fileName,
                        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
                    },
                ],
            },
        },
        'preferSource'
    );
}
