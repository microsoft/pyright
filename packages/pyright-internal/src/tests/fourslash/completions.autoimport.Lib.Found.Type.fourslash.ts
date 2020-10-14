/// <reference path="fourslash.ts" />

// @filename: test1.py
//// Test[|/*marker*/|]

// @filename: test2.py
//// import testLib

// @filename: testLib/__init__.pyi
// @library: true
//// class Test:
////     pass

// @ts-ignore
await helper.verifyCompletion('included', 'markdown', {
    marker: {
        completions: [
            {
                label: 'Test',
                kind: Consts.CompletionItemKind.Class,
                documentation: '```\nfrom testLib import Test\n```',
                detail: 'Auto-import',
            },
        ],
    },
});
