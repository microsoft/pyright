/// <reference path="fourslash.ts" />

// @filename: test.py
//// msg = "gekki"
////
//// a = f"{[|/*marker1*/|]}"
//// b = f"{msg.c[|/*marker2*/|]}"
//// b = f"{msg.[|/*marker3*/|]}"

// @ts-ignore
await helper.verifyCompletion('included', 'markdown', {
    marker1: {
        completions: [{ label: 'msg', kind: Consts.CompletionItemKind.Variable }],
    },
    marker2: {
        completions: [{ label: 'count', kind: Consts.CompletionItemKind.Method }],
    },
    marker3: {
        completions: [{ label: 'capitalize', kind: Consts.CompletionItemKind.Method }],
    },
});
