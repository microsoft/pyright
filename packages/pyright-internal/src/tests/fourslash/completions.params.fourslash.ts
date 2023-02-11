/// <reference path="fourslash.ts" />

// @filename: test.py
//// from typing import TypedDict, Unpack, Any
////
//// class Movie(TypedDict):
////     key1: str
////     key2: int
////
//// def method(param1=None, param2='active', param3=None):
////     pass
////
//// met/*marker1*/hod   /*marker2*/ (    /*marker3*/      param2 = 'test')
////
//// def method2(param1: int, **kwargs: Unpack[Movie]):
////     pass
////
//// method2(p/*marker4*/, k/*marker5*/)
////
//// def method3(param1: int, **kwargs: Any):
////     pass
////
//// method3(p/*marker6*/, k/*marker7*/)

// @ts-ignore
await helper.verifyCompletion('excluded', 'markdown', {
    marker1: {
        completions: [{ label: 'param1', kind: undefined }],
    },
    marker2: {
        completions: [{ label: 'param1', kind: undefined }],
    },
    marker4: {
        completions: [{ label: 'key1', kind: undefined }],
    },
    marker5: {
        completions: [{ label: 'param1', kind: undefined }],
    },
    marker7: {
        completions: [{ label: 'key1', kind: undefined }],
    },
});

// @ts-ignore
await helper.verifyCompletion('included', 'markdown', {
    marker3: {
        completions: [{ label: 'param1=', kind: Consts.CompletionItemKind.Variable }],
    },
    marker4: {
        completions: [{ label: 'param1=', kind: Consts.CompletionItemKind.Variable }],
    },
    marker5: {
        completions: [
            { label: 'key2=', kind: Consts.CompletionItemKind.Variable },
            { label: 'key1=', kind: Consts.CompletionItemKind.Variable },
        ],
    },
    marker6: {
        completions: [{ label: 'param1=', kind: Consts.CompletionItemKind.Variable }],
    },
});
