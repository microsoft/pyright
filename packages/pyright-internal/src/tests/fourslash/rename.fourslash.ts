/// <reference path="typings/fourslash.d.ts" />

// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: test.py
//// class [|Test1|]:
////    def M(self, a: '[|Test1|]'):
////     pass

// @filename: test2.py
//// from test import [|Test1|]
////
//// b = [|[|/*marker*/Test1|]|]()

{
    const ranges = helper.getRanges().filter((r) => !r.marker);

    helper.verifyRename({
        marker: {
            newName: 'NewTest1',
            changes: ranges.map((r) => {
                return { filePath: r.fileName, range: helper.convertPositionRange(r), replacementText: 'NewTest1' };
            }),
        },
    });
}
