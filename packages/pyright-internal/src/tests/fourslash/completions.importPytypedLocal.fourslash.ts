// @filename: test_no_private_completions.py
//// import testLib.[|/*marker*/|]

// @filename: testLib/__init__.py
//// # empty

// @filename: testLib/__privateclass.py
//// class PrivateClass():
////     pass

// @filename: testLib/publicclass.py
//// class PublicClass():
////     pass

// @filename: testLib/py.typed
//// # has to contain something for file to be written

// @ts-ignore
await helper.verifyCompletion('exact', 'markdown', {
    marker: {
        completions: [
            {
                label: 'publicclass',
                kind: Consts.CompletionItemKind.Module,
            },
            {
                label: '__privateclass',
                kind: Consts.CompletionItemKind.Module,
            },
        ],
    },
});
