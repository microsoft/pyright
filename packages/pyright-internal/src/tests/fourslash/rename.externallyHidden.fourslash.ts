/// <reference path="typings/fourslash.d.ts" />

// @filename: test1.py
//// def [|__foo|]():
////     pass
////
//// [|__foo/*marker*/|]()

// @filename: test2.py
//// from test1 import [|__foo|]
////
//// [|__foo|]()

helper.verifyRename({
    marker: {
        newName: '__foo1',
        changes: helper
            .getRangesByText()
            .get('__foo')!
            .map((r) => {
                return { filePath: r.fileName, range: helper.convertPositionRange(r), replacementText: '__foo1' };
            }),
    },
});
