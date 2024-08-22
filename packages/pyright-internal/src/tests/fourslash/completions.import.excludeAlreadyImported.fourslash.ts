/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// from testLib import Enum, Enu[|/*marker1*/|]

// @filename: testLib.py
//// class Enum: pass
//// class EnumCheck: pass

// @ts-ignore
await helper.verifyCompletion('exact', 'markdown', {
    marker1: {
        completions: [{ label: 'EnumCheck', kind: Consts.CompletionItemKind.Class }],
    },
});
