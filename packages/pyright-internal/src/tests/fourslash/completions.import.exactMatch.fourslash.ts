/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// from testLib import [|/*marker1*/|]En[|/*marker2*/|]um[|/*marker3*/|]

// @filename: testLib.py
//// class Enum: pass
//// class EnumCheck: pass

// @ts-ignore
await helper.verifyCompletion('exact', 'markdown', {
    marker1: {
        completions: [
            { label: 'Enum', kind: Consts.CompletionItemKind.Class },
            { label: 'EnumCheck', kind: Consts.CompletionItemKind.Class },
        ],
    },
    marker2: {
        completions: [
            { label: 'Enum', kind: Consts.CompletionItemKind.Class },
            { label: 'EnumCheck', kind: Consts.CompletionItemKind.Class },
        ],
    },
    marker3: {
        completions: [
            { label: 'Enum', kind: Consts.CompletionItemKind.Class },
            { label: 'EnumCheck', kind: Consts.CompletionItemKind.Class },
        ],
    },
});
