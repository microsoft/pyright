/// <reference path="typings/fourslash.d.ts" />

// @filename: test1.py
//// from typing import Literal
//// a: Literal["Hello"] = "He[|/*marker1*/|]

// @filename: test2.py
//// from typing import Literal
//// a: Literal["Hello"] = [|/*marker2*/|]

{
    helper.openFiles(helper.getMarkers().map((m) => m.fileName));

    // @ts-ignore
    await helper.verifyCompletion('included', 'markdown', {
        marker1: {
            completions: [
                {
                    label: '"Hello"',
                    kind: Consts.CompletionItemKind.Constant,
                },
            ],
        },
        marker2: {
            completions: [
                {
                    label: '"Hello"',
                    kind: Consts.CompletionItemKind.Constant,
                },
            ],
        },
    });
}
