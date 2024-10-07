/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// def Method(a, b, c):
////     pass
////
//// Method([|/*marker1*/|]"[|/*marker2*/|]hello[|/*marker3*/|]"[|/*marker4*/|])

// @ts-ignore
await helper.verifyCompletion('included', 'markdown', {
    marker1: {
        completions: [{ label: 'a=', kind: Consts.CompletionItemKind.Variable }],
    },
    marker4: {
        completions: [{ label: 'b=', kind: Consts.CompletionItemKind.Variable }],
    },
});

// @ts-ignore
await helper.verifyCompletion('exact', 'markdown', {
    marker2: { completions: [] },
    marker3: { completions: [] },
});
