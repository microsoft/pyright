/// <reference path="typings/fourslash.d.ts" />

// @filename: testLib1/__init__.py
//// class Test1:
////    def [|M|](self, a):
////     pass

// @filename: testLib1/__init__.pyi
//// class Test1:
////     def [|M|](self, a: str): ...

// @filename: test.py
//// from testLib1 import Test1
////
//// Test1().[|[|/*marker*/M|]|]('')

// @filename: test2.py
//// from testLib1 import Test1
////
//// b = Test1()
//// func(b)
////
//// def func(t: Test1):
////     t.[|M|]('')

{
    const ranges = helper.getRanges().filter((r) => !r.marker);

    helper.verifyRename({
        marker: {
            newName: 'M2',
            changes: ranges.map((r) => {
                return { filePath: r.fileName, range: helper.convertPositionRange(r), replacementText: 'M2' };
            }),
        },
    });
}
