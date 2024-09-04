/// <reference path="typings/fourslash.d.ts" />

// @filename: test1.py
//// [|/*import*/|][|test/*marker*/|]

// @filename: test2.py
//// import testLib
//// import testLib.test1
//// import testLib.test2
//// a = testLib.test1.Test1()
//// b = testLib.test2.Test2()

// @filename: testLib/__init__.pyi
// @library: true
//// class Test:
////     pass

// @filename: testLib/test1.pyi
// @library: true
//// class Test1:
////     pass

// @filename: testLib/test2.pyi
// @library: true
//// class Test2:
////     pass

{
    const importRange = helper.getPositionRange('import');
    const markerRange = helper.getPositionRange('marker');

    // @ts-ignore
    await helper.verifyCompletion('included', 'markdown', {
        marker: {
            completions: [
                {
                    label: 'test1',
                    kind: Consts.CompletionItemKind.Module,
                    documentation: '```\nfrom testLib import test1\n```',
                    detail: 'Auto-import',
                    textEdit: { range: markerRange, newText: 'test1' },
                    additionalTextEdits: [{ range: importRange, newText: 'from testLib import test1\n\n\n' }],
                },
            ],
        },
    });
}
