/// <reference path="fourslash.ts" />

// @filename: test.py
//// from typing import TypedDict, Optional, Union, List, Dict, Any
////
//// class Movie(TypedDict):
////     name: str
////     age: int
////
//// def thing(movie: Movie):
////     pass
////
//// thing({'[|/*marker1*/|]'})
//// thing({'name': '[|/*marker2*/|]'})
//// thing({'name': 'Robert','[|/*marker3*/|]'})
//// thing({'name': 'Robert',   '[|/*marker4*/|]'})
//// thing('[|/*marker5*/|]')
//// thing({'na[|/*marker6*/|]'})
//// thing({[|/*marker7*/|]})
//// thing({'a', '[|/*marker8*/|]'})
////
//// class Episode(TypedDict):
////     title: str
////     score: int
////
//// def thing2(item: Union[Episode, Movie]):
////    pass
////
//// thing2({'[|/*marker9*/|]'})
//// thing2({'unknown': 'a', '[|/*marker10*/|]': ''})
//// thing2({'title': 'Episode 01', '[|/*marker11*/|]': ''})
////
//// class Wrapper(TypedDict):
////     age: int
////     wrapped: Union[bool, Movie]
////     data: Dict[str, Any]
////
//// def thing3(wrapper: Optional[Wrapper]):
////     pass
////
//// thing3({'data': {'[|/*marker12*/|]'}})
//// thing3({'wrapped': {'[|/*marker13*/|]'}})
//// thing3({'age': 1, 'wrapped': {'[|/*marker14*/|]'}})
//// thing3({'unknown': {'[|/*marker15*/|]'}})
//// thing3({'age': {'[|/*marker16*/|]'}})

{
    const marker1Range = helper.getStringPositionRange('marker1');
    const marker3Range = helper.getStringPositionRange('marker3');
    const marker4Range = helper.getStringPositionRange('marker4');
    const marker6Range = helper.getStringPositionRange('marker6', /* start */ 3);
    const marker7Range = helper.getPositionRange('marker7');
    const marker9Range = helper.getStringPositionRange('marker9');
    const marker10Range = helper.getStringPositionRange('marker10');
    const marker11Range = helper.getStringPositionRange('marker11');
    const marker13Range = helper.getStringPositionRange('marker13');
    const marker14Range = helper.getStringPositionRange('marker14');

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
            completions: [],
        },
        marker3: {
            completions: [
                // TODO: this first completion is a bug
                {
                    label: 'movie=',
                    kind: Consts.CompletionItemKind.Variable,
                },
                {
                    label: "'age'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: marker3Range, newText: "'age'" },
                },
            ],
        },
        marker4: {
            completions: [
                // TODO: this first completion is a bug
                {
                    label: 'movie=',
                    kind: Consts.CompletionItemKind.Variable,
                },
                {
                    label: "'age'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: marker4Range, newText: "'age'" },
                },
            ],
        },
        marker5: {
            completions: [],
        },
        marker6: {
            completions: [
                {
                    label: "'name'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: marker6Range, newText: "'name'" },
                },
            ],
        },
        marker8: {
            completions: [],
        },
        marker9: {
            completions: [
                {
                    label: "'name'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: marker9Range, newText: "'name'" },
                },
                {
                    label: "'age'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: marker9Range, newText: "'age'" },
                },
                {
                    label: "'title'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: marker9Range, newText: "'title'" },
                },
                {
                    label: "'score'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: marker9Range, newText: "'score'" },
                },
            ],
        },
        marker10: {
            completions: [
                {
                    label: "'name'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: marker10Range, newText: "'name'" },
                },
                {
                    label: "'age'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: marker10Range, newText: "'age'" },
                },
                {
                    label: "'title'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: marker10Range, newText: "'title'" },
                },
                {
                    label: "'score'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: marker10Range, newText: "'score'" },
                },
            ],
        },
        marker11: {
            completions: [
                {
                    label: "'score'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: marker11Range, newText: "'score'" },
                },
            ],
        },
        marker12: {
            completions: [],
        },
        marker13: {
            completions: [
                {
                    label: "'name'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: marker13Range, newText: "'name'" },
                },
                {
                    label: "'age'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: marker13Range, newText: "'age'" },
                },
            ],
        },
        marker14: {
            completions: [
                {
                    label: "'name'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: marker14Range, newText: "'name'" },
                },
                {
                    label: "'age'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: marker14Range, newText: "'age'" },
                },
            ],
        },
        marker15: {
            completions: [],
        },
        marker16: {
            completions: [],
        },
    });

    // @ts-ignore
    await helper.verifyCompletion('included', 'markdown', {
        marker7: {
            completions: [
                {
                    label: "'name'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: marker7Range, newText: "'name'" },
                },
                {
                    label: "'age'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: marker7Range, newText: "'age'" },
                },
            ],
        },
    });
}
