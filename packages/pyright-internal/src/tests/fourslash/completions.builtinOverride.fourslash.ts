/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// Cust[|/*marker1*/|]
//// my_v[|/*marker2*/|]

// @filename: __builtins__.pyi
//// class CustomClass: ...
//// my_var: int = ...

// @ts-ignore
await helper.verifyCompletion('exact', 'markdown', {
    marker1: {
        completions: [
            {
                label: 'CustomClass',
                kind: Consts.CompletionItemKind.Class,
            },
        ],
    },
    marker2: { completions: [{ label: 'my_var', kind: Consts.CompletionItemKind.Variable }] },
});
