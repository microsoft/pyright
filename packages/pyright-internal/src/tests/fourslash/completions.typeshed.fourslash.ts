/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// from r/*marker*/

// @ts-ignore
await helper.verifyCompletion('included', 'markdown', {
    marker: { completions: [{ label: 'requests', kind: Consts.CompletionItemKind.Module }] },
});
