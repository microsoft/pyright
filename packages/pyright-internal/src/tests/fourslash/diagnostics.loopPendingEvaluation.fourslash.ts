/// <reference path="typings/fourslash.d.ts" />

// The type of "d" is evaluated within the loop while the evaluation of "k"
// is pending. The type of "d" must not stay incomplete after the loop, or
// the diagnostics that depend on it are dropped.

// @filename: test.py
//// def func1(d: dict[str, str | None]):
////     for k in ["a"]:
////         assert k in d, k
////
////     d["a"].[|/*marker1*/upper|]()
////     d["b"].[|/*marker2*/upper|]()

helper.verifyDiagnostics({
    marker1: {
        category: 'error',
        message: '"upper" is not a known attribute of "None"',
    },
    marker2: {
        category: 'error',
        message: '"upper" is not a known attribute of "None"',
    },
});
