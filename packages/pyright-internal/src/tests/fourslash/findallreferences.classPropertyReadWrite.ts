/// <reference path="typings/fourslash.d.ts" />

// @filename: testLib1/__init__.py
//// class Test1:
////     @property
////     def [|P|](self):
////         return ''
////     @[|P|].setter
////     def [|P|](self, a):
////         pass

// @filename: test.py
//// from testLib1 import Test1
////
//// a = Test1()
//// a.[|/*marker*/P|] = ''
//// val = a.[|P|]

// @filename: test2.py
//// from testLib1 import Test1
////
//// b = Test1()
//// func(b)
////
//// def func(t: Test1):
////     t.[|P|] = ''
////     print(t.[|P|])

{
    const ranges = helper.getRanges();

    helper.verifyFindAllReferences({
        marker: {
            references: ranges.map((r) => {
                return { path: r.fileName, range: helper.convertPositionRange(r) };
            }),
        },
    });
}
