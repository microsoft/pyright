/// <reference path="fourslash.ts" />

// @filename: getitem.py
//// from typing import Literal
//// class Foo:
////     def __getitem__(self, key: Literal['a', 'b']):
////         pass

// @filename: test1.py
//// from getitem import Foo
//// f = Foo()
//// f[[|/*marker1*/|]]

// @filename: test2.py
//// from getitem import Foo
//// f = Foo()
//// f[[|"/*marker2*/"|]]

{
    helper.openFiles(helper.getMarkers().map((m) => m.fileName));

    // @ts-ignore
    await helper.verifyCompletion('exact', 'markdown', {
        marker1: {
            completions: [
                {
                    label: "'a'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker1'), newText: "'a'" },
                    detail: 'Dictionary key',
                },
                {
                    label: "'b'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker1'), newText: "'b'" },
                    detail: 'Dictionary key',
                },
            ],
        },
        marker2: {
            completions: [
                {
                    label: '"a"',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker2'), newText: '"a"' },
                    detail: 'Dictionary key',
                },
                {
                    label: '"b"',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker2'), newText: '"b"' },
                    detail: 'Dictionary key',
                },
            ],
        },
    });
}
