/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// from unittest.mock import patch
//// def some_func():
////     pass
//// with patch('some_func') as[|/*marker1*/|] a1:
////     pass
//// with patch('some_func') as   [|/*marker2*/|] a1:
////     pass
//// with patch('some_func') as a[|/*marker3*/|]2:
////     pass
//// with patch[|/*marker4*/|]('some_func'):
////     pass

// @ts-ignore
await helper.verifyCompletion('exact', 'markdown', {
    marker1: { completions: [] },
    marker2: { completions: [] },
    marker3: { completions: [] },
});

// @ts-ignore
await helper.verifyCompletion('included', 'markdown', {
    marker4: { completions: [{ label: 'patch', kind: Consts.CompletionItemKind.Variable }] },
});
