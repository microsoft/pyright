/// <reference path="typings/fourslash.d.ts" />

// @filename: python/test.py
//// from d/*marker*/

// @filename: python/data_processing/__init__.py
//// #empty

// @filename: python/data_processing/create_fullname.py
//// #empty

// @ts-ignore
await helper.verifyCompletion('included', 'markdown', {
    marker: {
        completions: [{ label: 'data_processing', kind: Consts.CompletionItemKind.Module }],
    },
});
