/// <reference path="typings/fourslash.d.ts" />

// @filename: test1.py
//// Test[|/*marker*/|]

// @filename: testLib/__init__.pyi
// @library: true
//// class Test:
////     pass

// @ts-ignore
await helper.verifyCompletion('excluded', 'markdown', {
    marker: { completions: [{ label: 'Test', kind: undefined }] },
});
