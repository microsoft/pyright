/// <reference path="fourslash.ts" />

// @filename: test1.py
//// Test[|/*marker*/|]

// @filename: test2.py
//// class Test:
////     pass

// @ts-ignore
await helper.verifyCompletion('included', 'plaintext', {
    marker: {
        completions: [
            {
                label: 'Test',
                documentation: 'from test2 import Test',
                detail: 'Auto-import',
            },
        ],
    },
});
