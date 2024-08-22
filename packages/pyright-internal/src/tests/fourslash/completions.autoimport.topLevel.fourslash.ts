/// <reference path="typings/fourslash.d.ts" />

// @filename: test1.py
//// [|/*import1*/|][|os/*marker1*/|]

// @filename: test2.py
//// [|/*import2*/|][|sys/*marker2*/|]

// @filename: test3.py
//// import os
//// import sys
//// a = os.path
//// b = sys.path

{
    helper.openFile('/test1.py');

    const import1Range = helper.getPositionRange('import1');
    const marker1Range = helper.getPositionRange('marker1');

    // @ts-ignore
    await helper.verifyCompletion('included', 'markdown', {
        marker1: {
            completions: [
                {
                    label: 'os',
                    kind: Consts.CompletionItemKind.Module,
                    documentation: '```\nimport os\n```',
                    detail: 'Auto-import',
                    textEdit: { range: marker1Range, newText: 'os' },
                    additionalTextEdits: [{ range: import1Range, newText: 'import os\n\n\n' }],
                },
            ],
        },
    });

    helper.openFile('/test2.py');

    const import2Range = helper.getPositionRange('import2');
    const marker2Range = helper.getPositionRange('marker2');

    // @ts-ignore
    await helper.verifyCompletion('included', 'markdown', {
        marker2: {
            completions: [
                {
                    label: 'sys',
                    kind: Consts.CompletionItemKind.Module,
                    documentation: '```\nimport sys\n```',
                    detail: 'Auto-import',
                    textEdit: { range: marker2Range, newText: 'sys' },
                    additionalTextEdits: [{ range: import2Range, newText: 'import sys\n\n\n' }],
                },
            ],
        },
    });
}
