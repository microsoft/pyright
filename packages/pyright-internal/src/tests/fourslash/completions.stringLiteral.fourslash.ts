/// <reference path="fourslash.ts" />

// @filename: test.py
//// import os
//// from typing import Literal, TypedDict, Union
////
//// def method(a, b, c):
////     pass
////
//// method("os.[|/*marker1*/|]")
////
//// class Movie(TypedDict):
////     name: str
////     age: int
////
//// m = Movie(name="hello", age=10)
//// m[[|"/*marker2*/"|]]
////
//// a: Union[Literal["hello"], Literal["hallo"]]
//// a = [|"/*marker3*/"|]

{
    const marker2Range = helper.getPositionRange('marker2');
    const marker3Range = helper.getPositionRange('marker3');

    // @ts-ignore
    await helper.verifyCompletion('exact', 'markdown', {
        marker1: { completions: [] },
        marker2: {
            completions: [
                {
                    label: '"name"',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: marker2Range, newText: '"name"' },
                },
                {
                    label: '"age"',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: marker2Range, newText: '"age"' },
                },
            ],
        },
        marker3: {
            completions: [
                {
                    label: '"hello"',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: marker3Range, newText: '"hello"' },
                },
                {
                    label: '"hallo"',
                    kind: Consts.CompletionItemKind.Constant,
                    textEdit: { range: marker3Range, newText: '"hallo"' },
                },
            ],
        },
    });
}
