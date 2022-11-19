/// <reference path="fourslash.ts" />

// @filename: test.py
//// class MyType: pass
////
//// class B:
////     var1 = 1
////     var2: MyType
////     var3: list[str] = ["hello"]
////     __var4 = 4
////
////     def __init__(self):
////         self.var6 = 1
////
//// class T(B):
////     var5: bool
////     [|va/*marker1*/|]
////
//// class T1(B):
////     var2: [|/*marker2*/|]
////
//// class T2(B):
////     var3: [|/*marker3*/|]

// @ts-ignore
await helper.verifyCompletion('included', 'markdown', {
    marker1: {
        completions: [
            {
                label: 'var1',
                kind: Consts.CompletionItemKind.Variable,
            },
            {
                label: 'var2',
                kind: Consts.CompletionItemKind.Variable,
            },
            {
                label: 'var3',
                kind: Consts.CompletionItemKind.Variable,
            },
        ],
    },
    marker2: {
        completions: [
            {
                label: 'MyType',
                kind: Consts.CompletionItemKind.Reference,
            },
        ],
    },
    marker3: {
        completions: [
            {
                label: 'list[str]',
                kind: Consts.CompletionItemKind.Reference,
            },
        ],
    },
});
