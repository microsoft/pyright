/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// class [|/*marker1*/|]
////

// @filename: test1.py
//// class c[|/*marker2*/|]
////

// @filename: test2.py
//// class c1[|/*marker3*/|]():
////     pass
////

// @filename: test3.py
//// class c1([|/*marker4*/|]):
////     pass
////

{
    helper.openFiles(helper.getMarkers().map((m) => m.fileName));

    // @ts-ignore
    await helper.verifyCompletion('exact', 'markdown', {
        marker1: { completions: [] },
        marker2: { completions: [] },
        marker3: { completions: [] },
    });

    // @ts-ignore
    await helper.verifyCompletion('included', 'markdown', {
        marker4: { completions: [{ label: 'Exception', kind: Consts.CompletionItemKind.Class }] },
    });
}
