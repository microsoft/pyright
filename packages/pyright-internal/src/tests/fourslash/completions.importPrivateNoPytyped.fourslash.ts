// @filename: test_private_completions.py
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
