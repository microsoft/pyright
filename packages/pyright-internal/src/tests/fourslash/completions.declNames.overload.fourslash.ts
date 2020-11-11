/// <reference path="fourslash.ts" />

// @filename: test1.py
//// from typing import overload
////
//// class A:
////     @overload
////     def met[|/*marker1*/|]

// @filename: test2.py
//// from typing import overload
////
//// class A:
////     @overload
////     def met[|/*marker2*/|]()

// @filename: test3.py
//// from typing import overload
////
//// class A:
////     @overload
////     def met[|/*marker3*/|]():
////         pass

// @filename: test4.py
//// from typing import overload
////
//// class A:
////     @overload
////     def method(self):
////         pass
////     @overload
////     def met[|/*marker4*/|]

// @filename: test5.py
//// from typing import overload
////
//// class A:
////     @overload
////     def method(self):
////         pass
////     @overload
////     def method2(self):
////         pass
////     @overload
////     def met[|/*marker5*/|]

// @filename: test6.py
//// from typing import overload
////
//// class A:
////     @overload
////     def method(self):
////         pass
////     @overload
////     def method2(self):
////         pass
////     @overload
////     def diff[|/*marker6*/|]

// @filename: test7.py
//// from typing import overload
////
//// class A:
////     @overload
////     def method(self):
////         pass
////     @overload
////     def method2(self):
////         pass
////
//// class B(A):
////     @overload
////     def method3(self):
////         pass
////     @overload
////     def met[|/*marker7*/|]

// @filename: test8.py
//// from typing import overload
////
//// class A:
////     @overload
////     def method(self):
////         pass
////     @overload
////     def method[|/*marker8*/|](self, a):
////         pass

{
    helper.openFiles(helper.getMarkers().map((m) => m.fileName));

    // @ts-ignore
    await helper.verifyCompletion('exact', 'markdown', {
        marker1: { completions: [] },
        marker2: { completions: [] },
        marker3: { completions: [] },
        marker4: { completions: [{ label: 'method', kind: Consts.CompletionItemKind.Method }] },
        marker5: {
            completions: [
                { label: 'method', kind: Consts.CompletionItemKind.Method },
                { label: 'method2', kind: Consts.CompletionItemKind.Method },
            ],
        },
        marker6: { completions: [] },
        marker7: {
            completions: [
                { label: 'method', kind: Consts.CompletionItemKind.Method },
                { label: 'method2', kind: Consts.CompletionItemKind.Method },
                { label: 'method3', kind: Consts.CompletionItemKind.Method },
            ],
        },
        marker8: { completions: [{ label: 'method', kind: Consts.CompletionItemKind.Method }] },
    });
}
