/// <reference path="typings/fourslash.d.ts" />

// @filename: testFunctionWithVariableStub.py
//// import module1
////
//// module1.[|/*marker1*/displayhook|]

// @filename: module1.py
//// def displayhook() -> None:
////     '''displayhook docs'''
////     ...

// @filename: module1.pyi
//// from typing import Callable
//// displayhook: Callable[[],Any]

// @ts-ignore
await helper.verifyCompletion('included', 'markdown', {
    marker1: {
        completions: [
            {
                label: 'displayhook',
                kind: Consts.CompletionItemKind.Variable,
                documentation: '```python\ndef displayhook() -> Unknown\n```',
            },
        ],
    },
});
