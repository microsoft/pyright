/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// class B:
////     def method1(self, a: str = 'hello', b: int = 1234):
////         pass
////
////     def method2(self, a=None):
////         pass
////
////     def method3(self, a=1234, b=object()):
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
                    newText: "method1(self, a: str = 'hello', b: int = 1234):\n    return super().method1(a, b)",
                },
            },
            {
                label: 'method2',
                kind: Consts.CompletionItemKind.Method,
                textEdit: {
                    range: helper.getPositionRange('marker'),
                    newText: 'method2(self, a=None):\n    return super().method2(a)',
                },
            },
            {
                label: 'method3',
                kind: Consts.CompletionItemKind.Method,
                textEdit: {
                    range: helper.getPositionRange('marker'),
                    newText: 'method3(self, a=1234, b=object()):\n    return super().method3(a, b)',
                },
            },
        ],
    },
});
