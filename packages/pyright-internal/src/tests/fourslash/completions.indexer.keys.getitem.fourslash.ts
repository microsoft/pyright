/// <reference path="typings/fourslash.d.ts" />

// @filename: getitem.py
//// from typing import Literal, Generic, TypeVar, overload
//// class ClassA:
////     def __getitem__(self, key: Literal['a', 'b']):
////         pass
//// T = TypeVar("T")
//// class ClassB(Generic[T]):
////     @overload
////     def __getitem__(self, key: T):
////         pass
////     @overload
////     def __getitem__(self, key: Literal['foo']):
////         pass

// @filename: test1.py
//// from typing import Literal
//// from getitem import ClassA, ClassB
//// a = ClassA()
//// a[[|/*marker1*/|]]
//// b = ClassB[Literal['x']]()
//// b[[|/*marker2*/|]]

// @filename: test2.py
//// from typing import Literal
//// from getitem import ClassA, ClassB
//// a = ClassA()
//// a[[|"/*marker3*/"|]]
//// b = ClassB[Literal['x']]()
//// b[[|"/*marker4*/"|]]

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
                    detail: Consts.IndexValueDetail,
                },
                {
                    label: "'b'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker1'), newText: "'b'" },
                    detail: Consts.IndexValueDetail,
                },
            ],
        },
        marker2: {
            completions: [
                {
                    label: "'x'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker2'), newText: "'x'" },
                    detail: Consts.IndexValueDetail,
                },
                {
                    label: "'foo'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker2'), newText: "'foo'" },
                    detail: Consts.IndexValueDetail,
                },
            ],
        },
        marker3: {
            completions: [
                {
                    label: '"a"',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker3'), newText: '"a"' },
                    detail: Consts.IndexValueDetail,
                },
                {
                    label: '"b"',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker3'), newText: '"b"' },
                    detail: Consts.IndexValueDetail,
                },
            ],
        },
        marker4: {
            completions: [
                {
                    label: '"x"',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker4'), newText: '"x"' },
                    detail: Consts.IndexValueDetail,
                },
                {
                    label: '"foo"',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker4'), newText: '"foo"' },
                    detail: Consts.IndexValueDetail,
                },
            ],
        },
    });
}
