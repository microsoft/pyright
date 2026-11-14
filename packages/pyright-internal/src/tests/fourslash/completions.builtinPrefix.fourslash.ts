/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// import os
////
//// pri[|/*module*/|]
////
//// def func():
////     private_value = 1
////     pri[|/*function*/|]

// @ts-ignore
await helper.verifyCompletion('included', 'markdown', {
    module: {
        completions: [{ label: 'print', kind: Consts.CompletionItemKind.Function }],
    },
    function: {
        completions: [
            { label: 'print', kind: Consts.CompletionItemKind.Function },
            { label: 'private_value', kind: Consts.CompletionItemKind.Variable },
        ],
    },
});
