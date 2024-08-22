/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// a = 42
//// a.n[|/*marker1*/|]

// @ts-ignore
await helper.verifyCompletion('included', 'markdown', {
    marker1: {
        completions: [{ label: 'numerator', kind: Consts.CompletionItemKind.Property }],
    },
});
