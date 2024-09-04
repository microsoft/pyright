/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// class A:
////     @staticmethod
////     def smethod(a, b):
////         pass
////
////     @classmethod
////     def cmethod(cls, a):
////         pass
////
//// class B1(A):
////     def [|m/*marker1*/|]
////
//// class B2(A):
////     @staticmethod
////     def [|m/*marker2*/|]
////
//// class B3(A):
////     @classmethod
////     def [|m/*marker3*/|]

{
    // @ts-ignore
    await helper.verifyCompletion('included', 'markdown', {
        marker2: {
            completions: [
                {
                    label: 'smethod',
                    kind: Consts.CompletionItemKind.Method,
                    textEdit: {
                        range: helper.getPositionRange('marker2'),
                        newText: 'smethod(a, b):\n    return super().smethod(a, b)',
                    },
                },
            ],
        },
        marker3: {
            completions: [
                {
                    label: 'cmethod',
                    kind: Consts.CompletionItemKind.Method,
                    textEdit: {
                        range: helper.getPositionRange('marker3'),
                        newText: 'cmethod(cls, a):\n    return super().cmethod(a)',
                    },
                },
            ],
        },
    });

    // @ts-ignore
    await helper.verifyCompletion('excluded', 'markdown', {
        marker1: {
            completions: [
                { label: 'smethod', kind: undefined },
                { label: 'cmethod', kind: undefined },
            ],
        },
        marker2: { completions: [{ label: 'cmethod', kind: undefined }] },
        marker3: { completions: [{ label: 'smethod', kind: undefined }] },
    });
}
