/// <reference path="typings/fourslash.d.ts" />

// @filename: testLib1/__init__.py
// @library: true
//// def [|func1|](a):
////     pass

// @filename: typings/testLib1/__init__.pyi
//// def [|func1|](a: str): ...

// @filename: test.py
//// from testLib1 import [|func1|]
////
//// [|/*marker*/func1|]('')

// @filename: test2.py
//// import testLib1
////
//// def func1(t: str):
////     pass
////
//// func1('')
//// testLib1.[|func1|]('')

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
