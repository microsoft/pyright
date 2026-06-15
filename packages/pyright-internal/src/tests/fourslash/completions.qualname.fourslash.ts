/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// class A:
////     pass
////
//// a = A()
//// a.__[|/*instanceMarker*/|]
//// A.__[|/*classMarker*/|]

{
    helper.openFiles(helper.getMarkers().map((m) => m.fileName));

    // `__qualname__` is exposed via the metaclass (`type`), so it is a valid
    // member of the class object but not of an instance.
    // @ts-ignore
    await helper.verifyCompletion('excluded', 'markdown', {
        instanceMarker: {
            completions: [{ label: '__qualname__', kind: Consts.CompletionItemKind.Variable }],
        },
    });

    // @ts-ignore
    await helper.verifyCompletion('included', 'markdown', {
        instanceMarker: {
            completions: [
                { label: '__doc__', kind: Consts.CompletionItemKind.Variable },
                { label: '__module__', kind: Consts.CompletionItemKind.Variable },
            ],
        },
        classMarker: {
            completions: [{ label: '__qualname__', kind: Consts.CompletionItemKind.Variable }],
        },
    });
}
