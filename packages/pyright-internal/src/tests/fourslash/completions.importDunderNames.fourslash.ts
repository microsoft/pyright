/// <reference path="fourslash.ts" />

// @filename: test.py
//// import _[|/*marker1*/|]
//// import __pycache__[|/*marker2*/|]

// @ts-ignore
await helper.verifyCompletion('included', 'markdown', {
    marker1: {
        completions: [{ label: '__future__', kind: Consts.CompletionItemKind.Module }],
    },
});

// @ts-ignore
await helper.verifyCompletion('exact', 'markdown', {
    marker2: {
        completions: [],
    },
});
