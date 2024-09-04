/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// from submodule.[|/*marker1*/|]

// @filename: pyrightconfig.json
//// {
////   "extraPaths": ["submodule"]
//// }

// @filename: submodule/submodule/__init__.py
////

// @filename: submodule/submodule/submodule1.py
//// def test_function():
////     pass

// @filename: submodule/setup.py
////

// @ts-ignore
await helper.verifyCompletion('exact', 'markdown', {
    marker1: {
        completions: [{ label: 'submodule1', kind: Consts.CompletionItemKind.Module }],
    },
});
