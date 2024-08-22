/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// class Parent:
////     def __init__(self, *args: Any, **kwargs: Any):
////         pass
////
////     def __new__(cls, *args: Any, **kwargs: Any):
////         pass
////
//// class Child(Parent):
////     def __new__(cls, name:str):
////         return super().__new__(cls, name)
////
//// class GrandChild(Child):
////     pass

//// x = GrandChild([|/*marker1*/|])

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
