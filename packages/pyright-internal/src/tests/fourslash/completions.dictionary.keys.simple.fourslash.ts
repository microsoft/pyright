/// <reference path="typings/fourslash.d.ts" />

// @filename: simple_dict_expression.py
//// d = { "key" : 1 }
//// d[[|/*marker1*/|]]

// @filename: simple_dict_constructor.py
//// d = dict(key=1)
//// d[[|/*marker2*/|]]

// @filename: dict_expression_index.py
//// d = {}
//// d["key"] = 1
//// d[[|/*marker3*/|]]

// @filename: dict_constructor_index.py
//// d = dict()
//// d["key"] = 1
//// d[[|/*marker4*/|]]

// @filename: dict_expression_multiple_keys.py
//// d = { "key": 1, "key2": 2 }
//// d["key3"] = 3
//// d[[|/*marker5*/|]]

// @filename: dict_constructor_multiple_keys.py
//// d = dict(key=1, key2=2)
//// d["key3"] = 3
//// d[[|/*marker6*/|]]

// @filename: dict_expression_typeAnnotation.py
//// from typing import Mapping
//// d: Mapping[str, int] = { "key": 1}
//// d[[|/*marker7*/|]]

// @filename: dict_constructor_typeAnnotation.py
//// from typing import Mapping
//// d: Mapping[str, int] = dict(key=1)
//// d[[|/*marker8*/|]]

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
                    label: "'key'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker2'), newText: "'key'" },
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
                    label: '"key"',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker5'), newText: '"key"' },
                    detail: Consts.IndexValueDetail,
                },
                {
                    label: '"key2"',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker5'), newText: '"key2"' },
                    detail: Consts.IndexValueDetail,
                },
                {
                    label: '"key3"',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker5'), newText: '"key3"' },
                    detail: Consts.IndexValueDetail,
                },
            ],
        },
        marker6: {
            completions: [
                {
                    label: '"key"',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker6'), newText: '"key"' },
                    detail: Consts.IndexValueDetail,
                },
                {
                    label: '"key2"',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker6'), newText: '"key2"' },
                    detail: Consts.IndexValueDetail,
                },
                {
                    label: '"key3"',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker6'), newText: '"key3"' },
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
            ],
        },
        marker8: {
            completions: [
                {
                    label: "'key'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker8'), newText: "'key'" },
                    detail: Consts.IndexValueDetail,
                },
            ],
        },
    });
}
