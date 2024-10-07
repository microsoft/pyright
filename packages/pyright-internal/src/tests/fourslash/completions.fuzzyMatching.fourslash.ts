/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// from unittest.mock import MagicMock
//// mock = MagicMock()
//// mock.call[|/*marker1*/|]

// @ts-ignore
await helper.verifyCompletion('included', 'markdown', {
    marker1: {
        completions: [
            {
                label: 'call_args',
                kind: Consts.CompletionItemKind.Variable,
            },
            {
                label: 'called',
                kind: Consts.CompletionItemKind.Variable,
            },
            {
                label: '__call__',
                kind: Consts.CompletionItemKind.Method,
            },
            {
                label: 'assert_called',
                kind: Consts.CompletionItemKind.Method,
            },
        ],
    },
});
