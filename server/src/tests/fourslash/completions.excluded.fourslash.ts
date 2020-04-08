/// <reference path="fourslash.ts" />

// @filename: test.py
//// a = 42
//// a.n[|/*marker1*/|]

helper.verifyCompletion('excluded', {
    marker1: {
        completions: [{ label: 'capitalize' }],
    },
});
