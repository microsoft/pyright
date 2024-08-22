/// <reference path="typings/fourslash.d.ts" />

// @filename: test1.py
//// [|/*import*/|][|Test/*marker*/|]

// @filename: test2.py
//// class Test:
////     pass

{
    const importRange = helper.getPositionRange('import');
    const markerRange = helper.getPositionRange('marker');

    // @ts-ignore
    await helper.verifyCompletion('included', 'plaintext', {
        marker: {
            completions: [
                {
                    label: 'Test',
                    kind: Consts.CompletionItemKind.Class,
                    documentation: 'from test2 import Test',
                    detail: 'Auto-import',
                    textEdit: { range: markerRange, newText: 'Test' },
                    additionalTextEdits: [{ range: importRange, newText: 'from test2 import Test\n\n\n' }],
                },
            ],
        },
    });
}
