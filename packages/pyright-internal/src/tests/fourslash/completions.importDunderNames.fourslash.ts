/// <reference path="fourslash.ts" />

// @filename: test.py
//// import __future__[|/*marker1*/|]
//// import __pycache__[|/*marker2*/|]

// @ts-ignore
await helper.verifyCompletion('exact', 'markdown', {
    marker1: {
        completions: [{ label: '__future__', kind: Consts.CompletionItemKind.Module }],
    },
    marker2: {
        completions: [],
    },
});
