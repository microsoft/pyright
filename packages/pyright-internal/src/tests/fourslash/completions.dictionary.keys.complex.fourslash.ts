/// <reference path="typings/fourslash.d.ts" />

// @filename: dict_key_complex.py
//// d = { "key" : 1 }
////
//// if (len(d) > 0):
////     d["ifKey"] = 2
////
//// def foo():
////     d["capturedKey"] = 3
////
//// class C:
////     def method(self):
////         d["capturedInsideOfMethod"] = 4
////
//// d = dict(reassignedKey=5)
////
//// d[[|/*marker1*/|]]

// @filename: dict_expression_symbol.py
//// keyString = "key"
//// d = { keyString : 1 }
//// d[k/*marker2*/]

{
    helper.openFiles(helper.getMarkers().map((m) => m.fileName));

    // @ts-ignore
    await helper.verifyCompletion('included', 'markdown', {
        marker1: {
            completions: [
                {
                    label: '"key"',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker1'), newText: '"key"' },
                    detail: Consts.IndexValueDetail,
                },
                {
                    label: '"ifKey"',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker1'), newText: '"ifKey"' },
                    detail: Consts.IndexValueDetail,
                },
                {
                    label: '"capturedKey"',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker1'), newText: '"capturedKey"' },
                    detail: Consts.IndexValueDetail,
                },
                {
                    label: '"capturedInsideOfMethod"',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker1'), newText: '"capturedInsideOfMethod"' },
                    detail: Consts.IndexValueDetail,
                },
                {
                    label: '"reassignedKey"',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker1'), newText: '"reassignedKey"' },
                    detail: Consts.IndexValueDetail,
                },
            ],
        },
        marker2: {
            completions: [{ label: 'keyString', kind: Consts.CompletionItemKind.Variable }],
        },
    });

    // @ts-ignore
    await helper.verifyCompletion('excluded', 'markdown', {
        marker2: {
            // Regular symbol should over take dict key.
            completions: [{ label: 'keyString', kind: Consts.CompletionItemKind.Constant }],
        },
    });
}
