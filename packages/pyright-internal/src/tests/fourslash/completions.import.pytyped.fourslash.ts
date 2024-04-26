// @filename: test_no_private_completions.py
//// import testLib.[|/*marker*/|]

// @filename: testLib/__init__.py
// @library: true
//// # empty

// @filename: testLib/__privateclass.py
// @library: true
//// class PrivateClass():
////     pass

// @filename: testLib/publicclass.py
// @library: true
//// class PublicClass():
////     pass

// @filename: testLib/py.typed
// @library: true
//// # has to contain something for file to be written

// @ts-ignore
await helper.verifyCompletion('exact', 'markdown', {
    marker: {
        completions: [
            {
                label: 'publicclass',
                kind: Consts.CompletionItemKind.Module,
            },
        ],
    },
});
