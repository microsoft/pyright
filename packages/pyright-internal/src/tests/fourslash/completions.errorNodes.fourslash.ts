/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// import os

//// class App():
////     def __init(self):
////         self.instance_path = "\\foo"

//// app = App()
//// try:
////     os.makedirs(app.in[|/*marker*/|])

//// except:
////     pass

// @ts-ignore
await helper.verifyCompletion('included', 'markdown', {
    marker: {
        completions: [
            {
                label: 'instance_path',
                kind: Consts.CompletionItemKind.Variable,
            },
        ],
    },
});
