/// <reference path="typings/fourslash.d.ts" />

// @filename: testLib1/__init__.py
// @library: true
//// class Test1:
////    def [|M|](self, a):
////     pass

// @filename: typings/testLib1/__init__.pyi
//// class Test1:
////     def [|M|](self, a: str): ...

// @filename: test.py
//// from testLib1 import Test1
////
//// Test1().[|/*marker*/M|]('')

// @filename: test2.py
//// from testLib1 import Test1
////
//// b = Test1()
//// func(b)
////
//// def func(t: Test1):
////     t.[|M|]('')

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
