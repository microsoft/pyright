/// <reference path="typings/fourslash.d.ts" />

// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: testLib1/__init__.py
// @library: true
//// class Test1:
////    def M(self, a: Test1):
////     pass

// @filename: test.py
//// from testLib1 import Test1 as [|t1|]
////
//// a = [|[|/*marker*/t1|]|]()

// @filename: test2.py
//// from testLib1 import Test1
////
//// b = Test1()

{
    const ranges = helper.getRanges().filter((r) => !r.marker);

    helper.verifyFindAllReferences({
        marker: {
            references: ranges.map((r) => {
                return { path: r.fileName, range: helper.convertPositionRange(r) };
            }),
        },
    });
}
