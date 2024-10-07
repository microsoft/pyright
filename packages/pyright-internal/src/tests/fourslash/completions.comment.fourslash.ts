/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// msg = 'hello'
//// [|/*marker1*/|]
//// # msg.[|/*marker2*/|]
//// [|/*marker3*/|]
//// print('upper: ' + msg.up[|/*marker4*/|]per())
//// print('#upper: ' + msg.up[|/*marker5*/|]per())
////
//// # msg.[|/*marker6*/|]
//// [|/*marker7*/|]
////

// @ts-ignore
await helper.verifyCompletion('exact', 'markdown', {
    marker2: { completions: [] },
    marker6: { completions: [] },
});

// @ts-ignore
await helper.verifyCompletion('included', 'markdown', {
    marker1: { completions: [{ label: 'msg', kind: Consts.CompletionItemKind.Variable }] },
    marker3: { completions: [{ label: 'msg', kind: Consts.CompletionItemKind.Variable }] },
    marker4: { completions: [{ label: 'upper', kind: Consts.CompletionItemKind.Method }] },
    marker5: { completions: [{ label: 'upper', kind: Consts.CompletionItemKind.Method }] },
    marker7: { completions: [{ label: 'msg', kind: Consts.CompletionItemKind.Variable }] },
});
