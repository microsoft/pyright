/// <reference path="typings/fourslash.d.ts" />

// @filename: testLib1/__init__.py
//// def [|func1|](a):
////     pass

// @filename: test.py
//// from . import testLib1
////
//// testLib1.[|/*marker*/func1|]('')

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
