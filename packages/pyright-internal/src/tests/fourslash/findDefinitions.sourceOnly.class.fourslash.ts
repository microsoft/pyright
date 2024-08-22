/// <reference path="typings/fourslash.d.ts" />

// @filename: pyrightconfig.json
//// {
////   "useLibraryCodeForTypes": true
//// }

// @filename: testLib1/__init__.py
// @library: true
//// class [|Test1|]:
////     def M(self, a: str):
////         pass

// @filename: test.py
//// import testLib1
////
//// a = testLib1.[|/*marker*/Test1|]()

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
