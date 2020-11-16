/// <reference path="fourslash.ts" />

// @filename: test.py
//// MY_CONSTANT_VAR[|/*marker1*/|]
//// MyAliasList[|/*marker2*/|]
//// normal_variable[|/*marker3*/|]
//// MY_PROTECTED[|/*marker4*/|]
//// __MyAliasList[|/*marker5*/|]

// @filename: lib.py
//// MY_CONSTANT_VAR = 42
//// MyAliasList = list[int]
//// normal_variable = 1
//// _MY_PROTECTED2 = False
//// __MyAliasList = int

// @ts-ignore
await helper.verifyCompletion('exact', 'markdown', {
    marker1: {
        completions: [
            {
                label: 'MY_CONSTANT_VAR',
                kind: Consts.CompletionItemKind.Constant,
                documentation: '```\nfrom lib import MY_CONSTANT_VAR\n```',
                detail: 'Auto-import',
            },
        ],
    },
    marker2: {
        completions: [
            {
                label: 'MyAliasList',
                kind: Consts.CompletionItemKind.Variable,
                documentation: '```\nfrom lib import MyAliasList\n```',
                detail: 'Auto-import',
            },
        ],
    },
    marker3: { completions: [] },
    marker4: {
        // Protected variables SHOULD be added
        completions: [
            {
                label: '_MY_PROTECTED2',
                kind: Consts.CompletionItemKind.Constant,
                documentation: '```\nfrom lib import _MY_PROTECTED2\n```',
                detail: 'Auto-import',
            },
        ],
    },
    marker5: { completions: [] },
});
