/// <reference path="typings/fourslash.d.ts" />

// @filename: module.py
//// # empty

// @filename: nested1/__init__.py
//// # empty

// @filename: nested1/module.py
//// # empty

// @filename: nested1/nested2/__init__.py
//// # empty

// @filename: nested1/nested2/test1.py
//// from .[|/*marker1*/|]

// @filename: nested1/nested2/test2.py
//// from ..[|/*marker2*/|]

// @filename: nested1/nested2/test3.py
//// from ..nested2.[|/*marker3*/|]

// @filename: nested1/nested2/test4.py
//// from ...nested1.[|/*marker4*/|]

// @filename: nested1/nested2/test5.py
//// from ...nested1.nested2.[|/*marker5*/|]

{
    helper.openFiles(helper.getMarkers().map((m) => m.fileName));

    // @ts-ignore
    await helper.verifyCompletion('exact', 'markdown', {
        marker1: {
            completions: [
                { label: 'import', kind: Consts.CompletionItemKind.Keyword },
                { label: 'test1', kind: Consts.CompletionItemKind.Module },
                { label: 'test2', kind: Consts.CompletionItemKind.Module },
                { label: 'test3', kind: Consts.CompletionItemKind.Module },
                { label: 'test4', kind: Consts.CompletionItemKind.Module },
                { label: 'test5', kind: Consts.CompletionItemKind.Module },
            ],
        },
        marker2: {
            completions: [
                { label: 'import', kind: Consts.CompletionItemKind.Keyword },
                { label: 'nested2', kind: Consts.CompletionItemKind.Module },
                { label: 'module', kind: Consts.CompletionItemKind.Module },
            ],
        },
        marker3: {
            completions: [
                { label: 'test1', kind: Consts.CompletionItemKind.Module },
                { label: 'test2', kind: Consts.CompletionItemKind.Module },
                { label: 'test3', kind: Consts.CompletionItemKind.Module },
                { label: 'test4', kind: Consts.CompletionItemKind.Module },
                { label: 'test5', kind: Consts.CompletionItemKind.Module },
            ],
        },
        marker4: {
            completions: [
                { label: 'nested2', kind: Consts.CompletionItemKind.Module },
                { label: 'module', kind: Consts.CompletionItemKind.Module },
            ],
        },
        marker5: {
            completions: [
                { label: 'test1', kind: Consts.CompletionItemKind.Module },
                { label: 'test2', kind: Consts.CompletionItemKind.Module },
                { label: 'test3', kind: Consts.CompletionItemKind.Module },
                { label: 'test4', kind: Consts.CompletionItemKind.Module },
                { label: 'test5', kind: Consts.CompletionItemKind.Module },
            ],
        },
    });
}
