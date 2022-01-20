// @filename: test_no_duplicate_tseries_completions.py
//// from testLib import [|t/*marker*/|]

// @filename: testLib/__init__.pyi
// @library: true
//// import tseries
//// __all__ =  ['tseries']

// @filename: testLib/tseries/__init__.pyi
// @library: true
//

// @ts-ignore
await helper.verifyCompletion('exact', 'markdown', {
    marker: {
        completions: [
            {
                label: 'tseries',
                kind: Consts.CompletionItemKind.Module,
            },
        ],
    },
});
