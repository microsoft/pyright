/// <reference path="typings/fourslash.d.ts" />

// @filename: main.py
//// from test import B
////
//// class C(B):
////     def [|method/*marker*/|]

// @filename: test.pyi
//// class B:
////     def method1(self, a: str = 'hello', b: int = 1234):
////         pass
////
////     def method2(self, a=None):
////         pass
////
////     def method3(self, a=1234, b=object()):
////         pass

// @ts-ignore
await helper.verifyCompletion('included', 'markdown', {
    marker: {
        completions: [
            {
                label: 'method1',
                kind: Consts.CompletionItemKind.Method,
                textEdit: {
                    range: helper.getPositionRange('marker'),
                    newText: 'method1(self, a: str = ..., b: int = ...):\n    return super().method1(a=a, b=b)',
                },
            },
            {
                label: 'method2',
                kind: Consts.CompletionItemKind.Method,
                textEdit: {
                    range: helper.getPositionRange('marker'),
                    newText: 'method2(self, a=...):\n    return super().method2(a=a)',
                },
            },
            {
                label: 'method3',
                kind: Consts.CompletionItemKind.Method,
                textEdit: {
                    range: helper.getPositionRange('marker'),
                    newText: 'method3(self, a=..., b=...):\n    return super().method3(a=a, b=b)',
                },
            },
        ],
    },
});
