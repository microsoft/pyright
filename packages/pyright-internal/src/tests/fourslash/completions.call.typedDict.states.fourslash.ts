/// <reference path="fourslash.ts" />

// @filename: test.py
//// from typing import TypedDict
////
//// class Movie(TypedDict):
////     name: str
////     age: int
////
//// def thing(movie: Movie):
////     pass
////
//// thing(movie={'foo': 'a', '[|/*marker1*/|]'})
//// thing(movie={'foo': 'a', 'a[|/*marker2*/|]'})
//// thing(
////     movie={
////        'name': 'Parasite',
////        '[|/*marker3*/|]
////     }
//// )
//// thing(
////     movie={
////        'name': 'Parasite',
////        '[|/*marker4*/|]'
////     }
//// )
//// thing({
////     'name': 'Parasite',
////     # hello world
////     '[|/*marker5*/|]'
//// })
//// thing({'foo': '[|/*marker6*/|]'})

{
    // completions that rely on token parsing instead of node parsing
    const marker1Range = helper.getStringPositionRange('marker1');
    const marker2Range = helper.getStringPositionRange('marker2', /* start */ 2);
    const marker3Range = helper.getStringPositionRange('marker3', /* start */ 1, /* end */ 0);
    const marker4Range = helper.getStringPositionRange('marker4');
    const marker5Range = helper.getStringPositionRange('marker5');

    // @ts-ignore
    await helper.verifyCompletion('exact', 'markdown', {
        marker1: {
            completions: [
                {
                    label: "'name'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: marker1Range, newText: "'name'" },
                },
                {
                    label: "'age'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: marker1Range, newText: "'age'" },
                },
            ],
        },
        marker2: {
            completions: [
                {
                    label: "'name'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: marker2Range, newText: "'name'" },
                },
                {
                    label: "'age'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: marker2Range, newText: "'age'" },
                },
            ],
        },
        marker6: {
            completions: [],
        },
    });

    // @ts-ignore
    await helper.verifyCompletion('included', 'markdown', {
        marker3: {
            completions: [
                {
                    label: "'age'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: marker3Range, newText: "'age'" },
                },
            ],
        },
        marker4: {
            completions: [
                {
                    label: "'age'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: marker4Range, newText: "'age'" },
                },
            ],
        },
        marker5: {
            completions: [
                {
                    label: "'age'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: marker5Range, newText: "'age'" },
                },
            ],
        },
    });

    // @ts-ignore
    await helper.verifyCompletion('excluded', 'markdown', {
        marker3: {
            completions: [
                {
                    label: "'name'",
                    kind: Consts.CompletionItemKind.Constant,
                },
            ],
        },
        marker4: {
            completions: [
                {
                    label: "'name'",
                    kind: Consts.CompletionItemKind.Constant,
                },
            ],
        },
        marker5: {
            completions: [
                {
                    label: "'name'",
                    kind: Consts.CompletionItemKind.Constant,
                },
            ],
        },
    });
}
