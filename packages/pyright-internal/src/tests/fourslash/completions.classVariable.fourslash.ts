/// <reference path="fourslash.ts" />

// @filename: test.py
//// class B:
////     var1 = 1
////     var2: int
////     var3: str = "hello"
////     __var4 = 4
////
////     def __init__(self):
////         self.var6 = 1
////
//// class T(B):
////     var5: bool
////     [|va/*marker*/|]

// @ts-ignore
await helper.verifyCompletion('included', 'markdown', {
    marker: {
        completions: [
            {
                label: 'var1',
                kind: Consts.CompletionItemKind.Variable,
            },
            {
                label: 'var2',
                kind: Consts.CompletionItemKind.Variable,
                textEdit: { range: helper.getPositionRange('marker'), newText: 'var2: int' },
            },
            {
                label: 'var3',
                kind: Consts.CompletionItemKind.Variable,
                textEdit: { range: helper.getPositionRange('marker'), newText: 'var3: str' },
            },
        ],
    },
});
