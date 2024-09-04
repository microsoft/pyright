/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// from typing import Literal
////
//// def thing(foo: Literal["hello", "world"]):
////     pass
////
//// thing([|/*marker1*/|])
//// thing(hel[|/*marker2*/|])
//// thing([|"/*marker3*/"|])

{
    // @ts-ignore
    await helper.verifyCompletion('included', 'markdown', {
        marker1: {
            completions: [
                {
                    label: '"hello"',
                    kind: Consts.CompletionItemKind.Constant,
                },
                {
                    label: '"world"',
                    kind: Consts.CompletionItemKind.Constant,
                },
            ],
        },
        marker2: {
            completions: [
                {
                    label: '"hello"',
                    kind: Consts.CompletionItemKind.Constant,
                },
            ],
        },
    });

    // @ts-ignore
    await helper.verifyCompletion('exact', 'markdown', {
        marker3: {
            completions: [
                {
                    label: '"hello"',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker3'), newText: '"hello"' },
                },
                {
                    label: '"world"',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker3'), newText: '"world"' },
                },
            ],
        },
    });
}
