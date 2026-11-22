/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// class A:
////     def foo_bar(self) -> int:
////         return 1
////
//// class B(A):
////     def other(self):
////         super().[|/*empty*/|]
////         super().fo[|/*prefix*/|]
////         super(B, self).fo[|/*explicit*/|]
////         self.fo[|/*ordinary*/|]
////
////     @classmethod
////     def factory(cls):
////         super().fo[|/*classmethod*/|]

// @filename: multiple.py
//// class First:
////     def first_method(self) -> int: ...
//// class Second:
////     def second_method(self) -> str: ...
//// class Child(First, Second):
////     def child_method(self):
////         super().se[|/*second*/|]
////         super().second_method[|/*complete*/|]()
////         super(First, self).se[|/*skipFirst*/|]
////         super().ch[|/*child*/|]

// @ts-ignore
await helper.verifyCompletion('included', 'markdown', {
    second: { completions: [{ label: 'second_method', kind: Consts.CompletionItemKind.Method }] },
    complete: { completions: [{ label: 'second_method', kind: Consts.CompletionItemKind.Method }] },
    skipFirst: { completions: [{ label: 'second_method', kind: Consts.CompletionItemKind.Method }] },
    empty: { completions: [{ label: 'foo_bar', kind: Consts.CompletionItemKind.Method }] },
    prefix: { completions: [{ label: 'foo_bar', kind: Consts.CompletionItemKind.Method }] },
    explicit: { completions: [{ label: 'foo_bar', kind: Consts.CompletionItemKind.Method }] },
    ordinary: { completions: [{ label: 'foo_bar', kind: Consts.CompletionItemKind.Method }] },
    classmethod: { completions: [{ label: 'foo_bar', kind: Consts.CompletionItemKind.Method }] },
});

// @ts-ignore
await helper.verifyCompletion('excluded', 'markdown', {
    child: { completions: [{ label: 'child_method', kind: Consts.CompletionItemKind.Method }] },
});
