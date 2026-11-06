/// <reference path="typings/fourslash.d.ts" />

// @filename: test1.py
//// class Op[T]:
////     @property
////     def completed(self) -> "Handler[int]": ...
////
////     @completed.setter
////     def completed(self, value: int) -> None: ...
////
//// type Handler[T] = list[Op[T]]

// @filename: test2.py
//// class Op[T]:
////     @property
////     def [|/*marker1*/completed|](self) -> "Handler[int]": ...
////
////     @completed.[|/*marker2*/settr|]
////     def completed(self, value: int) -> None: ...
////
//// type Handler[T] = list[Op[T]]

helper.verifyDiagnostics({
    marker1: {
        category: 'error',
        message: 'Method declaration "completed" is obscured by a declaration of the same name',
    },
    marker2: {
        category: 'error',
        message: 'Cannot access attribute "settr" for class "property"\n\u00a0\u00a0Attribute "settr" is unknown',
    },
});
