/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// import time
//// time.gm[|/*marker1*/|]
//// aaaaaa = 100
//// aaaaa[|/*marker2*/|]
//// def some_func1(a):
////     '''some function docs'''
////     pass
//// def some_func2(a):
////     '''another function docs'''
////     pass
//// some_fun[|/*marker3*/|]
//// unknownVariable.[|/*marker4*/|]

// @ts-ignore
await helper.verifyCompletion('exact', 'markdown', {
    marker1: {
        completions: [
            {
                label: 'gmtime',
                kind: Consts.CompletionItemKind.Function,
            },
            {
                label: 'clock_gettime',
                kind: Consts.CompletionItemKind.Function,
            },
            {
                label: 'clock_gettime_ns',
                kind: Consts.CompletionItemKind.Function,
            },
        ],
    },
    marker2: { completions: [{ label: 'aaaaaa', kind: Consts.CompletionItemKind.Variable }] },
    marker3: {
        completions: [
            {
                label: 'some_func1',
                kind: Consts.CompletionItemKind.Function,
                documentation: '```python\ndef some_func1(a: Unknown) -> None\n```\n---\nsome function docs',
            },
            {
                label: 'some_func2',
                kind: Consts.CompletionItemKind.Function,
                documentation: '```python\ndef some_func2(a: Unknown) -> None\n```\n---\nanother function docs',
            },
        ],
    },
    marker4: { completions: [] },
});
