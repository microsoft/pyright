/// <reference path="fourslash.ts" />
// @asynctest: true

// @filename: test1.py
//// Test[|/*marker*/|]

// @filename: test2.py
//// class Test:
////     pass

helper.verifyCompletion('included', {
    marker: {
        completions: [
            {
                label: 'Test',
                documentation: {
                    kind: 'markdown',
                    value: 'Auto-import from test2\n\n',
                },
            },
        ],
    },
});
