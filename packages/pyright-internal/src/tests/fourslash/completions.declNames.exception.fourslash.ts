/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// try:
////     pass
//// except ZeroDivisionError as d[|/*marker1*/|]:
////     pass
////
//// try:
////     pass
//// except ZeroDivisionError as [|/*marker2*/|]:
////     pass

// @ts-ignore
await helper.verifyCompletion('exact', 'markdown', {
    marker1: { completions: [] },
    marker2: { completions: [] },
});
