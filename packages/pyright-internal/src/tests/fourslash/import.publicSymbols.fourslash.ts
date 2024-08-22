/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// [|/*import*/|][|MY_CONSTANT_VAR/*marker1*/|]
//// [|MyAliasList/*marker2*/|]
//// [|normal_variable/*marker3*/|]
//// [|MY_PROTECTED/*marker4*/|]
//// [|__MyAliasList/*marker5*/|]

// @filename: lib.py
//// MY_CONSTANT_VAR = 42
//// MyAliasList = list[int]
//// normal_variable = 1
//// _MY_PROTECTED2 = False
//// __MyAliasList = int

{
    const importRange = helper.getPositionRange('import');
    const marker1Range = helper.getPositionRange('marker1');
    const marker2Range = helper.getPositionRange('marker2');
    const marker4Range = helper.getPositionRange('marker4');

    // @ts-ignore
    await helper.verifyCompletion('exact', 'markdown', {
        marker1: {
            completions: [
                {
                    label: 'MY_CONSTANT_VAR',
                    kind: Consts.CompletionItemKind.Constant,
                    documentation: '```\nfrom lib import MY_CONSTANT_VAR\n```',
                    detail: 'Auto-import',
                    textEdit: { range: marker1Range, newText: 'MY_CONSTANT_VAR' },
                    additionalTextEdits: [{ range: importRange, newText: 'from lib import MY_CONSTANT_VAR\n\n\n' }],
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
                    textEdit: { range: marker2Range, newText: 'MyAliasList' },
                    additionalTextEdits: [{ range: importRange, newText: 'from lib import MyAliasList\n\n\n' }],
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
                    textEdit: { range: marker4Range, newText: '_MY_PROTECTED2' },
                    additionalTextEdits: [{ range: importRange, newText: 'from lib import _MY_PROTECTED2\n\n\n' }],
                },
            ],
        },
        marker5: { completions: [] },
    });
}
