/// <reference path="fourslash.ts" />

// @filename: test.py
//// import time
//// time.lo[|/*marker1*/|]
//// aaaaaa = 100
//// aaaa[|/*marker2*/|]
//// def some_func1(a):
////     '''some function docs'''
////     pass
//// def some_func2(a):
////     '''another function docs'''
////     pass
//// some_fun[|/*marker3*/|]

helper.verifyCompletion('exact', {
    marker1: { completions: [{ label: 'localtime' }] },
    marker2: { completions: [{ label: 'aaaaaa' }] },
    marker3: {
        completions: [
            {
                label: 'some_func1',
                documentation: {
                    kind: 'markdown',
                    value: '```python\nsome_func1: (a) -> None\n```\n---\nsome function docs',
                },
            },
            {
                label: 'some_func2',
                documentation: {
                    kind: 'markdown',
                    value: '```python\nsome_func2: (a) -> None\n```\n---\nanother function docs',
                },
            },
        ],
    },
});
