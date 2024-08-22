/// <reference path="typings/fourslash.d.ts" />

// @filename: pyrightconfig.json
//// {
////   "typeCheckingMode": "off"
//// }

// @filename: testLib/py.typed
// @library: true
////

// @filename: testLib/__init__.py
// @library: true
//// class Foo:
////    def method1(self):
////        '''Method docs'''
////        return None
////
//// # This method has no annotation
//// def foo(a):
////    return Foo()

// @filename: .src/test.py
//// from testLib import foo
//// foo(1).me[|/*marker1*/|]

// @ts-ignore
await helper.verifyCompletion('included', 'markdown', {
    marker1: {
        completions: [
            {
                label: 'method1',
                kind: Consts.CompletionItemKind.Method,
                documentation: '```python\ndef method1() -> None\n```\n---\nMethod docs',
            },
        ],
    },
});
