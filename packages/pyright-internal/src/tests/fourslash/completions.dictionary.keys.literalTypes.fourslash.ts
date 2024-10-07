/// <reference path="typings/fourslash.d.ts" />

// @filename: literal_types.py
//// from typing import Mapping, Literal
////
//// d: Mapping[Literal["key", "key2"], int] = { "key" : 1 }
//// d[[|/*marker1*/|]]

// @filename: parameter_mapping.py
//// from typing import Mapping, Literal
////
//// def foo(d: Mapping[Literal["key", "key2"], int]):
////     d[[|/*marker2*/|]]

// @filename: literal_types_mixed.py
//// from typing import Mapping, Literal
////
//// d: Mapping[Literal["key", 1], int] = { "key" : 1 }
//// d[[|/*marker3*/|]]

// @filename: parameter_dict.py
//// from typing import Dict, Literal
////
//// def foo(d: Dict[Literal["key", "key2"], int]):
////     d[[|/*marker4*/|]]

// @filename: literal_types_boolean.py
//// from typing import Dict, Literal
////
//// d: Dict[Literal[True, False], int] = { True: 1, False: 2 }
////     d[[|/*marker5*/|]]

// @filename: literal_types_enum.py
//// from typing import Dict, Literal
//// from enum import Enum
////
//// class MyEnum(Enum):
////     red = 1
////     blue = 2
////
//// def foo(d: Dict[Literal[MyEnum.red, MyEum.blue], int]):
////     d[[|/*marker6/|]]

// @filename: literal_bytes.py
//// from typing import Mapping, Literal
////
//// d: Mapping[Literal[b"key", b"key2"], int] = { b"key" : 1 }
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
                {
                    label: '"key2"',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker1'), newText: '"key2"' },
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
                {
                    label: '"key2"',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker2'), newText: '"key2"' },
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
                {
                    label: '1',
                    kind: Consts.CompletionItemKind.Constant,
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
                {
                    label: 'True',
                    kind: Consts.CompletionItemKind.Constant,
                    detail: Consts.IndexValueDetail,
                },
                {
                    label: 'False',
                    kind: Consts.CompletionItemKind.Constant,
                    detail: Consts.IndexValueDetail,
                },
            ],
        },
        marker6: {
            completions: [
                {
                    label: 'MyEnum.red',
                    kind: Consts.CompletionItemKind.Constant,
                    detail: Consts.IndexValueDetail,
                },
                {
                    label: 'MyEnum.blue',
                    kind: Consts.CompletionItemKind.Constant,
                    detail: Consts.IndexValueDetail,
                },
            ],
        },
        marker7: {
            completions: [
                {
                    label: 'b"key"',
                    kind: Consts.CompletionItemKind.Constant,
                    detail: Consts.IndexValueDetail,
                },
                {
                    label: 'b"key2"',
                    kind: Consts.CompletionItemKind.Constant,
                    detail: Consts.IndexValueDetail,
                },
            ],
        },
    });
}
