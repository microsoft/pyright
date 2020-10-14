/// <reference path="fourslash.ts" />

// @filename: test.py
//// def method(param1=None, param2='active', param3=None):
////     pass
////
//// met/*marker1*/hod   /*marker2*/ (    /*marker3*/      param2 = 'test')

// @ts-ignore
await helper.verifyCompletion('excluded', 'markdown', {
    marker1: {
        completions: [{ label: 'param1', kind: undefined }],
    },
    marker2: {
        completions: [{ label: 'param1', kind: undefined }],
    },
});

// @ts-ignore
await helper.verifyCompletion('included', 'markdown', {
    marker3: {
        completions: [{ label: 'param1=', kind: Consts.CompletionItemKind.Variable }],
    },
});
