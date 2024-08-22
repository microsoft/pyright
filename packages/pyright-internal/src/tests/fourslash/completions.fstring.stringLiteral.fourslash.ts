/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// from typing import TypedDict
////
//// class Movie(TypedDict):
////     name: str
////     age: int
////
//// m = Movie(name="hello", age=10)
////
//// a = f"{m[[|/*marker1*/|]]}"
//// b = f'{m[[|/*marker2*/|]]}'
//// c = f'{m[[|"ag/*marker3*/"|]]}'
////
////
////
//// m2 = { 'name' : "hello" }
////
//// d = f"{m2[[|/*marker4*/|]]}"
//// e = f'{m2[[|/*marker5*/|]]}'
//// f = f'{m2[[|"na/*marker6*/"|]]}'
////

{
    // @ts-ignore
    await helper.verifyCompletion('included', 'markdown', {
        marker1: {
            completions: [
                {
                    label: "'name'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker1'), newText: "'name'" },
                },
                {
                    label: "'age'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker1'), newText: "'age'" },
                },
            ],
        },
        marker2: {
            completions: [
                {
                    label: '"name"',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker2'), newText: '"name"' },
                },
                {
                    label: '"age"',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker2'), newText: '"age"' },
                },
            ],
        },
        marker3: {
            completions: [
                {
                    label: '"age"',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker3'), newText: '"age"' },
                },
            ],
        },
        marker4: {
            completions: [
                {
                    label: "'name'",
                    kind: Consts.CompletionItemKind.Constant,
                    detail: Consts.IndexValueDetail,
                    textEdit: { range: helper.getPositionRange('marker4'), newText: "'name'" },
                },
            ],
        },
        marker5: {
            completions: [
                {
                    label: '"name"',
                    kind: Consts.CompletionItemKind.Constant,
                    detail: Consts.IndexValueDetail,
                    textEdit: { range: helper.getPositionRange('marker5'), newText: '"name"' },
                },
            ],
        },
        marker6: {
            completions: [
                {
                    label: '"name"',
                    kind: Consts.CompletionItemKind.Constant,
                    detail: Consts.IndexValueDetail,
                    textEdit: { range: helper.getPositionRange('marker6'), newText: '"name"' },
                },
            ],
        },
    });
}
