/// <reference path="fourslash.ts" />

// @filename: test.py
//// try:
////     pass
//// except NotImplemented[|/*marker1*/|]:
////     pass

// @ts-ignore
await helper.verifyCompletion('exact', 'markdown', {
    marker1: { completions: [{ label: 'NotImplementedError', kind: Consts.CompletionItemKind.Class }] },
});
