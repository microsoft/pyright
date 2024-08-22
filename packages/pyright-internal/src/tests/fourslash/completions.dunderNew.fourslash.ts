/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// class Foo:
////     def __new__(cls, name: str):
////         return super().__new__(cls)
////
//// x = Foo([|/*marker1*/|])

// @ts-ignore
await helper.verifyCompletion('included', 'markdown', {
    marker1: {
        completions: [
            {
                label: 'name=',
                kind: Consts.CompletionItemKind.Variable,
            },
        ],
    },
});
