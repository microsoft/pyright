/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// class B:
////     def method1(self, a: str, *args, **kwargs):
////         pass
////
////     def method2(self, b, /, *args):
////         pass
////
////     def method3(self, b, *, c: str):
////         pass
////
//// class C(B):
////     def [|method/*marker*/|]

// @ts-ignore
await helper.verifyCompletion('included', 'markdown', {
    marker: {
        completions: [
            {
                label: 'method1',
                kind: Consts.CompletionItemKind.Method,
                textEdit: {
                    range: helper.getPositionRange('marker'),
                    newText: 'method1(self, a: str, *args, **kwargs):\n    return super().method1(a, *args, **kwargs)',
                },
            },
            {
                label: 'method2',
                kind: Consts.CompletionItemKind.Method,
                textEdit: {
                    range: helper.getPositionRange('marker'),
                    newText: 'method2(self, b, /, *args):\n    return super().method2(b, *args)',
                },
            },
            {
                label: 'method3',
                kind: Consts.CompletionItemKind.Method,
                textEdit: {
                    range: helper.getPositionRange('marker'),
                    newText: 'method3(self, b, *, c: str):\n    return super().method3(b, c=c)',
                },
            },
        ],
    },
});
