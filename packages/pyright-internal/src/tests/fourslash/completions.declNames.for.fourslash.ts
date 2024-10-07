/// <reference path="typings/fourslash.d.ts" />

// @filename: test1.py
//// for [|/*marker1*/|]
////

// @filename: test2.py
//// for c[|/*marker2*/|]
////

// @filename: test3.py
//// for c1[|/*marker3*/|] in [1, 2]:
////     pass
////

// @filename: test4.py
//// [c for c[|/*marker4*/|] in [1, 2]]
////

{
    helper.openFiles(helper.getMarkers().map((m) => m.fileName));

    // @ts-ignore
    await helper.verifyCompletion('exact', 'markdown', {
        marker1: { completions: [{ label: 'in', kind: Consts.CompletionItemKind.Keyword }] },
        marker2: { completions: [] },
        marker3: { completions: [] },
        marker4: { completions: [] },
    });
}
