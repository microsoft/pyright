/// <reference path="fourslash.ts" />

// @filename: test.py
//// a = 42
//// a.n[|/*marker1*/|]

// @ts-ignore
await helper.verifyCompletion('excluded', {
    marker1: {
        completions: [{ label: 'capitalize' }],
    },
});
