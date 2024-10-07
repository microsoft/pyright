/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// from lib import (
////     [|/*import1*/|]MY_CONST_VAR[|/*import2*/|],
////     ClsOther[|/*import3*/|],
////     my_afunc[|/*import4*/|],
//// )
////
//// [|A_CONST/*marker1*/|]
//// [|MY_CONST_VAR2/*marker2*/|]
//// [|Cls/*marker3*/|]
//// [|ClsList/*marker4*/|]
//// [|my_func/*marker5*/|]
//// [|MYA_CONST_VAR/*marker6*/|]
//// [|MY_CONSTA_VAR/*marker7*/|]

// @filename: lib.py
//// A_CONST = 1
//// MY_CONST_VAR = 2
//// MY_CONST_VAR2 = 3
//// MY_CONSTA_VAR = 4
//// MYA_CONST_VAR = 4
//// class Cls: ...
//// class ClsOther: ...
//// ClsOtherList = list[ClsOther]
//// def my_afunc(): ...
//// def my_func(): ...

{
    const import1Range = helper.getPositionRange('import1');
    const import2Range = helper.getPositionRange('import2');
    const import3Range = helper.getPositionRange('import3');
    const import4Range = helper.getPositionRange('import4');
    const marker1Range = helper.getPositionRange('marker1');
    const marker2Range = helper.getPositionRange('marker2');
    const marker3Range = helper.getPositionRange('marker3');
    const marker4Range = helper.getPositionRange('marker4');
    const marker5Range = helper.getPositionRange('marker5');
    const marker6Range = helper.getPositionRange('marker6');
    const marker7Range = helper.getPositionRange('marker7');

    // @ts-ignore
    await helper.verifyCompletion('included', 'markdown', {
        marker1: {
            completions: [
                {
                    label: 'A_CONST',
                    kind: Consts.CompletionItemKind.Constant,
                    documentation: '```\nfrom lib import A_CONST\n```',
                    detail: 'Auto-import',
                    textEdit: { range: marker1Range, newText: 'A_CONST' },
                    additionalTextEdits: [{ range: import1Range, newText: 'A_CONST,\n    ' }],
                },
            ],
        },
        marker2: {
            completions: [
                {
                    label: 'MY_CONST_VAR2',
                    kind: Consts.CompletionItemKind.Constant,
                    documentation: '```\nfrom lib import MY_CONST_VAR2\n```',
                    detail: 'Auto-import',
                    textEdit: { range: marker2Range, newText: 'MY_CONST_VAR2' },
                    additionalTextEdits: [{ range: import2Range, newText: ',\n    MY_CONST_VAR2' }],
                },
            ],
        },
        marker3: {
            completions: [
                {
                    label: 'Cls',
                    kind: Consts.CompletionItemKind.Class,
                    documentation: '```\nfrom lib import Cls\n```',
                    detail: 'Auto-import',
                    textEdit: { range: marker3Range, newText: 'Cls' },
                    additionalTextEdits: [{ range: import2Range, newText: ',\n    Cls' }],
                },
            ],
        },
        marker4: {
            completions: [
                {
                    label: 'ClsOtherList',
                    kind: Consts.CompletionItemKind.Variable,
                    documentation: '```\nfrom lib import ClsOtherList\n```',
                    detail: 'Auto-import',
                    textEdit: { range: marker4Range, newText: 'ClsOtherList' },
                    additionalTextEdits: [{ range: import3Range, newText: ',\n    ClsOtherList' }],
                },
            ],
        },
        marker5: {
            completions: [
                {
                    label: 'my_func',
                    kind: Consts.CompletionItemKind.Function,
                    documentation: '```\nfrom lib import my_func\n```',
                    detail: 'Auto-import',
                    textEdit: { range: marker5Range, newText: 'my_func' },
                    additionalTextEdits: [{ range: import4Range, newText: ',\n    my_func' }],
                },
            ],
        },
        marker6: {
            completions: [
                {
                    label: 'MYA_CONST_VAR',
                    kind: Consts.CompletionItemKind.Constant,
                    documentation: '```\nfrom lib import MYA_CONST_VAR\n```',
                    detail: 'Auto-import',
                    textEdit: { range: marker6Range, newText: 'MYA_CONST_VAR' },
                    additionalTextEdits: [{ range: import2Range, newText: ',\n    MYA_CONST_VAR' }],
                },
            ],
        },
        marker7: {
            completions: [
                {
                    label: 'MY_CONSTA_VAR',
                    kind: Consts.CompletionItemKind.Constant,
                    documentation: '```\nfrom lib import MY_CONSTA_VAR\n```',
                    detail: 'Auto-import',
                    textEdit: { range: marker7Range, newText: 'MY_CONSTA_VAR' },
                    additionalTextEdits: [{ range: import2Range, newText: ',\n    MY_CONSTA_VAR' }],
                },
            ],
        },
    });
}
