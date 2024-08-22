/// <reference path="typings/fourslash.d.ts" />

// @filename: test1.py
//// from typing import overload
////
//// class A:
////     @overload
////     def [|met/*marker1*/|]

// @filename: test2.py
//// from typing import overload
////
//// class A:
////     @overload
////     def [|met/*marker2*/|]()

// @filename: test3.py
//// from typing import overload
////
//// class A:
////     @overload
////     def [|met/*marker3*/|]():
////         pass

// @filename: test4.py
//// from typing import overload
////
//// class A:
////     @overload
////     def method(self):
////         pass
////     @overload
////     def [|met/*marker4*/|]

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
////     def [|met/*marker5*/|]

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
////     def [|diff/*marker6*/|]

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
////     def [|met/*marker7*/|]

// @filename: test8.py
//// from typing import overload
////
//// class A:
////     @overload
////     def method(self):
////         pass
////     @overload
////     def [|method/*marker8*/|](self, a):
////         pass

{
    helper.openFiles(helper.getMarkers().map((m) => m.fileName));

    const marker4Range = helper.getPositionRange('marker4');
    const marker5Range = helper.getPositionRange('marker5');
    const marker7Range = helper.getPositionRange('marker7');
    const marker8Range = helper.getPositionRange('marker8');

    // @ts-ignore
    await helper.verifyCompletion('exact', 'markdown', {
        marker1: { completions: [] },
        marker2: { completions: [] },
        marker3: { completions: [] },
        marker4: {
            completions: [
                {
                    label: 'method',
                    kind: Consts.CompletionItemKind.Method,
                    textEdit: { range: marker4Range, newText: 'method' },
                },
            ],
        },
        marker5: {
            completions: [
                {
                    label: 'method',
                    kind: Consts.CompletionItemKind.Method,
                    textEdit: { range: marker5Range, newText: 'method' },
                },
                {
                    label: 'method2',
                    kind: Consts.CompletionItemKind.Method,
                    textEdit: { range: marker5Range, newText: 'method2' },
                },
            ],
        },
        marker6: { completions: [] },
        marker7: {
            completions: [
                {
                    label: 'method',
                    kind: Consts.CompletionItemKind.Method,
                    textEdit: { range: marker7Range, newText: 'method' },
                },
                {
                    label: 'method2',
                    kind: Consts.CompletionItemKind.Method,
                    textEdit: { range: marker7Range, newText: 'method2' },
                },
                {
                    label: 'method3',
                    kind: Consts.CompletionItemKind.Method,
                    textEdit: { range: marker7Range, newText: 'method3' },
                },
            ],
        },
        marker8: {
            completions: [
                {
                    label: 'method',
                    kind: Consts.CompletionItemKind.Method,
                    textEdit: { range: marker8Range, newText: 'method' },
                },
            ],
        },
    });
}
