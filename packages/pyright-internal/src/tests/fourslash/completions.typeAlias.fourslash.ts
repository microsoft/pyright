/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// AliasT = list[int]
//// x: AliasT[|/*marker1*/|]
//// y: AliasT = []
//// y[|/*marker2*/|]

// @ts-ignore
await helper.verifyCompletion('includes', 'markdown', {
    marker1: {
        completions: [
            {
                label: 'AliasT',
                kind: Consts.CompletionItemKind.Variable,
                documentation: '```python\nAliasT: type[list[int]]\n```',
            },
        ],
    },
    marker2: {
        completions: [
            {
                label: 'y',
                kind: Consts.CompletionItemKind.Variable,
                documentation: '```python\ny: AliasT\n```',
            },
        ],
    },
});
