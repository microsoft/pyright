/// <reference path="typings/fourslash.d.ts" />

// @filename: string_literals.py
//// d = { "key" : 1 }
//// d[[|"/*marker1*/"|]]

// @filename: dict_constructor.py
//// d = dict(key=1)
//// d[[|"/*marker2*/"|]]

// @filename: dict_key_no_end.py
//// d = { "key": 1 }
//// d[[|"/*marker3*/|]]

// @filename: dict_key_partial.py
//// d = dict(key=1)
//// d[[|"k/*marker4*/"|]]

// @filename: dict_key_stringLiteralsOnly.py
//// name = "key"
//// d = { name: 1 }
//// d["key2"] = 2
//// d[[|/*marker5*/|]]

// @filename: dict_key_name_conflicts.py
//// keyString = "key"
//// d = dict(keyString=1)
//// d[[|keyStr/*marker6*/|]]

// @filename: dict_key_mixed_literals.py
//// d = { "key": 1, 1 + 2: 1 }
//// d[[|/*marker7*/|]]

{
    helper.openFiles(helper.getMarkers().map((m) => m.fileName));

    // @ts-ignore
    await helper.verifyCompletion('exact', 'markdown', {
        marker1: {
            completions: [
                {
                    label: '"key"',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker1'), newText: '"key"' },
                    detail: Consts.IndexValueDetail,
                },
            ],
        },
        marker2: {
            completions: [
                {
                    label: '"key"',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker2'), newText: '"key"' },
                    detail: Consts.IndexValueDetail,
                },
            ],
        },
        marker3: {
            completions: [
                {
                    label: '"key"',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker3'), newText: '"key"' },
                    detail: Consts.IndexValueDetail,
                },
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
            ],
        },
        marker5: {
            completions: [
                {
                    label: 'name',
                    kind: Consts.CompletionItemKind.Constant,
                    detail: Consts.IndexValueDetail,
                },
                {
                    label: '"key2"',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker5'), newText: '"key2"' },
                    detail: Consts.IndexValueDetail,
                },
            ],
        },
        marker6: {
            completions: [
                { label: 'keyString', kind: Consts.CompletionItemKind.Variable },
                {
                    label: '"keyString"',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker6'), newText: '"keyString"' },
                    detail: Consts.IndexValueDetail,
                },
            ],
        },
        marker7: {
            completions: [
                {
                    label: '"key"',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker7'), newText: '"key"' },
                    detail: Consts.IndexValueDetail,
                },
                {
                    label: '1 + 2',
                    kind: Consts.CompletionItemKind.Constant,
                    detail: Consts.IndexValueDetail,
                },
            ],
        },
    });
}
