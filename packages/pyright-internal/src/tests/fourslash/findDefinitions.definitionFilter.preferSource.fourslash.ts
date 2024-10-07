/// <reference path="typings/fourslash.d.ts" />

// @filename: testLib1/__init__.py
// @library: true
//// def [|func1|](a):
////     pass

// @filename: typings/testLib1/__init__.pyi
//// def [|/*ignore*/func1|](a: str): ...

// @filename: test.py
//// from testLib1 import func1
////
//// [|/*marker*/func1|]('')

{
    const ranges = helper.getRanges().filter((r) => !r.marker);

    helper.verifyFindDefinitions(
        {
            marker: {
                definitions: ranges.map((r) => {
                    return { path: r.fileName, range: helper.convertPositionRange(r) };
                }),
            },
        },
        'preferSource'
    );
}
