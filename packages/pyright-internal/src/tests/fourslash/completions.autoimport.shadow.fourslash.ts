/// <reference path="typings/fourslash.d.ts" />

// @filename: test1.py
//// [|/*import*/|][|MyShadow/*marker*/|]

// @filename: test2.py
//// import testLib
//// a = testLib.MyShadow()
//// a.[|/*hover*/method|]()

// @filename: testLib/__init__.pyi
// @library: true
//// class MyShadow:
////     def method(self): ...

// @filename: testLib/__init__.py
// @library: true
//// class MyShadow:
////     def method(self):
////         'doc string'
////         pass

{
    // This will cause shadow file to be injected.
    helper.openFile(helper.getMarkerByName('hover').fileName);
    helper.verifyHover('markdown', {
        hover: '```python\n(method) def method() -> Unknown\n```\n---\ndoc string',
    });

    const importRange = helper.getPositionRange('import');
    const markerRange = helper.getPositionRange('marker');

    // @ts-ignore
    await helper.verifyCompletion('exact', 'markdown', {
        marker: {
            completions: [
                {
                    label: 'MyShadow',
                    kind: Consts.CompletionItemKind.Class,
                    documentation: '```\nfrom testLib import MyShadow\n```',
                    detail: 'Auto-import',
                    textEdit: { range: markerRange, newText: 'MyShadow' },
                    additionalTextEdits: [{ range: importRange, newText: 'from testLib import MyShadow\n\n\n' }],
                },
            ],
        },
    });
}
