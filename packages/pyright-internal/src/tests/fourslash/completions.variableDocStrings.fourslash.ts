/// <reference path="fourslash.ts" />

//// class Foo:
////     """ This is a docstring """

////     aaa = 4
////     """ aaa is an int """

////     def __init__(self) -> None:
////         self.bbb = "hi"
////         " bbb is a str "

//// ccc = Foo()
//// """ ccc is a Foo """

//// foo1.b[|/*marker1*/|]

//// foo1.a[|/*marker2*/|]

//// cc[|/*marker3*/|]

// @ts-ignore
await helper.verifyCompletion('includes', 'markdown', {
    marker1: {
        completions: [
            {
                label: 'bbb',
                kind: Consts.CompletionItemKind.Variable,
                documentation: '```python\nbbb: str\n```\n---\nbbb is a str',
            },
        ],
    },
    marker2: {
        completions: [
            {
                label: 'aaa',
                kind: Consts.CompletionItemKind.Variable,
                documentation: '```python\naaa: int\n```\n---\naaa is an int',
            },
        ],
    },
    marker3: {
        completions: [
            {
                label: 'ccc',
                kind: Consts.CompletionItemKind.Variable,
                documentation: '```python\nccc: Foo\n```\n---\nccc is a Foo',
            },
        ],
    },
});
