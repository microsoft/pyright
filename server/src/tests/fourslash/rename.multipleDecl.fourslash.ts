/// <reference path="fourslash.ts" />

// @filename: mspythonconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: foo/__init__.py
// @library: true
//// class Foo:
////    pass

// @filename: test.py
//// import foo
//// import os as [|foo|]
//// [|/*marker*/foo|] = 3
//// def [|foo|](): pass

{
    const ranges = helper.getRanges();

    helper.verifyRename({
        marker: {
            newName: 'foo1',
            changes: ranges.map((r) => {
                return { filePath: r.fileName, range: helper.convertPositionRange(r), replacementText: 'foo1' };
            }),
        },
    });
}
