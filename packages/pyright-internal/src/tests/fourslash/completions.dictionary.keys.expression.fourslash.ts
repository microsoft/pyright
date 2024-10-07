/// <reference path="typings/fourslash.d.ts" />

// @filename: dict_expression_number.py
//// d = { 1: 1 }
//// d[2] = 1
//// d[/*marker1*/]

// @filename: dict_expression_tuple.py
//// d = { (1, 2): 1 }
//// d[(2, 3)] = 1
//// d[/*marker2*/]

// @filename: dict_expression_key_expression.py
//// d = { 1 + 2: 1 }
//// d[2 + 3] = 1
//// d[/*marker3*/]

// @filename: dict_expression_partial_expression.py
//// d = { "key" : 1 }
//// d["key2"] = 1
//// d[[|key/*marker4*/|]]

// @filename: dict_expression_complex_key.py
//// class C:
////     key = "name"
////
//// d = { C.key : 1 }
//// d[key/*marker5*/]

{
    helper.openFiles(helper.getMarkers().map((m) => m.fileName));

    // @ts-ignore
    await helper.verifyCompletion('included', 'markdown', {
        marker1: {
            completions: [
                { label: '1', kind: Consts.CompletionItemKind.Constant, detail: Consts.IndexValueDetail },
                { label: '2', kind: Consts.CompletionItemKind.Constant, detail: Consts.IndexValueDetail },
            ],
        },
        marker2: {
            completions: [
                { label: '(1, 2)', kind: Consts.CompletionItemKind.Constant, detail: Consts.IndexValueDetail },
                { label: '(2, 3)', kind: Consts.CompletionItemKind.Constant, detail: Consts.IndexValueDetail },
            ],
        },
        marker3: {
            completions: [
                { label: '1 + 2', kind: Consts.CompletionItemKind.Constant, detail: Consts.IndexValueDetail },
                { label: '2 + 3', kind: Consts.CompletionItemKind.Constant, detail: Consts.IndexValueDetail },
            ],
        },
        marker4: {
            completions: [
                {
                    label: '"key"',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker4'), newText: '"key"' },
                    detail: Consts.IndexValueDetail,
                },
                {
                    label: '"key2"',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker4'), newText: '"key2"' },
                    detail: Consts.IndexValueDetail,
                },
            ],
        },
        marker5: {
            completions: [
                { label: 'C.key', kind: Consts.CompletionItemKind.Constant, detail: Consts.IndexValueDetail },
            ],
        },
    });
}
