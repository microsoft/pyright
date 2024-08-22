/// <reference path="typings/fourslash.d.ts" />
// @filename: pyrightconfig.json
//// {
////   "pythonVersion": "3.11"
//// }

// @filename: test.py
//// class MyType: pass
////
//// class B:
////     var1 = 1
////     var2: MyType
////     var3: list[str] = ["hello"]
////     __var4 = 4
////
////     def __init__(self):
////         self.var6 = 1
////
//// class T(B):
////     var5: bool
////     [|va/*marker1*/|]
////
//// class T1(B):
////     var2: [|/*marker2*/|]
////
//// class T2(B):
////     var3: [|/*marker3*/|]

// @filename: test2.py
//// from typing import Generic, Sequence, TypeVar
////
////
//// T = TypeVar("T")
////
//// class A(Generic[T]):
////     var: Sequence[T]
////
//// class B(A[int]):
////     var: [|/*marker4*/|]
////
//// T2 = TypeVar("T2")
////
//// class C(A[T2]):
////     var: [|/*marker5*/|]

// @filename: test3.py
//// from typing import Generic, TypeVarTuple
////
//// T = TypeVarTuple('T')
////
//// class MyType(Generic[*T]):
////     pass
////
//// class A(Generic[*T]):
////     var: MyType[*T]
////
//// class B(A[int, str, float]):
////     var: [|/*marker6*/|]
////
//// T2 = TypeVarTuple('T2')
////
//// class C(A[int, *T2]):
////     var: [|/*marker7*/|]

{
    helper.openFiles(helper.getMarkers().map((m) => m.fileName));

    // @ts-ignore
    await helper.verifyCompletion('included', 'markdown', {
        marker1: {
            completions: [
                {
                    label: 'var1',
                    kind: Consts.CompletionItemKind.Variable,
                },
                {
                    label: 'var2',
                    kind: Consts.CompletionItemKind.Variable,
                },
                {
                    label: 'var3',
                    kind: Consts.CompletionItemKind.Variable,
                },
            ],
        },
        marker2: {
            completions: [
                {
                    label: 'MyType',
                    kind: Consts.CompletionItemKind.Reference,
                },
            ],
        },
        marker3: {
            completions: [
                {
                    label: 'list[str]',
                    kind: Consts.CompletionItemKind.Reference,
                },
            ],
        },
        marker4: {
            completions: [
                {
                    label: 'Sequence[int]',
                    kind: Consts.CompletionItemKind.Reference,
                },
            ],
        },
        marker5: {
            completions: [
                {
                    label: 'Sequence[T2]',
                    kind: Consts.CompletionItemKind.Reference,
                },
            ],
        },
        marker6: {
            completions: [
                {
                    label: 'MyType[int, str, float]',
                    kind: Consts.CompletionItemKind.Reference,
                },
            ],
        },
        marker7: {
            completions: [
                {
                    label: 'MyType[int, *T2]',
                    kind: Consts.CompletionItemKind.Reference,
                },
            ],
        },
    });
}
