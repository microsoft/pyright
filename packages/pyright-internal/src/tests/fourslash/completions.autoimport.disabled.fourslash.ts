/// <reference path="typings/fourslash.d.ts" />

// @filename: pyrightconfig.json
//// {
////   "autoImportCompletions": false
//// }

// @filename: test1.py
//// Test[|/*marker*/|]

// @filename: test2.py
//// class Test:
////     pass

// @ts-ignore
await helper.verifyCompletion('excluded', 'markdown', {
    marker: {
        completions: [
            {
                label: 'Test',
                kind: Consts.CompletionItemKind.Class,
            },
        ],
    },
});
