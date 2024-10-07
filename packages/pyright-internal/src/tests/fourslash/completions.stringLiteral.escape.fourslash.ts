/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// from typing import Literal
////
//// def method(foo: Literal["'\"", '"\'', "'mixed'"]):
////     pass
////
//// method([|/*marker1*/|])
//// method([|"/*marker2*/"|])
//// method([|'/*marker3*/'|])

{
    // @ts-ignore
    await helper.verifyCompletion('included', 'markdown', {
        marker1: {
            completions: [
                {
                    label: '"\'\\""',
                    kind: Consts.CompletionItemKind.Constant,
                },
                {
                    label: '"\\"\'"',
                    kind: Consts.CompletionItemKind.Constant,
                },
                {
                    label: '"\'mixed\'"',
                    kind: Consts.CompletionItemKind.Constant,
                },
            ],
        },
        marker2: {
            completions: [
                {
                    label: '"\'\\""',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker2'), newText: '"\'\\""' },
                },
                {
                    label: '"\\"\'"',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker2'), newText: '"\\"\'"' },
                },
                {
                    label: '"\'mixed\'"',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker2'), newText: '"\'mixed\'"' },
                },
            ],
        },
        marker3: {
            completions: [
                {
                    label: "'\\'\"'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker3'), newText: "'\\'\"'" },
                },
                {
                    label: "'\"\\''",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker3'), newText: "'\"\\''" },
                },
                {
                    label: "'\\'mixed\\''",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker3'), newText: "'\\'mixed\\''" },
                },
            ],
        },
    });
}
