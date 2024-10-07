/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// class C:
////     def __init__(self):
////         self._x = None
////
////     @property
////     def prop(self):
////         pass
////
////     @prop.setter
////     def prop(self, value):
////         pass
////
//// C()./*marker*/prop

// @ts-ignore
await helper.verifyCompletion('included', 'markdown', {
    marker: {
        completions: [
            {
                label: 'prop',
                kind: Consts.CompletionItemKind.Property,
            },
        ],
    },
});
