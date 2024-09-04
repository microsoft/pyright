/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// class B(list):
////     def [|append/*marker*/|]

// @filename: test1.py
//// class A:
////     def __init__(self, *args, **kwargs):
////         pass
////
//// class B(A):
////     def [|__init__/*marker1*/|]

// @filename: test2.py
//// class A:
////     def [|__class__/*marker2*/|]

// @filename: test3.py
//// class A:
////     def [|__call__/*marker3*/|]

{
    helper.openFiles(helper.getMarkers().map((m) => m.fileName));

    // @ts-ignore
    await helper.verifyCompletion('included', 'markdown', {
        marker: {
            completions: [
                {
                    label: 'append',
                    kind: Consts.CompletionItemKind.Method,
                    textEdit: {
                        range: helper.getPositionRange('marker'),
                        newText: 'append(self, object: _T, /) -> None:\n    return super().append(object)',
                    },
                },
            ],
        },
        marker1: {
            completions: [
                {
                    label: '__init__',
                    kind: Consts.CompletionItemKind.Method,
                    textEdit: {
                        range: helper.getPositionRange('marker1'),
                        newText: '__init__(self, *args, **kwargs):\n    super().__init__(*args, **kwargs)',
                    },
                },
            ],
        },
        marker3: {
            completions: [
                {
                    label: '__call__',
                    kind: Consts.CompletionItemKind.Method,
                    textEdit: {
                        range: helper.getPositionRange('marker3'),
                        newText: '__call__(self, *args: Any, **kwds: Any) -> Any:\n    ${0:pass}',
                    },
                },
            ],
        },
    });

    // @ts-ignore
    await helper.verifyCompletion('excluded', 'markdown', {
        // Only method shows up. __class__ is property
        marker2: { completions: [{ label: '__class__', kind: undefined }] },
    });
}
