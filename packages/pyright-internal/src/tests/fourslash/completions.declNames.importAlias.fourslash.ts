/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// import os as o[|/*marker1*/|]
//// import os as [|/*marker2*/|]
//// from os import path as p[|/*marker3*/|]
//// from os import path as [|/*marker4*/|]

// @ts-ignore
await helper.verifyCompletion('exact', 'markdown', {
    marker1: { completions: [] },
    marker2: { completions: [] },
    marker3: { completions: [] },
    marker4: { completions: [] },
});
