/// <reference path="typings/fourslash.d.ts" />

// @filename: string_literals_with_symbols.py
//// d = { "key-1" : 1 }
//// d[[|"/*marker1*/"|]]

// @filename: string_literals_with_symbols2.py
//// d = { "key\"yo\"" : 1 }
//// d[[|"/*marker2*/"|]]

// @filename: string_literals_duplicates.py
//// d = { "hello" : 1 }
//// d["hello"] = 2
////
//// d[[|"/*marker3*/"|]]

{
    helper.openFiles(helper.getMarkers().map((m) => m.fileName));

    // @ts-ignore
    await helper.verifyCompletion('exact', 'markdown', {
        marker1: {
            completions: [
                {
                    label: '"key-1"',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker1'), newText: '"key-1"' },
                    detail: Consts.IndexValueDetail,
                },
            ],
        },
        marker2: {
            completions: [
                {
                    label: '"key\\"yo\\""',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker2'), newText: '"key\\"yo\\""' },
                    detail: Consts.IndexValueDetail,
                },
            ],
        },
        marker3: {
            completions: [
                {
                    label: '"hello"',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: helper.getPositionRange('marker3'), newText: '"hello"' },
                    detail: Consts.IndexValueDetail,
                },
            ],
        },
    });
}
