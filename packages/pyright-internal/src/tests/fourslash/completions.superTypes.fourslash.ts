/// <reference path="typings/fourslash.d.ts" />

// @filename: test.py
//// from typing import Generic, TypeVar
//// T = TypeVar("T")
//// class Base(Generic[T]):
////     def value(self) -> T:
////         raise NotImplementedError
//// class Child(Base[int]):
////     def method(self):
////         result = super().[|/*valid*/value/*completion*/|]()
////         print([|/*result*/result|])
////         super().[|/*invalid*/missing/*invalidCompletion*/|]()

// @ts-ignore
await helper.verifyCompletion('included', 'markdown', {
    completion: { completions: [{ label: 'value', kind: Consts.CompletionItemKind.Method }] },
});
// @ts-ignore
await helper.verifyCompletion('excluded', 'markdown', {
    invalidCompletion: { completions: [{ label: 'missing', kind: Consts.CompletionItemKind.Method }] },
});
helper.verifyHover('markdown', {
    valid: '```python\n(method) def value() -> int\n```',
    result: '```python\n(variable) result: int\n```',
});
helper.verifyDiagnostics({
    completion: { category: 'none', message: '' },
    result: { category: 'none', message: '' },
    invalidCompletion: {
        category: 'error',
        message: 'Cannot access attribute "missing" for class "object"\n\u00a0\u00a0Attribute "missing" is unknown',
    },
});
