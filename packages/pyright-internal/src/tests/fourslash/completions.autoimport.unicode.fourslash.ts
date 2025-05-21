/// <reference path="typings/fourslash.d.ts" />

// @filename: consume.py
//// [|/*import1*/|][|Ät/*marker1*/|]

// @filename: declare.py
//// class Äther: ...
//// class Ether: ...

{
    helper.openFiles(helper.getMarkers().map((m) => m.fileName));

    // @ts-ignore
    await helper.verifyCompletion('included', 'markdown', {
        marker1: {
            completions: [
                {
                    label: 'Äther',
                    kind: Consts.CompletionItemKind.Class,
                    documentation: '```\nfrom declare import Äther\n```',
                    detail: 'Auto-import',
                    textEdit: { range: helper.getPositionRange('marker1'), newText: 'Äther' },
                    additionalTextEdits: [
                        { range: helper.getPositionRange('import1'), newText: 'from declare import Äther\n\n\n' },
                    ],
                },
            ],
        },
    });
}
