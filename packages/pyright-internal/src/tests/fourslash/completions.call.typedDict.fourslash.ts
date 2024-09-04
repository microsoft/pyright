/// <reference path="typings/fourslash.d.ts" />

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
//// thing3({'wrapped': {'name': 'ET', '[|/*marker17*/|]'}})

{
    const marker1Range = helper.expandPositionRange(helper.getPositionRange('marker1'), 1, 1);
    const marker3Range = helper.expandPositionRange(helper.getPositionRange('marker3'), 1, 1);
    const marker4Range = helper.expandPositionRange(helper.getPositionRange('marker4'), 1, 1);
    const marker6Range = helper.expandPositionRange(helper.getPositionRange('marker6'), 3, 1);
    const marker7Range = helper.getPositionRange('marker7');
    const marker8Range = helper.expandPositionRange(helper.getPositionRange('marker8'), 1, 1);
    const marker9Range = helper.expandPositionRange(helper.getPositionRange('marker9'), 1, 1);
    const marker10Range = helper.expandPositionRange(helper.getPositionRange('marker10'), 1, 1);
    const marker11Range = helper.expandPositionRange(helper.getPositionRange('marker11'), 1, 1);
    const marker13Range = helper.expandPositionRange(helper.getPositionRange('marker13'), 1, 1);
    const marker14Range = helper.expandPositionRange(helper.getPositionRange('marker14'), 1, 1);
    const marker17Range = helper.expandPositionRange(helper.getPositionRange('marker17'), 1, 1);

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
            completions: [
                {
                    label: "'age'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: marker8Range, newText: "'age'" },
                },
                {
                    label: "'name'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: marker8Range, newText: "'name'" },
                },
            ],
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
        marker17: {
            completions: [
                {
                    label: "'age'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: marker17Range, newText: "'age'" },
                },
            ],
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
