/// <reference path="typings/fourslash.d.ts" />

// @filename: test1.py
//// def __hello():
////     pass
////
//// __hello[|/*marker1*/|]

// @filename: test2.pyi
//// from typing import Union
////
//// Union[|/*marker2*/|]
////
//// def __hello1():
////     pass
////
//// __hello1[|/*marker3*/|]

{
    helper.openFiles(helper.getMarkers().map((m) => m.fileName));

    // @ts-ignore
    await helper.verifyCompletion('included', 'markdown', {
        marker1: {
            completions: [
                // Private symbol in same file suggested.
                {
                    label: '__hello',
                    kind: Consts.CompletionItemKind.Function,
                },
            ],
        },
        marker2: {
            completions: [
                // No Auto-import on Union exists.
                {
                    label: 'Union',
                    kind: Consts.CompletionItemKind.Class,
                },
            ],
        },
        marker3: {
            completions: [
                {
                    label: '__hello1',
                    kind: Consts.CompletionItemKind.Function,
                },
            ],
        },
    });

    // @ts-ignore
    await helper.verifyCompletion('excluded', 'markdown', {
        marker3: {
            completions: [
                // Private symbol from other file not suggested.
                {
                    label: '__hello',
                    kind: Consts.CompletionItemKind.Function,
                },
            ],
        },
    });
}
