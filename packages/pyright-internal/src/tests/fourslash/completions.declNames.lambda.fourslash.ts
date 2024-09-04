/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// lambda [|/*marker1*/|]

// @filename: test1.py
//// lambda x[|/*marker2*/|]

// @filename: test2.py
//// lambda x[|/*marker3*/|]:

// @filename: test3.py
//// lambda x, [|/*marker4*/|]

// @filename: test4.py
//// lambda x, [|/*marker5*/|]:

// @filename: test5.py
//// lambda x, y[|/*marker6*/|]

// @filename: test6.py
//// lambda x, y[|/*marker7*/|]:

// @filename: test7.py
//// lambda x: [|/*marker8*/|]

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
        marker7: { completions: [] },
    });

    // @ts-ignore
    await helper.verifyCompletion('included', 'markdown', {
        marker8: { completions: [{ label: 'str', kind: Consts.CompletionItemKind.Class }] },
    });
}
