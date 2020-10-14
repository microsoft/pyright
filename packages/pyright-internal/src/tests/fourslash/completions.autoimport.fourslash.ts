/// <reference path="fourslash.ts" />

// @filename: test1.py
//// Test[|/*marker*/|]

// @filename: test2.py
//// class Test:
////     pass

// @ts-ignore
await helper.verifyCompletion('included', 'markdown', {
    marker: {
        completions: [
            {
                label: 'Test',
                kind: Consts.CompletionItemKind.Class,
                documentation: '```\nfrom test2 import Test\n```',
                detail: 'Auto-import',
            },
        ],
    },
});
