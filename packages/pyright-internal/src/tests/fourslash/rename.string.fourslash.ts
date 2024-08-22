/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// class [|/*marker*/A|]:
////     pass
////
//// __all__ = ["[|A|]"]

// @filename: test2.py
//// from test import [|A|]
////
//// a: "[|A|]" = [|A|]()

{
    helper.verifyRename({
        marker: {
            newName: 'RenamedA',
            changes: helper
                .getRangesByText()
                .get('A')!
                .map((r) => {
                    return { filePath: r.fileName, range: helper.convertPositionRange(r), replacementText: 'RenamedA' };
                }),
        },
    });
}
