/// <reference path="typings/fourslash.d.ts" />

// Unpacked parameterized TypedDict as a variadic keyword parameter.
// expandTypedKwargs() (consumed by both signature help and completion literal-value suggestions)
// must substitute the TypedDict type argument. Before the fix, the `t` entry kept the unspecialized
// TypeVar `T@TD`, so no literal-value completions were offered; after the fix the entry is
// `Literal['a', 'b']`, so the literal values are offered at the call site.

// @filename: test.py
//// from typing import Generic, Literal, TypedDict, TypeVar, Unpack
////
//// T = TypeVar('T')
////
//// class TD(TypedDict, Generic[T]):
////     t: T
////
//// def func(**kwargs: Unpack[TD[Literal['a', 'b']]]) -> None: ...
////
//// func(t=[|/*marker*/|])

// @ts-ignore
await helper.verifyCompletion('included', 'markdown', {
    marker: {
        completions: [
            {
                label: "'a'",
                kind: Consts.CompletionItemKind.Constant,
            },
            {
                label: "'b'",
                kind: Consts.CompletionItemKind.Constant,
            },
        ],
    },
});
