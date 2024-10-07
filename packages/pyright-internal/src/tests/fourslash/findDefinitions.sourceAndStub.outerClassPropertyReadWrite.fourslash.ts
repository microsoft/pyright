/// <reference path="typings/fourslash.d.ts" />

// @filename: testLib1/__init__.py
// @library: true
//// class Test1:
////     @property
////     def [|P|](self):
////         return ''
////     @P.setter
////     def [|P|](self, a):
////         pass

// @filename: typings/testLib1/__init__.pyi
//// class Test1:
////     @property
////     def [|P|](self) -> str: ...
////     @P.setter
////     def [|P|](self, a: str): ...

// @filename: test.py
//// import testLib1
////
//// a = testLib1.Test1()
//// a.[|/*marker*/P|]

{
    const ranges = helper.getRanges().filter((r) => !r.marker);

    helper.verifyFindDefinitions({
        marker: {
            definitions: ranges.map((r) => {
                return { path: r.fileName, range: helper.convertPositionRange(r) };
            }),
        },
    });
}
