/// <reference path="fourslash.ts" />

// @filename: test.py
//// a = 42
//// a.n[|/*marker1*/|]

// @ts-ignore
await helper.verifyCompletion('included', {
    marker1: {
        completions: [{ label: 'denominator' }, { label: 'imag' }, { label: 'numerator' }, { label: 'real' }],
    },
});
