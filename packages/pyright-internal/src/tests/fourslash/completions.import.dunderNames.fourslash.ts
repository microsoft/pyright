/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// import _[|/*marker1*/|]
//// import __pycache__[|/*marker2*/|]
//// from test2 import _[|/*marker3*/|]
//// from test2 import [|/*marker4*/|]

// @filename: test2.py
//// def foo():
////     pass

// @ts-ignore
await helper.verifyCompletion('included', 'markdown', {
    marker1: {
        completions: [{ label: '__future__', kind: Consts.CompletionItemKind.Module }],
    },
    marker4: {
        completions: [{ label: 'foo', kind: Consts.CompletionItemKind.Function }],
    },
});

// @ts-ignore
await helper.verifyCompletion('exact', 'markdown', {
    marker2: {
        completions: [],
    },
    marker3: {
        completions: [],
    },
});
