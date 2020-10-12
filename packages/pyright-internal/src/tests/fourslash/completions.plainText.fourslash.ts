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

// @ts-ignore
await helper.verifyCompletion('exact', 'plaintext', {
    marker1: { completions: [{ label: 'localtime' }] },
    marker2: { completions: [{ label: 'aaaaaa' }] },
    marker3: {
        completions: [
            {
                label: 'some_func1',
                documentation: 'some_func1: (a: Unknown) -> None\n\nsome function docs',
            },
            {
                label: 'some_func2',
                documentation: 'some_func2: (a: Unknown) -> None\n\nanother function docs',
            },
        ],
    },
});
