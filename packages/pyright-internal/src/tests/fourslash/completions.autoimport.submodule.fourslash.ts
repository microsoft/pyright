/// <reference path="typings/fourslash.d.ts" />

// @filename: test1.py
//// [|/*import1*/|]from os.path import dirname
//// [|path/*marker1*/|]

// @filename: test2.py
//// import os
//// a = os.path

{
    helper.openFiles(helper.getMarkers().map((m) => m.fileName));

    // @ts-ignore
    await helper.verifyCompletion('included', 'markdown', {
        marker1: {
            completions: [
                {
                    label: 'path',
                    kind: Consts.CompletionItemKind.Variable,
                    documentation: '```\nfrom os import path\n```',
                    detail: 'Auto-import',
                    textEdit: { range: helper.getPositionRange('marker1'), newText: 'path' },
                    additionalTextEdits: [
                        { range: helper.getPositionRange('import1'), newText: 'from os import path\n' },
                    ],
                },
            ],
        },
    });
}
