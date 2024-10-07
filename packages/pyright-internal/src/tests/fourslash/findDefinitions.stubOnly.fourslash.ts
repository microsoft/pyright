/// <reference path="typings/fourslash.d.ts" />

// @filename: typings/testLib1/__init__.pyi
//// from typing import overload
////
//// class [|Test1|]:
////     def M(self, a: str):
////         pass
////     @overload
////     def [|OL|](self, [|a|]):
////         pass
////     @overload
////     def [|OL|](self, [|a|], [|b|]):
////         pass

// @filename: test.py
//// import testLib1
////
//// a = testLib1.[|/*marker*/Test1|]()
//// testLib1.Test1().[|/*marker2*/OL|]("hello")
//// testLib1.Test1().OL([|/*marker3*/a|] = "hello")
//// testLib1.Test1().OL(a = "hello", [|/*marker4*/b|] = 1)

{
    const rangeMap = helper.getRangesByText();

    helper.verifyFindDefinitions({
        marker: {
            definitions: rangeMap
                .get('Test1')!
                .filter((r) => !r.marker)
                .map((r) => {
                    return { path: r.fileName, range: helper.convertPositionRange(r) };
                }),
        },
        marker2: {
            definitions: rangeMap
                .get('OL')!
                .filter((r) => !r.marker)
                .map((r) => {
                    return { path: r.fileName, range: helper.convertPositionRange(r) };
                }),
        },
        marker3: {
            definitions: rangeMap
                .get('a')!
                .filter((r) => !r.marker)
                .map((r) => {
                    return { path: r.fileName, range: helper.convertPositionRange(r) };
                }),
        },
        marker4: {
            definitions: rangeMap
                .get('b')!
                .filter((r) => !r.marker)
                .map((r) => {
                    return { path: r.fileName, range: helper.convertPositionRange(r) };
                }),
        },
    });
}
