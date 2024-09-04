/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// msg = "gekki"
////
//// a = f"{[|/*marker1*/|]}"
//// b = f"{msg.c[|/*marker2*/|]}"
//// c = f"{msg.[|/*marker3*/|]}"
//// d = f"msg.[|/*marker4*/|]{msg}"
//// e = f"{msg}msg.[|/*marker5*/|]"

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

// @ts-ignore
await helper.verifyCompletion('exact', 'markdown', {
    marker4: {
        completions: [],
    },
    marker5: {
        completions: [],
    },
});
