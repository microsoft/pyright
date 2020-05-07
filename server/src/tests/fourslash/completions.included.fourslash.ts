/// <reference path="fourslash.ts" />
// @asynctest: true

// @filename: test.py
//// a = 42
//// a.n[|/*marker1*/|]

helper.verifyCompletion('included', {
    marker1: {
        completions: [{ label: 'denominator' }, { label: 'imag' }, { label: 'numerator' }, { label: 'real' }],
    },
});
