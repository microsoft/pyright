/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// def [|/*marker1*/|]
////
//// def d[|/*marker2*/|]
////
//// def d1[|/*marker3*/|]():
////     pass
////
//// async def [|/*marker4*/|]
////
//// async def a[|/*marker5*/|]
////
//// async def a1[|/*marker6*/|]():
////     pass
////
//// def method(x[|/*marker7*/|]):
////     pass
//// def method(x:[|/*marker8*/|]):
////     pass
////
//// def method(x, x2[|/*marker9*/|]):
////     pass
//// def method(x, x2:[|/*marker10*/|]):
////     pass

// @filename: test1.py
//// class A:
////     def a1[|/*marker11*/|]
////
////     def a2[|/*marker12*/|]():
////         pass
////
////     def method(x[|/*marker13*/|]):
////         pass
////     def method(x:[|/*marker14*/|]):
////         pass
////
////     def method(x, x2[|/*marker15*/|]):
////         pass
////     def method(x, x2:[|/*marker16*/|]):
////         pass

{
    helper.openFiles(helper.getMarkers().map((m) => m.fileName));

    // @ts-ignore
    await helper.verifyCompletion('exact', 'markdown', {
        marker1: { completions: [] },
        marker2: { completions: [] },
        marker3: { completions: [] },
        marker4: { completions: [] },
        marker5: { completions: [] },
        marker6: { completions: [] },
        marker7: { completions: [] },
        marker9: { completions: [] },
        marker11: { completions: [] },
        marker12: { completions: [] },
        marker13: { completions: [] },
        marker15: { completions: [] },
    });

    // @ts-ignore
    await helper.verifyCompletion('included', 'markdown', {
        marker8: { completions: [{ label: 'str', kind: Consts.CompletionItemKind.Class }] },
        marker10: { completions: [{ label: 'str', kind: Consts.CompletionItemKind.Class }] },
        marker14: { completions: [{ label: 'str', kind: Consts.CompletionItemKind.Class }] },
        marker16: { completions: [{ label: 'str', kind: Consts.CompletionItemKind.Class }] },
    });
}
