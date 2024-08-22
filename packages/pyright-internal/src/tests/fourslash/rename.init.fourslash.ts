/// <reference path="typings/fourslash.d.ts" />
// Verify rename doesn't use the same logic as find all references (which would find the constructor calls)

// @filename: test.py
//// class Test1:
////    def [|/*marker*/__init__|](self):
////     pass

// @filename: test2.py
//// from test import Test1
////
//// b = Test1()

{
    const ranges = helper.getRanges().filter((r) => r.marker);

    helper.verifyRename({
        marker: {
            newName: 'foo',
            changes: ranges.map((r) => {
                return { filePath: r.fileName, range: helper.convertPositionRange(r), replacementText: 'foo' };
            }),
        },
    });
}
