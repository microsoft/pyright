/// <reference path="typings/fourslash.d.ts" />

// @filename: test.pyi
//// class B:
////     @property
////     def prop(self):
////         return 1
////
////     @prop.setter
////     def prop(self, value):
////         pass
////
//// class C(B):
////     @property
////     def [|pr/*marker*/|]

// @ts-ignore
await helper.verifyCompletion('included', 'markdown', {
    marker: {
        completions: [
            {
                label: 'prop',
                kind: Consts.CompletionItemKind.Property,
                textEdit: {
                    range: helper.getPositionRange('marker'),
                    newText: 'prop(self): ...',
                },
            },
        ],
    },
});
