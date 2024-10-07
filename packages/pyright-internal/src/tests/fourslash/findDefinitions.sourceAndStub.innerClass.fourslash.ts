/// <reference path="typings/fourslash.d.ts" />

// @filename: testLib1/__init__.py
// @library: true
//// class Outer:
////     class [|Middle|]:
////         class Inner:
////             def M(self, a):
////                 pass

// @filename: typings/testLib1/__init__.pyi
//// class Outer:
////     class [|Middle|]:
////         class Inner:
////             def M(self, a: str): ...

// @filename: test.py
//// import testLib1
////
//// testLib1.Outer.[|/*marker*/Middle|].Inner()

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
