/// <reference path="typings/fourslash.d.ts" />

// @filename: testList.py
//// a = 42
//// x = [
////     a.[|/*marker1*/|]
//// ]

// @filename: testListWithCall.py
//// b = 42
//// y = [
////     print(b.[|/*marker2*/|])
//// ]

// @filename: testListWithCallMissingClosedParens.py
//// b = 42
//// y = [
////     print(b.[|/*marker3*/|]
//// ]
{
    helper.openFiles(helper.getMarkers().map((m) => m.fileName)); // @ts-ignore
    await helper.verifyCompletion('included', 'markdown', {
        marker1: {
            completions: [{ label: 'numerator', kind: Consts.CompletionItemKind.Property }],
        },
        marker2: {
            completions: [{ label: 'numerator', kind: Consts.CompletionItemKind.Property }],
        },
        marker3: {
            completions: [{ label: 'numerator', kind: Consts.CompletionItemKind.Property }],
        },
    });
}
