/// <reference path="typings/fourslash.d.ts" />

// @filename: pyrightconfig.json
//// {
////   "executionEnvironments": [
////     { "root": "python33", "pythonVersion": "3.3" },
////     { "root": "python35", "pythonVersion": "3.5" },
////     { "root": "python310", "pythonVersion": "3.10" },
////   ]
//// }

// @filename: python33/test.py
//// def foo():
////     [|/*python33*/|]

// @filename: python35/test.py
//// def foo():
////     [|/*python35*/|]

// @filename: python310/test.py
//// def foo():
////     [|/*python310*/|]

{
    helper.openFiles(helper.getMarkers().map((m) => m.fileName));

    // @ts-ignore
    await helper.verifyCompletion('included', 'markdown', {
        python33: {
            completions: [
                { label: 'def', kind: Consts.CompletionItemKind.Keyword },
                { label: 'import', kind: Consts.CompletionItemKind.Keyword },
            ],
        },
        python35: {
            completions: [
                { label: 'def', kind: Consts.CompletionItemKind.Keyword },
                { label: 'import', kind: Consts.CompletionItemKind.Keyword },
                { label: 'async', kind: Consts.CompletionItemKind.Keyword },
                { label: 'await', kind: Consts.CompletionItemKind.Keyword },
            ],
        },
        python310: {
            completions: [
                { label: 'def', kind: Consts.CompletionItemKind.Keyword },
                { label: 'import', kind: Consts.CompletionItemKind.Keyword },
                { label: 'async', kind: Consts.CompletionItemKind.Keyword },
                { label: 'await', kind: Consts.CompletionItemKind.Keyword },
                { label: 'case', kind: Consts.CompletionItemKind.Keyword },
                { label: 'match', kind: Consts.CompletionItemKind.Keyword },
            ],
        },
    });

    // @ts-ignore
    await helper.verifyCompletion('excluded', 'markdown', {
        python33: {
            completions: [
                { label: 'async', kind: Consts.CompletionItemKind.Keyword },
                { label: 'await', kind: Consts.CompletionItemKind.Keyword },
                { label: 'case', kind: Consts.CompletionItemKind.Keyword },
                { label: 'match', kind: Consts.CompletionItemKind.Keyword },
            ],
        },
        python35: {
            completions: [
                { label: 'case', kind: Consts.CompletionItemKind.Keyword },
                { label: 'match', kind: Consts.CompletionItemKind.Keyword },
            ],
        },
    });
}
