/// <reference path="typings/fourslash.d.ts" />

// @filename: test1.py
//// [|/*import*/|][|Test/*marker*/|]

// @filename: test2.py
//// import testLib

// @filename: testLib/__init__.pyi
// @library: true
//// class Test:
////     pass

{
    const importRange = helper.getPositionRange('import');
    const markerRange = helper.getPositionRange('marker');

    // @ts-ignore
    await helper.verifyCompletion('included', 'markdown', {
        marker: {
            completions: [
                {
                    label: 'Test',
                    kind: Consts.CompletionItemKind.Class,
                    documentation: '```\nfrom testLib import Test\n```',
                    detail: 'Auto-import',
                    textEdit: { range: markerRange, newText: 'Test' },
                    additionalTextEdits: [{ range: importRange, newText: 'from testLib import Test\n\n\n' }],
                },
            ],
        },
    });
}
