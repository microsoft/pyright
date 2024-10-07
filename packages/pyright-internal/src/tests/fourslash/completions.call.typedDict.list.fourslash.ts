/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// from typing import TypedDict, Union, List
////
//// class Movie(TypedDict):
////     name: str
////     age: int
////
//// class MultipleInputs(TypedDict):
////     items: List[Movie]
////     union: Union[bool, List[Movie]]
////     unions: Union[Movie, Union[bool, List[Movie]]]
////
//// def thing(inputs: MultipleInputs):
////     pass
////
//// thing({'items': ['[|/*marker1*/|]']})
//// thing({'items': {'[|/*marker2*/|]'}})
//// thing({'items': [{'[|/*marker3*/|]'}]})
//// thing({'union': [{'[|/*marker4*/|]'}]})
//// thing({'unions': {'[|/*marker5*/|]'}})
//// thing({'unions': [{'[|/*marker6*/|]'}]})
////
//// def thing2(movies: List[Movie]):
////     pass
////
//// thing2([{'[|/*marker7*/|]'}])
//// thing2({'[|/*marker8*/|]'})
////
//// class Wrapper(TypedDict):
////     wrapped: MultipleInputs
////
//// def thing3(wrapper: Wrapper):
////     pass
////
//// thing3({'wrapped': {'items': [{'[|/*marker9*/|]'}]}})
//// thing3({'wrapped': {'items': {'[|/*marker10*/|]'}}})
//// thing3({'wrapped': {'items': [{'a': 'b'}, {'[|/*marker11*/|]'}]}})

{
    const marker3Range = helper.expandPositionRange(helper.getPositionRange('marker3'), 1, 1);
    const marker4Range = helper.expandPositionRange(helper.getPositionRange('marker4'), 1, 1);
    const marker5Range = helper.expandPositionRange(helper.getPositionRange('marker5'), 1, 1);
    const marker6Range = helper.expandPositionRange(helper.getPositionRange('marker6'), 1, 1);
    const marker7Range = helper.expandPositionRange(helper.getPositionRange('marker7'), 1, 1);
    const marker9Range = helper.expandPositionRange(helper.getPositionRange('marker9'), 1, 1);
    const marker11Range = helper.expandPositionRange(helper.getPositionRange('marker11'), 1, 1);

    // @ts-ignore
    await helper.verifyCompletion('exact', 'markdown', {
        marker1: {
            completions: [],
        },
        marker2: {
            completions: [],
        },
        marker3: {
            completions: [
                {
                    label: "'name'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: marker3Range, newText: "'name'" },
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
                {
                    label: "'name'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: marker4Range, newText: "'name'" },
                },
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
                    label: "'name'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: marker5Range, newText: "'name'" },
                },
                {
                    label: "'age'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: marker5Range, newText: "'age'" },
                },
            ],
        },
        marker6: {
            completions: [
                {
                    label: "'name'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: marker6Range, newText: "'name'" },
                },
                {
                    label: "'age'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: marker6Range, newText: "'age'" },
                },
            ],
        },
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
            ],
        },
        marker10: {
            completions: [],
        },
        marker11: {
            completions: [
                {
                    label: "'name'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: marker11Range, newText: "'name'" },
                },
                {
                    label: "'age'",
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: marker11Range, newText: "'age'" },
                },
            ],
        },
    });
}
