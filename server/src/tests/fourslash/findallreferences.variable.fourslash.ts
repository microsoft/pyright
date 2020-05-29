/// <reference path="fourslash.ts" />

// @filename: test.py
//// def func(a):
////     print(a)
////
//// [|/*marker*/a|] = 40
//// func([|a|])

// @filename: test2.py
//// a = 50
//// print(a)

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
