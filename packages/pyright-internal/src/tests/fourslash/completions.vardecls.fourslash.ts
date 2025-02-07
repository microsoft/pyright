/// <reference path="typings/fourslash.d.ts" />

// @filename: test1.py
//// a/*marker1*/ = 1

// @filename: test2.py
//// a = 1
//// a/*marker2*/ = 1

// @filename: test3.py
//// if (a/*marker3*/:= 1): pass

// @filename: test4.py
//// a = 1
//// if (a/*marker4*/:= 1): pass

// @filename: test5.py
//// a = 1
//// a/*marker5*/ *= 1

// @filename: test6.py
//// a = 1
//// a/*marker6*/ *= 1

{
    helper.openFiles(helper.getMarkers().map((m) => m.fileName));

    // @ts-ignore
    await helper.verifyCompletion('excluded', 'markdown', {
        marker1: { completions: [{ label: 'a', kind: Consts.CompletionItemKind.Variable }] },
        marker3: { completions: [{ label: 'a', kind: Consts.CompletionItemKind.Variable }] },
    });

    // @ts-ignore
    await helper.verifyCompletion('included', 'markdown', {
        marker2: { completions: [{ label: 'a', kind: Consts.CompletionItemKind.Variable }] },
        marker4: { completions: [{ label: 'a', kind: Consts.CompletionItemKind.Variable }] },
        marker5: { completions: [{ label: 'a', kind: Consts.CompletionItemKind.Variable }] },
        marker6: { completions: [{ label: 'a', kind: Consts.CompletionItemKind.Variable }] },
    });
}
