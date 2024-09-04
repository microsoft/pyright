/// <reference path="typings/fourslash.d.ts" />

// @filename: test1.py
//// .[|/*marker1*/|]

// @filename: test2.py
//// ..[|/*marker2*/|]

// @filename: test3.py
//// ...[|/*marker3*/|]

// @filename: test4.py
//// ....[|/*marker4*/|]

// @filename: test5.py
//// dict = { "test" : "value" }
//// dict[.[|/*marker5*/|]]

// @filename: test6.py
//// a = 1
//// a..[|/*marker6*/|]

{
    helper.openFiles(helper.getMarkers().map((m) => m.fileName));

    // @ts-ignore
    await helper.verifyCompletion('exact', 'markdown', {
        marker1: { completions: [] },
        marker2: { completions: [] },
        marker3: { completions: [] },
        marker4: { completions: [] },
        marker5: { completions: [] },
        marker6: { completions: [] },
    });
}
